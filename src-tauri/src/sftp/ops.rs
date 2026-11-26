//! SFTP の置き場所への操作（一覧・作成・書き込み・移動・コピー・削除・大きさ・読み出し）。
//! 失敗は、ローカルの `fs_*`・WebDAV と同じ `FsError.code` に写す。
//!
//! 黙って上書きしない決まり（WebDAV と同じ）:
//!  - 作成は、同名があれば `exists`
//!  - 上書きは、一覧で読んだ「版」（更新時刻と大きさ。`DavEntry.etag`）が同じときだけ。変わっていれば `precondition`
//!  - 移動・コピーは、上書きを明示したときだけ上書きする
//!
//! 書き込みは、同じフォルダの一時の名前（`.名前.fixplor-part`）へ書いてから付け替える（途中で止まっても、前の中身が残る）。
//! SFTP にはサーバー側のコピーが無いので、コピーは読んで書き直す。

use crate::fs::{FsError, FsResult, Kind};
use crate::webdav::url::segments;
use crate::webdav::{DavEntry, Progress, SIZE_DIR_LIMIT};
use bytes::Bytes;
use futures_util::future::BoxFuture;
use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::fs::Metadata;
use russh_sftp::client::SftpSession;
use russh_sftp::protocol::StatusCode;
use std::io::SeekFrom;
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

/// SFTP の失敗を、`FsError` にする
pub fn err(e: SftpError) -> FsError {
    let code = match &e {
        SftpError::Status(s) => match s.status_code {
            StatusCode::NoSuchFile => "not_found",
            StatusCode::PermissionDenied => "denied",
            StatusCode::NoConnection | StatusCode::ConnectionLost => "offline",
            StatusCode::OpUnsupported => "unsupported",
            _ => "io",
        },
        SftpError::Timeout | SftpError::IO(_) => "offline",
        _ => "io",
    };
    FsError::new(code, format!("SFTP: {e}"))
}

fn io_err(e: std::io::Error) -> FsError {
    FsError::new("offline", format!("SFTP の読み書きに失敗しました: {e}"))
}

/// 画面のパス（根からの相対）→ サーバーの絶対パス。`..` などは断る
pub fn remote(root: &str, rel: &str) -> FsResult<String> {
    let segs = segments(rel)?;
    let mut p = root.trim_end_matches('/').to_string();
    for s in segs {
        p.push('/');
        p.push_str(s);
    }
    if p.is_empty() {
        p.push('/');
    }
    Ok(p)
}

fn child(dir: &str, name: &str) -> String {
    format!("{}/{}", dir.trim_end_matches('/'), name)
}

/// 一覧で渡す「版」（上書きの確かめに使う）
fn etag_of(m: &Metadata) -> String {
    format!("{}-{}", m.mtime.unwrap_or(0), m.len())
}

fn entry_at(path: &str, m: &Metadata, kind: Kind) -> DavEntry {
    let name = path.rsplit('/').next().unwrap_or("").to_string();
    let dir = kind == Kind::Dir;
    DavEntry {
        hidden: name.starts_with('.'),
        name,
        path: path.to_string(),
        kind,
        size: if dir { None } else { Some(m.len()) },
        modified: m.mtime.map(|t| i64::from(t) * 1000),
        mime: None,
        etag: if dir { None } else { Some(etag_of(m)) },
    }
}

fn is_dir(m: &Metadata) -> bool {
    m.file_type().is_dir()
}

/// リンクは、先を見る（フォルダへのリンクは、フォルダとして開ける）。先を辿れない（切れている）なら、ファイルとして出す
async fn resolve(sftp: &SftpSession, full: &str, m: Metadata) -> Metadata {
    if m.file_type().is_symlink() {
        if let Ok(t) = sftp.metadata(full.to_string()).await {
            return t;
        }
    }
    m
}

async fn exists(sftp: &SftpSession, full: &str) -> FsResult<bool> {
    sftp.try_exists(full.to_string()).await.map_err(err)
}

