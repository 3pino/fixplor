//! WebDAV の資格情報（ユーザー名・パスワード）。保管は OS のキーチェーン（`SecretStore`）だけ。
//! キーチェーンが使えないときは、ほかの場所（ファイル・設定）へ書かずに、`keychain` の失敗にする。
//!
//! - 画面には、パスワードを返さない（`CredInfo` にパスワードの欄は無い）。変えるときは、画面が新しい値を渡す。
//! - 保管するものは「置き場所の id」→ {接続先の URL・ユーザー名・パスワード}。使うときは、要求の接続先が、
//!   保管したものと同じでなければ使わない（別のサーバーへ、保管したパスワードを送らない）。
//! - 暗号化されない http へは送らない（この端末の中の http だけは許す）。
//! - 読んだ値は、このプロセスの中に覚える（キーチェーンへの問い合わせを、要求のたびにしない）。

use super::url::parse_any;
use crate::fs::{FsError, FsResult};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// キーチェーンの入れ物（試験では、メモリの偽物に差し替える）
pub trait SecretStore: Send + Sync {
    /// 無ければ `Ok(None)`。使えないときは `Err(Unavailable)`
    fn get(&self, id: &str) -> Result<Option<String>, Unavailable>;
    fn set(&self, id: &str, secret: &str) -> Result<(), Unavailable>;
    /// 無くても成功
    fn delete(&self, id: &str) -> Result<(), Unavailable>;
}

/// キーチェーンが使えない（Secret Service が無い・ロックされたまま・権限が無い など）。理由は診断用
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unavailable(pub String);

impl From<Unavailable> for FsError {
    fn from(e: Unavailable) -> Self {
        FsError::new("keychain", format!("キーチェーンが使えません: {}", e.0))
    }
}

/// キーチェーンの中の 1 件の中身
#[derive(Clone, Serialize, Deserialize)]
struct Stored {
    base: String,
    user: String,
    /// SFTP で鍵を使うときは、鍵のパスフレーズ（無ければ空）
    password: String,
    /// SFTP の秘密鍵（OpenSSH などの文章そのまま）。パスワードで入るときは無い
    #[serde(default)]
    key: Option<String>,
}

/// 画面へ返す、保管している資格情報の様子（パスワードは含めない）
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CredInfo {
    pub user: String,
    pub base: String,
    /// 秘密鍵を保管している（SFTP）
    pub has_key: bool,
}

/// SFTP の認証に使う資格情報
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SshAuth {
    pub user: String,
    /// パスワード（鍵があるときは、鍵のパスフレーズ。無ければ None）
    pub password: Option<String>,
    pub key: Option<String>,
}

/// 暗号化されていない http へ、パスワードを送ってよい場所か（https と、この端末の中だけ）
pub fn may_send_credentials(url: &Url) -> bool {
    match url.scheme() {
        "https" => true,
        // SSH は、経路が暗号化されている
        "sftp" => true,
        "http" => {
            let Some(h) = url.host_str() else { return false };
            h.eq_ignore_ascii_case("localhost")
                || h.parse::<std::net::Ipv4Addr>().is_ok_and(|a| a.is_loopback())
                || h.trim_start_matches('[').trim_end_matches(']').parse::<std::net::Ipv6Addr>().is_ok_and(|a| a.is_loopback())
        }
        _ => false,
    }
}

const NOT_SECURE: &str = "暗号化されていない http へは、パスワードを送れません。https の URL にしてください（この端末の中の http だけは使えます）";

pub struct Creds {
    store: Arc<dyn SecretStore>,
    cache: Mutex<HashMap<String, Option<Stored>>>,
}

