import type { Component } from 'svelte';

// 共有の部品が外とやりとりする 2 つの口（置き場所 ExplorerApi・本体から借りる機能 ExplorerHost）と、その上を流れる値。
// 項目の形（Entry）は、置き場所が違っても同じ。置き場所が持たない欄は null（または省く）にする。

export type EntryKind = 'file' | 'dir';

/** ゴミ箱の 1 件（置き場所が、ゴミ箱の中を仮想のフォルダとして見せるとき） */
export type TrashEntry = {
  id: string;
  /** 消したときのパス */
  original_path: string;
  kind: EntryKind;
  size: number;
  deleted_at: number;
  trash_path?: string;
};

/** ゴミ箱の仮想のフォルダの中での位置（root: フォルダそのもの / item: 直下の 1 件 / descendant: その中身） */
export type TrashNode = { kind: 'root' } | { kind: 'item'; entry: TrashEntry } | { kind: 'descendant'; id: string };

/** 一覧の 1 行。`path` は置き場所のいちばん上からの相対パス（区切りは `/`。いちばん上は空文字） */
export type Entry = {
  name: string;
  path: string;
  kind: EntryKind;
  /** バイト数。フォルダは 0 */
  size: number;
  /** 更新時刻（UNIX 時刻のミリ秒）。分からなければ 0 */
  modified: number;
  /** 作成時刻（UNIX 時刻のミリ秒）。置き場所・OS が持たなければ省く */
  created?: number;
  /** 種類（分かるときだけ） */
  mime: string | null;
  /** ゴミ箱の仮想のフォルダの中の項目だけ */
  trash?: TrashNode;
  /** 一覧のアイコンだけを、この種類で見せる（Windows のショートカット（.lnk）の、リンク先の種類）。押したときの動きは変わらない */
  iconKind?: EntryKind;
};

export type Size = { size: number; files: number; dirs: number };

/** 送信（アップロード）の 1 件。abort で止められる */
export type UploadHandle = { promise: Promise<unknown>; abort: () => void };

/**
 * 置き場所（この端末・ネットワークドライブ・サーバーのフォルダなど）。パスは、いちばん上からの相対（`docs/a.txt`）。
 * 同名の決まり: write は黙って上書きする（呼ぶ側が先に確かめる）。move・copy は overwrite が真のときだけ、ファイルを置き換える。
 */
export interface ExplorerApi {
  list(path: string): Promise<Entry[]>;
  /** 作成・上書き */
  write(path: string, body: Blob | ArrayBuffer | string): Promise<Entry>;
  mkdir(path: string): Promise<Entry>;
  /** ゴミ箱へ入れる。入った項目を返す（id は restore・purge に渡す） */
  trash(path: string): Promise<TrashEntry>;
  /** ゴミ箱から元の場所へ戻す（caps.restore が真のときだけ呼ぶ） */
  restore(id: string): Promise<Entry>;
  /** ゴミ箱の項目を完全に消す（caps.restore が真のときだけ呼ぶ） */
  purge(id: string): Promise<void>;
  /**
   * 完全に削除する（元に戻せない）。ゴミ箱の無い置き場所（caps.trash が偽）だけが持つ。部品は、確認を取ってから呼ぶ。
   * caps.trash が偽なら、部品は trash の代わりにこれを呼ぶ。
   */
  remove?(path: string): Promise<void>;
  /**
   * そのパスの項目を、ゴミ箱へ移せるか（任意。省くと移せる）。偽のとき（例: WSL の中は、OS のゴミ箱に入らず消えてしまう）は、
   * 部品は確認を取って、`remove` で完全に削除する（元に戻せない）
   */
  trashable?(path: string): boolean;
  /** ホームのフォルダのパス（任意。パス欄の `~` が指す。省くと `~` は解かない） */
  home?(): string;
  size(path: string): Promise<Size>;
  /**
   * 一覧の「サイズ」の列に出す、フォルダの大きさ（任意。持たない置き場所は、フォルダの欄を空にする）。
   * 大きなフォルダで長く掛からないよう、数える量に上限を持つこと。上限で止めたら partial を真にする（画面は「以上」と出す）。
   */
  folderSize?(path: string): Promise<{ size: number; partial: boolean }>;
  move(from: string, to: string, overwrite?: boolean): Promise<Entry>;
  copy(from: string, to: string, overwrite?: boolean): Promise<Entry>;
  /** 進み具合つきで送る（ファイルの選択・貼り付け） */
  upload(path: string, file: Blob, onProgress?: (ratio: number) => void): UploadHandle;
  /**
   * フォルダの中（サブフォルダも）から、名前に文字を含む項目を探す（任意。持たない置き場所は、サブフォルダの検索を出さない）。
   * 見つけたものは hits で少しずつ渡す（パスは、いちばん上からの相対。Entry は一覧と同じ形）。signal が中止されたら、速やかに止めて reject する。
   * 置き場所が、上限（件数・調べる数・深さ）を決める。上限で止めたときは、resolve で partial に理由を返す（黙って打ち切らない）。
   */
  search?(query: SearchQuery, on: { hits(entries: Entry[]): void; signal: AbortSignal }): Promise<SearchOutcome>;
}

