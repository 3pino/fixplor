import { vi } from 'vitest';
import FakeIcon from './FakeIcon.svelte';
import FakePdfThumb from './FakePdfThumb.svelte';
import { createExplorer } from '../explorer';
import { DirIndex } from '../stores/dirIndex.svelte';
import { basicNameError } from '../ops';
import { basicViewerKind, isImageName } from '../kinds';
import { dir as dirEntry, file as fileEntry } from './fakes';
import type { Entry, EntryUrls, ExplorerApi, ExplorerHost, Rules, ToastAction, OsDropEntry, OsDropEvent, ToastKind, UploadHandle, ViewerItem } from '../types';

// 画面の流れの試験（FileExplorer.screen.test.ts）の土台: 1 つのエクスプローラー（メモリの中の置き場所・本体）と、試験が見る窓。
// - h: 置き場所の呼び出しの記録と、返す一覧（h.current）。送る・貼る・消すは、記録だけして成功を返す
// - ui: 本体が受け取るもの（通知・確認・拡大表示・戻る）の窓
// - place: 置き場所の見分け（place.key を替えると、置き場所が変わったことになる）
// 画面はアプリ全体で 1 つの explorer を使う（アプリと同じ。試験ごとに reset する）。

export const entry = (name: string, kind: 'file' | 'dir' = 'file'): Entry => ({ ...(kind === 'dir' ? dirEntry(name) : fileEntry(name)), size: 1 });
export const listing: Entry[] = [entry('a.txt'), entry('docs', 'dir'), { ...entry('pic.png'), mime: 'image/png', size: 9 }];

export const h = {
  /** 一覧（既定は listing。特別なフォルダの場面では差し替える） */
  current: null as Entry[] | null,
  list: vi.fn(async (_path?: string): Promise<Entry[]> => h.current ?? listing),
  /** フォルダのサイズ（プロパティ） */
  size: vi.fn(async (_path?: string) => ({ size: 12345, files: 3, dirs: 1 })),
  /** 一覧のフォルダのサイズ（詳細の「サイズ」の列） */
  folderSize: vi.fn(async (_path?: string) => ({ size: 2048, partial: false })),
  upload: vi.fn((_path: string, _file: Blob, _onProgress?: (ratio: number) => void): UploadHandle => ({ promise: new Promise(() => {}), abort: () => {} })),
  write: vi.fn(async (path: string, _body?: Blob | ArrayBuffer | string) => ({ ...entry(path.split('/').pop()!), path })),
  mkdir: vi.fn(async (_path?: string) => ({}) as Entry),
  copy: vi.fn(async (_from: string, _to: string, _overwrite?: boolean) => ({}) as Entry),
  /** 完全に削除（caps.trash が偽のときだけ呼ばれる。ふつうは呼ばれないことの確認用） */
  remove: vi.fn(async (_path: string) => {}),
  trash: vi.fn(async (path: string) => ({ id: `id-${path}`, original_path: path, kind: 'file' as const, size: 1, deleted_at: 0 })),
  restore: vi.fn(async (_id: string) => ({ name: '', path: '', kind: 'file' as const, size: 1, modified: 0, mime: null }) as Entry),
  purge: vi.fn(async (_id: string) => {}),
  move: vi.fn(async (_from: string, _to: string, _overwrite?: boolean) => ({}) as Entry),
  /**
   * OS のクリップボード（差し替え）。copyText で書いたものが text に、files.write で書いたものが files に入る。
   * supportsFiles が偽なら、置き場所は files を持たない（Android・WebDAV など。アプリの中のバッファだけ）
   */
  clip: { text: null as string | null, image: null as File | null, files: null as { paths: string[]; op: 'copy' | 'move'; token: string } | null, writable: true, supportsFiles: true },
};

/** この端末の種類。true のときだけ、選択の操作が 0 件でも続く（PC 向けの動き。試験ごとに戻す） */
export const dsk = { desktop: false, linux: false };

/** 置き場所の見分け。key を替えると、置き場所が変わったことになる */
export const place = { key: 'http://a.test', listeners: new Set<() => void>() };
/** 置き場所の見分けだけを替える（変わったことは知らせない）。戻すのは mockRestore */
export function scopeAs(key: string): { mockRestore(): void } {
  place.key = key;
  return { mockRestore: () => void (place.key = 'http://a.test') };
}
/** 置き場所を替える（key を替えて、変わったことを知らせる） */
export function switchPlace(key: string): void {
  place.key = key;
  for (const cb of [...place.listeners]) cb();
}

