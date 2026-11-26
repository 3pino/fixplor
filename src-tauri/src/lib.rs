pub mod clipboard;
pub mod fs;
pub mod platform;
pub mod sftp;
pub mod webdav;

use fs::{Entry, FsError, FsResult, Place, Size};
use tauri_plugin_opener::OpenerExt;

// コマンドは、ファイルの読み書きで画面を止めないよう、別のスレッドで動かす。
// パスは絶対パスだけを受ける（fs::abs）。
// 環境変数 FIXPLOR_TRACE があると、コマンドの名前と結果（ok か、失敗の code）だけを標準エラーに出す
// （パスや中身は出さない。起動の確認・不具合の切り分け用）。

fn trace<T>(name: &str, result: &FsResult<T>) {
    if std::env::var_os("FIXPLOR_TRACE").is_none() {
        return;
    }
    match result {
        Ok(_) => eprintln!("[trace] {name} ok"),
        Err(e) => eprintln!("[trace] {name} {}", e.code),
    }
}

async fn blocking<T, F>(name: &'static str, f: F) -> FsResult<T>
where
    T: Send + 'static,
    F: FnOnce() -> FsResult<T> + Send + 'static,
{
    let result = match tauri::async_runtime::spawn_blocking(f).await {
        Ok(r) => r,
        Err(e) => Err(FsError::new("io", format!("処理を終えられませんでした: {e}"))),
    };
    trace(name, &result);
    result
}

#[tauri::command]
async fn fs_list(path: String) -> FsResult<Vec<Entry>> {
    blocking("fs_list", move || fs::list(&fs::abs(&path)?)).await
}

#[tauri::command]
async fn fs_stat(path: String) -> FsResult<Entry> {
    blocking("fs_stat", move || fs::entry_of(&fs::abs(&path)?)).await
}

#[tauri::command]
async fn fs_mkdir(path: String) -> FsResult<Entry> {
    blocking("fs_mkdir", move || fs::mkdir(&fs::abs(&path)?)).await
}

/// ファイルを書く。中身は生のバイト列で受ける（JSON にしない）。パスはヘッダー `x-path`（URL の形に符号化）
#[tauri::command]
async fn fs_write(request: tauri::ipc::Request<'_>) -> FsResult<Entry> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(FsError::new("invalid", "中身がバイト列ではありません"));
    };
    let raw = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| FsError::new("invalid", "パスがありません"))?;
    let path = percent_encoding::percent_decode_str(raw)
        .decode_utf8()
        .map_err(|_| FsError::new("invalid", "パスを読めません"))?
        .into_owned();
    let body = body.clone();
    blocking("fs_write", move || fs::write_file(&fs::abs(&path)?, &body)).await
}

#[tauri::command]
async fn fs_move(from: String, to: String, overwrite: Option<bool>) -> FsResult<Entry> {
    blocking("fs_move", move || fs::rename(&fs::abs(&from)?, &fs::abs(&to)?, overwrite.unwrap_or(false))).await
}

#[tauri::command]
async fn fs_copy(from: String, to: String, overwrite: Option<bool>) -> FsResult<Entry> {
    blocking("fs_copy", move || fs::copy(&fs::abs(&from)?, &fs::abs(&to)?, overwrite.unwrap_or(false))).await
}

/// ゴミ箱へ入れる。戻すときの印（OS のゴミ箱の id。Android は、アプリ内のゴミ箱を `fs_trash_list` で見るので無し）
#[tauri::command]
async fn fs_trash(path: String) -> FsResult<Option<String>> {
    blocking("fs_trash", move || fs::trash(&fs::abs(&path)?)).await
}

/// OS のゴミ箱から、元の場所へ戻す（元に戻す・Ctrl+Z）。戻したパスを返す
#[tauri::command]
async fn fs_os_trash_restore(id: String) -> FsResult<String> {
    blocking("fs_os_trash_restore", move || fs::os_trash_restore(&id)).await
}

/// 完全に削除する（Android だけ。ゴミ箱の無い場所の確認つきの削除）
#[tauri::command]
async fn fs_remove(path: String) -> FsResult<()> {
    blocking("fs_remove", move || fs::remove(&fs::abs(&path)?)).await
}