/// フォルダの中身（並び順は決めない）。フォルダ自身は含めない
pub async fn list(sftp: &SftpSession, root: &str, rel: &str) -> FsResult<Vec<DavEntry>> {
    let dir = remote(root, rel)?;
    let mut out = Vec::new();
    for e in sftp.read_dir(dir.clone()).await.map_err(err)? {
        let name = e.file_name();
        let full = child(&dir, &name);
        let m = resolve(sftp, &full, e.metadata()).await;
        let kind = if is_dir(&m) { Kind::Dir } else { Kind::File };
        let path = if rel.is_empty() { name } else { format!("{rel}/{name}") };
        out.push(entry_at(&path, &m, kind));
    }
    Ok(out)
}

pub async fn stat(sftp: &SftpSession, root: &str, rel: &str) -> FsResult<DavEntry> {
    let m = sftp.metadata(remote(root, rel)?).await.map_err(err)?;
    let kind = if is_dir(&m) { Kind::Dir } else { Kind::File };
    Ok(entry_at(rel, &m, kind))
}

pub async fn mkdir(sftp: &SftpSession, root: &str, rel: &str) -> FsResult<DavEntry> {
    if rel.is_empty() {
        return Err(FsError::new("invalid", "いちばん上は作れません"));
    }
    let full = remote(root, rel)?;
    if exists(sftp, &full).await? {
        return Err(FsError::new("exists", "同じ名前があります"));
    }
    sftp.create_dir(full).await.map_err(err)?;
    stat(sftp, root, rel).await
}

fn remove_path(sftp: &SftpSession, full: String) -> BoxFuture<'_, FsResult<()>> {
    Box::pin(async move {
        // リンクは、先を辿らず、リンクそのものを消す
        let m = sftp.symlink_metadata(full.clone()).await.map_err(err)?;
        if is_dir(&m) {
            for e in sftp.read_dir(full.clone()).await.map_err(err)? {
                remove_path(sftp, child(&full, &e.file_name())).await?;
            }
            sftp.remove_dir(full).await.map_err(err)
        } else {
            sftp.remove_file(full).await.map_err(err)
        }
    })
}

/// 完全に削除する（元に戻せない。確認は画面が先に取る）。フォルダは中身ごと
pub async fn remove(sftp: &SftpSession, root: &str, rel: &str) -> FsResult<()> {
    if rel.is_empty() {
        return Err(FsError::new("invalid", "いちばん上は消せません"));
    }
    remove_path(sftp, remote(root, rel)?).await
}

/// フォルダの大きさ（中のファイルの合計）。読むフォルダが `SIZE_DIR_LIMIT` を超えたら、途中までの値で `partial`。
/// 戻り値は（合計の大きさ, ファイルの数, フォルダの数, 途中で止めたか）
pub async fn size(sftp: &SftpSession, root: &str, rel: &str) -> FsResult<(u64, u64, u64, bool)> {
    let (mut size, mut files, mut dirs) = (0u64, 0u64, 0u64);
    let mut queue = vec![rel.to_string()];
    let mut visited = 0usize;
    while let Some(dir) = queue.pop() {
        if visited >= SIZE_DIR_LIMIT {
            return Ok((size, files, dirs, true));
        }
        visited += 1;
        for e in list(sftp, root, &dir).await? {
            match e.kind {
                Kind::Dir => {
                    dirs += 1;
                    queue.push(e.path);
                }
                Kind::File => {
                    files += 1;
                    size += e.size.unwrap_or(0);
                }
            }
        }
    }
    Ok((size, files, dirs, false))
}

/// 書きかけのファイルの名前（同じフォルダの、隠しファイル）
fn part_name(dest: &str) -> String {
    let (dir, name) = dest.rsplit_once('/').unwrap_or(("", dest));
    format!("{dir}/.{name}.fixplor-part")
}

