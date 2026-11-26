//! SFTP の Tauri コマンド（`sftp_*`）。画面（`src/lib/fs/webdav.ts`）が、WebDAV の `dav_*` と同じ引数で呼ぶ。
//! 書き込みの続き（`dav_put_chunk`・`dav_put_finish`）と中止（`dav_cancel`）は、WebDAV のコマンドが受ける（job の名前で見つける）。

use super::ops;
use super::pool::{session, with};
use crate::fs::{FsError, FsResult};
use crate::webdav::commands::{reporter, run_job, temp_dest, Conns, Jobs, Puts};
use crate::webdav::DavEntry;
use futures_util::future::abortable;
use tauri::State;

#[tauri::command]
pub async fn sftp_list(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<Vec<DavEntry>> {
    with(&conns, &place, &base, |c| {
        let path = path.clone();
        async move { ops::list(&c.sftp, &c.root, &path).await }
    })
    .await
}

#[tauri::command]
pub async fn sftp_stat(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<DavEntry> {
    with(&conns, &place, &base, |c| {
        let path = path.clone();
        async move { ops::stat(&c.sftp, &c.root, &path).await }
    })
    .await
}

#[tauri::command]
pub async fn sftp_mkdir(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<DavEntry> {
    with(&conns, &place, &base, |c| {
        let path = path.clone();
        async move { ops::mkdir(&c.sftp, &c.root, &path).await }
    })
    .await
}

/// 書き込みの開始（`dav_put_open` と同じ。中身は、`dav_put_chunk` で順に送り、`dav_put_finish` で終える）
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn sftp_put_open(
    app: tauri::AppHandle,
    conns: State<'_, Conns>,
    jobs: State<'_, Jobs>,
    puts: State<'_, Puts>,
    place: String,
    base: String,
    path: String,
    size: u64,
    if_match: Option<String>,
    job: String,
) -> FsResult<()> {
    let conn = session(&conns, &place, &base).await?;
    let progress = reporter(app, Some(job.clone()));
    let (tx, rx) = tokio::sync::mpsc::channel::<bytes::Bytes>(2);
    let (fut, handle) = abortable(async move { ops::put_stream(&conn.sftp, &conn.root, &path, size, if_match, rx, progress).await });
    jobs.add(&job, handle);
    let task = tokio::spawn(async move { fut.await.unwrap_or_else(|_| Err(FsError::new("aborted", "中止しました"))) });
    puts.insert(&job, tx, task);
    Ok(())
}

#[tauri::command]
pub async fn sftp_move(conns: State<'_, Conns>, place: String, base: String, from: String, to: String, overwrite: Option<bool>) -> FsResult<DavEntry> {
    with(&conns, &place, &base, |c| {
        let (from, to) = (from.clone(), to.clone());
        async move { ops::mv(&c.sftp, &c.root, &from, &to, overwrite.unwrap_or(false)).await }
    })
    .await
}

#[tauri::command]
pub async fn sftp_copy(conns: State<'_, Conns>, place: String, base: String, from: String, to: String, overwrite: Option<bool>) -> FsResult<DavEntry> {
    with(&conns, &place, &base, |c| {
        let (from, to) = (from.clone(), to.clone());
        async move { ops::copy(&c.sftp, &c.root, &from, &to, overwrite.unwrap_or(false)).await }
    })
    .await
}

/// 完全に削除する（元に戻せない）
#[tauri::command]
pub async fn sftp_remove(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<()> {
    with(&conns, &place, &base, |c| {
        let path = path.clone();
        async move { ops::remove(&c.sftp, &c.root, &path).await }
    })
    .await
}

#[derive(serde::Serialize)]
pub struct SftpSize {
    pub size: u64,
    pub files: u64,
    pub dirs: u64,
    pub partial: bool,
}

#[tauri::command]
pub async fn sftp_size(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<SftpSize> {
    let (size, files, dirs, partial) = with(&conns, &place, &base, |c| {
        let path = path.clone();
        async move { ops::size(&c.sftp, &c.root, &path).await }
    })
    .await?;
    Ok(SftpSize { size, files, dirs, partial })
}

/// ファイルを、この端末の一時のフォルダへ受け取って、その絶対パスを返す（開くため）
#[tauri::command]
pub async fn sftp_download(app: tauri::AppHandle, conns: State<'_, Conns>, jobs: State<'_, Jobs>, place: String, base: String, path: String, job: Option<String>) -> FsResult<String> {
    let conn = session(&conns, &place, &base).await?;
    let name = path.rsplit('/').next().filter(|n| !n.is_empty()).ok_or_else(|| FsError::new("invalid", "ファイルを指していません"))?.to_string();
    let dest = temp_dest(&name)?;
    let progress = reporter(app, job.clone());
    let out = dest.clone();
    run_job(&jobs, job.as_deref(), async move { ops::download(&conn.sftp, &conn.root, &path, &out, progress).await }).await?;
    Ok(dest.to_string_lossy().into_owned())
}
