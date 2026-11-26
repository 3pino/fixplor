//! 証明書の指紋の固定。自己署名・私的な認証局の証明書の https の置き場所を、置き場所ごとに「この証明書だけ」と決める。
//!
//! - 固定するのは、サーバーが示す葉の証明書（DER）の SHA-256。固定のある置き場所は、その証明書だけを受け入れる。
//!   チェーン・ホスト名・有効期限は見ない（葉の証明書そのものを信頼するため）。ただし、握手の署名（その証明書の鍵を持つ証明）は必ず確かめる。
//! - 指紋は秘密ではないので、キーチェーンではなく、設定フォルダの JSON（`dav-pins.json`）に置く（キーチェーンの無い環境でも使える）。
//! - 固定は、固定したときの接続先（URL）にだけ効く。接続先が違えば使わない（URL を変えたら外れる）。
//! - 確認（`probe`）は、握手の途中で止める。HTTP の要求は 1 つも送らない（資格情報も送らない）。

use super::client::{client_builder, net_error};
use super::url::{parse_any, parse_base};
use crate::fs::{FsError, FsResult};
use reqwest::{Client, Url};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{verify_tls12_signature, verify_tls13_signature, CryptoProvider, WebPkiSupportedAlgorithms};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error as TlsError, SignatureScheme};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// 固定と違う証明書を見たときの、握手の失敗の印（`net_error` が `cert_changed` に直す）
pub const PIN_MISMATCH: &str = "fixplor:pin-mismatch";
/// 確認のために握手を止めた印
const PROBE_STOP: &str = "fixplor:probe-stop";

pub type Fingerprint = [u8; 32];

pub fn fingerprint_of(der: &[u8]) -> Fingerprint {
    Sha256::digest(der).into()
}

/// 小文字の 16 進 64 桁
pub fn to_hex(f: &Fingerprint) -> String {
    f.iter().map(|b| format!("{b:02x}")).collect()
}

/// 16 進 64 桁（`:`・空白・`-` の区切り、大文字小文字は問わない）を読む
pub fn parse_fingerprint(raw: &str) -> FsResult<Fingerprint> {
    let hex: String = raw.chars().filter(|c| !matches!(c, ':' | ' ' | '-' | '\t')).collect();
    let bad = || FsError::new("invalid", "指紋は SHA-256 の 16 進 64 桁です");
    if hex.len() != 64 || !hex.is_ascii() {
        return Err(bad());
    }
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).map_err(|_| bad())?;
    }
    Ok(out)
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq, Debug)]
struct PinRec {
    base: String,
    fingerprint: String,
}

/// 画面へ返す、固定の様子
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PinInfo {
    pub base: String,
    /// 小文字の 16 進 64 桁
    pub fingerprint: String,
}

/// 置き場所 id → 固定。アプリで 1 つ。`path` が無ければ、保存しない（試験用）
pub struct Pins {
    path: Option<PathBuf>,
    /// 保存しない入れ物（試験用）。false で保存先も無ければ、固定の設定は断る
    volatile: bool,
    map: Mutex<HashMap<String, PinRec>>,
}

impl Pins {
    /// 保存先から読む。無い・読めない中身は、空として始める（固定が無いだけ。通常の確かめに戻る）
    pub fn load(path: Option<PathBuf>) -> Self {
        let map = path
            .as_ref()
            .and_then(|p| std::fs::read_to_string(p).ok())
            .and_then(|s| serde_json::from_str::<HashMap<String, PinRec>>(&s).ok())
            .unwrap_or_default();
        Self { path, volatile: false, map: Mutex::new(map) }
    }

    /// 保存しない入れ物（試験用）
    pub fn memory() -> Self {
        Self { path: None, volatile: true, map: Mutex::new(HashMap::new()) }
    }

