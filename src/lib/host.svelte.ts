import { basicViewerKind, isImageName, type ConfirmOptions, type ExplorerHost, type ToastAction, type ToastKind, type ViewerItem } from '@3pino/explorer-kit';
import { copyText } from '@3pino/app-kit-web/core/clipboard';
import { osName } from '@3pino/app-kit-web/core/platform';
import { Shell } from '@3pino/app-kit-web/shell';
import PdfThumb from '@3pino/viewer-kit-web/viewers/PdfThumb.svelte';
import type { LightboxItem } from '@3pino/viewer-kit-web/viewers/types';
import { errorText } from './labels';
import { openHref, pathOfOpenHref } from './fs/local';
import type { Sources } from './fs/sources';
import { FsError } from './fs/types';
import { canWriteFiles, fileClipboard } from './osClipboard';

// 共有の部品（エクスプローラー）へ貸す、本体の機能: 通知・確認・「戻る」・ファイルを開く・クリップボード・この端末の種類。
// 通知・確認・戻るの状態は、土台の Shell（@3pino/app-kit-web/shell）が持つ。

/**
 * 本体の画面の状態。通知・確認・「戻る」の層は土台の Shell（@3pino/app-kit-web/shell）が持ち、ここはその上の薄い包み。
 * 通知と確認の表示は、土台の Toasts.svelte・ConfirmDialog.svelte が `shell` を読んで出す。
 */
export class HostState {
  readonly shell = new Shell<unknown, LightboxItem>();

  toast(text: string, kind: ToastKind = 'info', action?: ToastAction): number {
    return this.shell.toast(text, kind, action);
  }

  dismiss(id: number): void {
    this.shell.dismiss(id);
  }

  /** 確認を出す。前の確認が出たままなら、それは取り消しとして閉じる（土台は黙って置き換えるので、ここで閉じる） */
  confirm(opts: ConfirmOptions): Promise<boolean> {
    this.shell.confirmReq?.resolve(false);
    const p = this.shell.confirm(opts);
    // 確認は「戻る」で取り消せる層（開いているあいだだけ積む）
    const off = this.addBack(() => this.shell.confirmReq?.resolve(false));
    return p.finally(off);
  }

  addBack(run: () => void): () => void {
    return this.shell.addPluginBack(run);
  }

  get canBack(): boolean {
    return this.shell.backDepth(0) > 0;
  }

  /** 「戻る」。積まれた処理のうち、いちばん新しいものを外してから呼ぶ。無ければ false */
  back(): boolean {
    return this.shell.back(() => false);
  }
}

/** 失敗を、利用者向けの文にする（Rust の code から。ほかはそのままの文） */
export function failureText(e: unknown): string {
  if (e instanceof FsError) return errorText(e.code);
  return e instanceof Error ? e.message : String(e);
}

/** 置き場所が、ファイルを開く・表示の URL から元のパスをたどる口 */
export type OpenSource = {
  open: (path: string) => Promise<void>;
  sources: Sources;
  /** 画面のパス → OS の絶対パス（この端末のファイルだけが持つ。あれば、コピーを OS のクリップボードへファイルとして書く） */
  osPath?: (path: string) => string;
};

/** 項目を、既定のアプリで開く（OS の既定のアプリ・ネットワークの場所は受け取ってから）。開けなければ知らせる */
export function externalOpener(state: HostState, fs: Pick<OpenSource, 'open'>): (req: { url: string; name: string }) => Promise<void> {
  return async (req) => {
    const path = pathOfOpenHref(req.url);
    if (path === null) return;
    try {
      await fs.open(path);
    } catch (e) {
      state.toast(`「${req.name}」を開けませんでした: ${failureText(e)}`, 'error');
    }
  };
}

export function createHost(state: HostState, fs: OpenSource): ExplorerHost {
  const openExternally = externalOpener(state, fs);
  /** 拡大表示の「保存」は、既定のアプリで開く（表示の URL ではなく、項目のパスで） */
  const forViewer = (item: ViewerItem): LightboxItem => {
    const path = fs.sources.pathOf(item.src);
    return { ...item, downloadUrl: path === null ? item.downloadUrl : openHref(path) };
  };
  return {
    toast: (text, kind, action) => state.toast(text, kind, action),
    confirm: (opts) => state.confirm(opts),
    addBack: (run) => state.addBack(run),
    // 写真・PDF は、拡大表示（土台の viewer-kit-web）で見る。ほかのファイルは、既定のアプリで開く
    openViewer: (item, gallery) => state.shell.openLightbox(forViewer(item), () => gallery().map(forViewer)),
    viewerKind: basicViewerKind,
    isImage: isImageName,
    errorText: failureText,
    log: (level, text) => console[level](text),
    PdfThumb,
    platform: {
      // このアプリは常に Tauri の中（試験では WebView の内部オブジェクトが無いので、判定に任せない）
      isTauri: () => true,
      osName,
      // OS からのドロップ（Tauri のネイティブのイベント）は、まだ受けない
      isLinuxDesktop: () => false,
    },
    clipboard: {
      copyText,
      // 中身は確かめない（読むと、OS が許可を尋ねることがある）。貼り付けは押せるままにする
      peek: async () => 'unknown',
      async readText() {
        try {
          return (await navigator.clipboard.readText()) || null;
        } catch {
          return null;
        }
      },
      readImage: async () => null,
      readNativeImage: async () => null,
      textName: () => `貼り付け ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.txt`,
      // コピー・切り取りは、この端末のファイルならファイルとして OS に渡す（Windows・Linux）。文字は書かない。WebDAV・Android は、アプリの中のバッファだけ（コピーした時点のクリップボードの中身を控えて、貼るときに比べる）
      files: fs.osPath && canWriteFiles(osName()) ? fileClipboard(fs.osPath) : undefined,
    },
    download: {
      file: openExternally,
      intercept(ev, req) {
        ev.preventDefault();
        void openExternally(req);
        return true;
      },
    },
    osDrop: {
      listenNative: async () => () => {},
      listen: async () => () => {},
      entries: async () => ({ entries: [], skipped: [] }),
      release: async () => {},
      rootsOf: () => [],
      entriesFromRoots: async () => [],
    },
  };
}

