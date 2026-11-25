//! Linux: GTK のクリップボードに、ファイルの一覧（`text/uri-list`・`x-special/gnome-copied-files`・`application/x-kde-cutselection`）と印を載せる。
//! 中身は、貼り付けた側が求めたときに渡す（GTK が、このアプリが持ち主のあいだ応える）。ほかのアプリがコピーし直すと、持ち主ではなくなる。
//! GTK の操作は、メインのスレッドで行う（`run_on_main_thread`）。

use super::{check, file_uri, gnome_list, uri_list, TOKEN_FORMAT};
use crate::fs::{FsError, FsResult};
use gtk::gdk::{Atom, SELECTION_CLIPBOARD};
use gtk::{Clipboard, TargetEntry, TargetFlags};

fn io(text: &str) -> FsError {
    FsError::new("io", text.to_string())
}

/// メインのスレッドで f を動かして、結果を受け取る
async fn on_main<T: Send + 'static>(app: &tauri::AppHandle, f: impl FnOnce() -> T + Send + 'static) -> FsResult<T> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(f());
    })
    .map_err(|e| io(&format!("メインのスレッドで動かせませんでした: {e}")))?;
    rx.await.map_err(|_| io("クリップボードの処理を終えられませんでした"))
}

/// 形式の番号（info）。求められた形式を見分けるのに使う
const URI_LIST: u32 = 0;
const GNOME: u32 = 1;
const KDE_CUT: u32 = 2;
const TOKEN: u32 = 3;

fn write(paths: Vec<String>, mv: bool, token: String) -> bool {
    let uris: Vec<String> = paths.iter().map(|p| file_uri(p)).collect();
    let list = uri_list(&uris);
    let gnome = gnome_list(&uris, mv);
    let kde = if mv { "1" } else { "0" };
    let targets = [
        TargetEntry::new("text/uri-list", TargetFlags::empty(), URI_LIST),
        TargetEntry::new("x-special/gnome-copied-files", TargetFlags::empty(), GNOME),
        TargetEntry::new("application/x-kde-cutselection", TargetFlags::empty(), KDE_CUT),
        TargetEntry::new(TOKEN_FORMAT, TargetFlags::empty(), TOKEN),
    ];
    Clipboard::get(&SELECTION_CLIPBOARD).set_with_data(&targets, move |_, data, info| {
        let bytes: &[u8] = match info {
            URI_LIST => list.as_bytes(),
            GNOME => gnome.as_bytes(),
            KDE_CUT => kde.as_bytes(),
            _ => token.as_bytes(),
        };
        // 型は、求められた形式と同じ名前にする
        data.set(&data.target(), 8, bytes);
    })
}

fn read_token() -> Option<String> {
    let clipboard = Clipboard::get(&SELECTION_CLIPBOARD);
    let data = clipboard.wait_for_contents(&Atom::intern(TOKEN_FORMAT))?;
    String::from_utf8(data.data()).ok()
}

pub async fn set_files(app: &tauri::AppHandle, paths: Vec<String>, mv: bool, token: String) -> FsResult<()> {
    check(&paths)?;
    if on_main(app, move || write(paths, mv, token)).await? {
        Ok(())
    } else {
        Err(io("クリップボードへ書けませんでした"))
    }
}

pub async fn token(app: &tauri::AppHandle) -> FsResult<Option<String>> {
    on_main(app, read_token).await
}