/// ゴミ箱（Android のアプリ内）の一覧・戻す・完全に消す。`volume` は保存領域の根（`/storage/emulated/0` など）
fn trash_volume(volume: &str) -> FsResult<std::path::PathBuf> {
    let root = fs::abs(volume)?;
    if fs::trash::volume_root(&root).as_deref() != Some(root.as_path()) {
        return Err(FsError::new("invalid", "ゴミ箱のある場所ではありません"));
    }
    Ok(root)
}

#[tauri::command]
async fn fs_trash_list(volume: String) -> FsResult<Vec<fs::trash::TrashItem>> {
    blocking("fs_trash_list", move || fs::trash::trash_list(&trash_volume(&volume)?)).await
}

#[tauri::command]
async fn fs_trash_restore(volume: String, id: String) -> FsResult<String> {
    blocking("fs_trash_restore", move || fs::trash::trash_restore(&trash_volume(&volume)?, &id)).await
}

#[tauri::command]
async fn fs_trash_purge(volume: String, id: String) -> FsResult<()> {
    blocking("fs_trash_purge", move || fs::trash::trash_purge(&trash_volume(&volume)?, &id)).await
}

#[tauri::command]
async fn fs_size(path: String, limit: Option<u64>) -> FsResult<Size> {
    // limit: 調べる項目の上限（一覧のフォルダのサイズ用）。省くと、最後まで数える
    blocking("fs_size", move || fs::size_within(&fs::abs(&path)?, limit.unwrap_or(u64::MAX))).await
}

/// 動いている検索（画面が付けた job の名前 → 中止の旗）
#[derive(Default)]
struct Searches(std::sync::Mutex<std::collections::HashMap<String, std::sync::Arc<std::sync::atomic::AtomicBool>>>);

/// フォルダの中（サブフォルダも）から、名前に文字を含む項目を探す。見つけたものは `on_hits` へ少しずつ流す。
/// `job` で `fs_search_cancel` から止められる（止めたら `aborted`）。上限で止めたときは、結果の `partial` に理由が入る
#[tauri::command]
async fn fs_search(
    searches: tauri::State<'_, Searches>,
    dir: String,
    text: String,
    show_hidden: bool,
    job: String,
    on_hits: tauri::ipc::Channel<Vec<Entry>>,
) -> FsResult<fs::Outcome> {
    let root = fs::abs(&dir)?;
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    searches.0.lock().unwrap().insert(job.clone(), cancel.clone());
    let result = blocking("fs_search", move || {
        fs::search(&root, &text, show_hidden, fs::Limits::default(), &cancel, |batch| {
            // 受け手（画面）が閉じても、検索は止めない（止めるのは cancel だけ）
            let _ = on_hits.send(batch);
        })
    })
    .await;
    searches.0.lock().unwrap().remove(&job);
    result
}

/// 検索を止める（動いていなければ false）
#[tauri::command]
fn fs_search_cancel(searches: tauri::State<'_, Searches>, job: String) -> bool {
    match searches.0.lock().unwrap().get(&job) {
        Some(flag) => {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
            true
        }
        None => false,
    }
}

/// 外部のコマンド（依存）が入っているか。候補の名前を順に試して、最初に呼べたもの（名前と版）を返す。無ければ null
#[tauri::command]
async fn fs_which(candidates: Vec<String>) -> FsResult<Option<fs::Found>> {
    blocking("fs_which", move || Ok(fs::which(&candidates))).await
}

#[tauri::command]
async fn fs_places() -> FsResult<Vec<Place>> {
    blocking("fs_places", || Ok(fs::places())).await
}

#[tauri::command]
fn fs_start_dir() -> String {
    fs::start_dir()
}

/// ファイルを、OS の既定のアプリで開く
#[tauri::command]
fn fs_open(app: tauri::AppHandle, path: String) -> FsResult<()> {
    let p = fs::abs(&path)?;
    std::fs::symlink_metadata(&p).map_err(|e| FsError::io(&e, &p))?;
    app.opener()
        .open_path(path, None::<&str>)
        .map_err(|e| FsError::new("io", format!("開けませんでした: {e}")))
}

/// コピー・切り取りしたファイルを、OS のクリップボードへ書く（ほかのアプリに貼り付けられる。文字は書かない）。
/// `op` は copy か move。`token` は、書いたものの印（貼り付けのとき、まだ自分が書いたままかを確かめる）。Windows・Linux だけ
#[tauri::command]
async fn clipboard_set_files(app: tauri::AppHandle, paths: Vec<String>, op: String, token: String) -> FsResult<()> {
    clipboard::set_files(&app, paths, op == "move", token).await
}

