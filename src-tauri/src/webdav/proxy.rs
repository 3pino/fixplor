//! 表示（画像・PDF）の中継。WebView は、資格情報の要る置き場所の中身を `<img>` や `fetch` では読めない
//! （認証のヘッダーを付けられない・サーバーの CORS に頼れない・証明書の扱いが Rust と違う）ので、
//! 独自のスキーム（`fixdav://localhost/…`、Windows と Android は `http://fixdav.localhost/…`）を Rust が受けて、
//! 保管してある資格情報つきで取りに行く。置き場所の中身を WebView の自由な通信にはしない（GET と HEAD だけ）。
//!
//! URL の形: `/{置き場所の id}/{接続先の URL}/{パス}` の全体を 1 つの部品として符号化したもの
//! （id・接続先・パスの各段は、その中でさらに符号化されている）。`?` 以降（更新日時など）は無視する。
//! Range は、そのまま渡す（PDF は、要る分だけ読める）。メモリに載せる大きさの上限は `PROXY_MAX`。

use super::commands::Conns;
use crate::fs::FsError;
use percent_encoding::percent_decode_str;

/// 1 回の応答として、メモリに載せてよい大きさ（超えたら 413）
pub const PROXY_MAX: u64 = 256 * 1024 * 1024;

pub struct ProxyResponse {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub body: Vec<u8>,
}