    fn persist(&self, map: &HashMap<String, PinRec>) -> FsResult<()> {
        let Some(path) = &self.path else {
            return if self.volatile { Ok(()) } else { Err(FsError::new("io", "固定の保存先（設定フォルダ）がありません")) };
        };
        let json = serde_json::to_string_pretty(map).map_err(|e| FsError::new("io", e.to_string()))?;
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| FsError::new("io", format!("固定の保存先を作れません: {e}")))?;
        }
        // 一時のファイルへ書いてから付け替える（途中で止まっても、前の中身が残る）
        let tmp = path.with_extension("json.tmp");
        std::fs::write(&tmp, json).and_then(|()| std::fs::rename(&tmp, path)).map_err(|e| FsError::new("io", format!("固定を保存できません: {e}")))
    }

    pub fn info(&self, place: &str) -> Option<PinInfo> {
        self.map.lock().unwrap().get(place).map(|r| PinInfo { base: r.base.clone(), fingerprint: r.fingerprint.clone() })
    }

    /// 固定する（置き場所の前の固定は置き換える）。https の接続先（証明書の指紋）と、sftp の接続先（ホスト鍵の指紋）だけ
    pub fn set(&self, place: &str, base: &str, fingerprint: &str) -> FsResult<()> {
        let url = parse_any(base)?;
        if !matches!(url.scheme(), "https" | "sftp") {
            return Err(FsError::new("invalid", "証明書・ホスト鍵の固定は https と sftp の接続先だけです"));
        }
        let fp = parse_fingerprint(fingerprint)?;
        let mut map = self.map.lock().unwrap();
        let mut next = map.clone();
        next.insert(place.to_string(), PinRec { base: url.as_str().to_string(), fingerprint: to_hex(&fp) });
        // 先に保存。書けなければ、覚えも変えない
        self.persist(&next)?;
        *map = next;
        Ok(())
    }

    /// 解除する（無くても成功）
    pub fn clear(&self, place: &str) -> FsResult<()> {
        let mut map = self.map.lock().unwrap();
        if !map.contains_key(place) {
            return Ok(());
        }
        let mut next = map.clone();
        next.remove(place);
        self.persist(&next)?;
        *map = next;
        Ok(())
    }

    /// 要求に使う固定。固定が無い・別の接続先のものなら `None`（通常の確かめ）
    pub fn for_base(&self, place: &str, base: &Url) -> Option<Fingerprint> {
        let map = self.map.lock().unwrap();
        let rec = map.get(place)?;
        if rec.base != base.as_str() {
            return None;
        }
        parse_fingerprint(&rec.fingerprint).ok()
    }
}

fn provider() -> Arc<CryptoProvider> {
    Arc::new(rustls::crypto::ring::default_provider())
}

fn algs(p: &CryptoProvider) -> WebPkiSupportedAlgorithms {
    p.signature_verification_algorithms
}

/// 葉の証明書が固定と同じときだけ受け入れる
#[derive(Debug)]
struct PinVerifier {
    want: Fingerprint,
    algs: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for PinVerifier {
    fn verify_server_cert(&self, end_entity: &CertificateDer<'_>, _intermediates: &[CertificateDer<'_>], _name: &ServerName<'_>, _ocsp: &[u8], _now: UnixTime) -> Result<ServerCertVerified, TlsError> {
        if fingerprint_of(end_entity.as_ref()) == self.want {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(TlsError::General(PIN_MISMATCH.into()))
        }
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(message, cert, dss, &self.algs)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(message, cert, dss, &self.algs)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algs.supported_schemes()
    }
}

/// 示された葉の証明書を覚えて、必ず握手を止める（確認用）
#[derive(Debug)]
struct ProbeVerifier {
    seen: Arc<Mutex<Option<Vec<u8>>>>,
    algs: WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for ProbeVerifier {
    fn verify_server_cert(&self, end_entity: &CertificateDer<'_>, _intermediates: &[CertificateDer<'_>], _name: &ServerName<'_>, _ocsp: &[u8], _now: UnixTime) -> Result<ServerCertVerified, TlsError> {
        *self.seen.lock().unwrap() = Some(end_entity.as_ref().to_vec());
        Err(TlsError::General(PROBE_STOP.into()))
    }
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(message, cert, dss, &self.algs)
    }
    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(message, cert, dss, &self.algs)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algs.supported_schemes()
    }
}

fn client_with(verifier: Arc<dyn ServerCertVerifier>, p: Arc<CryptoProvider>) -> FsResult<Client> {
    let config = ClientConfig::builder_with_provider(p)
        .with_safe_default_protocol_versions()
        .map_err(|e| FsError::new("io", e.to_string()))?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();
    client_builder().use_preconfigured_tls(config).build().map_err(|e| FsError::new("io", e.to_string()))
}

/// 固定の証明書だけを受け入れる入れ物
pub fn pinned_client(want: Fingerprint) -> FsResult<Client> {
    let p = provider();
    let v = Arc::new(PinVerifier { want, algs: algs(&p) });
    client_with(v, p)
}