/// 書きかけを、本来の名前へ付け替える。同名があれば、置き換える（OpenSSH の `posix-rename` があれば、それで）
async fn finish_rename(sftp: &SftpSession, tmp: &str, dest: &str) -> FsResult<()> {
    if exists(sftp, dest).await? {
        if matches!(sftp.posix_rename(tmp.to_string(), dest.to_string()).await, Ok(true)) {
            return Ok(());
        }
        sftp.remove_file(dest.to_string()).await.map_err(err)?;
    }
    sftp.rename(tmp.to_string(), dest.to_string()).await.map_err(err)
}

/// 書く前の確かめ。`if_match` が無ければ作成（同名があれば `exists`）、あれば上書き（版が変わっていたら `precondition`）
async fn check_precondition(sftp: &SftpSession, dest: &str, if_match: Option<&str>) -> FsResult<()> {
    let current = match sftp.metadata(dest.to_string()).await {
        Ok(m) => Some(m),
        Err(SftpError::Status(s)) if s.status_code == StatusCode::NoSuchFile => None,
        Err(e) => return Err(err(e)),
    };
    match (if_match, current) {
        (None, Some(_)) => Err(FsError::new("exists", "同じ名前があります")),
        (Some(want), Some(m)) if etag_of(&m) != want => Err(FsError::new("precondition", "読んだあとに、相手のファイルが変わっています")),
        (Some(_), None) => Err(FsError::new("precondition", "読んだあとに、相手のファイルが無くなっています")),
        _ => Ok(()),
    }
}

/// 中身を受け取りながら書く（`rx` が閉じたら終わり。`size` と合わなければ、書きかけを捨てて失敗にする）
pub async fn put_stream(
    sftp: &SftpSession,
    root: &str,
    rel: &str,
    size: u64,
    if_match: Option<String>,
    mut rx: tokio::sync::mpsc::Receiver<Bytes>,
    progress: Option<Progress>,
) -> FsResult<DavEntry> {
    if rel.is_empty() {
        return Err(FsError::new("invalid", "いちばん上には書けません"));
    }
    let dest = remote(root, rel)?;
    check_precondition(sftp, &dest, if_match.as_deref()).await?;
    let tmp = part_name(&dest);
    let mut file = sftp.create(tmp.clone()).await.map_err(err)?;
    let mut done = 0u64;
    let written: FsResult<()> = async {
        while let Some(chunk) = rx.recv().await {
            file.write_all(&chunk).await.map_err(io_err)?;
            done += chunk.len() as u64;
            if let Some(p) = &progress {
                p(done, size);
            }
        }
        file.shutdown().await.map_err(io_err)?;
        if done != size {
            return Err(FsError::new("io", "送信が途中で止まりました"));
        }
        Ok(())
    }
    .await;
    drop(file);
    if let Err(e) = written {
        let _ = sftp.remove_file(tmp).await;
        return Err(e);
    }
    // 書いている間に、相手が変わっていないか、もう一度確かめてから付け替える
    if let Err(e) = check_precondition(sftp, &dest, if_match.as_deref()).await {
        let _ = sftp.remove_file(tmp).await;
        return Err(e);
    }
    finish_rename(sftp, &tmp, &dest).await?;
    stat(sftp, root, rel).await
}

/// 1 つのファイルを、一時の名前へ書き写してから付け替える
async fn copy_file(sftp: &SftpSession, src: &str, dst: &str) -> FsResult<()> {
    let mut r = sftp.open(src.to_string()).await.map_err(err)?;
    let tmp = part_name(dst);
    let mut w = sftp.create(tmp.clone()).await.map_err(err)?;
    let copied = match tokio::io::copy(&mut r, &mut w).await {
        Ok(_) => w.shutdown().await,
        Err(e) => Err(e),
    };
    drop(w);
    if let Err(e) = copied {
        let _ = sftp.remove_file(tmp).await;
        return Err(io_err(e));
    }
    finish_rename(sftp, &tmp, dst).await
}