/** 検索の問い合わせ（text は、名前に含まれる文字。大文字小文字は区別しない。dir から下を探す） */
export type SearchQuery = { dir: string; text: string };

/**
 * 検索の結果。partial は、途中で止めた理由（null は、最後まで調べた）。
 * hits = 件数の上限／scan = 調べる数の上限／depth = 深さの上限／time = 時間の上限。
 */
export type SearchOutcome = { partial: null | 'hits' | 'scan' | 'depth' | 'time' };

/** 検索で表示する件数の上限（置き場所の上限の目安。画面もこれを超えて並べない） */
export const SEARCH_MAX_HITS = 1000;

/**
 * 特別なフォルダの、利用者へ出す文（すべて省ける。省いたものは、置き場所を問わない一般の文）。
 * 特別なフォルダが無い置き場所（specialDir が null）では、root 以外は使われない。
 */
export type RuleTexts = {
  /** いちばん上の呼び名。「元の場所（○○の直下）」に使う（既定 'いちばん上'） */
  root?: string;
  /** 特別なフォルダそのものは動かせない・消せない、の理由 */
  reserved?: string;
  /** 特別なフォルダの中と外の間は移動できない、の理由 */
  crossMove?: string;
  /** 特別なフォルダの中にはフォルダを作れない、の理由 */
  noSubfolder?: string;
  /** 切り取りで、動かせない項目（特別なフォルダ・ゴミ箱のフォルダ）を除いたことの知らせ */
  cutSkipped?: string;
  /** ゴミ箱へ移す確認に足す一文（特別なフォルダの中の項目を含むとき）。無ければ足さない */
  trashNote?: string;
  /** 特別なフォルダの中のファイルを上書きする確認の本文。無ければ、ふつうの文 */
  overwriteBody?: string;
};

/** 置き場所ごとの決まり（名前・特別なフォルダ） */
export type Rules = {
  /**
   * 特別なフォルダ（いちばん上からの相対パス。例 `reserved`）。無ければ null。
   * 決まり: フォルダそのものは動かせない・消せない／中にはファイルだけ（フォルダは作れない）／中と外の間は移動できない（コピーはできる）／
   * 中では、大文字・小文字だけが違う名前を同じ名前として扱う。
   */
  specialDir: string | null;
  /**
   * 仮想のゴミ箱のフォルダの名前（いちばん上の直下。例 `.trash`）。置き場所が一覧に印（Entry.trash）を入れて、その名前で見せるときだけ指す。
   * 無ければ（省く・null）仮想のゴミ箱は無い（どのフォルダも、ふつうのフォルダ）。
   */
  trashDir?: string | null;
  /** 名前の決まり。使えるなら null、使えないなら理由 */
  nameError(dir: string, name: string): string | null;
  /** 利用者へ出す文（省くと一般の文） */
  texts?: RuleTexts;
};

/** 置き場所が変わったか（接続先を切り替えられるサーバーなど）を見分ける口。操作の途中で変わったら、新しい方へは書かない */
export type ScopeSource = {
  /** いまの置き場所の見分け（同じ文字列なら同じ置き場所） */
  key(): string;
  /** 変わったときに呼ぶ。戻り値で外す */
  onChange(cb: () => void): () => void;
};

/** 項目の URL（一覧・サムネイル・拡大表示） */
export type EntryUrls = {
  /** 開く・保存するときの URL */
  href(e: Entry): string;
  /** 読む元の URL（thumb は縮小版があればそれ） */
  readUrl(e: Entry, thumb?: boolean): string;
  /** 並べ目（グリッド）の小さい画像。画像でなければ null */
  thumbUrl(e: Entry): string | null;
  /** PDF のサムネイルの元。PDF でない・大きすぎるなら null */
  pdfSource(e: Entry): { url: string; key: string } | null;
};

export type ConfirmOptions = { title: string; body?: string; okLabel: string; ngLabel?: string; danger?: boolean };
export type ToastKind = 'info' | 'error';
export type ToastAction = { label: string; run: () => void };

/** 拡大表示の 1 件 */
export type ViewerItem = { src: string; alt: string; downloadUrl: string; kind?: string };

export type ClipboardPeek = { text: boolean; image: boolean } | 'unknown';

/** OS からドロップされた 1 件（フォルダか、中身を読めるファイル）。rel はドロップした根からの相対パス */
export type OsDropEntry = { rel: string; dir: true } | { rel: string; dir: false; size: number; read: () => Promise<Blob> };
export type NativeDropEvent = { type: 'enter' | 'over' | 'drop' | 'leave'; paths: string[]; position: { x: number; y: number } | null };
export type OsDropEvent = { id: number | null; error?: string | null; position: { x: number; y: number } | null };