/// クリップボードに、アプリが書いた印がまだあるか（あればその印）。ほかでコピーし直した・対応しない OS なら null
#[tauri::command]
async fn clipboard_token(app: tauri::AppHandle) -> FsResult<Option<String>> {
    clipboard::token(&app).await
}

/// アプリを終える（Android で、最後のタブを閉じたとき。デスクトップは、ウィンドウを閉じる）
#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 状態（資格情報・証明書の固定・一時の送信）は setup で作る（保存先を、OS の設定フォルダから取るため）
    // 前の起動で受け取った一時のファイルのうち、古いものを消す（開いている最中のものは、消さない長さ）
    std::thread::spawn(|| {
        webdav::commands::clean_temp(&webdav::commands::temp_root(), std::time::Duration::from_secs(24 * 60 * 60));
    });
    let builder = tauri::Builder::default()
        .setup(|app| {
            use tauri::Manager;
            // 証明書の固定の保存先: アプリの設定フォルダ（デスクトップは OS の設定の場所、Android はアプリ専用の領域）
            let pins = app.path().app_config_dir().ok().map(|d| d.join("dav-pins.json"));
            let (conns, jobs, puts) = webdav::commands::state(std::sync::Arc::new(webdav::secret::OsStore), webdav::pin::Pins::load(pins));
            app.manage(conns);
            app.manage(jobs);
            app.manage(puts);
            app.manage(Searches::default());
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("fixdav", |ctx, request, responder| {
            use tauri::Manager;
            let conns = ctx.app_handle().state::<webdav::commands::Conns>().inner().clone();
            tauri::async_runtime::spawn(async move {
                let range = request.headers().get("range").and_then(|v| v.to_str().ok()).map(str::to_string);
                let r = webdav::proxy::serve(&conns, request.method().as_str(), request.uri().path(), range.as_deref()).await;
                let mut b = tauri::http::Response::builder().status(r.status);
                for (k, v) in r.headers {
                    b = b.header(k, v);
                }
                if let Ok(resp) = b.body(r.body) {
                    responder.respond(resp);
                }
            });
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(platform::plugin());
    // Android の全ファイルへのアクセス（確認と設定画面）
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_fixplor_storage::init());
    #[cfg(target_os = "android")]
    let builder = builder.plugin(tauri_plugin_fixplor_updater::init());
    // アプリの更新（デスクトップだけ）: 公式の updater（latest.json の署名を、tauri.conf.json の公開鍵で確かめる）と、入れ替えたあとの再起動
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_process::init());
    builder
        .invoke_handler(tauri::generate_handler![
            fs_list,
            fs_stat,
            fs_mkdir,
            fs_write,
            fs_move,
            fs_copy,
            fs_trash,
            fs_os_trash_restore,
            fs_remove,
            fs_trash_list,
            fs_trash_restore,
            fs_trash_purge,
            fs_size,
            fs_search,
            fs_search_cancel,
            fs_which,
            fs_places,
            fs_start_dir,
            fs_open,
            clipboard_set_files,
            clipboard_token,
            exit_app,
            sftp::commands::sftp_list,
            sftp::commands::sftp_stat,
            sftp::commands::sftp_mkdir,
            sftp::commands::sftp_put_open,
            sftp::commands::sftp_move,
            sftp::commands::sftp_copy,
            sftp::commands::sftp_remove,
            sftp::commands::sftp_size,
            sftp::commands::sftp_download,
            webdav::commands::dav_list,
            webdav::commands::dav_stat,
            webdav::commands::dav_mkdir,
            webdav::commands::dav_put_open,
            webdav::commands::dav_put_chunk,
            webdav::commands::dav_put_finish,
            webdav::commands::dav_move,
            webdav::commands::dav_copy,
            webdav::commands::dav_remove,
            webdav::commands::dav_size,
            webdav::commands::dav_download,
            webdav::commands::dav_cancel,
            webdav::commands::dav_cred_info,
            webdav::commands::dav_cred_set,
            webdav::commands::dav_cred_clear,
            webdav::commands::dav_cert_probe,
            webdav::commands::dav_pin_info,
            webdav::commands::dav_pin_set,
            webdav::commands::dav_pin_clear
        ])
        .run(tauri::generate_context!())
        .expect("fixplor を起動できませんでした");
}