/// WebView（別のオリジン）から読めるようにする。Range の読みに要る応答のヘッダーも見せる
fn cors(mut headers: Vec<(&'static str, String)>) -> Vec<(&'static str, String)> {
    headers.push(("Access-Control-Allow-Origin", "*".into()));
    headers.push(("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS".into()));
    headers.push(("Access-Control-Allow-Headers", "Range".into()));
    headers.push(("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges, Content-Type".into()));
    headers
}

fn plain(status: u16, text: &str) -> ProxyResponse {
    ProxyResponse { status, headers: cors(vec![("Content-Type", "text/plain; charset=utf-8".into())]), body: text.as_bytes().to_vec() }
}

fn status_of(e: &FsError) -> u16 {
    match e.code {
        "auth" => 401,
        "denied" => 403,
        "not_found" | "not_dir" => 404,
        "invalid" => 400,
        "too_large" => 413,
        "offline" | "tls" | "cert_changed" => 502,
        _ => 500,
    }
}

/// URL のパス部分を、(置き場所の id, 接続先, 接続先からの相対パス) に分ける
pub fn parse_path(uri_path: &str) -> Option<(String, String, String)> {
    let whole = percent_decode_str(uri_path.trim_start_matches('/')).decode_utf8().ok()?;
    let mut parts = whole.split('/');
    let dec = |s: &str| percent_decode_str(s).decode_utf8().ok().map(|c| c.into_owned());
    let place = dec(parts.next()?)?;
    let base = dec(parts.next()?)?;
    let rel = parts.map(dec).collect::<Option<Vec<_>>>()?.join("/");
    if place.is_empty() || base.is_empty() {
        return None;
    }
    Some((place, base, rel))
}

/// SFTP の置き場所の中身。Range は、範囲が 1 つのものだけを、そのまま読む（メモリに載せる大きさの上限は `max`）
async fn serve_sftp(conns: &Conns, method: &str, place: &str, base: &str, rel: &str, range: Option<&str>, max: u64) -> ProxyResponse {
    use crate::sftp::ops::{self, Range, Wanted};
    let total = match crate::sftp::pool::with(conns, place, base, |c| {
        let rel = rel.to_string();
        async move { ops::file_size(&c.sftp, &c.root, &rel).await }
    })
    .await
    {
        Ok(n) => n,
        Err(e) => return plain(status_of(&e), &e.message),
    };
    let (status, part) = match ops::parse_range(range, total) {
        Wanted::Unsatisfiable => return ProxyResponse { status: 416, headers: cors(vec![("Content-Range", format!("bytes */{total}"))]), body: vec![] },
        Wanted::Part(r) => (206, Some(r)),
        Wanted::Full if total == 0 => (200, None),
        Wanted::Full => (200, Some(Range { start: 0, end: total - 1 })),
    };
    let len = part.map_or(0, |r| r.len());
    let name = rel.rsplit('/').next().unwrap_or("");
    let mut headers = vec![("Content-Type", ops::mime_of(name).to_string()), ("Accept-Ranges", "bytes".to_string())];
    if let (206, Some(r)) = (status, part) {
        headers.push(("Content-Range", format!("bytes {}-{}/{total}", r.start, r.end)));
    }
    headers.push(("Cache-Control", "private, max-age=3600".into()));
    headers.push(("X-Content-Type-Options", "nosniff".into()));
    if method == "HEAD" {
        headers.push(("Content-Length", len.to_string()));
        return ProxyResponse { status, headers: cors(headers), body: vec![] };
    }
    if len > max {
        return plain(413, "大きすぎて、表示できません");
    }
    let Some(r) = part else { return ProxyResponse { status, headers: cors(headers), body: vec![] } };
    match crate::sftp::pool::with(conns, place, base, |c| {
        let rel = rel.to_string();
        async move { ops::read_range(&c.sftp, &c.root, &rel, r).await }
    })
    .await
    {
        Ok(body) => ProxyResponse { status, headers: cors(headers), body },
        Err(e) => plain(status_of(&e), &e.message),
    }
}

/// 1 件の要求に答える（Tauri に依らない。`lib.rs` のスキームの受け口が呼ぶ）
pub async fn serve(conns: &Conns, method: &str, uri_path: &str, range: Option<&str>) -> ProxyResponse {
    serve_limited(conns, method, uri_path, range, PROXY_MAX).await
}

/// `serve`（メモリに載せる大きさの上限を指定できる。試験用）
pub async fn serve_limited(conns: &Conns, method: &str, uri_path: &str, range: Option<&str>, max: u64) -> ProxyResponse {
    match method {
        "OPTIONS" => return ProxyResponse { status: 204, headers: cors(vec![]), body: vec![] },
        "GET" | "HEAD" => {}
        _ => return plain(405, "GET だけ使えます"),
    }
    let Some((place, base, rel)) = parse_path(uri_path) else { return plain(400, "URL が正しくありません") };
    if base.trim_start().starts_with("sftp:") {
        return serve_sftp(conns, method, &place, &base, &rel, range, max).await;
    }
    let dav = match conns.dav(&place, &base).await {
        Ok(d) => d,
        Err(e) => return plain(status_of(&e), &e.message),
    };
    let mut res = match dav.get_raw(&rel, range).await {
        Ok(r) => r,
        Err(e) => return plain(status_of(&e), &e.message),
    };
    let status = res.status().as_u16();
    let pass = |name: &'static str| res.headers().get(name).and_then(|v| v.to_str().ok()).map(str::to_string);
    let mut headers = vec![("Content-Type", pass("content-type").unwrap_or_else(|| "application/octet-stream".into()))];
    for (name, key) in [("Content-Range", "content-range"), ("Accept-Ranges", "accept-ranges"), ("ETag", "etag"), ("Last-Modified", "last-modified")] {
        if let Some(v) = pass(key) {
            headers.push((name, v));
        }
    }
    // 中身の URL に更新日時を付けてあるので、同じ URL は同じ中身（別の版は別の URL）
    headers.push(("Cache-Control", "private, max-age=3600".into()));
    headers.push(("X-Content-Type-Options", "nosniff".into()));
    if method == "HEAD" {
        if let Some(n) = res.content_length() {
            headers.push(("Content-Length", n.to_string()));
        }
        return ProxyResponse { status, headers: cors(headers), body: vec![] };
    }
    if res.content_length().is_some_and(|n| n > max) {
        return plain(413, "大きすぎて、表示できません");
    }
    let mut body = Vec::new();
    loop {
        match res.chunk().await {
            Ok(Some(c)) => {
                if body.len() as u64 + c.len() as u64 > max {
                    return plain(413, "大きすぎて、表示できません");
                }
                body.extend_from_slice(&c);
            }
            Ok(None) => break,
            Err(e) => {
                let e = super::net_error(&e);
                return plain(status_of(&e), &e.message);
            }
        }
    }
    ProxyResponse { status, headers: cors(headers), body }
}
