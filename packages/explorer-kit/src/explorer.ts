import { ExplorerBuffer } from './stores/buffer.svelte';
import { DirIndex } from './stores/dirIndex.svelte';
import { ExplorerNav } from './stores/nav.svelte';
import { ExplorerSearch } from './stores/search.svelte';
import { ExplorerSelection } from './stores/selection.svelte';
import { ExplorerView } from './stores/view.svelte';
import type { DirIndexLike, EntryUrls, ExplorerApi, ExplorerHost, Rules, ScopeSource, ViewStore } from './types';

/** できること（無い操作は出さない） */
export type ExplorerCaps = {
  /** ゴミ箱へ入れたものを、この部品から元へ戻せる（削除のあとの「取り消す」） */
  restore: boolean;
  /**
   * 削除がゴミ箱へ入れるものか（既定 true）。偽のときは、削除は完全な削除（元に戻せない）になり、
   * 部品は `api.remove` を呼び、確認の文も「完全に削除します。元に戻せません」にする（ゴミ箱の無い置き場所用。`remove` が要る）。
   */
  trash: boolean;
};

/** 置き場所ごとの言葉（画面に出す文字） */
export type ExplorerLabels = {
  /** いちばん上の名前（パスの先頭。例: 「サーバー」「この端末」） */
  root: string;
  /** 外のファイルを取り込む操作の名前（例: 「アップロード」）。省くと、その操作を出さない */
  upload?: string;
  /** 置き場所を指す呼び名（切り替わって操作を止めたときの知らせに使う。既定 '置き場所'。例: 「サーバー」） */
  scope?: string;
};

/** エクスプローラー 1 つ分（置き場所・本体から借りる機能・状態）。画面（FileExplorer.svelte）へ渡す */
export type Explorer = {
  api: ExplorerApi;
  urls: EntryUrls;
  rules: Rules;
  scope: ScopeSource;
  caps: ExplorerCaps;
  labels: ExplorerLabels;
  host: ExplorerHost;
  index: DirIndexLike;
  nav: ExplorerNav;
  buffer: ExplorerBuffer;
  selection: ExplorerSelection;
  view: ExplorerView;
  /** 検索（名前の絞り込み・サブフォルダも探す） */
  search: ExplorerSearch;
  /** 数えたフォルダのサイズの写し（タブを切り替えても、数え直さない） */
  folderSizeCache: FolderSizeCache;
  /** フォルダごとに、最後に選んだ項目（パス）。戻る・下へ入る・上がるとき、そこを選び直す（アプリを閉じるまで。保存はしない） */
  lastSelected: Map<string, string>;
  /**
   * 次にフォルダを移ったときに、一覧で選んでカーソルを置く項目のパス（親フォルダのビューが、押した項目を一覧で見せるために立てる）。
   * 移り先のフォルダ直下の項目で、一覧にあれば、上へ上がったときの「いたフォルダ」より優先する。使ったら空にする
   */
  revealRequest: string | null;
  /**
   * いまドラッグしている項目（このエクスプローラーの一覧から始めたもの）を、別のフォルダへ移す・コピーする。画面（FileExplorer）が付ける。
   * 一覧の外のドロップ先（左の欄のブックマークなど）が使う。ドラッグしていないときは、何もしない
   */
  dropDragged: ((destDir: string, op: 'move' | 'copy') => Promise<void>) | null;
};

/** 数えたフォルダのサイズ（パス → 値と、そのときのフォルダの更新日時）。更新日時が同じなら、数え直さない */
export type FolderSizeCache = Map<string, { value: { size: number; partial: boolean }; modified: number }>;

export type ExplorerOptions = {
  api: ExplorerApi;
  urls: EntryUrls;
  rules: Rules;
  host: ExplorerHost;
  viewStore: ViewStore;
  caps?: Partial<ExplorerCaps>;
  labels: ExplorerLabels;
  /** 置き場所が変わるもの（接続先を切り替えられるサーバーなど）だけ渡す。省くと、変わらない置き場所 */
  scope?: ScopeSource;
  /** 一覧の写しを本体が持っているとき（ほかの画面と共有する）。省くと、ここで作る */
  index?: DirIndexLike;
  /**
   * 切り取り・コピーのバッファ。同じ置き場所を、複数のエクスプローラー（タブ）で開くとき、それらで 1 つを共有するために渡す。
   * 省くと、ここで作る（そのエクスプローラーだけのもの）。置き場所が違うものとは共有しないこと（パスが別の置き場所のものになる）。
   */
  buffer?: ExplorerBuffer;
  /**
   * 数えたフォルダのサイズの写し。同じ置き場所を、複数のエクスプローラー（タブ）で開くとき、それらで 1 つを共有するために渡す（タブを切り替えても、数え直さない）。
   * 省くと、ここで作る。置き場所が違うものとは共有しないこと。
   */
  folderSizeCache?: FolderSizeCache;
  /** 検索を始めるまでの待ち（ms。文字を打ち終えるのを待つ。試験で縮める。既定 250） */
  searchDelayMs?: number;
  /** 一覧の失敗が「そのフォルダが無い」か（index を省いたときだけ使う） */
  isMissing?(e: unknown): boolean;
};

const FIXED_SCOPE: ScopeSource = { key: () => '', onChange: () => () => {} };

/**
 * エクスプローラーを 1 つ作る。置き場所が変わったら（scope）、前の場所を開いたままにしない
 * （いちばん上へ戻し、選び・切り取りの控えを捨てる。ここで作った一覧の写しも捨てる）。
 */
export function createExplorer(options: ExplorerOptions): Explorer {
  const own = options.index ? null : new DirIndex({ list: (dir) => options.api.list(dir), isMissing: options.isMissing });
  const index = options.index ?? own!;
  const nav = new ExplorerNav(index);
  const buffer = options.buffer ?? new ExplorerBuffer();
  const selection = new ExplorerSelection();
  const view = new ExplorerView(options.viewStore);
  const search = new ExplorerSearch(options.api, (e) => options.host.errorText(e), options.searchDelayMs);
  const scope = options.scope ?? FIXED_SCOPE;
  const folderSizeCache: FolderSizeCache = options.folderSizeCache ?? new Map();
  const lastSelected = new Map<string, string>();
  scope.onChange(() => {
    lastSelected.clear();
    folderSizeCache.clear();
    own?.clear();
    nav.reset();
    buffer.clear();
    selection.clear();
    search.close();
  });
  return {
    api: options.api,
    urls: options.urls,
    rules: options.rules,
    scope,
    caps: { restore: true, trash: true, ...options.caps },
    labels: options.labels,
    host: options.host,
    index,
    nav,
    buffer,
    selection,
    view,
    search,
    folderSizeCache,
    lastSelected,
    revealRequest: null,
    dropDragged: null,
  };
}
