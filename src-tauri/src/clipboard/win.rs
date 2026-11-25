//! Windows: `CF_HDROP`（ファイルの一覧）・`Preferred DropEffect`（コピー = 1・移動 = 2）・印（独自の形式）を書く。
//! クリップボードは、ほかのアプリが開いていると開けないので、少し待って数回やり直す。

use super::{check, hdrop_bytes};
use crate::fs::{FsError, FsResult};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, IsClipboardFormatAvailable, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};

/// ファイルの一覧の形式（`CF_HDROP`）
const CF_HDROP: u32 = 15;

fn io(text: &str) -> FsError {
    FsError::new("io", text.to_string())
}

/// 開いているあいだだけ、クリップボードを持つ（閉じ忘れない）
struct Open;

impl Open {
    fn new() -> FsResult<Self> {
        for _ in 0..20 {
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Ok(Open);
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        Err(io("クリップボードを開けませんでした（ほかのアプリが使っています）"))
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}

/// 形式の番号（登録していなければ登録する。名前が同じなら、同じ番号）
fn format_of(name: PCWSTR) -> u32 {
    unsafe { RegisterClipboardFormatW(name) }
}

/// バイト列を、メモリに置いて、その形式でクリップボードへ渡す（渡せたら、メモリの持ち主は OS になる）
fn put(format: u32, bytes: &[u8]) -> FsResult<()> {
    if format == 0 {
        return Err(io("クリップボードの形式を登録できませんでした"));
    }
    let mem = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }.map_err(|e| io(&format!("メモリを確保できませんでした: {e}")))?;
    let ptr = unsafe { GlobalLock(mem) };
    if ptr.is_null() {
        let _ = unsafe { GlobalFree(Some(mem)) };
        return Err(io("メモリを使えませんでした"));
    }
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr as *mut u8, bytes.len()) };
    // 最後の解除は、成功でも「エラーなし」を返すことがあるので、結果は見ない
    let _ = unsafe { GlobalUnlock(mem) };
    match unsafe { SetClipboardData(format, Some(HANDLE(mem.0))) } {
        Ok(_) => Ok(()),
        Err(e) => {
            let _ = unsafe { GlobalFree(Some(mem)) };
            Err(io(&format!("クリップボードへ書けませんでした: {e}")))
        }
    }
}

/// ファイルの一覧・コピーか移動か・印を書く（前の中身は消える。文字は書かない）
fn write(paths: &[String], mv: bool, token: &str) -> FsResult<()> {
    check(paths)?;
    let _open = Open::new()?;
    unsafe { EmptyClipboard() }.map_err(|e| io(&format!("クリップボードを空にできませんでした: {e}")))?;
    put(CF_HDROP, &hdrop_bytes(paths))?;
    let effect: u32 = if mv { 2 } else { 1 };
    put(format_of(w!("Preferred DropEffect")), &effect.to_le_bytes())?;
    put(format_of(w!("application/x-fixplor-buffer")), token.as_bytes())?;
    Ok(())
}

/// 印を読む。クリップボードに無ければ（ほかのアプリがコピーし直した・空になった）None
fn read_token() -> FsResult<Option<String>> {
    let format = format_of(w!("application/x-fixplor-buffer"));
    if format == 0 || unsafe { IsClipboardFormatAvailable(format) }.is_err() {
        return Ok(None);
    }
    let _open = Open::new()?;
    let Ok(handle) = (unsafe { GetClipboardData(format) }) else {
        return Ok(None);
    };
    let mem = HGLOBAL(handle.0);
    let size = unsafe { GlobalSize(mem) };
    let ptr = unsafe { GlobalLock(mem) };
    if ptr.is_null() {
        return Ok(None);
    }
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, size) }.to_vec();
    let _ = unsafe { GlobalUnlock(mem) };
    // 確保したメモリは、書いた長さより大きいことがある（余りは 0）
    Ok(String::from_utf8(bytes).ok().map(|s| s.trim_end_matches('\0').to_string()))
}

pub async fn set_files(_app: &tauri::AppHandle, paths: Vec<String>, mv: bool, token: String) -> FsResult<()> {
    tauri::async_runtime::spawn_blocking(move || write(&paths, mv, &token))
        .await
        .map_err(|e| io(&format!("処理を終えられませんでした: {e}")))?
}

pub async fn token(_app: &tauri::AppHandle) -> FsResult<Option<String>> {
    tauri::async_runtime::spawn_blocking(read_token)
        .await
        .map_err(|e| io(&format!("処理を終えられませんでした: {e}")))?
}