impl Creds {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self { store, cache: Mutex::new(HashMap::new()) }
    }

    fn load(&self, place: &str) -> FsResult<Option<Stored>> {
        if let Some(hit) = self.cache.lock().unwrap().get(place) {
            return Ok(hit.clone());
        }
        let found = match self.store.get(place)? {
            None => None,
            // 読めない中身は、無いものとして扱う（上書きで直せる）
            Some(raw) => serde_json::from_str::<Stored>(&raw).ok(),
        };
        self.cache.lock().unwrap().insert(place.to_string(), found.clone());
        Ok(found)
    }

    /// 保管している資格情報の様子（無ければ `None`）。パスワードは返さない
    pub fn info(&self, place: &str) -> FsResult<Option<CredInfo>> {
        Ok(self.load(place)?.map(|s| CredInfo { user: s.user, base: s.base, has_key: s.key.is_some() }))
    }

    /// 保管する。`password` が無ければ、保管済みのパスワードを使い続ける（ユーザー名だけを変える。接続先が変わるなら断る）
    pub fn set(&self, place: &str, base: &str, user: &str, password: Option<&str>) -> FsResult<()> {
        self.set_with_key(place, base, user, password, None)
    }

    /// `set` に、SFTP の秘密鍵を足したもの。`key` が `None` なら保管済みの鍵を使い続け（接続先が同じとき）、`Some("")` なら鍵を外し、文章があればそれに替える。
    /// 鍵があるときの `password` は、鍵のパスフレーズ（空でもよい）
    pub fn set_with_key(&self, place: &str, base: &str, user: &str, password: Option<&str>, key: Option<&str>) -> FsResult<()> {
        let base_url = parse_any(base)?;
        if user.is_empty() {
            return Err(FsError::new("invalid", "ユーザー名がありません"));
        }
        if user.contains(':') {
            return Err(FsError::new("invalid", "ユーザー名に : は使えません"));
        }
        if !may_send_credentials(&base_url) {
            return Err(FsError::new("invalid", NOT_SECURE));
        }
        let same_base = |old: &Stored| old.base == base_url.as_str();
        let password = match password {
            Some(p) => p.to_string(),
            None => {
                let old = self.load(place)?.ok_or_else(|| FsError::new("invalid", "パスワードがありません"))?;
                // 別のサーバーへ、保管したパスワードを引き継がない（接続先を変えるときは、入れ直してもらう）
                if !same_base(&old) {
                    return Err(FsError::new("invalid", "接続先を変えるときは、パスワードも入れ直してください"));
                }
                old.password
            }
        };
        let key = match key {
            Some("") => None,
            Some(k) => {
                if base_url.scheme() != "sftp" {
                    return Err(FsError::new("invalid", "秘密鍵は sftp:// の接続先だけで使えます"));
                }
                Some(k.to_string())
            }
            // 保管済みの鍵は、接続先が同じときだけ使い続ける
            None => self.load(place)?.filter(|old| same_base(old)).and_then(|old| old.key),
        };
        let stored = Stored { base: base_url.as_str().to_string(), user: user.to_string(), password, key };
        let raw = serde_json::to_string(&stored).map_err(|e| FsError::new("io", e.to_string()))?;
        // 先にキーチェーンへ。書けなければ、覚えも変えない
        self.store.set(place, &raw)?;
        self.cache.lock().unwrap().insert(place.to_string(), Some(stored));
        Ok(())
    }

    /// 保管している資格情報を消す（無くても成功）
    pub fn clear(&self, place: &str) -> FsResult<()> {
        self.store.delete(place)?;
        self.cache.lock().unwrap().insert(place.to_string(), None);
        Ok(())
    }

    /// 要求に付ける資格情報。保管が無ければ `None`（認証なしで送る）。
    /// 保管が別の接続先のもの・暗号化されない接続先なら、送らずに `auth` の失敗にする
    pub fn for_base(&self, place: &str, base: &Url) -> FsResult<Option<(String, String)>> {
        let Some(s) = self.load(place)? else { return Ok(None) };
        if s.base != base.as_str() {
            return Err(FsError::new("auth", "保管している資格情報は、この接続先のものではありません。置き場所を直して、入れ直してください"));
        }
        if !may_send_credentials(base) {
            return Err(FsError::new("auth", NOT_SECURE));
        }
        Ok(Some((s.user, s.password)))
    }

    /// SFTP の認証に使う資格情報。保管が無ければ `None`。保管が別の接続先のものなら、送らずに `auth` の失敗にする
    pub fn for_ssh(&self, place: &str, base: &Url) -> FsResult<Option<SshAuth>> {
        let Some(s) = self.load(place)? else { return Ok(None) };
        if s.base != base.as_str() {
            return Err(FsError::new("auth", "保管している資格情報は、この接続先のものではありません。置き場所を直して、入れ直してください"));
        }
        Ok(Some(SshAuth { user: s.user, password: Some(s.password).filter(|p| !p.is_empty()), key: s.key }))
    }
}

