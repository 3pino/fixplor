//! 画面のパス（いちばん上からの相対・区切り `/`・名前は符号化しない）と、WebDAV の URL の対応。

use crate::fs::{FsError, FsResult};
use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use reqwest::Url;

/// URL の 1 段として符号化しない文字（RFC 3986 の unreserved）
const SEGMENT: &AsciiSet = &NON_ALPHANUMERIC.remove(b'-').remove(b'.').remove(b'_').remove(b'~');

/// 接続先の URL（`https://host/dav/`）。パスの終わりは必ず `/`。WebDAV の接続先（http・https）
pub fn parse_base(raw: &str) -> FsResult<Url> {
    parse_with(raw, &["http", "https"], "URL は http:// か https:// で始めてください")
}

/// 接続先の URL（WebDAV の http・https に加えて、SFTP の `sftp://host:22/home/me/`）。資格情報・証明書の固定で使う
pub fn parse_any(raw: &str) -> FsResult<Url> {
    parse_with(raw, &["http", "https", "sftp"], "URL は http://・https://・sftp:// で始めてください")
}

fn parse_with(raw: &str, schemes: &[&str], bad_scheme: &str) -> FsResult<Url> {
    let mut url = Url::parse(raw.trim()).map_err(|_| FsError::new("invalid", format!("URL を読めません: {raw}")))?;
    if !schemes.contains(&url.scheme()) {
        return Err(FsError::new("invalid", bad_scheme));
    }
    if url.host_str().is_none() {
        return Err(FsError::new("invalid", "URL にホスト名がありません"));
    }
    // 資格情報は URL に入れさせない（あとで、別に保管する）
    if !url.username().is_empty() || url.password().is_some() {
        return Err(FsError::new("invalid", "URL にユーザー名・パスワードは書けません"));
    }
    url.set_query(None);
    url.set_fragment(None);
    if !url.path().ends_with('/') {
        let p = format!("{}/", url.path());
        url.set_path(&p);
    }
    Ok(url)
}

/// 画面のパスの検査（`..`・空の段・NUL・`\` は受けない）。段の一覧を返す（いちばん上は空）
pub fn segments(rel: &str) -> FsResult<Vec<&str>> {
    if rel.is_empty() {
        return Ok(Vec::new());
    }
    let segs: Vec<&str> = rel.split('/').collect();
    if segs.iter().any(|s| s.is_empty() || *s == "." || *s == ".." || s.contains('\0') || s.contains('\\')) {
        return Err(FsError::new("invalid", format!("パスが正しくありません: {rel}")));
    }
    Ok(segs)
}

/// `base` の下の `rel` の URL。`dir` が真なら、終わりに `/` を付ける（フォルダ）
pub fn join(base: &Url, rel: &str, dir: bool) -> FsResult<Url> {
    let segs = segments(rel)?;
    let mut path = base.path().to_string();
    for s in &segs {
        path.push_str(&utf8_percent_encode(s, SEGMENT).to_string());
        path.push('/');
    }
    if !dir && !segs.is_empty() {
        path.pop();
    }
    let mut url = base.clone();
    // 符号化済みの文字をそのまま使う（set_path は二重に符号化しない）
    url.set_path(&path);
    Ok(url)
}

/// 応答の href（符号化されたパス、または絶対 URL）を、`base` からの相対のパスにする。base の外なら None
pub fn rel_of_href(base: &Url, href: &str) -> Option<String> {
    let path = if href.contains("://") { Url::parse(href).ok()?.path().to_string() } else { href.split(['?', '#']).next()?.to_string() };
    let decoded = percent_decode_str(&path).decode_utf8_lossy().into_owned();
    let base_path = percent_decode_str(base.path()).decode_utf8_lossy().into_owned();
    let rest = match decoded.strip_prefix(&base_path) {
        Some(r) => r,
        // base の末尾の `/` を除いた形（フォルダ自身）
        None if decoded == base_path.trim_end_matches('/') => "",
        None => return None,
    };
    Some(rest.trim_end_matches('/').to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> Url {
        parse_base("https://h.example/dav").unwrap()
    }

    #[test]
    fn base_gets_a_trailing_slash_and_drops_query_and_credentials_are_refused() {
        assert_eq!(base().as_str(), "https://h.example/dav/");
        assert_eq!(parse_base("http://h:8080/x/y/?q=1#f").unwrap().as_str(), "http://h:8080/x/y/");
        assert_eq!(parse_base("ftp://h/").unwrap_err().code, "invalid");
        assert_eq!(parse_base("not a url").unwrap_err().code, "invalid");
        assert_eq!(parse_base("https://u:p@h/").unwrap_err().code, "invalid");
    }

    #[test]
    fn join_encodes_each_segment() {
        assert_eq!(join(&base(), "", true).unwrap().as_str(), "https://h.example/dav/");
        assert_eq!(join(&base(), "docs/a b#?.txt", false).unwrap().as_str(), "https://h.example/dav/docs/a%20b%23%3F.txt");
        assert_eq!(join(&base(), "日本/語", true).unwrap().as_str(), "https://h.example/dav/%E6%97%A5%E6%9C%AC/%E8%AA%9E/");
        assert_eq!(join(&base(), "a%2Fb", false).unwrap().as_str(), "https://h.example/dav/a%252Fb");
    }

    #[test]
    fn sftp_base_is_accepted_only_by_parse_any() {
        assert_eq!(parse_any("sftp://h.example:2222/home/me").unwrap().as_str(), "sftp://h.example:2222/home/me/");
        assert_eq!(parse_any("sftp://h.example").unwrap().as_str(), "sftp://h.example/");
        assert_eq!(parse_any("https://h.example/dav").unwrap().as_str(), "https://h.example/dav/");
        assert_eq!(parse_base("sftp://h.example/").unwrap_err().code, "invalid");
        assert_eq!(parse_any("ftp://h.example/").unwrap_err().code, "invalid");
        assert_eq!(parse_any("sftp://u:p@h/").unwrap_err().code, "invalid");
    }

    #[test]
    fn dangerous_paths_are_refused() {
        for p in ["../x", "a/../b", "a//b", "/a", "a/", "a\\b", "a/./b", "a\0b"] {
            assert_eq!(join(&base(), p, false).unwrap_err().code, "invalid", "{p}");
        }
    }

    #[test]
    fn href_back_to_relative_path() {
        let b = base();
        assert_eq!(rel_of_href(&b, "/dav/").as_deref(), Some(""));
        assert_eq!(rel_of_href(&b, "/dav").as_deref(), Some(""));
        assert_eq!(rel_of_href(&b, "/dav/docs/a%20b.txt").as_deref(), Some("docs/a b.txt"));
        assert_eq!(rel_of_href(&b, "/dav/docs/").as_deref(), Some("docs"));
        assert_eq!(rel_of_href(&b, "https://h.example/dav/%E6%97%A5/x").as_deref(), Some("日/x"));
        assert_eq!(rel_of_href(&b, "/other/a"), None);
        assert_eq!(rel_of_href(&b, "/davx/a"), None);
    }

    #[test]
    fn join_then_href_roundtrip() {
        let b = base();
        for p in ["a", "a b/c#d", "日本語/ファイル.txt", "x%y/z&w"] {
            let u = join(&b, p, false).unwrap();
            assert_eq!(rel_of_href(&b, u.path()).as_deref(), Some(p));
        }
    }
}
