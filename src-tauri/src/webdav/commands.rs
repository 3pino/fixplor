//! WebDAV の Tauri コマンド（`dav_*`）。画面（`src/lib/fs/webdav.ts`）が呼ぶ。
//! 置き場所は、呼ぶたびに `base`（接続先の URL）で受ける（接続の状態は持たない）。

use super::pin::{pinned_client, probe, Fingerprint, PinInfo, Pins, Probe};
use super::secret::{CredInfo, Creds, SecretStore};
use super::{build_client, Dav, DavEntry, Progress};
use crate::fs::{FsError, FsResult};
use bytes::Bytes;
use futures_util::future::{abortable, AbortHandle};
use serde::Serialize;
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, State};

/// 進み具合や中止の対象になる、動いている操作（画面が付けた job の名前）
#[derive(Default)]
pub struct Jobs(Mutex<HashMap<String, AbortHandle>>);

impl Jobs {
    pub fn add(&self, id: &str, h: AbortHandle) {
        self.0.lock().unwrap().insert(id.to_string(), h);
    }
    pub fn done(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
    /// 中止する。動いていなければ false
    pub fn cancel(&self, id: &str) -> bool {
        match self.0.lock().unwrap().remove(id) {
            Some(h) => {
                h.abort();
                true
            }
            None => false,
        }
    }
    /// 動いている操作の数（試験用）
    pub fn len(&self) -> usize {
        self.0.lock().unwrap().len()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

/// job の名前があれば、中止できる形で動かす。中止されたら `aborted`（部品の約束と同じ名前）
pub async fn run_job<T>(jobs: &Jobs, job: Option<&str>, fut: impl Future<Output = FsResult<T>>) -> FsResult<T> {
    let Some(id) = job else { return fut.await };
    let (fut, handle) = abortable(fut);
    jobs.add(id, handle);
    let r = fut.await;
    jobs.done(id);
    r.unwrap_or_else(|_| Err(FsError::new("aborted", "中止しました")))
}

/// 通信の入れ物と資格情報（アプリで 1 つ。複製は安い）
#[derive(Clone)]
pub struct Conns {
    pub http: reqwest::Client,
    pub creds: Arc<Creds>,
    /// 証明書の固定（置き場所ごと）
    pub pins: Arc<Pins>,
    /// 固定のある置き場所の入れ物（置き場所と指紋ごと。つないだままの接続を使い回す）
    pinned: Arc<Mutex<HashMap<(String, Fingerprint), reqwest::Client>>>,
    /// SFTP の接続（置き場所ごとにつないでおく）
    pub sftp: Arc<crate::sftp::Pool>,
}

impl Conns {
    pub fn new(store: Arc<dyn SecretStore>) -> Self {
        Self::with_pins(store, Pins::memory())
    }

    pub fn with_pins(store: Arc<dyn SecretStore>, pins: Pins) -> Self {
        Self { http: build_client(), creds: Arc::new(Creds::new(store)), pins: Arc::new(pins), pinned: Arc::default(), sftp: Arc::default() }
    }

    /// 置き場所の入れ物。固定があれば、その証明書だけを受け入れるもの。無ければ共通のもの
    fn client_for(&self, place: &str, base: &reqwest::Url) -> FsResult<reqwest::Client> {
        let Some(fp) = self.pins.for_base(place, base) else { return Ok(self.http.clone()) };
        let mut map = self.pinned.lock().unwrap();
        if let Some(c) = map.get(&(place.to_string(), fp)) {
            return Ok(c.clone());
        }
        let c = pinned_client(fp)?;
        map.insert((place.to_string(), fp), c.clone());
        Ok(c)
    }

    /// 置き場所（id と接続先）への入り口。保管してある資格情報があれば付ける。
    /// キーチェーンへの問い合わせは待つことがあるので、別のスレッドで行う
    pub async fn dav(&self, place: &str, base: &str) -> FsResult<Dav> {
        let client = self.client_for(place, &super::url::parse_base(base)?)?;
        let dav = Dav::new(client, base)?;
        let creds = self.creds.clone();
        let (place, url) = (place.to_string(), dav.base().clone());
        let auth = tokio::task::spawn_blocking(move || creds.for_base(&place, &url))
            .await
            .map_err(|e| FsError::new("io", e.to_string()))??;
        Ok(dav.with_auth(auth))
    }
}

pub fn state(store: Arc<dyn SecretStore>, pins: Pins) -> (Conns, Jobs, Puts) {
    (Conns::with_pins(store, pins), Jobs::default(), Puts::default())
}

/// 書き込み中の送信（チャンクごとに受けて、サーバーへ流す）。キーは job の名前
#[derive(Default)]
pub struct Puts(Mutex<HashMap<String, PutState>>);

impl Puts {
    /// 試験用: `dav_put_open` と同じ登録
    #[cfg(test)]
    pub fn insert_for_test(&self, job: &str, tx: tokio::sync::mpsc::Sender<Bytes>, task: tokio::task::JoinHandle<FsResult<DavEntry>>) {
        self.insert(job, tx, task);
    }

    /// 書き込みを登録する（`dav_put_chunk`・`dav_put_finish` が、job の名前で見つける。SFTP もこれを使う）
    pub fn insert(&self, job: &str, tx: tokio::sync::mpsc::Sender<Bytes>, task: tokio::task::JoinHandle<FsResult<DavEntry>>) {
        self.0.lock().unwrap().insert(job.to_string(), PutState { tx, task });
    }
}

struct PutState {
    tx: tokio::sync::mpsc::Sender<Bytes>,
    task: tokio::task::JoinHandle<FsResult<DavEntry>>,
}

#[derive(Serialize, Clone)]
struct ProgressEvent<'a> {
    job: &'a str,
    done: u64,
    total: u64,
}

pub fn reporter(app: tauri::AppHandle, job: Option<String>) -> Option<Progress> {
    let job = job?;
    // 1% 進むごと（と、最後）に知らせる
    let last = Arc::new(Mutex::new(u64::MAX));
    Some(Arc::new(move |done, total| {
        let step = (done * 100).checked_div(total).unwrap_or(0);
        let mut l = last.lock().unwrap();
        if *l != step || done == total {
            *l = step;
            let _ = app.emit("dav-progress", ProgressEvent { job: &job, done, total });
        }
    }))
}

fn header(request: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    let raw = request.headers().get(name)?.to_str().ok()?;
    percent_encoding::percent_decode_str(raw).decode_utf8().ok().map(|s| s.into_owned())
}

#[tauri::command]
pub async fn dav_list(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<Vec<DavEntry>> {
    conns.dav(&place, &base).await?.list(&path).await
}

#[tauri::command]
pub async fn dav_stat(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<DavEntry> {
    conns.dav(&place, &base).await?.stat(&path).await
}

#[tauri::command]
pub async fn dav_mkdir(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<DavEntry> {
    conns.dav(&place, &base).await?.mkdir(&path).await
}

/// 書き込みの開始。中身は、`dav_put_chunk` で順に送り、`dav_put_finish` で終える（メモリに全部は載せない）。
/// `size` は中身の全体の長さ、`if_match` は上書きのとき、一覧で読んだ ETag（無ければ作成）。`job` は進み具合・中止の名前
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn dav_put_open(
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
    let dav = conns.dav(&place, &base).await?;
    let progress = reporter(app, Some(job.clone()));
    let (tx, task) = start_put(&jobs, dav, path, size, if_match, job.clone(), progress);
    puts.0.lock().unwrap().insert(job, PutState { tx, task });
    Ok(())
}

/// 書き込みの送信を始める（`jobs` に、中止の取っ手を登録する）。返す送り口へ中身を流し込む
pub fn start_put(
    jobs: &Jobs,
    dav: Dav,
    path: String,
    size: u64,
    if_match: Option<String>,
    job: String,
    progress: Option<Progress>,
) -> (tokio::sync::mpsc::Sender<Bytes>, tokio::task::JoinHandle<FsResult<DavEntry>>) {
    let (tx, rx) = tokio::sync::mpsc::channel::<Bytes>(2);
    let stream = futures_util::stream::unfold((rx, 0u64), move |(mut rx, done)| {
        let progress = progress.clone();
        async move {
            let chunk = rx.recv().await?;
            let done = done + chunk.len() as u64;
            if let Some(p) = &progress {
                p(done, size);
            }
            Some((Ok::<Bytes, std::convert::Infallible>(chunk), (rx, done)))
        }
    });
    let (fut, handle) = abortable(async move { dav.put_body(&path, size, reqwest::Body::wrap_stream(stream), if_match.as_deref()).await });
    jobs.add(&job, handle);
    let task = tokio::spawn(async move { fut.await.unwrap_or_else(|_| Err(FsError::new("aborted", "中止しました"))) });
    (tx, task)
}

/// 書き込みの中身を 1 つ送る（生のバイト列。ヘッダー `x-job`）。送れなければ失敗（本当の理由は `dav_put_finish` が返す）
#[tauri::command]
pub async fn dav_put_chunk(puts: State<'_, Puts>, request: tauri::ipc::Request<'_>) -> FsResult<()> {
    let tauri::ipc::InvokeBody::Raw(body) = request.body() else {
        return Err(FsError::new("invalid", "中身がバイト列ではありません"));
    };
    let job = header(&request, "x-job").ok_or_else(|| FsError::new("invalid", "job がありません"))?;
    let tx = puts.0.lock().unwrap().get(&job).map(|p| p.tx.clone()).ok_or_else(|| FsError::new("invalid", "この書き込みは、始まっていないか、終わっています"))?;
    tx.send(Bytes::copy_from_slice(body)).await.map_err(|_| FsError::new("io", "送信が止まりました"))
}

/// 書き込みを終える（中身を送り終えた印）。サーバーの答え（書いたあとの姿・または失敗）を返す
#[tauri::command]
pub async fn dav_put_finish(jobs: State<'_, Jobs>, puts: State<'_, Puts>, job: String) -> FsResult<DavEntry> {
    finish_put(&jobs, &puts, &job).await
}

pub async fn finish_put(jobs: &Jobs, puts: &Puts, job: &str) -> FsResult<DavEntry> {
    let state = puts.0.lock().unwrap().remove(job);
    let Some(PutState { tx, task }) = state else { return Err(FsError::new("invalid", "この書き込みは、始まっていないか、終わっています")) };
    drop(tx);
    let r = task.await.map_err(|e| FsError::new("io", e.to_string()))?;
    jobs.done(job);
    r
}

#[tauri::command]
pub async fn dav_move(conns: State<'_, Conns>, place: String, base: String, from: String, to: String, overwrite: Option<bool>) -> FsResult<DavEntry> {
    conns.dav(&place, &base).await?.mv(&from, &to, overwrite.unwrap_or(false)).await
}

#[tauri::command]
pub async fn dav_copy(conns: State<'_, Conns>, place: String, base: String, from: String, to: String, overwrite: Option<bool>) -> FsResult<DavEntry> {
    conns.dav(&place, &base).await?.copy(&from, &to, overwrite.unwrap_or(false)).await
}

/// 完全に削除する（元に戻せない）
#[tauri::command]
pub async fn dav_remove(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<()> {
    conns.dav(&place, &base).await?.remove(&path).await
}

#[derive(Serialize)]
pub struct DavSize {
    pub size: u64,
    pub files: u64,
    pub dirs: u64,
    pub partial: bool,
}

#[tauri::command]
pub async fn dav_size(conns: State<'_, Conns>, place: String, base: String, path: String) -> FsResult<DavSize> {
    let (size, files, dirs, partial) = conns.dav(&place, &base).await?.size(&path).await?;
    Ok(DavSize { size, files, dirs, partial })
}

/// ファイルを、この端末の一時のフォルダへ受け取って、その絶対パスを返す（開くため）
#[tauri::command]
pub async fn dav_download(app: tauri::AppHandle, conns: State<'_, Conns>, jobs: State<'_, Jobs>, place: String, base: String, path: String, job: Option<String>) -> FsResult<String> {
    let dav = conns.dav(&place, &base).await?;
    let name = path.rsplit('/').next().filter(|n| !n.is_empty()).ok_or_else(|| FsError::new("invalid", "ファイルを指していません"))?.to_string();
    let dest = temp_dest(&name)?;
    let progress = reporter(app, job.clone());
    let out = dest.clone();
    run_job(&jobs, job.as_deref(), async move { dav.download(&path, &out, progress).await }).await?;
    Ok(dest.to_string_lossy().into_owned())
}

/// 受け取り先（一時のフォルダの下に、受け取りごとの新しいフォルダ）
pub fn temp_dest(name: &str) -> FsResult<PathBuf> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = temp_root().join(format!("{nanos:x}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| FsError::io(&e, &dir))?;
    // 名前は、もう 1 段のフォルダを作れない文字を除いてから使う
    let safe: String = name.chars().map(|c| if matches!(c, '/' | '\\' | '\0') { '_' } else { c }).collect();
    Ok(dir.join(safe))
}

/// 動いている操作を中止する。動いていなければ false
#[tauri::command]
pub fn dav_cancel(jobs: State<'_, Jobs>, job: String) -> bool {
    jobs.cancel(&job)
}

/// 受け取り用の一時のフォルダの親（`temp_dest` の親）
pub fn temp_root() -> PathBuf {
    std::env::temp_dir().join("fixplor-dav")
}

/// 一時のフォルダの下の、古い受け取りを消す（`max_age` より前に作ったもの。開いている最中のファイルを消さないよう、起動のときだけ呼ぶ）。
/// 消せたフォルダの数を返す。失敗しても、ほかは続ける
pub fn clean_temp(root: &std::path::Path, max_age: std::time::Duration) -> usize {
    let Ok(rd) = std::fs::read_dir(root) else { return 0 };
    let now = std::time::SystemTime::now();
    let mut removed = 0;
    for e in rd.flatten() {
        let Ok(meta) = e.metadata() else { continue };
        let old = meta.modified().ok().and_then(|m| now.duration_since(m).ok()).is_some_and(|age| age > max_age);
        if old && meta.is_dir() && std::fs::remove_dir_all(e.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// 保管している資格情報の様子（ユーザー名・接続先。パスワードは返さない）。無ければ null
#[tauri::command]
pub async fn dav_cred_info(conns: State<'_, Conns>, place: String) -> FsResult<Option<CredInfo>> {
    let creds = conns.creds.clone();
    tokio::task::spawn_blocking(move || creds.info(&place)).await.map_err(|e| FsError::new("io", e.to_string()))?
}

/// 資格情報を保管する（OS のキーチェーンだけ）。`password` が無ければ、保管済みのパスワードを使い続ける
#[tauri::command]
pub async fn dav_cred_set(conns: State<'_, Conns>, place: String, base: String, user: String, password: Option<String>, key: Option<String>) -> FsResult<()> {
    let creds = conns.creds.clone();
    tokio::task::spawn_blocking(move || creds.set_with_key(&place, &base, &user, password.as_deref(), key.as_deref())).await.map_err(|e| FsError::new("io", e.to_string()))?
}

/// 保管している資格情報を消す
#[tauri::command]
pub async fn dav_cred_clear(conns: State<'_, Conns>, place: String) -> FsResult<()> {
    let creds = conns.creds.clone();
    tokio::task::spawn_blocking(move || creds.clear(&place)).await.map_err(|e| FsError::new("io", e.to_string()))?
}

/// 証明書を確かめる。通常の確かめで通れば `trusted`。通らなければ、示された証明書の指紋（握手だけ。要求は送らない）
#[tauri::command]
pub async fn dav_cert_probe(base: String) -> FsResult<Probe> {
    // sftp:// は、証明書ではなくホスト鍵の指紋を確かめる
    if base.trim_start().starts_with("sftp:") {
        return crate::sftp::probe(&base).await;
    }
    probe(&base).await
}

/// 固定している証明書の様子（接続先・指紋）。無ければ null
#[tauri::command]
pub async fn dav_pin_info(conns: State<'_, Conns>, place: String) -> FsResult<Option<PinInfo>> {
    Ok(conns.pins.info(&place))
}

/// 置き場所の証明書を固定する（https の接続先だけ。前の固定は置き換える）
#[tauri::command]
pub async fn dav_pin_set(conns: State<'_, Conns>, place: String, base: String, fingerprint: String) -> FsResult<()> {
    conns.pins.set(&place, &base, &fingerprint)
}

/// 固定を解除する（通常の確かめに戻る）
#[tauri::command]
pub async fn dav_pin_clear(conns: State<'_, Conns>, place: String) -> FsResult<()> {
    conns.pins.clear(&place)
}
