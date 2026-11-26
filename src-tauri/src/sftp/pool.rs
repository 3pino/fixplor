//! SFTP の接続（つなぐ・認証・ホスト鍵の確かめ・使い回し）。

use crate::fs::{FsError, FsResult};
use crate::webdav::commands::Conns;
use crate::webdav::pin::{to_hex, Fingerprint, Probe};
use crate::webdav::secret::SshAuth;
use crate::webdav::url::parse_any;
use percent_encoding::percent_decode_str;
use russh::client;
use russh::keys::{decode_secret_key, HashAlg, PrivateKeyWithHashAlg, PublicKeyOrCertificate};
use russh_sftp::client::SftpSession;
use std::collections::HashMap;
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// つなぎ始めてから、認証・SFTP の開始までの上限
const CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
/// 1 つの要求の返事を待つ上限（秒）
const REQUEST_TIMEOUT_SECS: u64 = 60;

/// サーバーのホスト鍵の確かめ。固定（`want`）と同じときだけ受け入れる。示された鍵は、いつも `seen` に残す
struct Check {
    want: Option<Fingerprint>,
    seen: Arc<Mutex<Option<Fingerprint>>>,
}

impl client::Handler for Check {
    type Error = russh::Error;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let fp = match key {
            PublicKeyOrCertificate::PublicKey { key, .. } => key.key_data().fingerprint(HashAlg::Sha256),
            PublicKeyOrCertificate::Certificate(c) => c.public_key().fingerprint(HashAlg::Sha256),
        };
        let Some(fp) = fp.sha256() else { return Ok(false) };
        *self.seen.lock().unwrap() = Some(fp);
        Ok(self.want == Some(fp))
    }
}

/// つないだ 1 つの置き場所
pub struct Conn {
    /// 接続先（正規の形）。置き場所の接続先が変わったら、使い回さない
    base: String,
    /// サーバーの絶対パスの根（`/home/me`。いちばん上は空文字）
    pub root: String,
    pub sftp: SftpSession,
    /// 持っておく（落とすと切れる）。切れたかの確かめにも使う
    handle: Mutex<client::Handle<Check>>,
}

impl Conn {
    fn alive(&self) -> bool {
        !self.handle.lock().unwrap().is_closed()
    }
}

/// 置き場所ごとの、つないだままの接続
#[derive(Default)]
pub struct Pool {
    conns: Mutex<HashMap<String, Arc<Conn>>>,
    /// つなぐ処理は 1 つずつ（サムネイルなどが一斉に来ても、つなぎ直しを重ねない）
    connecting: tokio::sync::Mutex<()>,
}

impl Pool {
    fn cached(&self, place: &str, base: &str) -> Option<Arc<Conn>> {
        let map = self.conns.lock().unwrap();
        map.get(place).filter(|c| c.base == base && c.alive()).cloned()
    }

    fn put(&self, place: &str, conn: Arc<Conn>) {
        self.conns.lock().unwrap().insert(place.to_string(), conn);
    }

    /// 使えなくなった接続を外す（別の接続に替わっていたら外さない）
    fn forget(&self, place: &str, conn: &Arc<Conn>) {
        let mut map = self.conns.lock().unwrap();
        if map.get(place).is_some_and(|c| Arc::ptr_eq(c, conn)) {
            map.remove(place);
        }
    }
}

fn offline(e: impl std::fmt::Display) -> FsError {
    FsError::new("offline", format!("接続できません: {e}"))
}

/// 接続の失敗を、`FsError` にする。ホスト鍵を見たあとの失敗は、鍵の固定の話（確認が要る・変わった）
fn connect_error(e: russh::Error, want: Option<Fingerprint>, seen: &Mutex<Option<Fingerprint>>) -> FsError {
    if let Some(fp) = *seen.lock().unwrap() {
        if Some(fp) != want {
            return match want {
                Some(_) => FsError::new("cert_changed", "サーバーのホスト鍵が、前に信頼したものと違います"),
                None => FsError::new("tls", "サーバーのホスト鍵を確認していません"),
            };
        }
    }
    offline(e)
}

/// サーバーのパスの根（`sftp://h/home/me/` → `/home/me`）
fn root_of(url: &reqwest::Url) -> String {
    let decoded = percent_decode_str(url.path()).decode_utf8_lossy().into_owned();
    decoded.trim_end_matches('/').to_string()
}