fn copy_path(sftp: &SftpSession, src: String, dst: String) -> BoxFuture<'_, FsResult<()>> {
    Box::pin(async move {
        let link = sftp.symlink_metadata(src.clone()).await.map_err(err)?;
        if link.file_type().is_symlink() {
            // フォルダへのリンクは辿らない（輪になっていると、終わらない）。ファイルへのリンクは、先の中身をコピーする
            let target = sftp.metadata(src.clone()).await.map_err(err)?;
            return if is_dir(&target) { Ok(()) } else { copy_file(sftp, &src, &dst).await };
        }
        if is_dir(&link) {
            sftp.create_dir(dst.clone()).await.map_err(err)?;
            for e in sftp.read_dir(src.clone()).await.map_err(err)? {
                let name = e.file_name();
                copy_path(sftp, child(&src, &name), child(&dst, &name)).await?;
            }
            Ok(())
        } else {
            copy_file(sftp, &src, &dst).await
        }
    })
}

/// 移動・コピーの前の確かめ。同じもの・自分の中へは断る。宛先に同名があれば、上書きのときだけ続ける
async fn check_transfer(sftp: &SftpSession, from: &str, to: &str, overwrite: bool, moving: bool) -> FsResult<()> {
    let dir_of = |p: &str| format!("{}/", p.trim_end_matches('/'));
    if from == to {
        return Err(FsError::new("same_path", "移す元と先が同じです"));
    }
    if to.starts_with(&dir_of(from)) {
        return Err(FsError::new("into_self", "フォルダを自分の中へは移せません"));
    }
    // 先の上のフォルダへ、元を重ねない（先を消すと、元も消えてしまう）
    if moving && from.starts_with(&dir_of(to)) {
        return Err(FsError::new("into_self", "元を含むフォルダへは、重ねて移せません"));
    }
    if exists(sftp, to).await? && !overwrite {
        return Err(FsError::new("exists", "宛先に同じ名前があります"));
    }
    Ok(())
}

pub async fn mv(sftp: &SftpSession, root: &str, from: &str, to: &str, overwrite: bool) -> FsResult<DavEntry> {
    if from.is_empty() || to.is_empty() {
        return Err(FsError::new("invalid", "いちばん上は動かせません"));
    }
    let (f, t) = (remote(root, from)?, remote(root, to)?);
    check_transfer(sftp, &f, &t, overwrite, true).await?;
    if exists(sftp, &t).await? {
        remove_path(sftp, t.clone()).await?;
    }
    sftp.rename(f, t).await.map_err(err)?;
    stat(sftp, root, to).await
}

pub async fn copy(sftp: &SftpSession, root: &str, from: &str, to: &str, overwrite: bool) -> FsResult<DavEntry> {
    if from.is_empty() || to.is_empty() {
        return Err(FsError::new("invalid", "いちばん上はコピーできません"));
    }
    let (f, t) = (remote(root, from)?, remote(root, to)?);
    check_transfer(sftp, &f, &t, overwrite, false).await?;
    if exists(sftp, &t).await? {
        // ファイルをファイルで上書きするときは、書き終えてから付け替える（途中で失敗しても、前の中身が残る）。それ以外は、先に消す
        let both_files = !is_dir(&sftp.metadata(f.clone()).await.map_err(err)?) && !is_dir(&sftp.metadata(t.clone()).await.map_err(err)?);
        if !both_files {
            remove_path(sftp, t.clone()).await?;
        }
    }
    copy_path(sftp, f, t).await?;
    stat(sftp, root, to).await
}

/// ファイルの大きさ（表示の中継用。フォルダは `not_found`）
pub async fn file_size(sftp: &SftpSession, root: &str, rel: &str) -> FsResult<u64> {
    let m = sftp.metadata(remote(root, rel)?).await.map_err(err)?;
    if is_dir(&m) {
        return Err(FsError::new("not_found", "ファイルではありません"));
    }
    Ok(m.len())
}

/// 読む範囲（先頭からのバイト位置。`end` を含む）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Range {
    pub start: u64,
    pub end: u64,
}