/**
 * 本体（この部品を使うアプリ）から借りる機能。部品は、通知や確認の出し方・クリップボードの読み方・この端末の種類を自分では決めない。
 */
export interface ExplorerHost {
  toast(text: string, kind?: ToastKind, action?: ToastAction): unknown;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** 「戻る」（Android の戻る・Alt+←）で先に呼ぶ処理を積む。戻り値で外す */
  addBack(run: () => void): () => void;
  /** 拡大表示で開く。gallery は前後に送るときの並び */
  openViewer(item: ViewerItem, gallery: () => ViewerItem[]): void;
  /** 拡大表示で見られる種類（'image'・'pdf' など）。見られなければ null */
  viewerKind(name: string, mime?: string | null): string | null;
  isImage(name: string, mime?: string | null): boolean;
  /** 失敗を、利用者向けの文にする */
  errorText(e: unknown): string;
  /** 診断の記録 */
  log(level: 'info' | 'warn' | 'error', text: string): void;
  platform: {
    isTauri(): boolean;
    /** 'windows'・'linux'・'android' など（分からなければ空文字） */
    osName(): string;
    isLinuxDesktop(): boolean;
  };
  clipboard: {
    copyText(text: string): Promise<boolean>;
    peek(): Promise<ClipboardPeek>;
    readText(): Promise<string | null>;
    readImage(): Promise<File | null>;
    /** Linux の WebView で、paste の画像が取れないときの読み方 */
    readNativeImage(): Promise<File | null>;
    /** 文字を貼り付けて作るファイルの名前 */
    textName(): string;
    /**
     * コピー・切り取りした項目を、OS のクリップボードにファイルとして書く（任意。省くと、アプリの中のバッファだけ。文字はどちらでも書かない）。
     * OS のファイルとして渡せる項目（この端末のファイル）を扱う置き場所だけが持つ。
     */
    files?: {
      /** 書く。token は、書いたものの印（貼り付けのとき、まだ自分が書いたままかを確かめる）。書けたら true（書けなかったら false） */
      write(paths: string[], op: 'copy' | 'move', token: string): Promise<boolean>;
      /** クリップボードにある、このアプリが書いた印。無ければ（ほかでコピーし直した・空になった）null */
      token(): Promise<string | null>;
    };
  };
  download: {
    file(req: { url: string; name: string }): Promise<void>;
    /** リンクの押しを、保存の処理に差し替える（差し替えたら true） */
    intercept(ev: MouseEvent, req: { url: string; name: string }): boolean;
  };
  /** OS からのドロップ（フォルダごと取り込む） */
  osDrop: {
    listenNative(handler: (ev: NativeDropEvent) => void): Promise<() => void>;
    listen(handler: (ev: OsDropEvent) => void): Promise<() => void>;
    entries(id: number): Promise<{ entries: OsDropEntry[]; skipped: string[] }>;
    release(id: number): Promise<void>;
    rootsOf(dt: DataTransfer | null | undefined): FileSystemEntry[];
    entriesFromRoots(roots: FileSystemEntry[]): Promise<OsDropEntry[]>;
  };
  /** PDF のサムネイルを描く部品（無ければ、アイコンを出す） */
  PdfThumb?: Component<{ url: string; key: string }>;
  /** ファイルのプロパティに出す、本体の操作（例: アプリの別の機能への入口）。無ければ出さない */
  fileAction?: { label: string; icon: Component<{ size?: number; class?: string }>; run(entry: Entry, label: string): void };
}

/** フォルダの一覧の状態 */
export type DirState =
  | { kind: 'loading' }
  | { kind: 'ok'; entries: Map<string, Entry> }
  | { kind: 'missing' }
  | { kind: 'error'; message: string; at: number };

/** フォルダの一覧の手元の写し（必要になったフォルダだけ読み、変わったら捨てる） */
export interface DirIndexLike {
  state(dir: string): DirState | undefined;
  ensure(dir: string): void;
  invalidate(changed: string): void;
}

/** フォルダごとの表示方法を保存する先（本体の設定） */
/** 詳細の列の幅（px）。省いた列は既定の幅。名前の列は、残りの幅 */
/** 項目のアイコン。アイコンの部品か、共通の登録簿（@3pino/ui-kit-web/icons）の名前（lucide・アプリのロゴなど）か、画像の URL */
export type EntryIcon = Component<{ size?: number | string }> | { iconName: string } | { src: string };

/** 項目の見た目（本体が、条件に合う項目に与える）。省いたものは、既定のまま */
export type EntryStyle = {
  icon?: EntryIcon;
  /** アイコンと名前の色（CSS の色） */
  color?: string;
  /** 行全体の不透明度（0〜1） */
  opacity?: number;
};

export type ColumnWidths = Partial<Record<'name' | 'kind' | 'size' | 'modified' | 'created', number>>;

export type ViewStore = {
  /** 保存されている値（形は部品が確かめる） */
  read(): unknown;
  write(map: Record<string, unknown>): void;
};