export type Toast = { id: number; text: string; kind: ToastKind; action?: ToastAction };
export type Confirm = { title: string; body?: string; okLabel: string; ngLabel?: string; danger?: boolean; resolve: (ok: boolean) => void };

/** 本体が受け取るものの窓（通知・確認・拡大表示・戻る） */
export const ui = {
  toasts: [] as Toast[],
  confirmReq: null as Confirm | null,
  /** 確認を出した回数 */
  confirmCount: 0,
  lightbox: null as ViewerItem | null,
  lightboxGallery: null as (() => ViewerItem[]) | null,
  pluginBack: [] as { run: () => void }[],
  /** 戻る操作。拡大表示 → 積んだ処理（新しい順）の順に 1 つ戻す。戻る先が無ければ false */
  back(): boolean {
    if (ui.lightbox) {
      ui.lightbox = null;
      return true;
    }
    const top = ui.pluginBack.pop();
    if (!top) return false;
    top.run();
    return true;
  },
};

/** 試験ごとに、本体の窓を初期へ戻す */
export function resetUi(): void {
  ui.toasts = [];
  ui.confirmReq = null;
  ui.confirmCount = 0;
  ui.lightbox = null;
  ui.lightboxGallery = null;
  ui.pluginBack = [];
  // 数えたフォルダのサイズの写しは、この explorer を使い回す試験の間で引き継がない
  explorer.folderSizeCache.clear();
}