/// 試験用の、メモリの入れ物（`fail` が真なら、いつも使えない）
#[derive(Default)]
pub struct MemoryStore {
    pub map: Mutex<HashMap<String, String>>,
    pub fail: bool,
}

impl SecretStore for MemoryStore {
    fn get(&self, id: &str) -> Result<Option<String>, Unavailable> {
        if self.fail {
            return Err(Unavailable("試験".into()));
        }
        Ok(self.map.lock().unwrap().get(id).cloned())
    }
    fn set(&self, id: &str, secret: &str) -> Result<(), Unavailable> {
        if self.fail {
            return Err(Unavailable("試験".into()));
        }
        self.map.lock().unwrap().insert(id.to_string(), secret.to_string());
        Ok(())
    }
    fn delete(&self, id: &str) -> Result<(), Unavailable> {
        if self.fail {
            return Err(Unavailable("試験".into()));
        }
        self.map.lock().unwrap().remove(id);
        Ok(())
    }
}

/// OS のキーチェーン
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub struct OsStore;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl OsStore {
    const SERVICE: &'static str = "fixplor-webdav";

    fn entry(id: &str) -> Result<keyring::Entry, Unavailable> {
        keyring::Entry::new(Self::SERVICE, id).map_err(|e| Unavailable(e.to_string()))
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl SecretStore for OsStore {
    fn get(&self, id: &str) -> Result<Option<String>, Unavailable> {
        match Self::entry(id)?.get_password() {
            Ok(s) => Ok(Some(s)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(Unavailable(e.to_string())),
        }
    }
    fn set(&self, id: &str, secret: &str) -> Result<(), Unavailable> {
        Self::entry(id)?.set_password(secret).map_err(|e| Unavailable(e.to_string()))
    }
    fn delete(&self, id: &str) -> Result<(), Unavailable> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(Unavailable(e.to_string())),
        }
    }
}

/// Android: Keystore の鍵で包んだファイル（storage プラグインの Kotlin。1 件 1 ファイルで、平文は書かない）。
/// 使えないとき（鍵が無い・壊れている・プラグインが無い）は `Unavailable` を返す（平文へは逃がさない）。
#[cfg(target_os = "android")]
pub struct OsStore;

#[cfg(target_os = "android")]
impl OsStore {
    fn call(command: &str, payload: serde_json::Value) -> Result<serde_json::Value, Unavailable> {
        tauri_plugin_fixplor_storage::call_secret(command, payload).map_err(Unavailable)
    }
}

#[cfg(target_os = "android")]
impl SecretStore for OsStore {
    fn get(&self, id: &str) -> Result<Option<String>, Unavailable> {
        let r = Self::call("secretGet", serde_json::json!({ "id": id }))?;
        if r.get("found").and_then(|v| v.as_bool()) == Some(true) {
            match r.get("value").and_then(|v| v.as_str()) {
                Some(s) => Ok(Some(s.to_string())),
                None => Err(Unavailable("資格情報の形が違います".into())),
            }
        } else {
            Ok(None)
        }
    }
    fn set(&self, id: &str, secret: &str) -> Result<(), Unavailable> {
        Self::call("secretSet", serde_json::json!({ "id": id, "value": secret })).map(|_| ())
    }
    fn delete(&self, id: &str) -> Result<(), Unavailable> {
        Self::call("secretDelete", serde_json::json!({ "id": id })).map(|_| ())
    }
}

/// iOS（対象外）: いつも使えない
#[cfg(target_os = "ios")]
pub struct OsStore;

#[cfg(target_os = "ios")]
impl SecretStore for OsStore {
    fn get(&self, _: &str) -> Result<Option<String>, Unavailable> {
        Err(Unavailable("この OS には対応していません".into()))
    }
    fn set(&self, _: &str, _: &str) -> Result<(), Unavailable> {
        self.get("").map(|_| ())
    }
    fn delete(&self, _: &str) -> Result<(), Unavailable> {
        self.get("").map(|_| ())
    }
}
