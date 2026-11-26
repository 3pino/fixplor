//! SFTP の、サーバーに依らない部分の試験（パスの対応・Range・Content-Type・失敗の写し方）。
//! サーバーへつなぐ部分は、実機で確かめる。

use super::ops::{err, mime_of, parse_range, remote, Range, Wanted};
use crate::webdav::secret::{Creds, MemoryStore};
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::protocol::{Status, StatusCode};
use std::sync::Arc;

#[test]
fn 画面のパスは_根の下のサーバーの絶対パスになる() {
    assert_eq!(remote("/home/me", "").unwrap(), "/home/me");
    assert_eq!(remote("/home/me", "docs/a b.txt").unwrap(), "/home/me/docs/a b.txt");
    // 根がいちばん上（/）のとき
    assert_eq!(remote("", "").unwrap(), "/");
    assert_eq!(remote("", "etc/hosts").unwrap(), "/etc/hosts");
}

#[test]
fn 根の外へ出るパスは断る() {
    for rel in ["../x", "a/../b", "a//b", "/a", "a\\b"] {
        assert_eq!(remote("/home/me", rel).unwrap_err().code, "invalid", "{rel}");
    }
}

#[test]
fn range_は_範囲が_1_つのものだけを読む() {
    assert_eq!(parse_range(None, 100), Wanted::Full);
    assert_eq!(parse_range(Some("bytes=0-9"), 100), Wanted::Part(Range { start: 0, end: 9 }));
    assert_eq!(parse_range(Some("bytes=90-"), 100), Wanted::Part(Range { start: 90, end: 99 }));
    assert_eq!(parse_range(Some("bytes=-10"), 100), Wanted::Part(Range { start: 90, end: 99 }));
    // 終わりが大きすぎれば、ファイルの終わりまで
    assert_eq!(parse_range(Some("bytes=50-5000"), 100), Wanted::Part(Range { start: 50, end: 99 }));
    // ファイルより長い「後ろから」は、全体
    assert_eq!(parse_range(Some("bytes=-500"), 100), Wanted::Part(Range { start: 0, end: 99 }));
}

#[test]
fn range_がファイルの外なら_満たせない_読めなければ全体() {
    assert_eq!(parse_range(Some("bytes=100-"), 100), Wanted::Unsatisfiable);
    assert_eq!(parse_range(Some("bytes=0-1"), 0), Wanted::Unsatisfiable);
    assert_eq!(parse_range(Some("bytes=0-1,5-6"), 100), Wanted::Full);
    assert_eq!(parse_range(Some("items=0-1"), 100), Wanted::Full);
    assert_eq!(parse_range(Some("bytes=9-3"), 100), Wanted::Full);
    assert_eq!(parse_range(Some("bytes=abc"), 100), Wanted::Full);
}

#[test]
fn range_の長さは_終わりを含める() {
    assert_eq!(Range { start: 0, end: 9 }.len(), 10);
    assert_eq!(Range { start: 5, end: 5 }.len(), 1);
}

#[test]
fn 表示に使う拡張子は_content_type_を返す() {
    assert_eq!(mime_of("a.PNG"), "image/png");
    assert_eq!(mime_of("x.tar.gz"), "application/octet-stream");
    assert_eq!(mime_of("noext"), "application/octet-stream");
    assert_eq!(mime_of("doc.pdf"), "application/pdf");
    assert_eq!(mime_of("pic.svg"), "image/svg+xml");
}

fn status(code: StatusCode) -> SftpError {
    SftpError::Status(Status { id: 1, status_code: code, error_message: "x".into(), language_tag: String::new() })
}

#[test]
fn サーバーの失敗は_画面が分岐に使う名前になる() {
    assert_eq!(err(status(StatusCode::NoSuchFile)).code, "not_found");
    assert_eq!(err(status(StatusCode::PermissionDenied)).code, "denied");
    assert_eq!(err(status(StatusCode::ConnectionLost)).code, "offline");
    assert_eq!(err(status(StatusCode::OpUnsupported)).code, "unsupported");
    assert_eq!(err(status(StatusCode::Failure)).code, "io");
    assert_eq!(err(SftpError::Timeout).code, "offline");
}

#[test]
fn 秘密鍵は_接続先が同じときだけ使い続ける() {
    let c = Creds::new(Arc::new(MemoryStore::default()));
    let base = "sftp://h.example/home/me/";
    c.set_with_key("p", base, "me", Some(""), Some("KEY-TEXT")).unwrap();
    assert!(c.info("p").unwrap().unwrap().has_key);
    let url = reqwest::Url::parse(base).unwrap();
    let a = c.for_ssh("p", &url).unwrap().unwrap();
    assert_eq!((a.user.as_str(), a.password, a.key.as_deref()), ("me", None, Some("KEY-TEXT")));
    // 鍵を指定しなければ、前の鍵を使い続ける（パスフレーズも）
    c.set_with_key("p", base, "me", None, None).unwrap();
    assert!(c.info("p").unwrap().unwrap().has_key);
    // 空の文字で、鍵を外す（パスワードでつなぐ）
    c.set_with_key("p", base, "me", Some("secret"), Some("")).unwrap();
    let b = c.for_ssh("p", &url).unwrap().unwrap();
    assert_eq!((b.password.as_deref(), b.key), (Some("secret"), None));
    // 接続先が別のものへは、保管した鍵を引き継がない
    c.set_with_key("p", base, "me", Some(""), Some("KEY-TEXT")).unwrap();
    assert_eq!(c.set_with_key("p", "sftp://other.example/", "me", None, None).unwrap_err().code, "invalid");
    c.set_with_key("p", "sftp://other.example/", "me", Some("pw"), None).unwrap();
    assert!(!c.info("p").unwrap().unwrap().has_key);
    // 鍵は sftp:// の接続先だけ
    assert_eq!(c.set_with_key("q", "https://h.example/dav/", "me", Some("pw"), Some("KEY")).unwrap_err().code, "invalid");
}

#[test]
fn 保管した資格情報は_別の接続先へ送らない() {
    let c = Creds::new(Arc::new(MemoryStore::default()));
    c.set("p", "sftp://a.example/", "me", Some("pw")).unwrap();
    let other = reqwest::Url::parse("sftp://b.example/").unwrap();
    assert_eq!(c.for_ssh("p", &other).unwrap_err().code, "auth");
    assert_eq!(c.for_ssh("none", &other).unwrap(), None);
}