/// 確認の結果
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Probe {
    /// 通常の確かめ（OS の証明書の保管庫）で通る。固定は要らない
    pub trusted: bool,
    /// 示された証明書の指紋（小文字の 16 進 64 桁）。trusted なら null
    pub fingerprint: Option<String>,
    /// 証明書の有効期限（UTC。`2126-10-25T04:58:05Z`）。読めなければ null
    pub not_after: Option<String>,
}

/// 接続先の証明書を確かめる。通常の確かめで通れば `trusted`。通らなければ、握手の途中で止めて、示された証明書の指紋を返す
/// （HTTP の要求は、通常の確かめが通った後のもの（資格情報なし）を除いて、送らない）
pub async fn probe(base: &str) -> FsResult<Probe> {
    let url = parse_base(base)?;
    if url.scheme() != "https" {
        return Err(FsError::new("invalid", "証明書の確認は https の接続先だけです"));
    }
    // 1. 通常の確かめ（認証なし）。通れば固定は要らない
    match super::build_client().head(url.clone()).timeout(Duration::from_secs(20)).send().await {
        Ok(_) => return Ok(Probe { trusted: true, fingerprint: None, not_after: None }),
        Err(e) => {
            let fe = net_error(&e);
            if fe.code != "tls" {
                return Err(fe);
            }
        }
    }
    // 2. 示された証明書を覚えて止める
    let seen = Arc::new(Mutex::new(None));
    let p = provider();
    let v = Arc::new(ProbeVerifier { seen: seen.clone(), algs: algs(&p) });
    let client = client_with(v, p)?;
    let result = client.head(url).timeout(Duration::from_secs(20)).send().await;
    let der = seen.lock().unwrap().take();
    match der {
        Some(der) => Ok(Probe { trusted: false, fingerprint: Some(to_hex(&fingerprint_of(&der))), not_after: not_after(&der) }),
        None => match result {
            Err(e) => Err(net_error(&e)),
            Ok(_) => Err(FsError::new("tls", "証明書を取得できませんでした")),
        },
    }
}

// ---- 有効期限（DER を、必要な所だけ読む。読めなければ None） ----

/// DER の 1 つの値: (タグ, 中身, 残り)
fn tlv(b: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, rest) = b.split_first()?;
    let (&l0, rest) = rest.split_first()?;
    let (len, rest) = if l0 < 0x80 {
        (l0 as usize, rest)
    } else {
        let n = (l0 & 0x7f) as usize;
        if n == 0 || n > 4 || rest.len() < n {
            return None;
        }
        (rest[..n].iter().fold(0usize, |a, &x| (a << 8) | x as usize), &rest[n..])
    };
    if rest.len() < len {
        return None;
    }
    Some((tag, &rest[..len], &rest[len..]))
}

/// 証明書の notAfter を `YYYY-MM-DDTHH:MM:SSZ` にする
pub fn not_after(der: &[u8]) -> Option<String> {
    let (_, cert, _) = tlv(der)?; // Certificate
    let (_, tbs, _) = tlv(cert)?; // TBSCertificate
    let mut rest = tbs;
    let (tag, _, r) = tlv(rest)?;
    if tag == 0xa0 {
        rest = r; // version
    }
    // serialNumber・signature・issuer を飛ばす
    for _ in 0..3 {
        rest = tlv(rest)?.2;
    }
    let (_, validity, _) = tlv(rest)?;
    let (_, _before, r) = tlv(validity)?;
    let (tag, after, _) = tlv(r)?;
    let s = std::str::from_utf8(after).ok()?.strip_suffix('Z')?;
    let (year, tail) = match tag {
        0x17 => {
            // UTCTime: YYMMDDHHMMSS（50 以上は 19xx、未満は 20xx）
            let yy: u32 = s.get(..2)?.parse().ok()?;
            (if yy >= 50 { 1900 + yy } else { 2000 + yy }, s.get(2..)?)
        }
        0x18 => (s.get(..4)?.parse().ok()?, s.get(4..)?), // GeneralizedTime: YYYYMMDDHHMMSS
        _ => return None,
    };
    if tail.len() != 10 || !tail.bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    Some(format!("{year:04}-{}-{}T{}:{}:{}Z", &tail[0..2], &tail[2..4], &tail[4..6], &tail[6..8], &tail[8..10]))
}