/** 特別なフォルダ（special/）を持つ置き場所の決まり。名前は、使えない文字（:）と、特別なフォルダの中の [ ] | も断る */
export const SPECIAL_DIR = 'special';
export const SCREEN_RULES: Rules = {
  specialDir: SPECIAL_DIR,
  trashDir: '.trash',
  nameError(dir, name) {
    const base = basicNameError(name);
    if (base) return base;
    if (/[:*?"<>|\\]/.test(name)) return '名前に使えない文字（: * ? " < > |）は使えません';
    if ((dir === SPECIAL_DIR || dir.startsWith(SPECIAL_DIR + '/')) && /[[\]]/.test(name)) return '特別なフォルダの中では [ ] は使えません';
    return null;
  },
  texts: {
    root: 'ルート',
    reserved: '特別なフォルダは動かせません',
    crossMove: '特別なフォルダの内外の間は移動できません（コピーしてください）',
    noSubfolder: '特別なフォルダ内にフォルダは作れません',
    cutSkipped: '特別・ゴミ箱のフォルダは動かせないので除きました',
    trashNote: '特別なフォルダのものは、リンクが切れます',
    overwriteBody: '同じ特別なフォルダの中身が入れ替わります。元に戻せません',
  },
};

const api: ExplorerApi = {
  list: (path) => h.list(path),
  write: (...a) => h.write(...a),
  mkdir: (...a) => h.mkdir(...a) as Promise<Entry>,
  trash: (...a) => h.trash(...a),
  restore: (...a) => h.restore(...a),
  purge: (...a) => h.purge(...a),
  remove: (...a) => h.remove(...a),
  size: (...a) => h.size(...a),
  folderSize: (...a) => h.folderSize(...a),
  move: (...a) => h.move(...a) as Promise<Entry>,
  copy: (...a) => h.copy(...a) as Promise<Entry>,
  upload: (...a) => h.upload(...a),
};

const urls: EntryUrls = {
  href: (e) => `fake://place/${e.path}`,
  readUrl: (e, thumb) => `fake://place/${e.path}${thumb ? '?thumb' : ''}`,
  thumbUrl: (e) => (e.kind === 'file' && isImageName(e.name, e.mime) ? `fake://place/${e.path}?thumb` : null),
  pdfSource: (e) => (e.kind === 'file' && /\.pdf$/i.test(e.name) && e.size <= 50 * 1024 * 1024 ? { url: `fake://place/${e.path}`, key: `${e.path}:${e.modified}:${e.size}` } : null),
};

/** OS のドロップ（Linux のデスクトップの経路）。handler はこの画面が登録したもの。readEntries は、届いた id の中身（試験が差し替える） */
export const osDrop = {
  handler: null as ((ev: OsDropEvent) => void | Promise<void>) | null,
  readEntries: vi.fn(async (_id: number): Promise<{ entries: OsDropEntry[]; skipped: string[] }> => ({ entries: [], skipped: [] })),
  releaseId: vi.fn(async (_id: number) => {}),
};

/** 保存（ダウンロード）の依頼の記録 */
export const downloadFile = vi.fn(async (_req: { url: string; name: string }) => {});

/** ドロップされた入口（FileSystemEntry）を、フォルダの中まで平らにする（親が先） */
async function flattenDrop(roots: FileSystemEntry[]): Promise<OsDropEntry[]> {
  const out: OsDropEntry[] = [];
  const walk = async (e: FileSystemEntry, rel: string): Promise<void> => {
    if (e.isFile) {
      // 中身は、送る直前に読む（読んでいる間に置き場所が変わる場合を、試験が作れる）
      out.push({ rel, dir: false, size: 0, read: () => new Promise<File>((ok, ng) => (e as FileSystemFileEntry).file(ok, ng)) });
      return;
    }
    out.push({ rel, dir: true });
    const kids = await new Promise<FileSystemEntry[]>((ok, ng) => (e as FileSystemDirectoryEntry).createReader().readEntries(ok, ng));
    for (const k of kids) await walk(k, `${rel}/${k.name}`);
  };
  for (const r of roots) await walk(r, r.name);
  return out;
}

/** 本体の操作（ファイルのプロパティに出す）の記録 */
export const fileActionRun = vi.fn();

const host: ExplorerHost = {
  PdfThumb: FakePdfThumb,
  fileAction: { label: '本体の操作', icon: FakeIcon, run: (entry, label) => fileActionRun(entry, label) },
  toast: (text, kind = 'info', action) => void ui.toasts.push({ id: ui.toasts.length + 1, text, kind, action }),
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      ui.confirmCount++;
      ui.confirmReq = {
        ...opts,
        resolve: (ok) => {
          ui.confirmReq = null;
          resolve(ok);
        },
      };
    }),
  addBack: (run) => {
    const item = { run };
    ui.pluginBack = [...ui.pluginBack, item];
    return () => {
      ui.pluginBack = ui.pluginBack.filter((e) => e !== item);
    };
  },
  openViewer: (item, gallery) => {
    ui.lightboxGallery = gallery;
    ui.lightbox = item;
  },
  viewerKind: (name, mime) => basicViewerKind(name, mime),
  isImage: (name, mime) => isImageName(name, mime),
  errorText: (e) => (e instanceof Error ? e.message : String(e)),
  log: () => {},
  platform: {
    isTauri: () => dsk.desktop,
    osName: () => (dsk.desktop ? 'windows' : ''),
    isLinuxDesktop: () => dsk.linux,
  },
  clipboard: {
    copyText: async (t) => {
      if (!h.clip.writable) return false;
      h.clip.text = t;
      h.clip.image = null;
      return true;
    },
    peek: async () => ({ text: h.clip.text !== null, image: h.clip.image !== null }),
    readText: async () => h.clip.text,
    readImage: async () => h.clip.image,
    readNativeImage: async () => null,
    textName: () => 'clipboard-20260101-000000.txt',
    get files() {
      if (!h.clip.supportsFiles) return undefined;
      return {
        write: async (paths: string[], op: 'copy' | 'move', token: string) => {
          if (!h.clip.writable) return false;
          // 前の中身（文字・画像）は消える。文字は書かない
          h.clip.files = { paths, op, token };
          h.clip.text = null;
          h.clip.image = null;
          return true;
        },
        token: async () => h.clip.files?.token ?? null,
      };
    },
  },
  download: { file: downloadFile, intercept: vi.fn(() => false) },
  osDrop: {
    listenNative: async () => () => {},
    listen: async (handler) => {
      osDrop.handler = handler;
      return () => void (osDrop.handler = null);
    },
    entries: (id) => osDrop.readEntries(id),
    release: (id) => osDrop.releaseId(id),
    rootsOf: (dt) =>
      Array.from(dt?.items ?? [])
        .filter((i) => i.kind === 'file')
        .flatMap((i) => i.webkitGetAsEntry() ?? []),
    entriesFromRoots: flattenDrop,
  },
};

let viewSaved = $state.raw<unknown>({});

/** 一覧の写し（画面と同じものを、試験からも見る・捨てる） */
export const dirIndex = new DirIndex({ list: (dir) => api.list(dir) });

export const explorer = createExplorer({
  api,
  urls,
  rules: SCREEN_RULES,
  host,
  index: dirIndex,
  labels: { root: 'ルート', upload: 'アップロード' },
  scope: { key: () => place.key, onChange: (cb) => (place.listeners.add(cb), () => place.listeners.delete(cb)) },
  // 表示の保存先（本体の設定のように、変わると画面が追従する）
  viewStore: { read: () => viewSaved, write: (m) => (viewSaved = m) },
});

export const fileExplorer = explorer.nav;
export const explorerBuffer = explorer.buffer;
export const explorerSelection = explorer.selection;
export const explorerView = explorer.view;