impl Range {
    pub fn len(&self) -> u64 {
        self.end - self.start + 1
    }

    pub fn is_empty(&self) -> bool {
        false
    }
}

/// Range ヘッダーの読み取り結果
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Wanted {
    /// 全体（Range が無い・読めない・複数の範囲）
    Full,
    Part(Range),
    /// 範囲が、ファイルの外
    Unsatisfiable,
}

/// `bytes=0-99`・`bytes=100-`・`bytes=-50` を、`total` バイトのファイルに当てはめる（範囲が 1 つのものだけ）
pub fn parse_range(header: Option<&str>, total: u64) -> Wanted {
    let Some(spec) = header.and_then(|h| h.trim().strip_prefix("bytes=")) else { return Wanted::Full };
    if spec.contains(',') {
        return Wanted::Full;
    }
    let Some((a, b)) = spec.split_once('-') else { return Wanted::Full };
    let (a, b) = (a.trim(), b.trim());
    if total == 0 {
        return if a.is_empty() && b.is_empty() { Wanted::Full } else { Wanted::Unsatisfiable };
    }
    let last = total - 1;
    let range = match (a.parse::<u64>(), b.parse::<u64>()) {
        (Ok(s), Ok(e)) if s <= e => Range { start: s, end: e.min(last) },
        (Ok(s), Err(_)) if b.is_empty() => Range { start: s, end: last },
        (Err(_), Ok(n)) if a.is_empty() && n > 0 => Range { start: total.saturating_sub(n), end: last },
        _ => return Wanted::Full,
    };
    if range.start > last {
        Wanted::Unsatisfiable
    } else {
        Wanted::Part(range)
    }
}

/// ファイルの一部を読む（表示の中継用）
pub async fn read_range(sftp: &SftpSession, root: &str, rel: &str, range: Range) -> FsResult<Vec<u8>> {
    let mut f = sftp.open(remote(root, rel)?).await.map_err(err)?;
    f.seek(SeekFrom::Start(range.start)).await.map_err(io_err)?;
    let mut buf = Vec::with_capacity(range.len().min(1 << 24) as usize);
    f.take(range.len()).read_to_end(&mut buf).await.map_err(io_err)?;
    Ok(buf)
}

/// ファイルを、`dest` へ受け取る（`dest.part` へ書き終えてから付け替える。失敗では `.part` を残さない）
pub async fn download(sftp: &SftpSession, root: &str, rel: &str, dest: &Path, progress: Option<Progress>) -> FsResult<()> {
    let full = remote(root, rel)?;
    let total = sftp.metadata(full.clone()).await.map_err(err)?.len();
    let mut r = sftp.open(full).await.map_err(err)?;
    let part = std::path::PathBuf::from(format!("{}.part", dest.display()));
    let res = async {
        let mut out = tokio::fs::File::create(&part).await.map_err(|e| FsError::io(&e, &part))?;
        let mut buf = vec![0u8; 256 * 1024];
        let mut done = 0u64;
        loop {
            let n = r.read(&mut buf).await.map_err(io_err)?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).await.map_err(|e| FsError::io(&e, &part))?;
            done += n as u64;
            if let Some(p) = &progress {
                p(done, total.max(done));
            }
        }
        out.flush().await.map_err(|e| FsError::io(&e, &part))?;
        drop(out);
        tokio::fs::rename(&part, dest).await.map_err(|e| FsError::io(&e, dest))
    }
    .await;
    if res.is_err() {
        let _ = tokio::fs::remove_file(&part).await;
    }
    res
}

/// 表示の中継が返す Content-Type（名前の拡張子から。表示に使うものだけ。ほかは `application/octet-stream`）
pub fn mime_of(name: &str) -> &'static str {
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "txt" | "md" | "log" | "csv" | "ini" | "toml" | "yaml" | "yml" | "rs" | "ts" | "js" | "py" | "sh" => "text/plain; charset=utf-8",
        "json" => "application/json",
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        _ => "application/octet-stream",
    }
}