/// 認証して、SFTP を始める
async fn open(url: &reqwest::Url, auth: Option<&SshAuth>, want: Option<Fingerprint>, seen: &Arc<Mutex<Option<Fingerprint>>>) -> FsResult<Conn> {
    let host = url.host_str().ok_or_else(|| FsError::new("invalid", "URL にホスト名がありません"))?.trim_start_matches('[').trim_end_matches(']').to_string();
    let port = url.port().unwrap_or(22);
    let config = Arc::new(client::Config { keepalive_interval: Some(Duration::from_secs(30)), keepalive_max: 3, ..Default::default() });
    let handler = Check { want, seen: seen.clone() };
    let mut handle = match tokio::time::timeout(CONNECT_TIMEOUT, client::connect(config, (host, port), handler)).await {
        Err(_) => return Err(FsError::new("offline", "接続がタイムアウトしました")),
        Ok(Err(e)) => return Err(connect_error(e, want, seen)),
        Ok(Ok(h)) => h,
    };
    let auth = auth.ok_or_else(|| FsError::new("auth", "ユーザー名とパスワード（または秘密鍵）を設定してください"))?;
    let result = match &auth.key {
        Some(key) => {
            let pk = decode_secret_key(key, auth.password.as_deref()).map_err(|_| FsError::new("auth", "秘密鍵を読めません（形式か、パスフレーズを確かめてください）"))?;
            let hash = handle.best_supported_rsa_hash().await.ok().flatten().flatten();
            handle.authenticate_publickey(auth.user.clone(), PrivateKeyWithHashAlg::new(Arc::new(pk), hash)).await
        }
        None => handle.authenticate_password(auth.user.clone(), auth.password.clone().unwrap_or_default()).await,
    }
    .map_err(offline)?;
    if !result.success() {
        return Err(FsError::new("auth", "認証できませんでした（ユーザー名・パスワード・秘密鍵を確かめてください）"));
    }
    let channel = handle.channel_open_session().await.map_err(offline)?;
    channel.request_subsystem(true, "sftp").await.map_err(|e| FsError::new("unsupported", format!("サーバーが SFTP を使えません: {e}")))?;
    let sftp = SftpSession::new(channel.into_stream()).await.map_err(super::ops::err)?;
    sftp.set_timeout(REQUEST_TIMEOUT_SECS);
    Ok(Conn { base: url.as_str().to_string(), root: root_of(url), sftp, handle: Mutex::new(handle) })
}

/// 置き場所の接続（つないだものがあれば、それ。無ければ、つなぐ）
pub async fn session(conns: &Conns, place: &str, base: &str) -> FsResult<Arc<Conn>> {
    let url = parse_any(base)?;
    if url.scheme() != "sftp" {
        return Err(FsError::new("invalid", "sftp:// の接続先ではありません"));
    }
    if let Some(c) = conns.sftp.cached(place, url.as_str()) {
        return Ok(c);
    }
    let _one = conns.sftp.connecting.lock().await;
    // 待っている間に、別の呼び出しがつないだかもしれない
    if let Some(c) = conns.sftp.cached(place, url.as_str()) {
        return Ok(c);
    }
    let creds = conns.creds.clone();
    let (p, u) = (place.to_string(), url.clone());
    // キーチェーンへの問い合わせは待つことがあるので、別のスレッドで行う
    let auth = tokio::task::spawn_blocking(move || creds.for_ssh(&p, &u)).await.map_err(|e| FsError::new("io", e.to_string()))??;
    let want = conns.pins.for_base(place, &url);
    let seen = Arc::new(Mutex::new(None));
    let conn = Arc::new(open(&url, auth.as_ref(), want, &seen).await?);
    conns.sftp.put(place, conn.clone());
    Ok(conn)
}

/// 接続を使って操作する。接続が切れていた（`offline`）ら、つなぎ直して 1 回だけやり直す
pub async fn with<T, F, Fut>(conns: &Conns, place: &str, base: &str, f: F) -> FsResult<T>
where
    F: Fn(Arc<Conn>) -> Fut,
    Fut: Future<Output = FsResult<T>>,
{
    let conn = session(conns, place, base).await?;
    match f(conn.clone()).await {
        Err(e) if e.code == "offline" => {
            conns.sftp.forget(place, &conn);
            let again = session(conns, place, base).await?;
            f(again).await
        }
        other => other,
    }
}

/// サーバーのホスト鍵を確かめる。固定が無い状態でつないで、示された鍵の指紋を返す（認証は始めない。パスワードも送らない）
pub async fn probe(base: &str) -> FsResult<Probe> {
    let url = parse_any(base)?;
    if url.scheme() != "sftp" {
        return Err(FsError::new("invalid", "ホスト鍵の確認は sftp:// の接続先だけです"));
    }
    let host = url.host_str().ok_or_else(|| FsError::new("invalid", "URL にホスト名がありません"))?.trim_start_matches('[').trim_end_matches(']').to_string();
    let seen = Arc::new(Mutex::new(None));
    let handler = Check { want: None, seen: seen.clone() };
    let config = Arc::new(client::Config::default());
    let r = tokio::time::timeout(CONNECT_TIMEOUT, client::connect(config, (host, url.port().unwrap_or(22)), handler)).await;
    let fp = *seen.lock().unwrap();
    match fp {
        // 鍵を見たら、拒んで終える（接続は成り立たない）
        Some(fp) => Ok(Probe { trusted: false, fingerprint: Some(to_hex(&fp)), not_after: None }),
        None => match r {
            Err(_) => Err(FsError::new("offline", "接続がタイムアウトしました")),
            Ok(Err(e)) => Err(offline(e)),
            Ok(Ok(_)) => Err(FsError::new("tls", "ホスト鍵を取得できませんでした")),
        },
    }
}
