//! OS のクリップボードに、コピー・切り取りしたファイルを書く（エクスプローラー・ファイルマネージャーに貼り付けられるように）。
//!
//! 書くのはファイルの一覧（と、コピーか移動か）だけで、文字（パスの並び）は書かない。
//!  - Windows: `CF_HDROP`（ファイルの一覧）と `Preferred DropEffect`（コピー = 1・移動 = 2）。
//!  - Linux: `text/uri-list`・`x-special/gnome-copied-files`（GNOME・Thunar など。先頭の行が copy / cut）・`application/x-kde-cutselection`（KDE）。
//!    GTK のクリップボードを使う（X11 でも Wayland でも同じ。GTK の操作はメインのスレッドで行う）。
//!  - それ以外（Android・macOS）: 何もしない（`unsupported`）。アプリの中の切り取り・コピーのバッファだけで貼り付ける。
//!
//! ほかに、書いたときの「印」（画面が作った文字）を、独自の形式で一緒に書く。貼り付けのとき、クリップボードにまだこの印があれば
//! （ほかのアプリでコピーし直していなければ）、アプリの中のバッファを貼る。印だけを読むので、ファイルの一覧は読まない。

use crate::fs::{FsError, FsResult};

/// 印を入れる形式の名前（Windows: 登録する形式の名前、Linux: 形式の名前（ターゲット））
pub const TOKEN_FORMAT: &str = "application/x-fixplor-buffer";

#[cfg(windows)]
mod win;
#[cfg(windows)]
pub use win::{set_files, token};

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::{set_files, token};

#[cfg(not(any(windows, target_os = "linux")))]
pub async fn set_files(_app: &tauri::AppHandle, _paths: Vec<String>, _mv: bool, _token: String) -> FsResult<()> {
    Err(unsupported())
}

#[cfg(not(any(windows, target_os = "linux")))]
pub async fn token(_app: &tauri::AppHandle) -> FsResult<Option<String>> {
    Ok(None)
}

#[cfg(not(any(windows, target_os = "linux")))]
fn unsupported() -> FsError {
    FsError::new("unsupported", "この OS では、ファイルをクリップボードへ書けません")
}

/// 絶対パス `/home/me/a b.txt` → `file:///home/me/a%20b.txt`（Linux のファイル一覧の形式）。
/// 英数字と `/ - _ . ~` 以外は `%XX` にする（日本語の名前も、UTF-8 のバイトごとに）
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn file_uri(path: &str) -> String {
    use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
    const KEEP: &AsciiSet = &NON_ALPHANUMERIC.remove(b'/').remove(b'-').remove(b'_').remove(b'.').remove(b'~');
    format!("file://{}", utf8_percent_encode(path, KEEP))
}

/// Linux の `x-special/gnome-copied-files` の中身（1 行目が copy か cut、続けて 1 行に 1 つの URI。最後に改行は付けない）
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn gnome_list(uris: &[String], mv: bool) -> String {
    let mut s = String::from(if mv { "cut" } else { "copy" });
    for u in uris {
        s.push('\n');
        s.push_str(u);
    }
    s
}

/// `text/uri-list` の中身（1 行に 1 つの URI。各行の終わりは CRLF）
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn uri_list(uris: &[String]) -> String {
    uris.iter().map(|u| format!("{u}\r\n")).collect()
}

/// Windows の `CF_HDROP`（`DROPFILES` の 20 バイト + UTF-16 のパスを NUL でつないで、最後にもう 1 つ NUL）
#[cfg_attr(not(windows), allow(dead_code))]
pub fn hdrop_bytes(paths: &[String]) -> Vec<u8> {
    let mut b = Vec::new();
    b.extend_from_slice(&20u32.to_le_bytes()); // pFiles: パスの並びの始まり（この 20 バイトのあと）
    b.extend_from_slice(&[0u8; 8]); // pt: 落とした位置（使わない）
    b.extend_from_slice(&0u32.to_le_bytes()); // fNC
    b.extend_from_slice(&1u32.to_le_bytes()); // fWide: UTF-16
    for p in paths {
        for u in p.encode_utf16() {
            b.extend_from_slice(&u.to_le_bytes());
        }
        b.extend_from_slice(&[0, 0]);
    }
    b.extend_from_slice(&[0, 0]);
    b
}

/// 書く前の確かめ: 空でなく、すべて絶対パス
pub fn check(paths: &[String]) -> FsResult<()> {
    if paths.is_empty() {
        return Err(FsError::new("invalid", "項目がありません"));
    }
    for p in paths {
        crate::fs::abs(p)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_uri_は英数字と一部の記号以外を_encode_する() {
        assert_eq!(file_uri("/home/me/a b.txt"), "file:///home/me/a%20b.txt");
        assert_eq!(file_uri("/home/me/日本語.txt"), "file:///home/me/%E6%97%A5%E6%9C%AC%E8%AA%9E.txt");
        assert_eq!(file_uri("/a/b-c_d.e~f"), "file:///a/b-c_d.e~f");
        assert_eq!(file_uri("/a/#?%"), "file:///a/%23%3F%25");
    }

    #[test]
    fn gnome_の一覧は先頭が_copy_か_cut_で_末尾に改行を付けない() {
        let uris = vec!["file:///a".to_string(), "file:///b".to_string()];
        assert_eq!(gnome_list(&uris, false), "copy\nfile:///a\nfile:///b");
        assert_eq!(gnome_list(&uris, true), "cut\nfile:///a\nfile:///b");
    }

    #[test]
    fn uri_list_は_crlf_でつなぐ() {
        let uris = vec!["file:///a".to_string(), "file:///b".to_string()];
        assert_eq!(uri_list(&uris), "file:///a\r\nfile:///b\r\n");
    }

    #[test]
    fn hdrop_は_20_バイトの先頭と_utf16_のパスと_二重の_nul() {
        let b = hdrop_bytes(&["C:\\a.txt".to_string(), "D:\\b".to_string()]);
        assert_eq!(&b[0..4], &20u32.to_le_bytes());
        assert_eq!(&b[16..20], &1u32.to_le_bytes());
        let units: Vec<u16> = b[20..].chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
        let text: String = String::from_utf16(&units).unwrap();
        assert_eq!(text, "C:\\a.txt\0D:\\b\0\0");
    }

    #[test]
    fn 書く前の確かめは_空と相対パスを断る() {
        assert_eq!(check(&[]).unwrap_err().code, "invalid");
        assert_eq!(check(&["a/b".to_string()]).unwrap_err().code, "invalid");
        #[cfg(unix)]
        assert!(check(&["/a/b".to_string()]).is_ok());
    }
}
