import { boundedSearch } from './search';
import { convertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { PDF_THUMB_MAX_BYTES } from '@3pino/viewer-kit-web/viewers/pdfThumb';
import { basicNameError, isImageName, isPdfName, type Entry, type EntryUrls, type ExplorerApi, type Rules } from '@3pino/explorer-kit';
import { runner, tauriCall, type Call } from './call';
import { openHref } from './local';
import { createSources, type Sources } from './sources';
import { FsError, type DavEntry } from './types';

// ネットワークの置き場所（WebDAV）を、共有の部品（@3pino/explorer-kit）の置き場所（ExplorerApi）として見せる。
// 実体は Rust（src-tauri/src/webdav）。画面のパスは、接続先からの相対（区切り `/`）で、そのまま Rust へ渡す。
// 資格情報（Basic 認証）は Rust が OS のキーチェーンから読んで付ける。ここは置き場所の id と接続先を渡すだけ（パスワードは持たない）。
// 画像・PDF の中身は、Rust の中継（fixdav スキーム）の URL で読む（認証・証明書・CORS を Rust が受け持つ）。

export type DavProgress = { job: string; done: number; total: number };

export type DavOptions = {
  /** 置き場所の id（資格情報の保管の名前） */
  id: string;
  /** 接続先の URL（`https://host/dav/`） */
  base: string;
  /** 認証が通らなかった（401）とき、利用者に入れ直してもらうために呼ぶ */
  onAuthError?: () => void;
  /** 証明書を確認できない（tls）・前に信頼したものと変わった（cert_changed）とき、利用者に確かめてもらうために呼ぶ */
  onCertError?: (code: 'tls' | 'cert_changed') => void;
  /** 中継のスキームの URL にする（試験で差し替える）。既定は Tauri の convertFileSrc */
  proxySrc?: (path: string) => string;
  call?: Call;
  /** 隠しファイル（. で始まるもの）を一覧に出すか */
  showHidden?: () => boolean;
  /** Rust のコマンドの種類（`dav_*` か `sftp_*`）。省くと、接続先の URL（`sftp://` なら sftp、ほかは dav）から決める */
  proto?: 'dav' | 'sftp';
  /** 進み具合の知らせを受ける（試験で差し替える） */
  onProgress?: (handler: (p: DavProgress) => void) => Promise<() => void>;
};

export type DavFs = {
  api: ExplorerApi;
  urls: EntryUrls;
  rules: Rules;
  base: string;
  /** 表示の URL → 項目のパス（拡大表示の「保存」で、既定のアプリで開くため） */
  sources: Sources;
  /** ファイルを、この端末の一時のフォルダへ受け取ってから、既定のアプリで開く */
  open(path: string): Promise<void>;
  isMissing(e: unknown): boolean;
};

const tauriProgress: NonNullable<DavOptions['onProgress']> = (handler) => listen<DavProgress>('dav-progress', (ev) => handler(ev.payload));

/** 中継の URL（`fixdav` スキーム）の、スキームの前の部分。置き場所の id・接続先・パスの各段を符号化し、全体をもう一度符号化する */
export const PROXY_SCHEME = 'fixdav';

/**
 * 中身を読む URL。更新日時と大きさを付けるので、中身が変われば別の URL になる（WebView の覚えが古くならない）。
 * Rust が受けて、保管してある資格情報を付けて取りに行く（`src-tauri/src/webdav/proxy.rs`）
 */
export function davProxyUrl(place: string, base: string, path: string, version: string, src: (path: string) => string = (p) => convertFileSrc(p, PROXY_SCHEME)): string {
  const enc = encodeURIComponent;
  const inner = `${enc(place)}/${enc(base)}/${path.split('/').filter((s) => s !== '').map(enc).join('/')}`;
  return `${src(inner)}?v=${enc(version)}`;
}

export function createDavFs(options: DavOptions): DavFs {
  const base = options.base;
  const id = options.id;
  // SFTP も、WebDAV と同じ引数・答えのコマンド（sftp_*）で使う。書き込みの続き・中止（dav_put_chunk・dav_put_finish・dav_cancel）は共通
  const proto = options.proto ?? (base.startsWith('sftp:') ? 'sftp' : 'dav');
  const baseRun = runner(options.call ?? tauriCall);
  const sources = createSources();
  const proxySrc = options.proxySrc ?? ((p: string) => convertFileSrc(p, PROXY_SCHEME));
  /** Rust を呼ぶ。認証が通らなかったら、利用者に知らせる口を呼んでから、そのまま失敗にする */
  const run: Call = async <T,>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> => {
    try {
      return await baseRun<T>(cmd, args, headers);
    } catch (e) {
      if (e instanceof FsError && e.code === 'auth') options.onAuthError?.();
      if (e instanceof FsError && (e.code === 'tls' || e.code === 'cert_changed')) options.onCertError?.(e.code);
      throw e;
    }
  };
  /** 置き場所の指定（どの置き場所の、どの接続先か） */
  const at = { place: id, base };
  const showHidden = options.showHidden ?? (() => false);
  const onProgress = options.onProgress ?? tauriProgress;
  /** 一覧で読んだ ETag（パス → ETag）。上書きは、これと同じときだけ通す（黙って上書きしない） */
  const etags = new Map<string, string>();
  let jobs = 0;
  const newJob = (kind: string): string => `${kind}-${Date.now().toString(36)}-${++jobs}`;

  const entry = (raw: DavEntry): Entry => {
    if (raw.etag) etags.set(raw.path, raw.etag);
    else etags.delete(raw.path);
    return { name: raw.name, path: raw.path, kind: raw.kind, size: raw.size ?? 0, modified: raw.modified ?? 0, mime: raw.mime };
  };
  const forget = (path: string): void => {
    for (const k of [...etags.keys()]) if (k === path || k.startsWith(path + '/')) etags.delete(k);
  };

  /** 1 回に送る大きさ（これだけがメモリに載る。Rust との間は、順に流す） */
  const CHUNK = 4 * 1024 * 1024;

  /**
   * ファイルを書く。中身は、Rust へ少しずつ流す（全体をメモリに載せない）:
   * dav_put_open（接続・ETag・大きさ）→ dav_put_chunk を順に → dav_put_finish（サーバーの答え）。
   * 途中で送れなくなったら、本当の理由（サーバーの答え・中止）は dav_put_finish が返す
   */
  const put = async (path: string, body: Blob | ArrayBuffer | string, job: string, cancelled: () => boolean): Promise<DavEntry> => {
    const blob = body instanceof Blob ? body : new Blob([body]);
    // 一覧で読んだ ETag があれば、そのものだけを上書き。無ければ作成（同名があれば exists）
    await run<void>(`${proto}_put_open`, { ...at, path, size: blob.size, ifMatch: etags.get(path) ?? null, job });
    // 開いている間に中止されたとき、取っ手が間に合わなくても止まるように
    if (cancelled()) void run<boolean>('dav_cancel', { job }).catch(() => false);
    const headers = { 'x-job': encodeURIComponent(job) };
    try {
      for (let offset = 0; offset < blob.size && !cancelled(); offset += CHUNK) {
        await run<void>('dav_put_chunk', new Uint8Array(await blob.slice(offset, offset + CHUNK).arrayBuffer()), headers);
      }
    } catch (e) {
      // 送れなかった。本当の理由を聞く（答えが成功なら、元の失敗を返す）
      await run<DavEntry>('dav_put_finish', { job });
      throw e;
    }
    return run<DavEntry>('dav_put_finish', { job });
  };

  const api: ExplorerApi = {
    // サーバー側の検索は一般には無いので、手元で、浅いフォルダから読む（上限つき。search.ts）
    search: (query, on) => boundedSearch((dir) => api.list(dir), query, on),
    async list(path) {
      const all = await run<DavEntry[]>(`${proto}_list`, { ...at, path });
      return (showHidden() ? all : all.filter((e) => !e.hidden)).map(entry);
    },
    async write(path, body) {
      return entry(await put(path, body, newJob('w'), () => false));
    },
    mkdir: async (path) => entry(await run<DavEntry>(`${proto}_mkdir`, { ...at, path })),
    // ゴミ箱は無い（caps.trash: false）。部品は remove を呼ぶ
    trash: () => Promise.reject(new FsError('unsupported', 'この置き場所にはゴミ箱がありません')),
    restore: () => Promise.reject(new FsError('unsupported', 'この置き場所にはゴミ箱がありません')),
    purge: () => Promise.reject(new FsError('unsupported', 'この置き場所にはゴミ箱がありません')),
    async remove(path) {
      await run<void>(`${proto}_remove`, { ...at, path });
      forget(path);
    },
    async size(path) {
      const s = await run<{ size: number; files: number; dirs: number; partial: boolean }>(`${proto}_size`, { ...at, path });
      // 途中までの値を、全体の値として見せない
      if (s.partial) throw new FsError('too_large', 'フォルダが大きく、数えきれませんでした');
      return { size: s.size, files: s.files, dirs: s.dirs };
    },
    async move(from, to, overwrite) {
      const e = entry(await run<DavEntry>(`${proto}_move`, { ...at, from, to, overwrite: overwrite === true }));
      forget(from);
      return e;
    },
    copy: async (from, to, overwrite) => entry(await run<DavEntry>(`${proto}_copy`, { ...at, from, to, overwrite: overwrite === true })),
    upload(path, file, onProg) {
      const job = newJob('up');
      let aborted = false;
      const promise = (async () => {
        // 進み具合を受けてから送る（先に届いた知らせを逃さない）
        const stop = await onProgress((p) => {
          if (p.job === job && p.total > 0) onProg?.(Math.min(1, p.done / p.total));
        });
        try {
          // 送り始める前に中止されていたら、送らない
          if (aborted) throw new FsError('aborted', '中止しました');
          return entry(await put(path, file, job, () => aborted));
        } finally {
          stop();
        }
      })();
      return {
        promise,
        abort: () => {
          aborted = true;
          void run<boolean>('dav_cancel', { job }).catch(() => false);
        },
      };
    },
  };

  /** 中身を読む URL（資格情報は Rust の中継が付ける） */
  const read = (e: Entry): string => sources.note(davProxyUrl(id, base, e.path, `${e.modified}-${e.size}`, proxySrc), e.path);
  const urls: EntryUrls = {
    href: (e) => openHref(e.path),
    readUrl: (e) => read(e),
    thumbUrl: (e) => (e.kind === 'file' && isImageName(e.name, e.mime) ? read(e) : null),
    // PDF の 1 ページ目（大きすぎるものは作らない）
    pdfSource: (e) => (e.kind === 'file' && isPdfName(e.name, e.mime) && e.size <= PDF_THUMB_MAX_BYTES ? { url: read(e), key: `${id}:${e.path}:${e.modified}:${e.size}` } : null),
  };

  const rules: Rules = {
    specialDir: null,
    nameError: (_dir, name) => basicNameError(name),
  };

  return {
    api,
    urls,
    rules,
    base,
    sources,
    async open(path) {
      const local = await run<string>(`${proto}_download`, { ...at, path, job: newJob('dl') });
      await run<void>('fs_open', { path: local });
    },
    isMissing: (e) => e instanceof FsError && (e.code === 'not_found' || e.code === 'not_dir'),
  };
}
