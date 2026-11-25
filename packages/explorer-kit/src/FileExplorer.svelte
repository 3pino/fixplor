<script lang="ts">
  import { onDestroy, onMount, tick, untrack, type Snippet } from 'svelte';
  import { SvelteMap } from 'svelte/reactivity';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
  import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
  import FileIcon from '@lucide/svelte/icons/file';
  import Folder from '@lucide/svelte/icons/folder';
  import Upload from '@lucide/svelte/icons/upload';
  import FilePlus from '@lucide/svelte/icons/file-plus';
  import ArrowUpDown from '@lucide/svelte/icons/arrow-up-down';
  import FolderPlus from '@lucide/svelte/icons/folder-plus';
  import X from '@lucide/svelte/icons/x';
  import ClipboardPaste from '@lucide/svelte/icons/clipboard-paste';
  import SquareCheck from '@lucide/svelte/icons/square-check-big';
  import Copy from '@lucide/svelte/icons/copy';
  import Scissors from '@lucide/svelte/icons/scissors';
  import Trash from '@lucide/svelte/icons/trash';
  import Info from '@lucide/svelte/icons/info';
  import Pencil from '@lucide/svelte/icons/pencil';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import EntryGlyph from './EntryGlyph.svelte';
  import PanelBar from '@3pino/ui-kit-web/PanelBar.svelte';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import TextInput from '@3pino/ui-kit-web/TextInput.svelte';

  import EntryActions from './EntryActions.svelte';
  import FileProperties from './FileProperties.svelte';
  import Check from '@lucide/svelte/icons/check';
  import MenuIcon from '@lucide/svelte/icons/menu';
  import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
  import SearchIcon from '@lucide/svelte/icons/search';
  import FolderSearch from '@lucide/svelte/icons/folder-search';
  import { matchesName } from './stores/search.svelte';
  import { SEARCH_MAX_HITS } from './types';
  import Menu from '@3pino/ui-kit-web/Menu.svelte';
  import MenuItem from '@3pino/ui-kit-web/MenuItem.svelte';
  import { applyMenuLayout, ENTRY_MENU_ITEMS, HEADER_ITEMS, headerLayout, SPACE_MENU_ITEMS, type MenuLayouts } from './menuLayout';
  import { breadcrumbs, entryAction, kindLabel, pathToText, resolveTypedPath, sortEntries, splitExt, type SortKey } from './listing';
  import type { ViewMode } from './stores/view.svelte';
  import { baseName, parentOf } from './path';
  import { childPath, DOUBLE_CLICK_MS, EXPLORER_DRAG_DIR_TYPE, EXPLORER_DRAG_TYPE, inSpecialDir, setExplorerDragItems, overwriteConfirm, permanentDeleteConfirm, planUpload, renameAllowed, renameTarget, ruleTexts, sameNameEntry } from './ops';
  import { runTransfer, transferFailure, type TransferItem, type TransferOp, type TransferResult } from './transfer';
  import { displayEntry, entryLabel, trashItemOf, trashPlace, virtualDir, writeBlockReason } from './trashFolder';
  import { allWholeTrash, copyBlockedReason, cutBlockedReason, deleteBlockedReason, transferItemOf } from './selection';
  import { formatSize, formatStamp } from './format';
  import { isSvgName } from './kinds';
  import type { Explorer } from './explorer';
  import { EXPLORER_HOTKEYS, matchesHotkey, type ExplorerHotkeyId, type Keymap } from './hotkeys';
  import { copyEntry, createEntry, explorerHistory, moveEntry, trashEntry } from './history';
  import type { ClipboardPeek, ColumnWidths, Entry, EntryStyle, ExplorerApi, OsDropEntry, ViewerItem } from './types';

  // エクスプローラーの画面（一覧・アイコン表示・選択・コピー・移動・ゴミ箱・名前の変更・外からの取り込み）。
  // 置き場所（api）と、本体から借りる機能（host）は explorer で受け取る（explorer.ts）。この部品の一生のあいだ変わらない
  // （別の置き場所を見せるときは、{#key} で作り直す）。
  const props: {
    explorer: Explorer;
    /** ≡ のメニューの先頭に足す項目（本体の操作。引数は、押したあとにメニューを閉じる関数） */
    menu?: Snippet<[() => void]>;
    /** 項目を右クリックしたメニューの終わりに足す項目（1 件だけ選んでいるとき。本体の操作。引数は、選んだ項目と、押したあとにメニューを閉じる関数） */
    entryMenu?: Snippet<[Entry, () => void]>;
    /** 上端の行に足す部品（本体の操作。引数は部品の ID: `back`・`forward`・`up`・`hidden`。並びと出す／出さないは menuLayout.header） */
    headerItem?: Snippet<[string]>;
    /** 一覧の操作のホットキー（`search`・`open`・`rename`・`clearSelection`）。省いたものは、既定（EXPLORER_HOTKEYS） */
    keymap?: Keymap;
    /** 詳細の列の幅（px）。見出しの境目をつまんで変えられる（省いた列は既定） */
    columnWidths?: ColumnWidths;
    /** 列の幅を変えたとき（保存するのは本体） */
    oncolumnwidths?: (widths: ColumnWidths) => void;
    /** 右クリックのメニューの並びと、出さない項目（項目の右クリック・空きの右クリック）と、上端の行の部品の並びと出さないもの。省くと既定。ID は menuLayout.ts の ENTRY_MENU_ITEMS・SPACE_MENU_ITEMS・HEADER_ITEMS */
    menuLayout?: MenuLayouts;
    /** 項目ごとの見た目（アイコン・色・不透明度）を決める。条件に合わない項目は null（既定の見た目）。詳細・アイコンの両方で使う */
    entryStyle?: (e: Entry) => EntryStyle | null;
    /** カーソル（PC のフォーカスのある項目）が変わったとき。無ければ null（タッチでは、いつも null）。プレビューなどの別のビューが見る */
    oncursor?: (e: Entry | null) => void;
  } = $props();
  const ENTRY_IDS = ENTRY_MENU_ITEMS.map((i) => i.id);
  const HEADER_IDS = HEADER_ITEMS.map((i) => i.id);
  /** 上端の行に出す部品（表示の順） */
  const headerIds = $derived(applyMenuLayout(HEADER_IDS, headerLayout(props.menuLayout?.header)));
  const SPACE_IDS = SPACE_MENU_ITEMS.map((i) => i.id);
  const keysOf = (id: ExplorerHotkeyId): readonly string[] => props.keymap?.[id] ?? EXPLORER_HOTKEYS[id];
  /** 入力欄に文字を打っているところか（修飾キーのないホットキーは、働かせない） */
  const typingIn = (t: EventTarget | null): boolean => t instanceof Element && t.closest('input, textarea, select, [contenteditable="true"]') !== null;
  function pick(): Explorer {
    return props.explorer;
  }
  const explorer = pick();
  const { api, urls, rules, host, nav: fileExplorer, index: dirIndex, buffer: explorerBuffer, selection: explorerSelection, view: explorerView, search } = explorer;
  /** 仮想のゴミ箱のフォルダ（置き場所の決まり。無ければ null） */
  const trashDir = rules.trashDir ?? null;
  const scopeSource = explorer.scope;
  const labels = explorer.labels;
  const PdfThumb = host.PdfThumb;
  /** 長押しとみなす時間（ms） */
  const LONG_PRESS_MS = 400;

  // 置き場所の中身を見るパネル（閲覧だけ。書き込み・削除はしない）。見た目は仮（利用者の確認を取る）。
  // フォルダは中へ、画像は拡大表示、ほかのファイルはリンクで開く・保存する（明示的に押したときだけ）。
  // 一覧は dirIndex の写し。files.changed で捨てられたら、ここで読み直す。
  const listing = $derived(fileExplorer.state);
  /** 開いているフォルダの場所（ゴミ箱の直下の項目は、元の名前で表す） */
  const crumbs = $derived(breadcrumbs(fileExplorer.dir).map((c) => ({ ...c, name: crumbName(c.path, c.name) })));
  function crumbName(path: string, seg: string): string {
    if (!trashDir || parentOf(path) !== trashDir) return seg;
    const top = dirIndex.state(trashDir);
    const x = top?.kind === 'ok' ? top.entries.get(seg) : undefined;
    return x ? entryLabel(x) : seg;
  }

  // ---- パンくずの ▸（その中のフォルダの一覧）。押したところの下に出す ----
  let crumbMenu = $state<{ path: string; x: number; y: number } | null>(null);
  /** ゴミ箱の中（の道）か。ゴミ箱の中のフォルダは、一覧にできない（元の名前で並ばない） */
  const inTrash = (path: string): boolean => trashDir !== null && (path === trashDir || path.startsWith(trashDir + '/'));
  function openCrumbMenu(ev: MouseEvent, path: string): void {
    ev.stopPropagation();
    if (crumbMenu?.path === path) {
      crumbMenu = null;
      return;
    }
    const box = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    dirIndex.ensure(path);
    crumbMenu = { path, x: box.left, y: box.bottom + 4 };
  }
  /** 今のパスで、path の次の階層（一覧の中で ✓ を付ける）。今のパスの外なら null */
  function crumbNext(path: string): string | null {
    const dir = fileExplorer.dir;
    const rest = path === '' ? dir : dir.startsWith(path + '/') ? dir.slice(path.length + 1) : '';
    return rest ? childPath(path, rest.split('/')[0]) : null;
  }
  // フォルダを変えたら、一覧は閉じる
  $effect(() => {
    void fileExplorer.dir;
    untrack(() => (crumbMenu = null));
  });
  // パンくずが幅に収まらないときは、左（上の階層）から隠れる。隠れているときは、左の端を薄くして知らせる
  let crumbsEl: HTMLElement | undefined = $state();
  let crumbsClipped = $state(false);
  $effect(() => {
    const el = crumbsEl;
    void crumbs;
    if (!el) {
      crumbsClipped = false;
      return;
    }
    const measure = (): void => {
      const first = el.firstElementChild;
      crumbsClipped = first !== null && first.getBoundingClientRect().left < el.getBoundingClientRect().left - 1;
    };
    void tick().then(measure);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  /** 開いているフォルダが、仮想のゴミ箱の中か（印で決める。直下の一覧が無いときは確かめられない） */
  const vdir = $derived(virtualDir(fileExplorer.dir, dirIndex.state(''), trashDir));
  /** 書き込みを止める理由（ゴミ箱の中・確かめ中）。ふつうのフォルダなら null */
  function writeBlock(dir: string): string | null {
    return writeBlockReason(virtualDir(dir, dirIndex.state(''), trashDir));
  }

  // 仮想のゴミ箱（rules.trashDir の中）を開いたときだけ、その判定に要る直下の一覧（と .trash の一覧）を読む。ほかのフォルダでは読まない
  // 読み直しの状態は読んでいる（無効化されて無くなったら読み直し、その結果で判定と表示を直す）。読むだけの ensure は追わない
  $effect(() => {
    const dir = fileExplorer.dir;
    if (!trashDir || (dir !== trashDir && !dir.startsWith(trashDir + '/'))) return;
    if (dirIndex.state('') === undefined) untrack(() => dirIndex.ensure(''));
    if (dir !== trashDir && dirIndex.state(trashDir) === undefined) untrack(() => dirIndex.ensure(trashDir));
  });
  const now = Date.now();

  $effect(() => {
    const dir = fileExplorer.dir;
    if (dirIndex.state(dir) === undefined) untrack(() => dirIndex.ensure(dir));
  });

  /** PC の Tauri（Windows・Linux）。選択の操作は常に効き、0 件でも終わらない（Android・ブラウザは従来の選択モード） */
  function isDesktopPc(): boolean {
    if (!host.platform.isTauri()) return false;
    const os = host.platform.osName();
    return os === 'windows' || os === 'linux';
  }
  explorerSelection.desktop = isDesktopPc();

  // 選択モードと名前の書き換えは、フォルダを変えたら外す（別のフォルダの項目を選んだままにしない）
  $effect(() => {
    void fileExplorer.dir;
    untrack(() => {
      explorerSelection.clear();
      cursorPath = null;
      renamingPath = null;
      clearTimeout(renameTimer);
    });
  });

  // 戻る・上の階層へ上がったとき、いたフォルダを、一覧で選んで（フォーカスして）見えるようにする
  // （どのフォルダか分からなくならないように。下の階層から上がったときだけ）
  let lastDir = fileExplorer.dir;
  let revealPath: string | null = null;
  /** フォルダを移った直後で、まだ、選ぶ項目を決めていない（一覧が読み終わったら、選ぶ） */
  let revealNeeded = false;
  /** こちらで選んだ（元いた）フォルダ。選びが変わったら、忘れる */
  let revealedPath = $state<string | null>(null);
  $effect(() => {
    if (revealedPath !== null && !(explorerSelection.count === 1 && explorerSelection.has(revealedPath))) revealedPath = null;
  });
  $effect(() => {
    const dir = fileExplorer.dir;
    untrack(() => {
      const from = lastDir;
      lastDir = dir;
      revealPath = null;
      if (from === dir) return;
      revealNeeded = true;
      const rest = dir === '' ? from : from.startsWith(dir + '/') ? from.slice(dir.length + 1) : null;
      // 上がったときは、いたフォルダ。それ以外（下へ入る・戻る・進む）は、そのフォルダで最後に選んだ項目
      if (rest) revealPath = childPath(dir, rest.split('/')[0]);
      else revealPath = explorer.lastSelected.get(dir) ?? null;
      // 親フォルダのビューが押した項目（このフォルダ直下のもの）があれば、それを最優先
      const asked = explorer.revealRequest;
      explorer.revealRequest = null;
      if (asked !== null && parentOf(asked) === dir) revealPath = asked;
    });
  });
  // フォルダごとに、最後に選んだ項目を覚える（空にしたときは、前のものを残す）
  $effect(() => {
    const last = explorerSelection.paths().at(-1);
    if (last === undefined || !explorerSelection.desktop) return;
    untrack(() => explorer.lastSelected.set(fileExplorer.dir, last));
  });
  $effect(() => {
    // 一覧を先に読む（読まないと、一覧が読み終わったときにこの効果が動かない）
    const l = listing;
    if (l?.kind !== 'ok' || !revealNeeded) return;
    // 戻る・上がるなら、いた（最後に選んだ）項目。それが無ければ（PC は）最初の項目
    const wanted = revealPath !== null && [...l.entries.values()].some((e) => e.path === revealPath) ? revealPath : null;
    const path = wanted ?? (explorerSelection.desktop ? untrack(() => shownEntries[0]?.path ?? null) : null);
    untrack(() => {
      revealNeeded = false;
      revealPath = null;
      if (path !== null) void tick().then(() => revealItem(path));
    });
  });
  /** 項目を選んで、フォーカスし、見える位置へスクロールする（PC）。タッチは、見える位置へスクロールするだけ（選択モードに入らない） */
  function revealItem(path: string): void {
    const el = [...(bodyEl?.querySelectorAll<HTMLElement>('.file-explorer-item') ?? [])].find((x) => x.dataset.path === path);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center' });
    if (!explorerSelection.desktop) return;
    cursorPath = path;
    explorerSelection.replace([path]);
    revealedPath = path;
    el.querySelector<HTMLElement>('.file-explorer-row')?.focus({ preventScroll: true });
  }

  // 選んでいる間の「戻る」（Android の戻る・Alt+←）は、選びを外す（フォルダやパネルは戻らない）。
  // PC の 0 件（操作だけ続いている）では登録しない（戻るを奪わない）
  // 戻った・上へ上がったときに、いたフォルダをこちらで選んだだけのとき（revealedPath）は、「戻る」を奈わない（ここで止めると、さらに戻れない）
  $effect(() => {
    if (!explorerSelection.showing) return;
    if (revealedPath !== null && explorerSelection.count === 1 && explorerSelection.has(revealedPath)) return;
    // 登録が読む本体の状態には依存しない（依存すると、登録のたびにやり直して回り続ける）
    return untrack(() => host.addBack(() => explorerSelection.clear()));
  });

  // 「戻る」は、前に開いていたフォルダへ（履歴が無ければ、パネルの戻る＝閉じるなどに任せる）。
  // 戻る操作は登録を外してから呼ぶので、履歴が変わるたびに登録し直す
  $effect(() => {
    if (fileExplorer.history.length === 0) return;
    return untrack(() => host.addBack(() => fileExplorer.back()));
  });

  /** 開いているフォルダの表示方法と並び順（フォルダごと・各デバイスに保存） */
  const dirView = $derived(explorerView.of(fileExplorer.dir));
  function setView(v: ViewMode): void {
    explorerView.setView(fileExplorer.dir, v);
  }

  /** 一覧に並べる項目（並び順・名前の絞り込みを反映したもの） */
  const shownEntries = $derived.by((): Entry[] => {
    if (listing?.kind !== 'ok') return [];
    const all = sortEntries([...listing.entries.values()].map(displayEntry), dirView.sortKey, dirView.sortOrder, kindText);
    return search.filtering ? all.filter((x) => matchesName(x.name, search.text)) : all;
  });

  // ---- フォルダのサイズ（詳細の「サイズ」の列）。置き場所が folderSize を持つときだけ、フォルダを 1 つずつ順に数える ----
  // 数えた値は覚えておき、フォルダの更新日時が変わっていなければ、数え直さない（開き直しても、すぐ出る）。
  // 更新日時は、直下の追加・削除でしか変わらない（深いところの変化は見えない）ので、再読み込み（F5）では、覚えた値を捨てて数え直す。
  type FolderSize = { size: number; partial: boolean } | 'loading' | 'error';
  const folderSizes = new SvelteMap<string, FolderSize>();
  /** 数えた値と、そのときのフォルダの更新日時 */
  const sizeCache = explorer.folderSizeCache;
  /** フォルダのサイズを、同時に数える数 */
  const SIZE_PARALLEL = 4;
  let sizeGen = 0;
  let sizeReloads = fileExplorer.reloads;
  $effect(() => {
    const count = api.folderSize;
    if (!count || dirView.view !== 'details' || listing?.kind !== 'ok') return;
    const dirs = shownEntries.filter((e) => e.kind === 'dir' && !e.trash);
    const reloads = fileExplorer.reloads;
    const gen = ++sizeGen;
    untrack(() => {
      if (sizeReloads !== reloads) {
        sizeCache.clear();
        folderSizes.clear();
        sizeReloads = reloads;
      }
      // 数え直すものは、先に全部「…」にする（順に数えるので、順番を待っているものも、数えているものと同じに見せる）。
      // 更新日時が変わったものは、古い値を出したまま数え直す
      const todo: Entry[] = [];
      for (const e of dirs) {
        const hit = sizeCache.get(e.path);
        if (hit && hit.modified === e.modified) {
          if (folderSizes.get(e.path) !== hit.value) folderSizes.set(e.path, hit.value);
          continue;
        }
        if (!folderSizes.has(e.path)) folderSizes.set(e.path, 'loading');
        todo.push(e);
      }
      // 数えるのは、少しずつ並べて（SIZE_PARALLEL 個まで同時に）行う。1 つずつだと、小さなフォルダの待ちが積み重なる
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < todo.length) {
          const e = todo[next++];
          if (gen !== sizeGen) return;
          try {
            const value = await count.call(api, e.path);
            // 途中で一覧が変わっても、数えた値は覚える（次の回で使える）
            sizeCache.set(e.path, { value, modified: e.modified });
            folderSizes.set(e.path, value);
          } catch {
            folderSizes.set(e.path, 'error');
          }
        }
      };
      for (let k = 0; k < Math.min(SIZE_PARALLEL, todo.length); k++) void worker();
    });
    return () => {
      sizeGen++;
    };
  });
  // ---- 詳細の列の幅（見出しの右の境目をつまんで変える。どの列も変えられ、右に余りがあってもよい。名前の列は、変えるまで残りの幅を使う） ----
  const COL_MIN_PX = 48;
  const COL_MAX_PX = 1000;
  type ColumnKey = keyof ColumnWidths;
  // 初めの幅だけを受け取る（あとはここで持ち、変えたら oncolumnwidths で知らせる）
  let colWidths = $state<ColumnWidths>(untrack(() => ({ ...props.columnWidths })));
  const colStyle = $derived(
    (Object.entries(colWidths) as [ColumnKey, number | undefined][])
      .filter(([, w]) => typeof w === 'number')
      .map(([k, w]) => `--col-${k}:${w}px`)
      .join(';') || undefined,
  );
  let colDrag: { key: ColumnKey; x: number; width: number } | null = null;
  /** 列の右の境目をつまむ。右へ動かすと、その列が広がる（右の列は、そのまま右へずれる）。左へ動かすと狭まる */
  function startColResize(ev: PointerEvent, key: ColumnKey): void {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const grip = ev.currentTarget as HTMLElement;
    // 名前の列は、見出しの幅にアイコンの分が入っているので、行の名前の幅を測る
    const measured = key === 'name' ? (bodyEl?.querySelector<HTMLElement>('.file-explorer-view-details .file-explorer-name')?.getBoundingClientRect().width ?? 0) : (grip.parentElement?.getBoundingClientRect().width ?? 0);
    colDrag = { key, x: ev.clientX, width: measured };
    grip.setPointerCapture?.(ev.pointerId);
  }
  function moveColResize(ev: PointerEvent): void {
    if (!colDrag) return;
    const width = Math.round(Math.min(COL_MAX_PX, Math.max(COL_MIN_PX, colDrag.width + ev.clientX - colDrag.x)));
    colWidths = { ...colWidths, [colDrag.key]: width };
  }
  function endColResize(): void {
    if (!colDrag) return;
    colDrag = null;
    props.oncolumnwidths?.({ ...colWidths });
  }
  /** 境目をダブルクリックすると、その列の幅を既定に戻す（名前の列は、残りの幅を使う状態に戻る） */
  function resetColWidth(key: ColumnKey): void {
    const { [key]: _drop, ...rest } = colWidths;
    colWidths = rest;
    props.oncolumnwidths?.({ ...rest });
  }

  /** 詳細の「サイズ」の列に出す文字 */
  function sizeCell(e: Entry): string {
    if (e.kind === 'file') return formatSize(e.size);
    const s = e.trash ? undefined : folderSizes.get(e.path);
    if (!s || s === 'error') return '';
    if (s === 'loading') return '…';
    return `${s.partial ? '≥ ' : ''}${formatSize(s.size)}`;
  }



  // 操作のメニュー（≡）。項目を選んだら閉じてから動く
  let menuOpen = $state(false);
  /** 上端の行の「並び替え」ボタンのメニュー */
  let sortMenuOpen = $state(false);
  function run(fn: () => void): void {
    menuOpen = false;
    fn();
  }
  const VIEW_LABEL = { details: '詳細', grid: 'アイコン' } as const;
  const KEY_LABEL = { name: '名前', kind: '種類', modified: '更新日時', created: '作成日時', size: 'サイズ' } as const;
  /** 並べ替えと「種類」の列に使う、種類の文字 */
  const kindText = (e: Entry): string => kindLabel(e, host.isImage);
  /** 見出しを押したときの並べ替え: 並べている列をもう一度押すと、昇順と降順が入れ替わる。別の列なら、その列の昇順 */
  function sortBy(key: SortKey): void {
    explorerView.setSort(fileExplorer.dir, key, dirView.sortKey === key && dirView.sortOrder === 'asc' ? 'desc' : 'asc');
  }
  /** 作成日時を持つ項目が、一覧にあるか（OS・置き場所が持たないときは、列も、並び替えの選択肢も出さない） */
  const hasCreated = $derived(listing?.kind === 'ok' && [...listing.entries.values()].some((e) => e.created));
  const sortKeys = $derived<readonly SortKey[]>(hasCreated ? ['name', 'kind', 'modified', 'created', 'size'] : ['name', 'kind', 'modified', 'size']);

  /**
   * 拡大表示で開く（画像・PDF など。lib/viewers.ts）。前後は、このフォルダの拡大表示で見られるものを今の並び順で
   */
  function openViewer(e: Entry, pool?: readonly Entry[]): void {
    const item = (x: Entry): ViewerItem => {
      const src = urls.readUrl(x);
      return { src, alt: entryLabel(x), downloadUrl: src, kind: host.viewerKind(x.name, x.mime) ?? undefined };
    };
    const viewable = () =>
      pool
        ? pool.filter((x) => x.kind === 'file' && host.viewerKind(x.name, x.mime) !== null).map(item)
        : listing?.kind === 'ok'
        ? sortEntries([...listing.entries.values()].map(displayEntry), dirView.sortKey, dirView.sortOrder, kindText)
            .filter((x) => x.kind === 'file' && host.viewerKind(x.name, x.mime) !== null)
            .map(item)
        : [];
    host.openViewer(item(e), viewable);
  }

  // ---- 検索（名前の絞り込み・サブフォルダも探す）。バーの虫めがね・Ctrl+F で開く ----

  let searchInput: HTMLInputElement | undefined = $state();
  function openSearch(): void {
    search.open = true;
    void tick().then(() => searchInput?.focus());
  }
  const closeSearch = (): void => search.close();
  /** 文字・「サブフォルダも」が変わったら、探し直す */
  const onSearchInput = (): void => search.refresh(fileExplorer.dir);
  function searchWindowKey(ev: KeyboardEvent): void {
    if (!matchesHotkey(ev, keysOf('search')) || (typingIn(ev.target) && !(ev.ctrlKey || ev.metaKey || ev.altKey))) return;
    ev.preventDefault();
    if (search.open) searchInput?.select();
    else openSearch();
  }
  /** Esc: 選んでいる項目があれば、選びを外す（入力中・名前の書き換え中・ダイアログやメニューが開いているときは、そちらの Esc） */
  // ---- パス欄（押すと、書き換えられる。Ctrl+L でも） ----
  let pathEditing = $state(false);
  let pathText = $state('');
  let pathInput: HTMLInputElement | undefined = $state();
  let pathBusy = false;
  function startPathEdit(): void {
    pathText = pathToText(fileExplorer.dir);
    pathEditing = true;
    void tick().then(() => {
      pathInput?.focus();
      pathInput?.select();
    });
  }
  /** 打ったパスへ移る。開けないパス（無い・フォルダでない）なら、理由を出して、書き換えを続ける */
  async function commitPath(): Promise<void> {
    if (pathBusy) return;
    const dir = resolveTypedPath(pathText, fileExplorer.dir, api.home?.());
    if (dir === fileExplorer.dir) {
      pathEditing = false;
      return;
    }
    pathBusy = true;
    try {
      await api.list(dir);
      fileExplorer.open(dir);
      pathEditing = false;
    } catch (err) {
      host.toast(`開けません: ${host.errorText(err)}`, 'error');
    } finally {
      pathBusy = false;
    }
  }
  function pathKey(ev: KeyboardEvent): void {
    if (ev.key === 'Enter' && !ev.isComposing) {
      ev.preventDefault();
      ev.stopPropagation();
      void commitPath();
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      pathEditing = false;
    }
  }
  /** 欄の、パンくずのボタンでないところを押したら、書き換えを始める */
  function pathFieldClick(ev: MouseEvent): void {
    if (pathEditing || (ev.target instanceof Element && ev.target.closest('.file-explorer-crumb, .file-explorer-crumb-chevron'))) return;
    startPathEdit();
  }
  // フォルダが変わったら、書き換えは終える
  $effect(() => {
    void fileExplorer.dir;
    untrack(() => (pathEditing = false));
  });

  function escapeKey(ev: KeyboardEvent): void {
    if (ev.defaultPrevented || !matchesHotkey(ev, keysOf('clearSelection'))) return;
    if (explorerSelection.count === 0 || renamingPath !== null) return;
    if (typingIn(ev.target)) return;
    if (document.querySelector('[role="dialog"], [role="menu"], .menu-backdrop')) return;
    explorerSelection.clear();
  }
  // ---- キーボードの操作（PC）: 矢印で項目を移り（選びも移る。Shift を押しながらなら、選びに足す）、ホットキーで操作する ----

  /** 一覧の列の数（アイコン表示は、並んでいる列の数。詳細は 1） */
  function gridColumns(items: HTMLElement[]): number {
    if (dirView.view !== 'grid') return 1;
    const grid = bodyEl?.querySelector('.file-explorer-view-grid');
    const tracks = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').filter((t) => /\d/.test(t)).length : 0;
    if (tracks > 0) return tracks;
    // 並びが分からないときは、先頭と同じ高さに並ぶ数
    const top = items[0]?.getBoundingClientRect().top;
    return Math.max(1, items.filter((el) => el.getBoundingClientRect().top === top).length);
  }
  /** いま「カーソル」がある項目（行にフォーカスがあればそれ。なければ、最後に移ったもの。なければ、選んでいる最後のもの） */
  let cursorPath = $state<string | null>(null);
  /** カーソルのある項目（PC だけ。一覧にあるもの） */
  const cursorEntry = $derived(explorerSelection.desktop && cursorPath !== null ? (shownEntries.find((x) => x.path === cursorPath) ?? null) : null);
  $effect(() => {
    const e = cursorEntry;
    untrack(() => props.oncursor?.(e));
  });
  /** 矢印で、項目を移る。動かしたら true（端で動かないときも、一覧の中なら true にして、画面のスクロールを止める） */
  function moveCursor(dir: 'up' | 'down' | 'left' | 'right', extend: boolean): boolean {
    const items = [...(bodyEl?.querySelectorAll<HTMLElement>('.file-explorer-item') ?? [])];
    if (items.length === 0) return false;
    const grid = dirView.view === 'grid';
    // 詳細の左右は、使わない
    if (!grid && (dir === 'left' || dir === 'right')) return false;
    const focused = document.activeElement instanceof Element ? document.activeElement.closest<HTMLElement>('.file-explorer-item') : null;
    const last = cursorPath ?? explorerSelection.paths().at(-1) ?? null;
    let from = focused ? items.indexOf(focused) : -1;
    if (from < 0 && last !== null) from = items.findIndex((el) => el.dataset.path === last);
    let to: number;
    if (from < 0) to = dir === 'up' || dir === 'left' ? items.length - 1 : 0;
    else {
      const cols = gridColumns(items);
      const step = dir === 'up' ? -cols : dir === 'down' ? cols : dir === 'left' ? -1 : 1;
      to = from + step;
      if (to < 0 || to >= items.length) to = from;
    }
    const el = items[to];
    const path = el.dataset.path ?? '';
    cursorPath = path;
    // focus() に任せると、見えていない項目は、画面の真ん中までスクロールされてしまう。スクロールは、こちらで（最小限）行う
    el.querySelector<HTMLElement>('.file-explorer-row')?.focus({ preventScroll: true });
    scrollIntoViewBelowHeader(el);
    if (extend) explorerSelection.replace([...new Set([...explorerSelection.paths(), path])]);
    else explorerSelection.replace([path]);
    return true;
  }

  /** 項目を見える位置へスクロールする。詳細の見出し（上端に残る）に隠れないようにする */
  function scrollIntoViewBelowHeader(el: HTMLElement): void {
    el.scrollIntoView?.({ block: 'nearest' });
    const head = bodyEl?.querySelector<HTMLElement>('.file-explorer-columns');
    if (!bodyEl || !head) return;
    const hide = head.getBoundingClientRect().bottom - el.getBoundingClientRect().top;
    if (hide > 0) bodyEl.scrollTop -= hide;
  }

  /** 一覧の最初・最後の項目を選んで、フォーカスする */
  function selectEdge(which: 'first' | 'last'): void {
    const items = [...(bodyEl?.querySelectorAll<HTMLElement>('.file-explorer-item') ?? [])];
    const el = which === 'first' ? items[0] : items.at(-1);
    if (!el) return;
    const path = el.dataset.path ?? '';
    cursorPath = path;
    el.querySelector<HTMLElement>('.file-explorer-row')?.focus({ preventScroll: true });
    scrollIntoViewBelowHeader(el);
    explorerSelection.replace([path]);
  }

  async function runHistory(way: 'undo' | 'redo'): Promise<void> {
    try {
      const label = await explorerHistory[way]();
      if (label === null) host.toast(way === 'undo' ? '元に戻せる操作はありません' : 'やり直せる操作はありません');
      else host.toast(`${way === 'undo' ? '元に戻しました' : 'やり直しました'}: ${label}`);
    } catch (e) {
      host.toast(`${way === 'undo' ? '元に戻せませんでした' : 'やり直せませんでした'}: ${host.errorText(e)}`, 'error');
    }
  }

  /** 入力中・名前の書き換え中・ダイアログやメニューが開いているときは、何もしない（そちらのキーを優先） */
  function explorerKey(ev: KeyboardEvent): void {
    if (ev.defaultPrevented || ev.isComposing || !explorerSelection.desktop || !bodyEl?.isConnected) return;
    if (renamingPath !== null || typingIn(ev.target)) return;
    if (document.querySelector('[role="dialog"], [role="menu"], .menu-backdrop')) return;
    const is = (id: ExplorerHotkeyId): boolean => matchesHotkey(ev, keysOf(id));
    // 矢印: 移る（選びも移る）・Shift を押しながらは、選びに足す（それぞれ、設定で変えられる）
    const dir = is('moveUp') ? 'up' : is('moveDown') ? 'down' : is('moveLeft') ? 'left' : is('moveRight') ? 'right' : null;
    const extendDir = is('extendUp') ? 'up' : is('extendDown') ? 'down' : is('extendLeft') ? 'left' : is('extendRight') ? 'right' : null;
    if (dir || extendDir) {
      if (moveCursor((dir ?? extendDir)!, extendDir !== null && dir === null)) ev.preventDefault();
      return;
    }
    const some = explorerSelection.count > 0;
    const run = (f: () => void): void => {
      ev.preventDefault();
      f();
    };
    if (is('selectFirst')) run(() => selectEdge('first'));
    else if (is('selectLast')) run(() => selectEdge('last'));
    else if (is('selectAll')) run(() => explorerSelection.selectAll(shownEntries.map((e) => e.path)));
    else if (is('copy') && some && copyBlocked === null) run(copySelected);
    else if (is('cut') && some && cutBlocked === null) run(cutSelected);
    else if (is('paste') && canPaste && !pasting) run(() => void pasteAny());
    else if (is('trash') && some && deleteBlocked === null && !actionBusy) run(removeSelected);
    else if (is('delete') && some && deleteBlocked === null && !actionBusy) run(removeSelectedForever);
    else if (is('editPath')) run(startPathEdit);
    else if (is('newFile') && canCreate) run(openMkdir);
    else if (is('viewDetails')) run(() => setView('details'));
    else if (is('viewGrid')) run(() => setView('grid'));
    else if (is('undo')) run(() => void runHistory('undo'));
    else if (is('redo')) run(() => void runHistory('redo'));
  }
  function searchInputKey(ev: KeyboardEvent): void {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    closeSearch();
  }
  // フォルダを変えたら、サブフォルダの検索は、新しいフォルダで探し直す（名前の絞り込みは、そのまま）
  $effect(() => {
    const dir = fileExplorer.dir;
    untrack(() => {
      if (search.open) search.refresh(dir);
    });
  });
  // 検索を開いている間の「戻る」（Android の戻る・Alt+←）は、検索を閉じる
  $effect(() => {
    if (!search.open) return;
    return untrack(() => host.addBack(() => search.close()));
  });
  const searchStatus = $derived.by(() => {
    if (!search.open || search.text.trim() === '') return '';
    if (search.error) return `検索できませんでした: ${search.error}`;
    if (!search.showingResults) return '';
    const n = search.hits.length;
    if (search.running) return `検索しています… ${n} 件`;
    const why = { hits: `${SEARCH_MAX_HITS} 件で止めました。文字を足して絞り込んでください`, scan: '調べる数の上限に達したので、途中までです', depth: '深いフォルダは調べていません', time: '時間の上限に達したので、途中までです' } as const;
    const partial = search.outcome?.partial;
    return n === 0 && !partial ? '見つかりません' : `${n} 件${partial ? `（${why[partial]}）` : ''}`;
  });
  /** 見つかった項目の場所（探したフォルダからの相対）。直下なら「このフォルダ」 */
  function hitPlace(e: Entry): string {
    const dir = fileExplorer.dir;
    const rel = dir === '' ? e.path : e.path.startsWith(dir + '/') ? e.path.slice(dir.length + 1) : e.path;
    const p = parentOf(rel);
    return p === '' || p === rel ? 'このフォルダ' : p;
  }
  /** 見つかった項目を開く（フォルダは中へ。ファイルは拡大表示・保存） */
  function activateHit(e: Entry): void {
    if (e.kind === 'dir') {
      closeSearch();
      fileExplorer.open(e.path);
      return;
    }
    if (entryAction(e, host.viewerKind) === 'file') downloadEntry(e);
    else openViewer(e, search.hits);
  }
  /** 見つかった項目のあるフォルダを開いて、その項目を選ぶ */
  async function revealHit(e: Entry): Promise<void> {
    closeSearch();
    fileExplorer.open(parentOf(e.path));
    await tick();
    // 移った先で、最初の項目や前に選んだ項目ではなく、見つけた項目を選ぶ
    revealNeeded = false;
    revealPath = null;
    if (explorerSelection.desktop) pendingFocus = { path: e.path, select: true };
    else explorerSelection.selectAll([e.path]);
  }

  // ---- 書き込み（アップロード・新しいフォルダ）。どの人も変えられる。変わったことは files.changed で全員に届く ----

  /** 送信の 1 件（進み・失敗・中止）。送信中と失敗だけ並べ、成功したら消す */
  type UploadRow = { key: number; name: string; ratio: number; error: string | null; abort: (() => void) | null };
  let uploads = $state<UploadRow[]>([]);
  let uploadSeq = 0;
  let fileInput: HTMLInputElement | undefined = $state();

  /** 新しいファイル・フォルダを作れるか（特別なフォルダ（Rules.specialDir）の中は、ファイルだけ作れる） */
  const canCreate = $derived(writeBlockReason(vdir) === null);

  function dropUpload(key: number): void {
    const u = uploads.find((x) => x.key === key);
    u?.abort?.();
    uploads = uploads.filter((x) => x.key !== key);
  }

  // ---- 送る・移す・消す・戻すの範囲（置き場所） ----
  // 操作を始めたときの置き場所を覚える。確認や応答を待つあいだに置き場所が変わったら、新しい置き場所へは書かない。
  // 変わったあとは、新しい置き場所の一覧の写し・選択には触らない（前の置き場所の結果は、その分だけ扱う）。

  /** 置き場所の呼び名（labels.scope。既定 '置き場所'） */
  const scopeName = labels.scope ?? '置き場所';
  /** 置き場所が変わったときの文（操作を止めた理由） */
  const SERVER_CHANGED = `${scopeName}が変わったため、ここで止めました`;
  /** 置き場所が変わってアップロードを止めたときの文 */
  const UPLOAD_SCOPE_CHANGED = `${scopeName}が変わったためアップロードを中止しました`;

  type Scope = { url: string; alive: () => boolean };

  /** 今の置き場所を覚える。alive() は、覚えた置き場所のままかを返す */
  function beginScope(): Scope {
    const url = scopeSource.key();
    return { url, alive: () => scopeSource.key() === url };
  }

  /** 範囲の外になっていたら投げる（書込の直前と応答のあとに置く。呼ぶ側の失敗として扱われる） */
  class ServerChangedError extends Error {
    constructor() {
      super(SERVER_CHANGED);
      this.name = 'ServerChangedError';
    }
  }

  function assertScope(scope: Scope): void {
    if (!scope.alive()) throw new ServerChangedError();
  }

  /** 移動・コピーの API。範囲のあいだだけ呼べる（呼ぶ前と、応答のあとに確かめる） */
  function scopedTransfer(scope: Scope): Pick<ExplorerApi, 'move' | 'copy'> {
    return {
      move: async (from, to, overwrite) => {
        assertScope(scope);
        const r = await api.move(from, to, overwrite);
        assertScope(scope);
        return r;
      },
      copy: async (from, to, overwrite) => {
        assertScope(scope);
        const r = await api.copy(from, to, overwrite);
        assertScope(scope);
        return r;
      },
    };
  }

  /** 送る 1 回分（複数件）の宛先。一覧は最初に 1 回だけ取る。成功したものは写しに足して、後続の同名の確認に使う */
  type Batch = { dir: string; scope: Scope; entries: Map<string, Entry> };

  /** 宛先の一覧を用意する（未読なら取り直す）。範囲は今の置き場所。取れない・置き場所が変わったら null */
  async function beginBatch(dir: string): Promise<Batch | null> {
    const why = writeBlock(dir);
    if (why) {
      host.toast(why, 'error');
      return null;
    }
    const scope = beginScope();
    const entries = await fetchDestEntries(dir);
    if (!scope.alive()) {
      host.toast(SERVER_CHANGED, 'error');
      return null;
    }
    if (!entries) return null; // エラーは fetchDestEntries がトーストで通知済み
    return { dir, scope, entries: new Map(entries) };
  }

  async function onPicked(e: Event): Promise<void> {
    const input = e.currentTarget as HTMLInputElement;
    const picked = [...(input.files ?? [])];
    input.value = '';
    if (picked.length === 0) return;
    // 開いたフォルダに送る（途中でフォルダを移っても、最初のフォルダへ送る）
    const batch = await beginBatch(fileExplorer.dir);
    if (batch) await sendAll(batch, picked);
  }

  /** 並んだ件を順に送る。範囲（置き場所）が変わったら、残りは送らない（変わったことは sendOne が知らせる） */
  async function sendAll(batch: Batch, files: File[]): Promise<(string | null)[]> {
    const sent: (string | null)[] = [];
    for (const file of files) {
      if (!batch.scope.alive()) break;
      sent.push(await sendOne(batch.dir, file, batch));
    }
    return sent;
  }

  /**
   * 1 件を送る。同名があれば確認してから上書きする（確認なしには上書きしない）。送れたらそのパス、送らなかった・失敗は null。
   * batch が無いときは、宛先の一覧を取り直してから同名を確かめる（クリップボードの 1 件など）。
   */
  async function sendOne(dir: string, file: File, batch?: Batch): Promise<string | null> {
    const why = writeBlock(dir);
    if (why) {
      host.toast(why, 'error');
      return null;
    }
    uploads.push({ key: ++uploadSeq, name: file.name, ratio: 0, error: null, abort: null });
    const row = uploads[uploads.length - 1];
    const scope = batch?.scope ?? beginScope();
    const entries = batch ? batch.entries : await fetchDestEntries(dir);
    if (!scope.alive()) {
      dropUpload(row.key);
      host.toast(SERVER_CHANGED, 'error');
      return null;
    }
    if (!entries) {
      dropUpload(row.key);
      return null;
    }
    const plan = planUpload(rules, dir, file.name, { kind: 'ok', entries });
    if (plan.kind === 'blocked') {
      row.error = plan.message;
      return null;
    }
    if (plan.kind === 'overwrite' && !(await host.confirm(overwriteConfirm(rules, plan.path)))) {
      dropUpload(row.key);
      return null;
    }
    // 確認を待つあいだに置き場所が変わっていたら、送らない
    if (!scope.alive()) {
      dropUpload(row.key);
      host.toast(SERVER_CHANGED, 'error');
      return null;
    }
    const h = api.upload(plan.path, file, (r) => (row.ratio = r));
    row.abort = h.abort;
    try {
      await h.promise;
      dropUpload(row.key);
      if (!scope.alive()) {
        // 送ったのは前の置き場所。新しい置き場所の一覧の写しには触らない
        host.toast(SERVER_CHANGED, 'error');
        return null;
      }
      dirIndex.invalidate(plan.path);
      if (batch) {
        const name = baseName(plan.path);
        batch.entries.set(name, { name, path: plan.path, kind: 'file', size: file.size, modified: Date.now(), mime: file.type || null, });
      }
      return plan.path;
    } catch (err) {
      // 中止（×で消した）は、失敗として出さない
      if (!uploads.some((x) => x.key === row.key)) return null;
      row.abort = null;
      const aborted = err && typeof err === 'object' && (err as { code?: unknown }).code === 'aborted';
      if (aborted) dropUpload(row.key);
      else row.error = host.errorText(err);
      return null;
    }
  }

  // ---- 貼り付け（アプリ内のバッファの項目を、開いているフォルダへ。切り取りは移動、コピーはコピー） ----

  let pasting = $state(false);

  async function paste(dir: string = fileExplorer.dir): Promise<void> {
    const mode = explorerBuffer.mode;
    if (pasting || !mode || explorerBuffer.empty) return;
    pasting = true;
    try {
      await transferInScope(mode, [...explorerBuffer.items], dir);
    } finally {
      pasting = false;
    }
  }

  // ---- OS のクリップボードとの同期 ----
  // コピー・切り取りは、項目を OS のクリップボードにもファイルとして書く（置き場所ができるとき。文字は書かない）。
  // 貼り付けは、クリップボードにこちらが書いた印がまだあればバッファを、
  // ほかでコピーし直していれば（ファイル・画像・文字）そちらを、開いているフォルダへ送る（文字は .txt のファイルにする）。
  // OS に書けないとき（Android など）は、クリップボードを見ずにバッファを貼る

  /** バッファが、貼るときの元になるか（OS に書いていないなら常に。書いたなら、まだ自分の印がクリップボードにあるときだけ） */
  async function bufferIsPasteSource(): Promise<boolean> {
    if (explorerBuffer.empty) return false;
    const mine = explorerBuffer.clipToken;
    if (mine === null) return true;
    return (await host.clipboard.files?.token()) === mine;
  }

  /** クリップボードに何があるか（貼り付けを押せるか）。開いたとき・前面に戻ったとき・コピーしたとき・メニューを開いたときに確かめ直す */
  let clip = $state<ClipboardPeek>({ text: false, image: false });
  async function refreshClip(): Promise<void> {
    clip = await host.clipboard.peek();
  }
  const canPaste = $derived(!explorerBuffer.empty || clip === 'unknown' || clip.text || clip.image);

  // 貼り付けのボタンに少しのあいだ乗せると、貼る予定の内容を一覧で見せる（項目の名前・画像・文字の先頭）。貼り付けと同じ順で、何を貼るか決める
  type PastePreview = { kind: 'items'; op: TransferOp; names: string[]; total: number } | { kind: 'image'; url: string } | { kind: 'text'; text: string; more: boolean } | { kind: 'empty' };
  let pastePreview = $state<PastePreview | null>(null);
  let pastePreviewTimer: ReturnType<typeof setTimeout> | undefined;
  let pastePreviewSeq = 0;
  const PREVIEW_DELAY_MS = 400;
  const PREVIEW_NAMES = 8;
  const PREVIEW_TEXT = 400;
  function bufferPreview(): PastePreview {
    const items = explorerBuffer.items;
    return { kind: 'items', op: explorerBuffer.mode ?? 'copy', names: items.slice(0, PREVIEW_NAMES).map((i) => baseName(i.path)), total: items.length };
  }
  async function loadPastePreview(): Promise<PastePreview> {
    if (await bufferIsPasteSource()) return bufferPreview();
    const text = await host.clipboard.readText();
    const img = await host.clipboard.readImage();
    if (img) return { kind: 'image', url: URL.createObjectURL(img) };
    if (text) return { kind: 'text', text: text.slice(0, PREVIEW_TEXT), more: text.length > PREVIEW_TEXT };
    if (!explorerBuffer.empty) return bufferPreview();
    return { kind: 'empty' };
  }
  function showPastePreview(): void {
    clearTimeout(pastePreviewTimer);
    if (!canPaste || pasting) return;
    const seq = ++pastePreviewSeq;
    pastePreviewTimer = setTimeout(() => {
      void loadPastePreview().then((p) => {
        if (seq !== pastePreviewSeq) {
          if (p.kind === 'image') URL.revokeObjectURL(p.url);
          return;
        }
        pastePreview = p;
      });
    }, PREVIEW_DELAY_MS);
  }
  function hidePastePreview(): void {
    clearTimeout(pastePreviewTimer);
    pastePreviewSeq++;
    if (pastePreview?.kind === 'image') URL.revokeObjectURL(pastePreview.url);
    pastePreview = null;
  }

  onMount(() => {
    // 戻るの履歴は、パネルを開いたところから数える
    fileExplorer.forgetHistory();
    // 置き場所が変わったら、進んでいる選びの操作の印を外す（古い操作の終わりは、新しい操作の印に触らない）
    const unsubServer = scopeSource.onChange(() => {
      action = null;
    });
    void refreshClip();
    const onFocus = () => void refreshClip();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshClip();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    document.addEventListener('paste', onPasteEvent);
    // Linux デスクトップ（Tauri/WebKitGTK）では HTML5 の dragover/drop でファイルが届かないので、
    // Tauri のネイティブイベントを使う:
    //   - listenNativeDrop: hover の enter/over/leave で externalDragOver を更新（ハイライト用）
    //     ハイライトは最前面要素が .file-explorer に属するときだけ。position=null は fail closed
    //   - listenOsDrop: 実際のドロップ（os-drop カスタムイベント）。position + elementFromPoint で対象判定
    //     宛先は data-drop-dir 属性（フォルダ行・パンくず）またはカレントフォルダ
    //     他の view への drop は release せずそのまま（別の view がclaim/releaseする）
    // async 登録の失敗はトーストで通知。destroy 後に登録完了した場合は即 unlisten（リーク防止）
    let destroyed = false;
    let unlistenHover: (() => void) | undefined;
    let unlistenOsDropFn: (() => void) | undefined;
    if (host.platform.isLinuxDesktop()) {
      // ホバーハイライト（position + elementFromPoint で最前面確認）
      host.osDrop.listenNative((ev) => {
        if (ev.type === 'enter' || ev.type === 'over') {
          // position=null は fail closed（ハイライトしない）
          if (!ev.position) { externalDragOver = false; return; }
          const el = document.elementFromPoint(ev.position.x, ev.position.y);
          const inExplorer = !!el?.closest('.file-explorer');
          externalDragDepth = inExplorer ? 1 : 0;
          externalDragOver = inExplorer;
        } else if (ev.type === 'leave' || ev.type === 'drop') {
          externalDragDepth = 0;
          externalDragOver = false;
        }
      }).then((u) => {
        if (destroyed) u(); // destroy 後に登録完了 → 即 unlisten
        else unlistenHover = u;
      }).catch((e) => {
        if (!destroyed) host.toast(`ホバーイベントを受け取れませんでした: ${host.errorText(e)}`, 'error');
      });

      // 実際のドロップ（階層ごとアップロード）
      host.osDrop.listen(async (ev) => {
        externalDragOver = false;
        externalDragDepth = 0;
        if (ev.id === null) {
          if (ev.error) host.toast(`ドロップを受け取れませんでした: ${ev.error}`, 'error');
          return;
        }
        // position=null は fail closed（どこへの drop か分からない → 受けない）
        const pos = ev.position;
        if (!pos) return;
        // 最前面の要素がこの .file-explorer に属するか確認。前面のダイアログ等も拒否
        const target = document.elementFromPoint(pos.x, pos.y);
        if (!target?.closest('.file-explorer')) return;
        // await 前に destDir・serverUrl をキャプチャ
        const dirEl = target.closest<HTMLElement>('[data-drop-dir]');
        const destDir = dirEl?.dataset.dropDir ?? fileExplorer.dir;
        const serverUrl = scopeSource.key();
        const id = ev.id;
        try {
          const { entries, skipped } = await host.osDrop.entries(id);
          if (scopeSource.key() !== serverUrl) {
            host.toast(UPLOAD_SCOPE_CHANGED, 'error');
            return;
          }
          if (skipped.length > 0) host.toast(`読み込めなかった項目があります（${skipped[0]}${skipped.length > 1 ? ' ほか' : ''}）`, 'error');
          await uploadOsDropEntries(entries, destDir, serverUrl);
        } catch (err) {
          host.toast(`ドロップを処理できませんでした: ${host.errorText(err)}`, 'error');
        } finally {
          // release は必ず呼ぶ（他 view のIDは触らない: このハンドラで受けたIDのみ）
          await host.osDrop.release(id).catch((e) => { host.toast(`ドロップのリリースに失敗しました: ${host.errorText(e)}`, 'error'); });
        }
      }).then((u) => {
        if (destroyed) u();
        else unlistenOsDropFn = u;
      }).catch((e) => {
        if (!destroyed) host.toast(`OS ドロップのリスナーを登録できませんでした: ${host.errorText(e)}`, 'error');
      });
    }
    return () => {
      destroyed = true;
      unsubServer();
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      document.removeEventListener('paste', onPasteEvent);
      unlistenHover?.();
      unlistenOsDropFn?.();
    };
  });

  /** バッファの項目を、OS のクリップボードにファイルとしても書く（置き場所ができるときだけ。文字は書かない）。書いたら、印をバッファに持つ */
  function syncToClipboard(): void {
    const files = host.clipboard.files;
    const mode = explorerBuffer.mode;
    if (!files || mode === null) {
      void refreshClip();
      return;
    }
    const paths = explorerBuffer.items.map((i) => i.path);
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    void files.write(paths, mode, token).then((ok) => {
      // 書いている間にバッファを入れ替えていなければ、クリップボードと結び付ける
      if (ok && explorerBuffer.items.map((i) => i.path).join('\n') === paths.join('\n') && explorerBuffer.mode === mode) explorerBuffer.clipToken = token;
      void refreshClip();
    });
  }

  /** 貼り付け（バーのボタン・空きスペースのメニュー）。OS のクリップボードを読んで、何を貼るか決める */
  async function pasteAny(dir: string = fileExplorer.dir): Promise<void> {
    if (pasting) return;
    if (await bufferIsPasteSource()) return paste(dir);
    await pasteWith(dir, await host.clipboard.readText(), [], () => host.clipboard.readImage());
  }

  /**
   * クリップボードの中身（files・text・画像）から貼る。こちらがファイルとして書いた印がまだあれば（コピーしたまま）、ファイルの一覧を読まずにバッファ。
   * そうでないとき、OS のファイルがあればそれ。無ければ画像、文字（.txt）の順。どれも無ければバッファ
   */
  async function pasteWith(dir: string, text: string | null, files: File[], image: () => Promise<File | null>): Promise<void> {
    if (explorerBuffer.clipToken !== null && (await bufferIsPasteSource())) return paste(dir);
    if (files.length > 0) {
      const batch = await beginBatch(dir);
      if (!batch) return;
      const sent = await sendAll(batch, files);
      if (sent.length === 1) renameAfterPaste(dir, sent[0]);
      return;
    }
    if (!explorerBuffer.empty && explorerBuffer.clipToken === null) return paste(dir);
    const img = await image();
    if (img) return renameAfterPaste(dir, await sendOne(dir, img));
    if (text) return renameAfterPaste(dir, await sendOne(dir, new File([text], host.clipboard.textName(), { type: 'text/plain' })));
    if (!explorerBuffer.empty) return paste(dir);
    host.toast('クリップボードに貼り付けられるものがありません');
  }

  /**
   * クリップボードから貼った 1 件は、すぐ名前の書き換えに入る（画像・文字は仮の名前で送るので）。
   * 一覧に出たところで入力欄に替わる。送っている間に別のフォルダへ移っていたら何もしない
   */
  function renameAfterPaste(dir: string, path: string | null): void {
    if (!path || fileExplorer.dir !== dir || !renameAllowed(rules, path).ok || writeBlock(dir)) return;
    renamingPath = path;
    renameTo = baseName(path);
    renameError = null;
  }

  /** Ctrl+V（入力欄の外）。OS のファイル（エクスプローラーでコピーしたもの）もここで受け取れる */
  function onPasteEvent(ev: ClipboardEvent): void {
    const t = ev.target;
    if (t instanceof HTMLElement && (t.isContentEditable || t.closest('input, textarea, [contenteditable="true"]'))) return;
    ev.preventDefault();
    const files = [...(ev.clipboardData?.files ?? [])];
    const text = ev.clipboardData?.getData('text/plain') || null;
    // Linux の WebKitGTK は、画像のペーストで files が空になることがある
    void pasteWith(fileExplorer.dir, text, files, host.platform.isLinuxDesktop() ? () => host.clipboard.readNativeImage() : async () => null);
  }

  // ---- 空きスペースの長押し（マウスは右クリック）のメニュー: アップロード・新しいフォルダ・貼り付け ----

  /** item が真なら、選んでいる項目のメニュー（マウスの右クリック）。偽なら、空きスペースのメニュー */
  let ctx = $state<{ x: number; y: number; item?: boolean } | null>(null);
  /** プロパティを開いている項目（項目のメニューから） */
  let propsEntry = $state<Entry | null>(null);
  let ctxTimer: ReturnType<typeof setTimeout> | undefined;
  let ctxFrom: { x: number; y: number } | null = null;
  /** 長押しでメニューを出した直後（指を離したときのタップで、出たメニューの幕を押して閉じないように） */
  let ctxByPress = false;

  /** 項目・ボタン・メニューの外（空きスペース）か */
  function isEmptySpot(t: EventTarget | null): boolean {
    return t instanceof Element && !t.closest('.file-explorer-item, .file-explorer-menu, .menu-backdrop, .file-explorer-columns, button, a, input, textarea');
  }

  function openCtx(x: number, y: number, item = false): void {
    ctx = { x, y, item };
    void refreshClip();
  }

  function runCtx(fn: () => void): void {
    ctx = null;
    fn();
  }

  function bodyPressStart(ev: PointerEvent): void {
    if (ev.pointerType === 'mouse' || !isEmptySpot(ev.target)) return;
    ctxByPress = false;
    ctxFrom = { x: ev.clientX, y: ev.clientY };
    clearTimeout(ctxTimer);
    ctxTimer = setTimeout(() => {
      const at = ctxFrom;
      ctxFrom = null;
      if (!at) return;
      ctxByPress = true;
      openCtx(at.x, at.y);
    }, LONG_PRESS_MS);
  }

  function bodyPressMove(ev: PointerEvent): void {
    if (!ctxFrom) return;
    if (Math.abs(ev.clientX - ctxFrom.x) > 8 || Math.abs(ev.clientY - ctxFrom.y) > 8) bodyPressEnd();
  }

  function bodyPressEnd(): void {
    clearTimeout(ctxTimer);
    ctxFrom = null;
  }

  /** 長押しでメニューを出したあと、指を離したときのタップ（クリック）を出さない */
  function bodyTouchEnd(ev: TouchEvent): void {
    if (!ctxByPress) return;
    ctxByPress = false;
    ev.preventDefault();
  }

  /** 右クリック（Android の長押しで出ることもある）。空きスペースならメニューを出す */
  function bodyContextMenu(ev: MouseEvent): void {
    if (!isEmptySpot(ev.target)) return;
    ev.preventDefault();
    if (!ctx) openCtx(ev.clientX, ev.clientY);
  }

  // ---- 複数選択の操作（コピー・切り取り・削除・移動）。まとめて 1 回の確認（削除・上書き） ----

  /** 選んでいる項目（一覧に今ある分。消えたものは外す） */
  const selectedEntries = $derived.by((): Entry[] => {
    if (listing?.kind !== 'ok') return [];
    const want = new Set(explorerSelection.paths());
    return [...listing.entries.values()].filter((e) => want.has(e.path));
  });

  const selectedItems = $derived(selectedEntries.map(transferItemOf));
  /** 選んだものが、全部ゴミ箱の直下の項目（元へ戻す・完全削除の対象） */
  const allWhole = $derived(allWholeTrash(selectedEntries));

  /** 選んだ項目に、コピーできないもの（ゴミ箱のフォルダ）があれば、その理由 */
  const copyBlocked = $derived(copyBlockedReason(selectedItems));

  /** 選んだ項目に、切り取りできないもの（特別なフォルダ・ゴミ箱のフォルダや中身など）があれば、その理由。ゴミ箱の直下の項目は切り取れる（貼り付けで元の場所だけ）。 */
  const cutBlocked = $derived(cutBlockedReason(rules, selectedItems));
  /** 選んだ項目を削除できない理由。ゴミ箱のフォルダ・中身は消せない。ゴミ箱の項目は完全削除（ふつうの項目と混ぜない） */
  const deleteBlocked = $derived(deleteBlockedReason(rules, selectedEntries, selectedItems));

  /** 選んだ項目をコピー・切り取りする（できたことは、貼り付けが押せるようになることで分かるので通知は出さない） */
  function copySelected(): void {
    const items = selectedItems;
    // 特別なフォルダそのものと、ゴミ箱のフォルダは動かせないので除く（フォルダのコピーは可）
    const allowed = items.filter((i) => i.path !== rules.specialDir && i.trash?.where !== 'root');
    if (allowed.length < items.length) host.toast(ruleTexts(rules).cutSkipped);
    if (allowed.length === 0) return;
    explorerBuffer.set('copy', allowed);
    syncToClipboard();
    explorerSelection.clear();
  }

  function cutSelected(): void {
    const items = selectedItems;
    if (items.length === 0 || cutBlocked) return;
    explorerBuffer.set('move', items);
    syncToClipboard();
    explorerSelection.clear();
  }

  /** ゴミ箱の直下の項目（選んだもの）の、押した時点の ID と名前。確認のあとも、この分だけ扱う */
  function wholeTargets(): { id: string; alias: string; label: string }[] {
    return selectedEntries
      .filter((e) => trashPlace(e) === 'item')
      .map((e) => ({ id: trashItemOf(e)!.id, alias: e.path, label: entryLabel(e) }));
  }

  /**
   * ゴミ箱の項目を、1 件ずつ元へ戻す・完全に削除する（選んだものを押した時点の置き場所で）。
   * 各項目の前と応答のあとに置き場所が変わっていないか確かめる。変わったら以後は送らず、新しい置き場所の選びや一覧には触らない。
   * 成功したものだけ一覧から外す（選びも外す）。失敗したものは選んだまま残す。
   */
  async function wholeBatch(
    targets: { id: string; alias: string; label: string }[],
    scope: Scope,
    call: (id: string) => Promise<{ path?: string } | void>,
    doneText: (n: number) => string,
  ): Promise<void> {
    const done: { alias: string }[] = [];
    const failed: string[] = [];
    let changed = false;
    for (const t of targets) {
      if (!scope.alive()) {
        changed = true;
        break;
      }
      try {
        const r = await call(t.id);
        if (!scope.alive()) {
          changed = true;
          break;
        }
        done.push({ alias: t.alias });
        dirIndex.invalidate(t.alias);
        if (r && typeof r === 'object' && typeof r.path === 'string') dirIndex.invalidate(r.path);
      } catch (err) {
        if (!scope.alive()) {
          changed = true;
          break;
        }
        failed.push(`${t.label}: ${host.errorText(err)}`);
      }
    }
    if (changed) {
      host.toast(`${SERVER_CHANGED}。残りは扱っていません`, 'error');
      return;
    }
    for (const d of done) if (explorerSelection.has(d.alias)) explorerSelection.toggle(d.alias);
    explorerBuffer.remove(done.map((d) => d.alias));
    if (done.length > 0) host.toast(doneText(done.length));
    if (failed.length > 0) host.toast(`${failed.length} 件を扱えませんでした（${failed[0]}）`, 'error');
  }

  /**
   * 選んだ項目への操作（削除・元へ戻す・完全削除。確認の途中も含む）は、同時に 1 つだけ。
   * 進んでいるあいだの押しは何もしない（確認を重ねて出さない・二重に送らない）。終わったら、自分の分だけ外す（token）。
   * 置き場所が変わると外す（古い操作は、終わっても新しい操作の状態に触らず、新しい置き場所の選びにも触らない）。
   */
  let action = $state<{ token: number } | null>(null);
  let actionSeq = 0;
  const actionBusy = $derived(action !== null);

  async function exclusive(run: () => Promise<void>): Promise<void> {
    if (action) return;
    const token = ++actionSeq;
    action = { token };
    try {
      await run();
    } finally {
      if (action?.token === token) action = null;
    }
  }

  /** 元へ戻す（確認は不要。同じ名前があれば、その項目だけ戻せない） */
  function restoreSelected(): Promise<void> {
    return exclusive(async () => {
      const targets = wholeTargets();
      if (targets.length === 0) return;
      const scope = beginScope();
      await wholeBatch(targets, scope, (id) => api.restore(id), (n) => `${n} 件を元の場所に戻しました`);
    });
  }

  /** 完全に削除する（名前を出して確認。取り消せない。ゴミ箱の項目だけ）。確認から終わりまで 1 つの操作 */
  function purgeSelected(): Promise<void> {
    return exclusive(async () => {
      const targets = wholeTargets();
      if (targets.length === 0) return;
      const scope = beginScope();
      const names = targets.map((t) => t.label);
      const shown = names.length === 1 ? `「${names[0]}」` : `${names.length} 件（${names.slice(0, 3).join('、')}${names.length > 3 ? ' など' : ''}）`;
      const ok = await host.confirm({ title: '完全に削除しますか', body: `${shown}を完全に削除します。取り消せません。`, okLabel: '完全に削除', danger: true });
      if (!ok) return;
      if (!scope.alive()) {
        host.toast(SERVER_CHANGED, 'error');
        return;
      }
      await wholeBatch(targets, scope, async (id) => void (await api.purge(id)), (n) => `${n} 件を完全に削除しました`);
    });
  }

  /** 選んだ項目を、押したものに合わせて扱う（ゴミ箱の項目は完全削除、ふつうの項目はゴミ箱へ） */
  function removeSelected(): void {
    if (allWhole) void purgeSelected();
    else void deleteSelected();
  }

  /** 完全に削除する（Shift+Delete）。確認してから。ゴミ箱を通さない（置き場所が完全な削除を持たなければ、ゴミ箱へ入れてから消す） */
  function removeSelectedForever(): void {
    if (allWhole) void purgeSelected();
    else void deleteSelected(true);
  }

  function deleteSelected(forever = false): Promise<void> {
    return exclusive(() => deleteSelectedOnce(forever));
  }

  async function deleteSelectedOnce(forever = false): Promise<void> {
    const items = selectedItems;
    if (items.length === 0 || deleteBlocked) return;
    // 範囲（置き場所）は、選んで押したときのもの。確認を待つあいだに変わったら、何も移さない
    const scope = beginScope();
    // ゴミ箱の無い置き場所は、完全な削除（元に戻せないので、その文で確認する）
    // （ゴミ箱へ移せない項目（WSL の中など）を含むときも、完全な削除として、確認する）
    const permanent = !explorer.caps.trash || forever || (api.trashable !== undefined && items.some((i) => !api.trashable!(i.path)));
    // ゴミ箱へ移すだけなら、確認は出さない（終わりの知らせに、取り消せるなら「取り消す」が付く）。完全な削除は、確認してから
    if (permanent && !(await host.confirm(permanentDeleteConfirm(items)))) return;
    if (!scope.alive()) {
      host.toast(SERVER_CHANGED, 'error');
      return;
    }
    const failed: string[] = [];
    const succeeded: { id: string; path: string }[] = [];
    for (const i of items) {
      // 次の項目を移す前に、置き場所が変わっていないか確かめる（変わったら残りは移さない）
      if (!scope.alive()) break;
      try {
        if (permanent) {
          if (api.remove) await api.remove(i.path);
          else if (explorer.caps.trash && explorer.caps.restore) await api.purge((await api.trash(i.path)).id);
          else throw new Error('この置き場所は、完全な削除に対応していません');
          succeeded.push({ id: '', path: i.path });
        } else {
          const trashed = await api.trash(i.path);
          succeeded.push({ id: trashed.id, path: i.path });
        }
        if (scope.alive()) dirIndex.invalidate(i.path);
      } catch (err) {
        failed.push(`${baseName(i.path)}: ${host.errorText(err)}`);
      }
    }
    const changed = !scope.alive();
    // 新しい置き場所の選択には触らない
    if (!changed) explorerSelection.clear();
    if (succeeded.length > 0) {
      // ゴミ箱に移した項目をバッファからも除去（cut済み→trash→pasteでnot_foundにならないよう）
      if (!changed) explorerBuffer.remove(succeeded.map((s) => s.path));
      // 成功したIDの不変スナップショット（この一括操作だけが対象、過去/他ユーザーの削除はundoしない）
      // 戻す印（id）を持つものだけ（OS のゴミ箱で、印を見つけられなかったものは、戻せない）
      const restorable = permanent ? [] : succeeded.filter((s) => s.id !== '');
      const ids = restorable.map((s) => s.id);
      // 元に戻す（Ctrl+Z）の履歴。ゴミ箱から戻せる置き場所だけ
      if (explorer.caps.restore && restorable.length > 0) explorerHistory.push(trashEntry(api, restorable, (p) => dirIndex.invalidate(p)));
      // 取り消しは、削除した置き場所へだけ送る（restoreBatch が確かめる）
      const trashServerUrl = scope.url;
      // 「取り消す」は、この部品から元へ戻せる置き場所だけ
      const undo = explorer.caps.restore && ids.length === succeeded.length && !permanent
        ? { label: '取り消す', run: () => void restoreBatch(ids, trashServerUrl).catch((e) => host.toast(host.errorText(e), 'error')) }
        : undefined;
      host.toast(permanent ? `${succeeded.length} 件を完全に削除しました` : `${succeeded.length} 件をゴミ箱に移しました`, 'info', undo);
    }
    if (changed) host.toast(`${SERVER_CHANGED}。残りは移していません`, 'error');
    if (failed.length > 0) host.toast(`${failed.length} 件を${permanent ? '完全に削除できませんでした' : 'ゴミ箱に移せませんでした'}（${failed[0]}）`, 'error');
  }

  /**
   * ゴミ箱の取り消し（削除直後のトーストから呼ぶ）。
   * - このセッションで成功した ID だけを対象にする（スナップショット）
   * - 戻す直前と応答のあとに、削除した置き場所のままかを確かめる。変わったら、以後は戻さず投げる
   * - 失敗した項目の ID は undo の対象に入れていないため、失敗は維持される
   */
  async function restoreBatch(ids: string[], serverUrl: string): Promise<void> {
    const scope: Scope = { url: serverUrl, alive: () => scopeSource.key() === serverUrl };
    const failed: string[] = [];
    for (const id of ids) {
      assertScope(scope);
      try {
        const restored = await api.restore(id);
        assertScope(scope);
        dirIndex.invalidate(restored.path);
      } catch (err) {
        if (err instanceof ServerChangedError) throw err;
        failed.push(host.errorText(err));
      }
    }
    if (failed.length > 0) throw new Error(`${failed.length} 件を元に戻せませんでした（${failed[0]}）`);
  }

  // ---- 行の操作: 長押しで選択モードに入る。選択モードの中では、行を押すと開かずに選び直す ----

  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  // 画面を閉じたあとに、長押し・名前の書き換え・メニューの待ちが動いて、選びを変えないようにする
  onDestroy(() => {
    props.oncursor?.(null);
    clearTimeout(pressTimer);
    clearTimeout(renameTimer);
    clearTimeout(ctxTimer);
    clearTimeout(pastePreviewTimer);
    clearInterval(scrollTimer);
  });
  let pressFrom: { x: number; y: number } | null = null;
  /** 長押しで選択に入ったところ（直後のクリックは無視する） */
  let longPressed = false;
  /** いまの押し（診断ログ用。タッチ・ペンだけ）。t は押し始めの時刻 */
  let pressLog: { t: number; type: string } | null = null;

  // Android で「長押しで振動する（WebView の長押しの合図）のに選択モードにならない」ことがあり、手元で再現しないため、
  // タッチの長押しの経過を診断ログに残す（名前・パスは書かない）
  function logPress(what: string): void {
    if (!pressLog) return;
    host.log('info', `[explorer] 長押し: ${what} 経過=${Date.now() - pressLog.t}ms 種類=${pressLog.type} 選択モード=${explorerSelection.active}`);
  }

  function pressStart(ev: PointerEvent, path: string): void {
    if (ev.pointerType === 'mouse' && ev.button !== 0) return;
    // 項目の「…」の上の長押しは、選択に入れない
    if (ev.target instanceof Element && ev.target.closest('.explorer-entry-actions, .file-explorer-rename')) return;
    longPressed = false;
    // タッチ・ペンでは、項目を HTML5 のドラッグにしない（長押しからのなぞりを、範囲の選択に使うため。長押しで、ブラウザがドラッグを始めてしまうのを避ける）
    touchPointer = ev.pointerType !== 'mouse';
    pressFrom = { x: ev.clientX, y: ev.clientY };
    pressLog = ev.pointerType === 'mouse' ? null : { t: Date.now(), type: ev.pointerType };
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      pressFrom = null;
      const before = explorerSelection.paths();
      explorerSelection.start(path);
      // タッチ・ペンは、そのまま指をなぞると範囲を選ぶ（長押しのまま、ドラッグでの選択を始める）
      if (pressLog) touchDrag = { anchor: path, base: before, x: ev.clientX, y: ev.clientY };
      logPress('選択モードに入った');
    }, LONG_PRESS_MS);
  }

  // ---- ドラッグでの複数選択 ----
  //  - マウス: 空きスペース、または選んでいない項目から、四角く囲む（Ctrl・Shift を押していれば、いまの選びに足す）。選んでいる項目は、ドラッグで移す
  //  - タッチ: 長押しで選んだ項目から、指をなぞった範囲まで
  /** 直前の押しがタッチ・ペンか（そのあいだ、項目はドラッグ（HTML5）にしない） */
  let touchPointer = $state(false);
  /** タッチの長押しから続くなぞり（anchor は最初の項目、base はそれまでの選び） */
  let touchDrag: { anchor: string; base: string[]; x: number; y: number } | null = null;
  /** マウスの囲み（画面の座標）。base はそれまでの選び。moved は、動かし始めたか */
  let band = $state<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  /** 囲みの始点。x・y は押した画面の座標、ax・ay は一覧の中の座標（スクロールしても、囲みの始点は同じ項目の上に残る） */
  let bandFrom: { x: number; y: number; ax: number; ay: number; base: string[]; pointerId: number } | null = null;
  /** 囲みを終えた直後のクリック（空きスペースを押した扱いで、選びを外さない） */
  let bandJustEnded = false;
  let bodyEl: HTMLDivElement | undefined = $state();
  let scrollTimer: ReturnType<typeof setInterval> | undefined;

  const itemEls = (): HTMLElement[] => (bodyEl ? [...bodyEl.querySelectorAll<HTMLElement>('li.file-explorer-item[data-path]')] : []);

  /** 画面の座標の下にある項目のパス */
  function pathAt(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('li.file-explorer-item[data-path]');
    return el?.dataset.path ?? null;
  }

  /** 長押しした項目から、いまの指の下の項目まで（並んでいる順）を、それまでの選びに足して選ぶ */
  function selectRangeTo(x: number, y: number): void {
    if (!touchDrag) return;
    const cur = pathAt(x, y);
    if (cur === null) return;
    const order = shownEntries.map((e) => e.path);
    const a = order.indexOf(touchDrag.anchor);
    const b = order.indexOf(cur);
    if (a < 0 || b < 0) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    explorerSelection.replace([...touchDrag.base, ...order.slice(lo, hi + 1)]);
  }

  /** 囲みの四角と重なる項目を選ぶ */
  function selectBand(): void {
    if (!band || !bandFrom) return;
    const left = Math.min(band.x1, band.x2);
    const right = Math.max(band.x1, band.x2);
    const top = Math.min(band.y1, band.y2);
    const bottom = Math.max(band.y1, band.y2);
    const hit = itemEls()
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < right && r.right > left && r.top < bottom && r.bottom > top;
      })
      .map((el) => el.dataset.path!);
    explorerSelection.replace([...bandFrom.base, ...hit]);
  }

  /** 囲み・なぞりの間、端に近ければスクロールする（指・ポインターが止まっていても続ける） */
  function startAutoScroll(): void {
    if (scrollTimer) return;
    scrollTimer = setInterval(() => {
      const pos = band ? { x: band.x2, y: band.y2 } : touchDrag ? { x: touchDrag.x, y: touchDrag.y } : null;
      if (!pos || !bodyEl) return stopAutoScroll();
      const r = bodyEl.getBoundingClientRect();
      const edge = 32;
      const dy = pos.y < r.top + edge ? -12 : pos.y > r.bottom - edge ? 12 : 0;
      if (dy === 0) return;
      bodyEl.scrollTop += dy;
      if (band) bandSync();
      else selectRangeTo(pos.x, pos.y);
    }, 30);
  }
  function stopAutoScroll(): void {
    clearInterval(scrollTimer);
    scrollTimer = undefined;
  }

  function bandStart(ev: PointerEvent): void {
    if (ev.pointerType !== 'mouse' || ev.button !== 0 || !bodyEl || !isEmptySpot(ev.target)) return;
    // スクロールバーの上は、囲みにしない
    const r = bodyEl.getBoundingClientRect();
    if (ev.clientX >= r.left + bodyEl.clientWidth || ev.clientY >= r.top + bodyEl.clientHeight) return;
    bandFrom = { x: ev.clientX, y: ev.clientY, ax: ev.clientX - r.left + bodyEl.scrollLeft, ay: ev.clientY - r.top + bodyEl.scrollTop, base: ev.ctrlKey || ev.metaKey || ev.shiftKey ? explorerSelection.paths() : [], pointerId: ev.pointerId };
  }

  function bandMove(ev: PointerEvent): void {
    if (!bandFrom || ev.pointerId !== bandFrom.pointerId) return;
    if (!band) {
      if (Math.abs(ev.clientX - bandFrom.x) < 5 && Math.abs(ev.clientY - bandFrom.y) < 5) return;
      bodyEl?.setPointerCapture?.(ev.pointerId);
      band = { x1: bandFrom.x, y1: bandFrom.y, x2: ev.clientX, y2: ev.clientY };
      startAutoScroll();
    } else {
      band = { ...band, x2: ev.clientX, y2: ev.clientY };
    }
    bandSync();
  }

  /** 囲みの始点を、いまのスクロールの位置に合わせて置き直し、選びを計算し直す（画面がスクロールするとき、四角も一緒に動く） */
  function bandSync(): void {
    if (!band || !bandFrom || !bodyEl) return;
    const r = bodyEl.getBoundingClientRect();
    band = { ...band, x1: r.left + bandFrom.ax - bodyEl.scrollLeft, y1: r.top + bandFrom.ay - bodyEl.scrollTop };
    selectBand();
  }

  /** 四角の表示。一覧の外にははみ出さない（選びの計算は、はみ出したままの四角で行う） */
  const bandBox = $derived.by(() => {
    if (!band) return null;
    let left = Math.min(band.x1, band.x2);
    let top = Math.min(band.y1, band.y2);
    let right = Math.max(band.x1, band.x2);
    let bottom = Math.max(band.y1, band.y2);
    const r = bodyEl?.getBoundingClientRect();
    if (r && r.width > 0) {
      left = Math.max(left, r.left);
      top = Math.max(top, r.top);
      right = Math.min(right, r.right);
      bottom = Math.min(bottom, r.bottom);
    }
    return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  });

  function bandEnd(ev: PointerEvent): void {
    if (!bandFrom || ev.pointerId !== bandFrom.pointerId) return;
    if (band) {
      bandJustEnded = true;
      setTimeout(() => (bandJustEnded = false), 0);
      if (bodyEl?.hasPointerCapture?.(ev.pointerId)) bodyEl.releasePointerCapture(ev.pointerId);
    }
    band = null;
    bandFrom = null;
    stopAutoScroll();
  }

  function touchDragMove(ev: PointerEvent): void {
    if (!touchDrag) return;
    touchDrag.x = ev.clientX;
    touchDrag.y = ev.clientY;
    selectRangeTo(ev.clientX, ev.clientY);
    startAutoScroll();
  }

  function touchDragEnd(): void {
    touchDrag = null;
    if (!band) stopAutoScroll();
  }

  // タッチのなぞりの間は、画面のスクロールをさせない（passive でない touchmove でだけ止められる）
  $effect(() => {
    const el = bodyEl;
    if (!el) return;
    const stop = (ev: TouchEvent): void => {
      if (touchDrag && ev.cancelable) ev.preventDefault();
    };
    // touchstart も passive でなく登録する（Chrome は、touchstart が passive だと、そのあとの touchmove を待たずにスクロールを始めてしまう）
    const hold = (): void => {};
    el.addEventListener('touchstart', hold, { passive: false });
    el.addEventListener('touchmove', stop, { passive: false });
    return () => {
      el.removeEventListener('touchstart', hold);
      el.removeEventListener('touchmove', stop);
      stopAutoScroll();
    };
  });

  function pressMove(ev: PointerEvent): void {
    if (touchDrag) {
      touchDragMove(ev);
      return;
    }
    if (!pressFrom) return;
    const dx = Math.abs(ev.clientX - pressFrom.x);
    const dy = Math.abs(ev.clientY - pressFrom.y);
    if (dx > 8 || dy > 8) pressEnd(`動いた dx=${Math.round(dx)} dy=${Math.round(dy)}`);
  }

  /** 押しが終わった・取り消された。長押しの前なら、why を診断ログに残す */
  function pressEnd(why: string): void {
    // 長押しになる前に止まった（短いタップの指離しは記録しない）
    if (pressFrom && why !== 'pointerup') logPress(`取り消し 理由=${why}`);
    clearTimeout(pressTimer);
    pressFrom = null;
  }

  /**
   * 右クリック・WebView の長押し（Android は振動して contextmenu が来る）。選択モードなら既定のメニューを出さない。
   * タッチの長押しで、こちらのタイマーより先に止められて選択モードに入れていなければ、ここで入る
   */
  function rowContextMenu(ev: MouseEvent, e: Entry): void {
    const path = e.path;
    const touch = pressLog !== null;
    if (!touch && explorerSelection.desktop) {
      // PC のマウスの右クリック: 項目のメニュー。選んでいない項目なら、その項目だけを選んでから出す
      ev.preventDefault();
      clearTimeout(renameTimer);
      if (!explorerSelection.has(path)) explorerSelection.replace([path]);
      cursorPath = path;
      openCtx(ev.clientX, ev.clientY, true);
      return;
    }
    if (touch) logPress(`contextmenu 長押し済み=${longPressed}`);
    if (touch && !explorerSelection.active && !longPressed) {
      clearTimeout(pressTimer);
      pressFrom = null;
      longPressed = true;
      explorerSelection.start(path);
      logPress('contextmenu で選択モードに入った');
    }
    if (explorerSelection.showing || longPressed) ev.preventDefault();
  }

  /** 項目を、カーソル（フォーカス）にする。行の要素が分かっていれば、それに（再描画で外れていても、なるべく合わせる） */
  function focusRow(path: string, row?: HTMLElement | null): void {
    cursorPath = path;
    const el = row ?? [...(bodyEl?.querySelectorAll<HTMLElement>('.file-explorer-item') ?? [])].find((x) => x.dataset.path === path)?.querySelector<HTMLElement>('.file-explorer-row');
    if (el && document.activeElement !== el) el.focus({ preventScroll: true });
  }

  /** 名前の文字を押してから、書き換えに入るまでの待ち（ダブルクリックで開くのと見分ける。この間に 2 回目を押すと、開く） */
  let renameTimer: ReturnType<typeof setTimeout> | undefined;

  /** 行を押したとき（選択モードの中では選び直す。長押しの直後は何もしない。名前の文字を押したら書き換える） */
  function rowClick(ev: MouseEvent, e: Entry, open: () => void): void {
    if (longPressed) {
      longPressed = false;
      ev.preventDefault();
      return;
    }
    clearTimeout(renameTimer);
    if (explorerSelection.active) {
      ev.preventDefault();
      // PC: 押した項目が、カーソル（フォーカス）になる。選びを外したときも、カーソルは、その項目に残る（フォーカスは、いつも 1 つ）
      if (explorerSelection.desktop) focusRow(e.path, ev.currentTarget instanceof HTMLElement ? ev.currentTarget : null);
      // PC: ダブルクリックの 2 回目の押しでは選び直さない（開くのは dblclick）
      if (explorerSelection.desktop && ev.detail >= 2) return;
      // PC: 名前の文字を押すと、選びは変えずに、名前を書き換える（ダブルクリック（開く）と見分けるため、DOUBLE_CLICK_MS だけ待つ）。
      // 文字以外の押しは、選ぶ・外す（Ctrl・Shift を押しながらなら、名前の上でも選ぶ・外す）
      if (
        explorerSelection.desktop &&
        !(ev.ctrlKey || ev.metaKey || ev.shiftKey) &&
        ev.target instanceof Element &&
        ev.target.closest('.file-explorer-name-text') &&
        !renameBlock(e)
      ) {
        renameTimer = setTimeout(() => startRename(e), DOUBLE_CLICK_MS);
        return;
      }
      // PC: Ctrl（Mac は Cmd）・Shift を押しながらなら、選びに足す・外す。押さないなら、その項目だけを選ぶ（選んでいる唯一の項目を押したときは、外す）
      const only = explorerSelection.count === 1 && explorerSelection.has(e.path);
      if (explorerSelection.desktop && !(ev.ctrlKey || ev.metaKey || ev.shiftKey) && !only) explorerSelection.replace([e.path]);
      else explorerSelection.toggle(e.path);
      return;
    }
    if (ev.target instanceof Element && ev.target.closest('.file-explorer-name-text') && startRename(e)) {
      ev.preventDefault();
      return;
    }
    open();
  }

  /**
   * 開く（PC の Enter・ダブルクリック）。フォルダは中へ、画像・PDF は拡大表示、ほかはダウンロード。
   * ダウンロードは、一時のリンクを押して行う（行の押しには届かせない）
   */
  function activateEntry(e: Entry): void {
    const action = entryAction(e, host.viewerKind);
    if (action === 'enter') fileExplorer.open(e.path);
    else if (action === 'file') downloadEntry(e);
    else openViewer(e);
  }

  function downloadEntry(e: Entry): void {
    void host.download.file({ url: urls.href(e), name: e.name });
  }

  /**
   * 行のキー操作。PC は Enter で開く（Space は押すと選ぶ＝ボタンの既定の押し）。F2 で名前を書き換える。
   * タッチの選択モードの中では、名前の書き換えはしない（従来どおり）
   */
  function rowKey(ev: KeyboardEvent, e: Entry): void {
    if (explorerSelection.desktop && matchesHotkey(ev, keysOf('open'))) {
      ev.preventDefault();
      activateEntry(e);
      return;
    }
    if (!matchesHotkey(ev, keysOf('rename'))) return;
    if (explorerSelection.active && !explorerSelection.desktop) return;
    if (startRename(e)) ev.preventDefault();
    else {
      const why = renameBlock(e);
      if (why) host.toast(why, 'error');
    }
  }

  // ---- 名前の変更: 名前の文字を押すと、その場で入力欄に置き換わる。Enter・外を押すと確定、Esc で取り消し ----

  let renamingPath = $state<string | null>(null);
  let renameTo = $state('');
  let renameError = $state<string | null>(null);
  let renameBusy = $state(false);

  /** 名前を変えられない理由（ゴミ箱の中の項目・特別なフォルダ・書けない場所）。変えられるなら null */
  function renameBlock(e: Entry): string | null {
    const place = trashPlace(e);
    if (place !== 'normal') return 'ゴミ箱の中の項目は名前を変えられません';
    const a = renameAllowed(rules, e.path);
    if (!a.ok) return a.message;
    return writeBlock(parentOf(e.path));
  }

  /** 書き換えを始める（名前を変えられない項目なら false。そのときは普通に開く） */
  function startRename(e: Entry): boolean {
    if (renameBlock(e)) return false;
    renamingPath = e.path;
    renameTo = baseName(e.path);
    renameError = null;
    return true;
  }

  /** 名前の書き換えを終えたあとに、カーソルを戻す項目（書き換え中の入力欄が消えるとフォーカスが迷子になるので）。select なら、その項目だけを選ぶ */
  let pendingFocus = $state<{ path: string; select: boolean } | null>(null);
  $effect(() => {
    const p = pendingFocus;
    const l = listing;
    if (p === null || l?.kind !== 'ok' || !explorerSelection.desktop) return;
    if (![...l.entries.values()].some((e) => e.path === p.path)) return;
    untrack(() => {
      pendingFocus = null;
      void tick().then(() => {
        if (p.select) explorerSelection.replace([p.path]);
        focusRow(p.path);
        const el = [...(bodyEl?.querySelectorAll<HTMLElement>('.file-explorer-item') ?? [])].find((x) => x.dataset.path === p.path);
        if (el && p.select) scrollIntoViewBelowHeader(el);
      });
    });
  });

  function cancelRename(): void {
    const path = renamingPath;
    renamingPath = null;
    if (path !== null) pendingFocus = { path, select: false };
  }

  async function commitRename(path: string): Promise<void> {
    if (renamingPath !== path || renameBusy) return;
    const to = renameTo.trim();
    if (to === baseName(path)) {
      cancelRename();
      return;
    }
    const bad = rules.nameError(parentOf(path), to);
    if (bad) {
      renameError = bad;
      return;
    }
    renameBusy = true;
    try {
      const target = renameTarget(path, to);
      await api.move(path, target);
      explorerHistory.push(moveEntry(api, [{ from: path, to: target }], (p) => dirIndex.invalidate(p)));
      dirIndex.invalidate(path);
      if (renamingPath === path) {
        renamingPath = null;
        // 新しい名前の項目が一覧に出たら、選んで、カーソルを戻す
        pendingFocus = { path: target, select: true };
      }
    } catch (err) {
      renameError = host.errorText(err);
    } finally {
      renameBusy = false;
    }
  }

  function renameKey(ev: KeyboardEvent, path: string): void {
    if (ev.isComposing) return;
    if (ev.key === 'Enter') {
      ev.preventDefault();
      void commitRename(path);
    } else if (ev.key === 'Escape') {
      // パネルの Esc（閉じるなど）まで届かせない
      ev.preventDefault();
      ev.stopPropagation();
      cancelRename();
    }
  }

  /** 入力欄を出したら、拡張子の前までを選ぶ（すぐ打ち替えられるように） */
  /**
   * 上端の行を必ず 1 行にする。部品は折り返す並べ方にしておき、次の行へ回った部品を隠す（data-clipped。隠したぶんは、どこにも出さない）。
   * 幅や部品が変わるたびに、いったん全部出して測り直す
   */
  function fitBar(sentinel: HTMLElement): { destroy(): void } | void {
    const box = sentinel.parentElement;
    if (!box) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const kids = [...box.children].filter((k) => k !== sentinel) as HTMLElement[];
      for (const k of kids) k.removeAttribute('data-clipped');
      const first = kids.find((k) => k.getClientRects().length > 0);
      if (!first) return;
      const top = first.getBoundingClientRect().top;
      for (const k of kids) if (k.getClientRects().length > 0 && k.getBoundingClientRect().top > top + 6) k.setAttribute('data-clipped', '');
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    ro?.observe(box);
    const mo = typeof MutationObserver === 'undefined' ? null : new MutationObserver(schedule);
    mo?.observe(box, { childList: true });
    schedule();
    return {
      destroy() {
        if (frame !== 0) cancelAnimationFrame(frame);
        ro?.disconnect();
        mo?.disconnect();
      },
    };
  }

  function focusName(input: HTMLTextAreaElement): void {
    fitName(input);
    input.focus();
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }

  /** 名前の入力欄の高さを中身に合わせる（長い名前は折り返して縦に伸ばす。改行は入れない: Enter は確定） */
  function fitName(input: HTMLTextAreaElement): void {
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }

  /** 選んでいる件数（0 のときは操作を押せない） */
  const noneSelected = $derived(explorerSelection.count === 0);
  /** 上端の件数: 選んでいるときは「N 件選択中」、選んでいないときはフォルダの項目数 */
  const countLabel = $derived.by(() => {
    if (explorerSelection.showing) return `${explorerSelection.count} 件選択中`;
    return listing?.kind === 'ok' ? `${listing.entries.size} 件` : '';
  });
  /** 選択の操作が押せないときの理由（ホバーで出す） */
  function selectionReason(what: string): string {
    return noneSelected ? `項目を選ぶと${what}できます` : what;
  }

  /** 空きスペース（項目の外）を押したら、選択を解除する。項目・バー・メニュー・パンくずは解除しない */
  function onbodyclick(ev: MouseEvent): void {
    if (bandJustEnded) return;
    if (!explorerSelection.showing || ctx) return;
    if (ev.target instanceof Element && ev.target.closest('.file-explorer-item, .file-explorer-menu, .menu-backdrop, .file-explorer-bar, .file-explorer-footer, .file-explorer-columns')) return;
    explorerSelection.clear();
  }

  let mkdirOpen = $state(false);
  let mkdirName = $state('');
  /** フォルダを作る入力か（「新しいフォルダ」。ファイルの入力でも、末尾が / か \ ならフォルダ） */
  let mkdirAsDir = $state(false);
  let mkdirError = $state<string | null>(null);
  let mkdirBusy = $state(false);

  // ---- 内部 DnD（項目をフォルダ・パンくず・空きスペースへドラッグ＆ドロップ） ----
  // ドラッグ中の項目（null なら DnD していない）。タッチの長押しと競合しないよう、HTML5 Drag API のみ
  let dragItems = $state<TransferItem[] | null>(null);
  /** ハイライト中のドロップ先（フォルダのパス・'' で現在フォルダ・null でハイライト無し） */
  let dragTarget = $state<string | null>(null);

  function startItemDrag(ev: DragEvent, e: Entry): void {
    if (renamingPath === e.path) { ev.preventDefault(); return; }
    // タッチのなぞり（範囲の選択）の間は、項目のドラッグにしない
    if (touchDrag) { ev.preventDefault(); return; }
    const item = transferItemOf(e);
    // 選択中にドラッグしたら選択中の全項目を、そうでなければその 1 件だけ
    const items = explorerSelection.active && explorerSelection.has(e.path) ? selectedItems : [item];
    dragItems = items;
    setExplorerDragItems(items.map((i) => ({ path: i.path, kind: i.kind === 'dir' ? 'dir' : 'file' })));
    ev.dataTransfer!.effectAllowed = 'copyMove';
    ev.dataTransfer!.setData(EXPLORER_DRAG_TYPE, items.map((i) => i.path).join('|'));
    // フォルダが含まれるときだけ印を付ける（ドロップ先が、落とす前にフォルダかを見分けられる）
    if (items.some((i) => i.kind === 'dir')) ev.dataTransfer!.setData(EXPLORER_DRAG_DIR_TYPE, '1');
  }

  function endItemDrag(): void {
    dragItems = null;
    setExplorerDragItems(null);
    dragTarget = null;
  }

  function isInternalDrag(ev: DragEvent): boolean {
    return !!ev.dataTransfer?.types.includes(EXPLORER_DRAG_TYPE);
  }

  /** フォルダ項目の上（ドロップ先にできるか確認してハイライト） */
  /** フォルダ項目の上（内部 DnD と外部 OS ファイルの両方を受ける） */
  function folderDragOver(ev: DragEvent, folderPath: string): void {
    const internal = isInternalDrag(ev);
    const external = isExternalFileDrag(ev);
    if (!internal && !external) return;
    if (internal) {
      if (!dragItems) return;
      if (dragItems.some((i) => i.path === folderPath || (i.kind === 'dir' && folderPath.startsWith(i.path + '/')))) return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    ev.dataTransfer!.dropEffect = external ? 'copy' : ev.ctrlKey ? 'copy' : 'move';
    dragTarget = folderPath;
  }

  function folderDragLeave(folderPath: string): void {
    if (dragTarget === folderPath) dragTarget = null;
  }

  async function folderDrop(ev: DragEvent, folderPath: string): Promise<void> {
    const items = dragItems;
    dragItems = null;
    dragTarget = null;

    if (isInternalDrag(ev)) {
      if (!items) return;
      ev.preventDefault();
      ev.stopPropagation();
      const op: TransferOp = ev.ctrlKey ? 'copy' : 'move';
      await performInternalTransfer(op, items, folderPath);
      return;
    }

    if (isExternalFileDrag(ev)) {
      // 外部 OS ファイル → そのフォルダを宛先としてアップロード
      await bodyExternalDrop(ev, folderPath);
    }
  }

  /** パンくずへのドラッグ（内部 DnD と外部 OS ファイルの両方） */
  function crumbDragOver(ev: DragEvent, dirPath: string): void {
    const internal = isInternalDrag(ev);
    const external = isExternalFileDrag(ev);
    if (!internal && !external) return;
    if (internal) {
      if (!dragItems) return;
      if (dragItems.some((i) => i.path === dirPath || (i.kind === 'dir' && dirPath.startsWith(i.path + '/')))) return;
    }
    ev.preventDefault();
    ev.dataTransfer!.dropEffect = external ? 'copy' : ev.ctrlKey ? 'copy' : 'move';
    dragTarget = '__crumb__' + dirPath;
  }

  function crumbDragLeave(dirPath: string): void {
    if (dragTarget === '__crumb__' + dirPath) dragTarget = null;
  }

  async function crumbDrop(ev: DragEvent, dirPath: string): Promise<void> {
    const items = dragItems;
    dragItems = null;
    dragTarget = null;

    if (isInternalDrag(ev)) {
      if (!items) return;
      ev.preventDefault();
      const op: TransferOp = ev.ctrlKey ? 'copy' : 'move';
      await performInternalTransfer(op, items, dirPath);
      return;
    }

    if (isExternalFileDrag(ev)) {
      await bodyExternalDrop(ev, dirPath);
    }
  }

  // 一覧の外のドロップ先（左の欄のブックマークなど）へ、ドラッグしている項目を移す・コピーする口
  $effect(() => {
    explorer.dropDragged = async (destDir, op) => {
      const items = dragItems;
      if (!items) return;
      await performInternalTransfer(op, items, destDir);
    };
    return () => {
      explorer.dropDragged = null;
    };
  });

  /** 内部 DnD の実行（移動・コピー）。貼り付けと同じ（宛先の一覧を取り、範囲のあいだだけ書く） */
  async function performInternalTransfer(op: TransferOp, items: TransferItem[], destDir: string): Promise<void> {
    await transferInScope(op, items, destDir);
  }

  /**
   * 移動・コピーを 1 回で行う（貼り付け・ドラッグ）。宛先の一覧は未読なら取り直す。
   * 上書きの確認や応答を待つあいだに置き場所が変わったら、新しい置き場所へは何も送らない（残りは移さず、知らせる）。
   */
  async function transferInScope(op: TransferOp, items: TransferItem[], destDir: string): Promise<void> {
    const why = writeBlock(destDir);
    if (why) {
      host.toast(why, 'error');
      return;
    }
    const scope = beginScope();
    const fetched = await fetchDestEntries(destDir);
    if (!scope.alive()) {
      host.toast(SERVER_CHANGED, 'error');
      return;
    }
    if (!fetched) return; // エラーは fetchDestEntries がトーストで通知済み
    const result = await runTransfer({
      rules,
      errorText: (e) => host.errorText(e),
      op,
      items,
      destDir,
      destEntries: new Map(fetched),
      confirm: (c) => host.confirm(c),
      api: scopedTransfer(scope),
      invalidate: (p) => {
        if (scope.alive()) dirIndex.invalidate(p);
      },
    });
    if (!scope.alive()) {
      host.toast(SERVER_CHANGED, 'error');
      return;
    }
    // 切り取りで移動したものを外す。接続先が変わった場合は、新しいバッファには触らない。
    if (op === 'move') explorerBuffer.remove([...result.done, ...result.skipped].map((i) => i.path));
    recordTransfer(result);
    // 同じフォルダへのコピー（` copy` を付けた名前になる）は、そのまま名前の書き換えに入る
    const only = result.applied.length === 1 && op === 'copy' ? result.applied[0] : null;
    if (only && parentOf(only.from) === parentOf(only.to) && parentOf(only.to) === fileExplorer.dir) {
      pendingRename = only.to;
      setTimeout(() => {
        if (pendingRename === only.to) pendingRename = null;
      }, 5000);
    }
    const msg = transferFailure(result);
    if (msg) host.toast(msg, 'error');
  }

  /** コピーしてできた項目を、一覧に現れたら、名前の書き換えに入る（一覧の読み直しを待つ） */
  let pendingRename = $state<string | null>(null);
  $effect(() => {
    const path = pendingRename;
    if (path === null) return;
    const made = shownEntries.find((e) => e.path === path);
    if (!made) return;
    untrack(() => {
      pendingRename = null;
      explorerSelection.replace([path]);
      startRename(made);
    });
  });

  // 貼り付けを始めてから、できた項目が一覧に現れる（名前の書き換えに入る）までの間、これが 0.5 秒を超えたら、カーソルを「待つ」にする
  const WAIT_CURSOR_MS = 500;
  let waitCursor = $state(false);
  $effect(() => {
    if (!pasting && pendingRename === null) {
      waitCursor = false;
      return;
    }
    const t = setTimeout(() => (waitCursor = true), WAIT_CURSOR_MS);
    return () => clearTimeout(t);
  });

  /** 移動・コピーを、元に戻せる履歴に積む（上書きしたものは、元に戻せないので積まない。コピーは、ゴミ箱へ入れて戻すので、ゴミ箱を戻せる置き場所だけ） */
  function recordTransfer(result: TransferResult): void {
    const ok = result.applied.filter((a) => !a.overwrote);
    const invalidate = (p: string): void => dirIndex.invalidate(p);
    const moves = ok.filter((a) => a.op === 'move');
    if (moves.length > 0) explorerHistory.push(moveEntry(api, moves, invalidate));
    const copies = ok.filter((a) => a.op === 'copy');
    if (copies.length > 0 && explorer.caps.trash && explorer.caps.restore) explorerHistory.push(copyEntry(api, copies, invalidate));
  }

  /**
   * 宛先フォルダの一覧を取得して返す共通ヘルパー。
   * キャッシュがあればそのまま、なければ api.list で明示取得。
   * 失敗時はトーストでエラーを通知して null を返す（書込なし保証）。
   */
  async function fetchDestEntries(destDir: string): Promise<ReadonlyMap<string, Entry> | null> {
    const cached = dirIndex.state(destDir);
    if (cached?.kind === 'ok') return cached.entries;
    try {
      const listed = await api.list(destDir);
      return new Map(listed.map((e) => [e.name, e]));
    } catch (err) {
      host.toast(`宛先の一覧を取得できませんでした: ${host.errorText(err)}`, 'error');
      return null;
    }
  }

  // ---- 外部 OS ファイルのドロップ（アップロード）。内部 DnD と分けてカウンタで入退場を管理 ----
  let externalDragOver = $state(false);
  let externalDragDepth = 0;

  function isExternalFileDrag(ev: DragEvent): boolean {
    return !!ev.dataTransfer?.types.includes('Files') && !isInternalDrag(ev);
  }

  function explorerDragEnter(ev: DragEvent): void {
    if (!isExternalFileDrag(ev)) return;
    externalDragDepth++;
    externalDragOver = true;
  }

  function explorerDragLeave(ev: DragEvent): void {
    if (!isExternalFileDrag(ev)) return;
    externalDragDepth = Math.max(0, externalDragDepth - 1);
    if (externalDragDepth === 0) externalDragOver = false;
  }

  async function bodyExternalDrop(ev: DragEvent, overrideDir?: string): Promise<void> {
    externalDragOver = false;
    externalDragDepth = 0;
    if (!ev.dataTransfer) return;
    // Windows: dropRootsOf は必ずドロップイベントの中で同期的に呼ぶ（後からは取れない）
    const roots = host.osDrop.rootsOf(ev.dataTransfer);
    if (roots.length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    // destDir と serverUrl は await 前にキャプチャ（ユーザーが await 中にフォルダ/置き場所を変えても意図した先へ）
    const destDir = overrideDir ?? fileExplorer.dir;
    const serverUrl = scopeSource.key();
    const entries = await host.osDrop.entriesFromRoots(roots);
    await uploadOsDropEntries(entries, destDir, serverUrl);
  }

  /**
   * OsDropEntry の逐次アップロード（Windows HTML5 ドロップ・Linux ネイティブドロップ共通）。
   * 根レベルの同名フォルダはマージせず止める（同名ファイルは確認して上書き）。
   * 空フォルダも保持（mkdir のみ）。OS 原本は変更しない。
   */
  /**
   * OS ドロップ（Windows HTML5 / Linux ネイティブ）の階層アップロード共通処理。
   * destDir と serverUrl は呼び出し元が await 前に捕捉して渡す（ユーザーが途中でフォルダ移動・置き場所切替しても意図した先へ送る）。
   * 安全方針:
   *  - 宛先一覧が未読・loading・error なら明示取得。失敗なら書込不可
   *  - 根レベルの同名（クロスタイプ含む）・名前エラーは中止
   *  - 根ファイルの上書きは確認
   *  - mkdir はいかなるエラーでも中止（409 exists も「マージ禁止」なので再開しない）
   *  - 各 write 前に置き場所スコープを確認
   */
  async function uploadOsDropEntries(entries: OsDropEntry[], destDir: string, serverUrl: string): Promise<void> {
    if (entries.length === 0) return;
    const why = writeBlock(destDir);
    if (why) {
      host.toast(why, 'error');
      return;
    }

    // 宛先一覧を取得（fetchDestEntries で キャッシュ / 明示取得を共通化）
    if (scopeSource.key() !== serverUrl) {
      host.toast(UPLOAD_SCOPE_CHANGED, 'error');
      return;
    }
    const fetchedEntries = await fetchDestEntries(destDir);
    if (scopeSource.key() !== serverUrl) {
      host.toast(UPLOAD_SCOPE_CHANGED, 'error');
      return;
    }
    if (!fetchedEntries) return; // エラーは fetchDestEntries がトースト通知済み
    const destEntries = fetchedEntries;

    // 上書きを取り消した根のファイル（その 1 件だけ送らない。ほかは続ける）
    const declined = new Set<string>();
    // 根レベル（rel に '/' を含まない）の事前確認
    const rootEntries = entries.filter((e) => !e.rel.includes('/'));
    for (const e of rootEntries) {
      const nameErr = rules.nameError(destDir, e.rel);
      if (nameErr) { host.toast(nameErr, 'error'); return; }
      const inSpecial = inSpecialDir(rules, destDir);
      if (inSpecial && e.dir) { host.toast(ruleTexts(rules).noSubfolder, 'error'); return; }
      const same = sameNameEntry(rules, destEntries, destDir, e.rel);
      if (same) {
        if (e.dir) {
          // フォルダ→同名あり: クロスタイプ問わずマージ禁止
          host.toast(`「${e.rel}」と同じ名前の${same.kind === 'dir' ? 'フォルダ' : 'ファイル'}があります。中止しました`, 'error');
          return;
        } else {
          // ファイル→同名フォルダ: 中止
          if (same.kind === 'dir') {
            host.toast(`「${e.rel}」と同じ名前のフォルダがあります。中止しました`, 'error');
            return;
          }
          // ファイル→同名ファイル: 上書き確認
          if (!(await host.confirm(overwriteConfirm(rules, childPath(destDir, same.name))))) {
            declined.add(e.rel);
            continue;
          }
          if (scopeSource.key() !== serverUrl) {
            host.toast(UPLOAD_SCOPE_CHANGED, 'error');
            return;
          }
        }
      }
    }

    if (declined.size > 0) host.toast(`上書きを取り消した ${declined.size} 件は送っていません`);
    // 逐次処理（OsDropEntry は親先の順に並んでいる）
    for (const e of entries) {
      if (declined.has(e.rel)) continue;
      if (scopeSource.key() !== serverUrl) {
        host.toast(UPLOAD_SCOPE_CHANGED, 'error');
        return;
      }
      const path = childPath(destDir, e.rel);
      if (e.dir) {
        try {
          await api.mkdir(path);
          dirIndex.invalidate(path);
        } catch (err) {
          // 409 exists を含むすべてのエラーで中断（マージ禁止・再開禁止）
          host.toast(`フォルダ「${e.rel}」を作れませんでした: ${host.errorText(err)}`, 'error');
          return;
        }
      } else {
        try {
          const blob = await e.read();
          if (scopeSource.key() !== serverUrl) {
            host.toast(UPLOAD_SCOPE_CHANGED, 'error');
            return;
          }
          await api.write(path, blob);
          dirIndex.invalidate(path);
        } catch (err) {
          host.toast(`「${e.rel}」を送れませんでした: ${host.errorText(err)}`, 'error');
          // ファイルの失敗は続ける（並行他ファイルへの影響なし）
        }
      }
    }
  }

  function bodyDragOver(ev: DragEvent): void {
    if (isInternalDrag(ev) && dragItems) {
      ev.preventDefault();
      ev.dataTransfer!.dropEffect = ev.ctrlKey ? 'copy' : 'move';
      dragTarget = '';
      return;
    }
    if (isExternalFileDrag(ev)) {
      ev.preventDefault();
      ev.dataTransfer!.dropEffect = 'copy';
    }
  }

  function bodyDragLeave(ev: DragEvent): void {
    // body から出たとき（フォルダ項目経由の dragLeave は stopPropagation で届かない）
    if (dragTarget === '') dragTarget = null;
  }

  async function bodyDrop(ev: DragEvent): Promise<void> {
    if (isInternalDrag(ev)) {
      const items = dragItems;
      dragItems = null;
      dragTarget = null;
      if (!items) return;
      ev.preventDefault();
      ev.stopPropagation();
      const op: TransferOp = ev.ctrlKey ? 'copy' : 'move';
      await performInternalTransfer(op, items, fileExplorer.dir);
      return;
    }
    if (isExternalFileDrag(ev)) {
      await bodyExternalDrop(ev);
    }
  }

  /** 新しいファイル（asDir なら、新しいフォルダ）の入力を開く */
  function openMkdir(asDir = false): void {
    mkdirAsDir = asDir;
    mkdirName = '';
    mkdirError = null;
    mkdirOpen = true;
  }

  async function submitMkdir(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (mkdirBusy) return;
    const dir = fileExplorer.dir;
    // 末尾が / か \ なら、フォルダを作る（それ以外は、空のファイル）
    const typed = mkdirName.trim();
    const isDir = mkdirAsDir || /[/\\]$/.test(typed);
    const name = isDir ? typed.replace(/[/\\]+$/, '').trim() : typed;
    const blocked = writeBlock(dir);
    if (blocked) {
      mkdirError = blocked;
      return;
    }
    // 特別なフォルダの中のフォルダは、ここでは断らない（置き場所の側が断る。disnans の WebDAV は 403 を返す）。失敗は、下で理由を出す
    const bad = rules.nameError(dir, name);
    if (bad) {
      mkdirError = bad;
      return;
    }
    // write は同名を黙って上書きするので、先に同名がないか確かめる（フォルダも、置き場所ごとの違いに頼らない）
    const st = dirIndex.state(dir);
    if (st?.kind === 'ok' && sameNameEntry(rules, st.entries, dir, name)) {
      mkdirError = '同じ名前のファイル・フォルダがあります';
      return;
    }
    const path = childPath(dir, name);
    mkdirBusy = true;
    try {
      if (isDir) await api.mkdir(path);
      else await api.write(path, '');
      if (explorer.caps.trash && explorer.caps.restore) explorerHistory.push(createEntry(api, path, isDir ? 'dir' : 'file', (p) => dirIndex.invalidate(p)));
      dirIndex.invalidate(path);
      mkdirOpen = false;
    } catch (err) {
      mkdirError = host.errorText(err);
    } finally {
      mkdirBusy = false;
    }
  }
</script>

<svelte:window onkeydown={(ev) => { searchWindowKey(ev); escapeKey(ev); explorerKey(ev); }} />

<div class="file-explorer" class:file-explorer-wait={waitCursor} class:file-explorer-name-fixed={colWidths.name !== undefined} role="region" aria-label="ファイルエクスプローラー" style={colStyle}
  ondragenter={explorerDragEnter}
  ondragleave={explorerDragLeave}
>
  <!-- 上端: 部品（戻る・進む・上へ・パス・選んだ項目の操作・検索など。並びと出す／出さないは、利用者が決める）と、右端の ≡。
       パス欄は、残りの幅を使う。必ず 1 行。狭いときはパス欄を最小幅まで縮め、それでも入らない部品は、右から順に隠す（fitBar） -->
  <PanelBar class="file-explorer-bar">
    <span hidden use:fitBar></span>
    {#each headerIds as id (id)}
      {@render headerPart(id)}
    {/each}
    {#snippet actions()}
    <span class="file-explorer-popup">
      <IconButton label="メニュー" title="メニュー" active={menuOpen} onclick={() => (menuOpen = !menuOpen)}><MenuIcon size={18} /></IconButton>
      {#if menuOpen}
        <Menu class="file-explorer-popup-menu file-explorer-menu" label="{labels.root}の操作" onclose={() => (menuOpen = false)}>
          {@render props.menu?.(() => (menuOpen = false))}
          {#if canCreate}
            <MenuItem icon={FilePlus} onclick={() => run(() => openMkdir())}>新しいファイル</MenuItem>
            <MenuItem icon={FolderPlus} onclick={() => run(() => openMkdir(true))}>新しいフォルダ</MenuItem>
          {/if}
          <!-- 表示・並び替えは、開いているフォルダの設定（各デバイスに保存。決めていない下のフォルダも従う） -->
          <p class="file-explorer-menu-head muted">表示</p>
          {#each ['details', 'grid'] as const as v (v)}
            <MenuItem onclick={() => run(() => setView(v))}>{VIEW_LABEL[v]}{#if dirView.view === v}<Check size={14} />{/if}</MenuItem>
          {/each}
          <p class="file-explorer-menu-head muted">並び替え</p>
          {@render sortItems(() => (menuOpen = false))}
        </Menu>
      {/if}
    </span>
    <input bind:this={fileInput} type="file" multiple hidden onchange={onPicked} />
    {/snippet}
  </PanelBar>

  {#if search.open}
    <div class="file-explorer-search" role="search">
      <SearchIcon size={16} />
      <input
        bind:this={searchInput}
        class="input file-explorer-search-input"
        type="search"
        aria-label="名前で検索"
        placeholder="名前で絞り込む"
        autocomplete="off"
        spellcheck="false"
        bind:value={search.text}
        oninput={onSearchInput}
        onkeydown={searchInputKey}
      />
      {#if search.available}
        <label class="file-explorer-search-sub"><input type="checkbox" bind:checked={search.recursive} onchange={onSearchInput} />サブフォルダも</label>
      {/if}
      <span class="file-explorer-search-status muted" role="status" aria-live="polite">{searchStatus}</span>
      <IconButton label="検索を閉じる" title="検索を閉じる" onclick={closeSearch}><X size={14} /></IconButton>
    </div>
  {/if}

  {#if uploads.length > 0}
    <ul class="file-explorer-uploads" aria-label="送信中のファイル">
      {#each uploads as u (u.key)}
        <li class="file-explorer-upload" class:file-explorer-upload-failed={u.error !== null}>
          <span class="file-explorer-upload-name">{u.name}</span>
          {#if u.error}
            <span class="file-explorer-upload-error" role="alert">{u.error}</span>
          {:else}
            <span class="file-explorer-upload-progress">{Math.round(u.ratio * 100)}%</span>
          {/if}
          <IconButton label="{u.name} を取り消す" onclick={() => dropUpload(u.key)}><X size={14} /></IconButton>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- 項目の外側（空きスペース）を押すと、選択を解除する（項目・バー・メニュー・パンくずは解除しない）。長押し・右クリックでメニュー -->
  <!-- 詳細は、狭い画面では横にはみ出させてスワイプで見る（「…」は右端に固定して常に見せる） -->
  <div
    bind:this={bodyEl}
    class="scroll file-explorer-body"
    class:file-explorer-body-banding={band !== null}
    class:file-explorer-body-details={dirView.view === 'details'}
    class:file-explorer-body-drag-target={dragTarget === ''}
    class:file-explorer-body-external-drop={externalDragOver}
    role="presentation"
    onclick={onbodyclick}
    onscroll={bandSync}
    onpointerdown={(ev) => {
      bodyPressStart(ev);
      bandStart(ev);
    }}
    onpointermove={(ev) => {
      bodyPressMove(ev);
      bandMove(ev);
    }}
    onpointerup={(ev) => {
      bodyPressEnd();
      bandEnd(ev);
    }}
    onpointercancel={(ev) => {
      bodyPressEnd();
      bandEnd(ev);
    }}
    ontouchend={bodyTouchEnd}
    oncontextmenu={bodyContextMenu}
    ondragover={bodyDragOver}
    ondragleave={bodyDragLeave}
    ondrop={(ev) => void bodyDrop(ev)}
  >
    {#if search.showingResults}
      {#if search.hits.length === 0}
        <p class="file-explorer-status muted">{search.running ? '検索しています…' : search.error ? '' : search.outcome?.partial ? '見つかる前に、止めました。' : '見つかりません。'}</p>
      {:else}
        <ul class="file-explorer-list file-explorer-hits" aria-label="検索結果">
          {#each search.hits as e (e.path)}
            <li class="file-explorer-hit">
              <button type="button" class="file-explorer-hit-row" onclick={() => activateHit(e)}>
                {#if e.kind === 'dir'}<Folder size={18} />{:else}<FileIcon size={18} />{/if}
                <span class="file-explorer-hit-name">{e.name}</span>
                <span class="file-explorer-hit-place muted">{hitPlace(e)}</span>
              </button>
              <IconButton label="{e.name} のある場所を開く" title="場所を開く" onclick={() => void revealHit(e)}><FolderSearch size={16} /></IconButton>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if listing === undefined || listing.kind === 'loading'}
      <p class="file-explorer-status muted">読み込み中…</p>
    {:else if listing.kind === 'missing'}
      <p class="file-explorer-status muted">このフォルダは見つかりません。</p>
      <div class="file-explorer-retry"><Button onclick={() => fileExplorer.open('')}>{#snippet children()}{labels.root}へ戻る{/snippet}</Button></div>
    {:else if listing.kind === 'error'}
      <p class="file-explorer-status file-explorer-error" role="alert">読み込めませんでした: {listing.message}</p>
      <div class="file-explorer-retry"><Button onclick={() => fileExplorer.reload()}>{#snippet children()}再読み込み{/snippet}</Button></div>
    {:else if listing.entries.size === 0}
      <p class="file-explorer-status muted">このフォルダには、まだ何もありません。</p>
    {:else}
      {@const sorted = shownEntries}
      {#if dirView.view === 'details'}
        <div class="file-explorer-columns" role="row">
          {#snippet head(key: SortKey, label: string)}
            <!-- 見出しを押すと、その列で並べ替える（今の並びの列には、向きの矢印） -->
            <button type="button" class="file-explorer-col-sort" class:file-explorer-col-sorted={dirView.sortKey === key} title="{label}で並べ替え" onclick={() => sortBy(key)}>
              <span class="file-explorer-col-label">{label}</span>{#if dirView.sortKey === key}{#if dirView.sortOrder === 'asc'}<ArrowUpIcon size={12} aria-label="昇順" />{:else}<ArrowDownIcon size={12} aria-label="降順" />{/if}{/if}
            </button>
          {/snippet}
          {#snippet grip(key: ColumnKey)}
            <!-- 列の右の境目（つまんで動かすと、幅が変わる。ダブルクリックで既定の幅） -->
            <span class="file-explorer-col-grip" role="presentation" onpointerdown={(ev) => startColResize(ev, key)} onpointermove={moveColResize} onpointerup={endColResize} onpointercancel={endColResize} ondblclick={() => resetColWidth(key)}></span>
          {/snippet}
          <span class="file-explorer-col-name">{@render head('name', '名前')}{@render grip('name')}</span>
          <span class="file-explorer-col-kind">{@render head('kind', '種類')}{@render grip('kind')}</span>
          <span class="file-explorer-col-size">{@render head('size', 'サイズ')}{@render grip('size')}</span>
          <span class="file-explorer-col-date">{@render head('modified', '更新日時')}{@render grip('modified')}</span>
          {#if hasCreated}<span class="file-explorer-col-date file-explorer-col-created">{@render head('created', '作成日時')}{@render grip('created')}</span>{/if}
          {#if !explorerSelection.desktop}<span class="file-explorer-col-actions"></span>{/if}
        </div>
      {/if}
      {#if sorted.length === 0}
        <p class="file-explorer-status muted">「{search.text.trim()}」を含む項目は、このフォルダにありません。</p>
      {/if}
      <ul class="file-explorer-list file-explorer-view-{dirView.view}">
        {#each sorted as e (e.path)}
          {@const action = entryAction(e, host.viewerKind)}
          {@const iconAction = e.iconKind === 'dir' ? 'enter' : action}
          {@const thumb = dirView.view === 'grid' ? urls.thumbUrl(e) : null}
          {@const pdf = dirView.view === 'grid' ? urls.pdfSource(e) : null}
          {@const renaming = renamingPath === e.path}
          {@const look = props.entryStyle?.(e) ?? null}
          <li
            class="file-explorer-item"
            data-path={e.path}
            style:--entry-color={look?.color}
            style:opacity={look?.opacity}
            class:file-explorer-item-cut={explorerBuffer.isCut(e.path)}
            class:file-explorer-item-selected={explorerSelection.has(e.path)}
            class:file-explorer-item-cursor={explorerSelection.desktop && cursorPath === e.path}
            class:file-explorer-item-drag-target={e.kind === 'dir' && dragTarget === e.path}
            draggable={(!renamingPath || renamingPath !== e.path) && !touchPointer}
            onpointerdown={(ev) => pressStart(ev, e.path)}
            onpointermove={pressMove}
            onpointerup={() => {
              touchDragEnd();
              pressEnd('pointerup');
            }}
            onpointerleave={() => pressEnd('pointerleave')}
            onpointercancel={() => {
              touchDragEnd();
              pressEnd('pointercancel');
            }}
            oncontextmenu={(ev) => rowContextMenu(ev, e)}
            ondragstart={(ev) => startItemDrag(ev, e)}
            ondragend={endItemDrag}
            ondragover={e.kind === 'dir' ? (ev) => folderDragOver(ev, e.path) : undefined}
            ondragleave={e.kind === 'dir' ? () => folderDragLeave(e.path) : undefined}
            ondrop={e.kind === 'dir' ? (ev) => void folderDrop(ev, e.path) : undefined}
          >
            {#snippet name()}
              {#if renaming}
                <span class="file-explorer-name file-explorer-name-editing">
                  <!-- 長い名前は折り返して縦に伸ばす（textarea。Enter は確定なので改行は入らない） -->
                  <textarea
                    class="file-explorer-rename"
                    aria-label="新しい名前"
                    aria-invalid={renameError !== null}
                    rows="1"
                    bind:value={renameTo}
                    disabled={renameBusy}
                    use:focusName
                    oninput={(ev) => fitName(ev.currentTarget)}
                    onkeydown={(ev) => renameKey(ev, e.path)}
                    onblur={() => void commitRename(e.path)}
                  ></textarea>
                  {#if renameError}
                    <span class="file-explorer-rename-error" role="alert">{renameError}</span>
                  {/if}
                </span>
              {:else}
                <!-- 名前の文字を押すと書き換える（文字の外の行は、押すと開く） -->
                <span class="file-explorer-name"><span class="file-explorer-name-text">{#if e.kind === 'file' && splitExt(e.name)[1]}<span class="file-explorer-name-stem">{splitExt(e.name)[0]}</span><span class="file-explorer-name-ext">{splitExt(e.name)[1]}</span>{:else}{e.name}{/if}</span></span>
              {/if}
            {/snippet}
            {#snippet row()}
              {#if dirView.view === 'grid'}
                <span class="file-explorer-thumb" class:file-explorer-thumb-alpha={thumb && isSvgName(e.name, e.mime)}>
                  {#if thumb}
                    <img src={thumb} alt="" loading="lazy" decoding="async" />
                  {:else if pdf && PdfThumb}
                    <PdfThumb url={pdf.url} key={pdf.key} />
                  {:else}{@render glyph(look, iconAction, 64)}{/if}
                </span>
                {@render name()}
              {:else}
                <!-- 詳細（選んでいるかは、行の背景の色で分かる。チェックの印は出さない） -->
                <span class="file-explorer-icon">
                  {@render glyph(look, iconAction, 18)}
                </span>
                {@render name()}
                <span class="file-explorer-col-kind">{kindText(e)}</span>
                <span class="file-explorer-col-size">{sizeCell(e)}</span>
                <span class="file-explorer-col-date">{formatStamp(e.modified, now)}</span>
                {#if hasCreated}<span class="file-explorer-col-date file-explorer-col-created">{e.created ? formatStamp(e.created, now) : ''}</span>{/if}
              {/if}
            {/snippet}
            {#if renaming}
              <!-- 書き換え中は、入力欄を入れるため押せる行（button・a）にしない -->
              <div class="file-explorer-row">{@render row()}</div>
            {:else}
              <!-- 行の要素は、選択モードに入っても作り直さない（長押しの指の下の要素が消えると、ブラウザが指の操作を取り消し、なぞりでの範囲の選択が途切れる）。
                   ファイルは <a>、ほかは <button>。選択モード（タッチの長押し・PC の常時）の間は、押すと選ぶ・外す（開くのは PC のダブルクリック・Enter）。
                   選択モードの <a> は、リンクにしない（href を付けない） -->
              {@const sel = explorerSelection.active}
              {@const link = action === 'file'}
              <svelte:element
                this={link ? 'a' : 'button'}
                class="file-explorer-row"
                type={link ? undefined : 'button'}
                role={link && sel ? 'button' : undefined}
                tabindex={link && sel ? 0 : undefined}
                href={link && !sel ? urls.href(e) : undefined}
                download={link && !sel ? e.name : undefined}
                target={link && !sel ? '_blank' : undefined}
                rel={link && !sel ? 'noopener' : undefined}
                aria-pressed={sel ? explorerSelection.has(e.path) : undefined}
                data-drop-dir={(sel ? explorerSelection.desktop && e.kind === 'dir' : action === 'enter') ? e.path : undefined}
                ondblclick={sel && explorerSelection.desktop ? () => activateEntry(e) : undefined}
                onclick={(ev: MouseEvent) =>
                  rowClick(ev, e, () => {
                    if (sel) return;
                    if (action === 'enter') fileExplorer.open(e.path);
                    else if (link) host.download.intercept(ev, { url: urls.href(e), name: e.name });
                    else openViewer(e);
                  })}
                onkeydown={(ev: KeyboardEvent) => rowKey(ev, e)}
              >{@render row()}</svelte:element>
            {/if}
            <!-- 「…」（プロパティ）は、選択中も含めて常に見せる。PC は、右クリックのメニューにプロパティがあるので出さない -->
            {#if !explorerSelection.desktop}
              <EntryActions {explorer} entry={e} placement={dirView.view === 'grid' ? 'overlay' : 'inline'} />
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  <!-- 下端: 件数（選んでいるときは「N 件選択中」）。選んだ項目の操作は、上端の行 -->
  <footer class="file-explorer-footer">
    <span class="file-explorer-selection-count" role="status" aria-live="polite">{countLabel}</span>
  </footer>
</div>

<!-- 上端の行の部品 1 つ（ID は menuLayout.ts の HEADER_ITEMS）。選んだ項目の操作は、選ぶまで押せない（貼り付けは選ばなくても押せる） -->
{#snippet headerPart(id: string)}
  {#if id === 'back' || id === 'forward' || id === 'up' || id === 'hidden'}
    {@render props.headerItem?.(id)}
  {:else if id === 'path'}
    <!-- パス欄。パンくずのボタンは、押すとその場所へ（ドロップ先でもある）。▸ を押すと、その中のフォルダの一覧。
         ボタンでないところ（右の空き）を押すか Ctrl+L で、パスの文字を書き換えられる -->
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="file-explorer-path" class:file-explorer-path-editing={pathEditing} onclick={pathFieldClick}>
      {#if pathEditing}
        <input
          bind:this={pathInput}
          class="file-explorer-path-input"
          type="text"
          aria-label="パス"
          autocomplete="off"
          spellcheck="false"
          bind:value={pathText}
          onkeydown={pathKey}
          onblur={() => (pathEditing = false)}
        />
      {:else}
        <nav class="file-explorer-crumbs" class:file-explorer-crumbs-clipped={crumbsClipped} bind:this={crumbsEl} aria-label="場所">
          {@render crumbItem('', labels.root)}
          {#each crumbs as c (c.path)}
            {@render crumbItem(c.path, c.name)}
          {/each}
        </nav>
        <!-- 押しても何もないところ（押すと、パスの書き換えに入る）。狭くても、最低限は残す -->
        <span class="file-explorer-path-gap" aria-hidden="true"></span>
      {/if}
    </div>
  {:else if id === 'selectAll'}
    {#if listing?.kind === 'ok' && explorerSelection.showing}
      <IconButton label="すべて選ぶ" title="すべて選ぶ" onclick={() => explorerSelection.selectAll([...listing.entries.values()].map((e) => e.path))}><SquareCheck size={18} /></IconButton>
    {/if}
  {:else if id === 'copy'}
    <IconButton label="コピー" title={copyBlocked ?? selectionReason('コピー')} disabled={noneSelected || copyBlocked !== null} onclick={copySelected}><Copy size={18} /></IconButton>
  {:else if id === 'cut'}
    <IconButton label="切り取り" title={cutBlocked ?? selectionReason('切り取り')} disabled={noneSelected || cutBlocked !== null} onclick={cutSelected}><Scissors size={18} /></IconButton>
  {:else if id === 'paste'}
    <!-- 貼り付けは選ばなくても押せる（アプリ内でコピーしたもの、または OS のクリップボードの中身） -->
    <span class="file-explorer-paste" role="presentation" onpointerenter={showPastePreview} onpointerleave={hidePastePreview} onfocusin={showPastePreview} onfocusout={hidePastePreview}>
      <IconButton label="貼り付け" title={canPaste ? undefined : 'コピー・切り取りすると貼り付けられます'} disabled={!canPaste || pasting} onclick={() => { hidePastePreview(); void pasteAny(); }}><ClipboardPaste size={18} /></IconButton>
      {#if pastePreview}
        <div class="file-explorer-paste-preview" role="tooltip">
          {#if pastePreview.kind === 'items'}
            <p class="file-explorer-paste-head">{pastePreview.op === 'move' ? '移動' : 'コピー'}: {pastePreview.total} 件</p>
            <ul>
              {#each pastePreview.names as n (n)}<li>{n}</li>{/each}
              {#if pastePreview.total > pastePreview.names.length}<li class="muted">ほか {pastePreview.total - pastePreview.names.length} 件</li>{/if}
            </ul>
          {:else if pastePreview.kind === 'image'}
            <p class="file-explorer-paste-head">画像</p>
            <img src={pastePreview.url} alt="貼り付ける画像" />
          {:else if pastePreview.kind === 'text'}
            <p class="file-explorer-paste-head">テキスト</p>
            <pre>{pastePreview.text}{pastePreview.more ? '…' : ''}</pre>
          {:else}
            <p class="muted">貼り付けられるものがありません</p>
          {/if}
        </div>
      {/if}
    </span>
  {:else if id === 'delete'}
    {#if allWhole}
      <IconButton label="元へ戻す" title={selectionReason('元へ戻す')} disabled={noneSelected || actionBusy} onclick={() => void restoreSelected()}><RotateCcw size={18} /></IconButton>
      <IconButton class="file-explorer-danger" label="完全削除" title={deleteBlocked ?? selectionReason('完全削除')} disabled={noneSelected || deleteBlocked !== null || actionBusy} onclick={removeSelected}><Trash size={18} /></IconButton>
    {:else}
      <IconButton class="file-explorer-danger" label="削除" title={deleteBlocked ?? selectionReason('削除')} disabled={noneSelected || deleteBlocked !== null || actionBusy} onclick={removeSelected}><Trash size={18} /></IconButton>
    {/if}
  {:else if id === 'search'}
    <IconButton label="検索" title="検索（Ctrl+F）" active={search.open} aria-pressed={search.open} onclick={() => (search.open ? closeSearch() : openSearch())}><SearchIcon size={18} /></IconButton>
  {:else if id === 'sort'}
    <!-- 並び替え（≡ の中の「並び替え」と同じ。開いているフォルダの設定） -->
    <span class="file-explorer-popup">
      <IconButton label="並び替え" title="並び替え" active={sortMenuOpen} aria-haspopup="menu" aria-expanded={sortMenuOpen} onclick={() => (sortMenuOpen = !sortMenuOpen)}><ArrowUpDown size={18} /></IconButton>
      {#if sortMenuOpen}
        <Menu class="file-explorer-popup-menu file-explorer-menu" label="並び替え" onclose={() => (sortMenuOpen = false)}>
          {@render sortItems(() => (sortMenuOpen = false))}
        </Menu>
      {/if}
    </span>
  {:else if id === 'newFile'}
    <IconButton label="新しいファイル" title="新しいファイル" disabled={!canCreate} onclick={() => openMkdir()}><FilePlus size={18} /></IconButton>
  {:else if id === 'newFolder'}
    <IconButton label="新しいフォルダ" title="新しいフォルダ" disabled={!canCreate} onclick={() => openMkdir(true)}><FolderPlus size={18} /></IconButton>
  {/if}
{/snippet}

<!-- 並び替えの項目（≡ のメニューと、上端の行の「並び替え」ボタンの両方で使う。選んだあと、close でメニューを閉じる） -->
{#snippet sortItems(close: () => void)}
  {#each sortKeys as k (k)}
    <MenuItem onclick={() => { close(); explorerView.setSort(fileExplorer.dir, k, dirView.sortOrder); }}>{KEY_LABEL[k]}{#if dirView.sortKey === k}<Check size={14} />{/if}</MenuItem>
  {/each}
  <MenuItem onclick={() => { close(); explorerView.setSort(fileExplorer.dir, dirView.sortKey, 'asc'); }}>昇順{#if dirView.sortOrder === 'asc'}<Check size={14} />{/if}</MenuItem>
  <MenuItem onclick={() => { close(); explorerView.setSort(fileExplorer.dir, dirView.sortKey, 'desc'); }}>降順{#if dirView.sortOrder === 'desc'}<Check size={14} />{/if}</MenuItem>
{/snippet}

<!-- パンくず 1 つ（名前のボタンと、その中のフォルダの一覧を開く ▸） -->
{#snippet crumbItem(path: string, name: string)}
  <button type="button" class="file-explorer-crumb" class:file-explorer-crumb-current={path === fileExplorer.dir} data-drop-dir={path} class:file-explorer-crumb-drag-over={dragTarget === '__crumb__' + path}
    onclick={() => fileExplorer.open(path)}
    ondragover={(ev) => crumbDragOver(ev, path)}
    ondragleave={() => crumbDragLeave(path)}
    ondrop={(ev) => void crumbDrop(ev, path)}>{name}</button>
  {#if inTrash(path)}
    <ChevronRight size={12} class="file-explorer-crumb-arrow" />
  {:else}
    <button type="button" class="file-explorer-crumb-chevron" aria-label="{name}の中のフォルダ" aria-haspopup="menu" aria-expanded={crumbMenu?.path === path} onclick={(ev) => openCrumbMenu(ev, path)}><ChevronRight size={12} /></button>
  {/if}
{/snippet}

<!-- 項目のアイコン（本体が決めた見た目があればそれ。無ければ、種類のアイコン） -->
{#snippet glyph(look: EntryStyle | null, kind: string, size: number)}
  <EntryGlyph {look} {kind} {size} />
{/snippet}

{#if bandBox}
  <div class="file-explorer-band" style:left="{bandBox.left}px" style:top="{bandBox.top}px" style:width="{bandBox.width}px" style:height="{bandBox.height}px"></div>
{/if}

<!-- 長押し・右クリックのメニュー（押したところに出す）。項目の上のマウスの右クリックは項目のメニュー、空きスペースはフォルダのメニュー -->
{#if ctx}
  <div class="file-explorer-context" style:left="{ctx.x}px" style:top="{ctx.y}px">
    {#if ctx.item}
      {@const only = selectedEntries.length === 1 ? selectedEntries[0] : null}
      {@const order = applyMenuLayout(ENTRY_IDS, props.menuLayout?.entry)}
      {#if order.length > 0}
      <Menu class="file-explorer-context-menu file-explorer-menu" label="選んだ項目の操作" onclose={() => (ctx = null)}>
        {#each order as id (id)}
          {#if id === 'copy'}
            {#if !allWhole}
              <MenuItem icon={Copy} disabled={copyBlocked !== null} onclick={() => runCtx(copySelected)}>コピー</MenuItem>
            {/if}
          {:else if id === 'cut'}
            <MenuItem icon={Scissors} disabled={cutBlocked !== null} onclick={() => runCtx(cutSelected)}>切り取り</MenuItem>
          {:else if id === 'pasteInto'}
            {#if only && only.kind === 'dir' && !only.trash && canPaste && writeBlock(only.path) === null}
              <MenuItem icon={ClipboardPaste} disabled={pasting} onclick={() => runCtx(() => void pasteAny(only.path))}>ここへ貼り付け</MenuItem>
            {/if}
          {:else if id === 'rename'}
            {#if only && !allWhole && !renameBlock(only)}
              <MenuItem icon={Pencil} onclick={() => runCtx(() => setTimeout(() => startRename(only), 0))}>名前の変更</MenuItem>
            {/if}
          {:else if id === 'restore'}
            {#if allWhole}
              <MenuItem icon={RotateCcw} disabled={actionBusy} onclick={() => runCtx(() => void restoreSelected())}>元へ戻す</MenuItem>
            {/if}
          {:else if id === 'delete'}
            {#if allWhole}
              <MenuItem icon={Trash} danger disabled={deleteBlocked !== null || actionBusy} onclick={() => runCtx(removeSelected)}>完全削除</MenuItem>
            {:else}
              <MenuItem icon={Trash} danger disabled={deleteBlocked !== null || actionBusy} onclick={() => runCtx(removeSelected)}>削除</MenuItem>
            {/if}
          {:else if id === 'properties'}
            {#if only}
              <MenuItem icon={Info} onclick={() => runCtx(() => (propsEntry = only))}>プロパティ</MenuItem>
            {/if}
          {:else if id === 'app'}
            {#if only}
              {@render props.entryMenu?.(only, () => (ctx = null))}
            {/if}
          {/if}
        {/each}
      </Menu>
      {/if}
    {:else}
      {@const order = applyMenuLayout(SPACE_IDS, props.menuLayout?.space)}
      {#if order.length > 0}
      <Menu class="file-explorer-context-menu file-explorer-menu" label="このフォルダの操作" onclose={() => (ctx = null)}>
        {#each order as id (id)}
          {#if id === 'upload'}
            {#if labels.upload}
              <MenuItem icon={Upload} onclick={() => runCtx(() => fileInput?.click())}>{labels.upload}</MenuItem>
            {/if}
          {:else if id === 'newFile'}
            {#if canCreate}
              <MenuItem icon={FilePlus} onclick={() => runCtx(openMkdir)}>新しいファイル</MenuItem>
            {/if}
          {:else if id === 'paste'}
            {#if canPaste}
              <MenuItem icon={ClipboardPaste} disabled={pasting} onclick={() => runCtx(() => void pasteAny())}>貼り付け</MenuItem>
            {/if}
          {/if}
        {/each}
      </Menu>
      {/if}
    {/if}
  </div>
{/if}

<!-- パンくずの ▸ を押したときの、その中のフォルダの一覧（選ぶと、そのフォルダへ移る。今のパスにあるものには ✓） -->
{#if crumbMenu}
  {@const st = dirIndex.state(crumbMenu.path)}
  {@const here = crumbNext(crumbMenu.path)}
  <div class="file-explorer-context" style:left="{crumbMenu.x}px" style:top="{crumbMenu.y}px">
    <Menu class="file-explorer-context-menu file-explorer-menu file-explorer-crumb-menu" label="フォルダの一覧" onclose={() => (crumbMenu = null)}>
      {#if st?.kind === 'ok'}
        {@const dirs = sortEntries([...st.entries.values()].filter((x) => x.kind === 'dir'))}
        {#each dirs as d (d.path)}
          <MenuItem icon={Folder} onclick={() => { crumbMenu = null; fileExplorer.open(d.path); }}>{d.name}{#if d.path === here}<Check size={14} />{/if}</MenuItem>
        {:else}
          <p class="file-explorer-menu-head muted">フォルダはありません</p>
        {/each}
      {:else if st?.kind === 'error'}
        <p class="file-explorer-menu-head muted">読み込めませんでした</p>
      {:else if st?.kind === 'missing'}
        <p class="file-explorer-menu-head muted">フォルダが見つかりません</p>
      {:else}
        <p class="file-explorer-menu-head muted">読み込み中…</p>
      {/if}
    </Menu>
  </div>
{/if}

{#if propsEntry}
  <FileProperties {explorer} entry={propsEntry} onclose={() => (propsEntry = null)} />
{/if}

{#if mkdirOpen}
  <Modal title={mkdirAsDir ? '新しいフォルダ' : '新しいファイル'} onclose={() => (mkdirOpen = false)} width={380}>
    <form class="file-explorer-mkdir" onsubmit={submitMkdir}>
      <TextInput bind:value={mkdirName} aria-label={mkdirAsDir ? 'フォルダの名前' : 'ファイルの名前'} />
      {#if !mkdirAsDir}<p class="file-explorer-mkdir-hint">末尾を <code>/</code> にするとフォルダを作成します</p>{/if}
      {#if mkdirError}<p class="file-explorer-mkdir-error" role="alert">{mkdirError}</p>{/if}
      <div class="modal-actions">
        <Button onclick={() => (mkdirOpen = false)}>キャンセル</Button>
        <Button type="submit" variant="primary" disabled={mkdirBusy}>作成</Button>
      </div>
    </form>
  </Modal>
{/if}

<style>
  .file-explorer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--bg);
  }
  /* パンくず: 上端の下の行。場所を示すだけ。小さく、背景を変えて区別する */
  .file-explorer-search {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
  }
  .file-explorer-search-input {
    flex: 1;
    min-width: 0;
  }
  .file-explorer-search-sub {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    white-space: nowrap;
    font-size: var(--fs-base);
  }
  .file-explorer-search-status {
    font-size: var(--fs-sm, 0.85em);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 40%;
  }
  .file-explorer-hits {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .file-explorer-hit {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
  }
  .file-explorer-hit-row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-4);
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
  }
  .file-explorer-hit-name {
    flex: none;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-explorer-hit-place {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--fs-sm, 0.85em);
  }
  /* 貼り付けが終わるまで（0.5 秒を超えたら）、どこに乗せても「待つ」カーソル */
  .file-explorer-wait,
  .file-explorer-wait :global(*) {
    cursor: wait !important;
  }
  /* 上端の行: 余白を詰める（左 8px・上 6px（Android はステータスバーの分を足す）・部品の間はあけない） */
  .file-explorer > :global(.file-explorer-bar.panel-bar) {
    gap: 0;
    padding-top: calc(env(safe-area-inset-top) + 6px);
    padding-left: 8px;
  }
  /* 部品が並びきらないときは、折り返す（パス欄は、残りの幅を使い、最小幅は残す）。折り返した部品は fitBar が隠す（必ず 1 行） */
  .file-explorer > :global(.file-explorer-bar .panel-bar-main) {
    gap: 0;
    flex-wrap: wrap;
  }
  .file-explorer > :global(.file-explorer-bar .panel-bar-main > [data-clipped]) {
    display: none !important;
  }
  /* パス欄: 入力欄のような見た目（押すと書き換えられる）。パンくずは、はみ出したら横にスクロールする */
  .file-explorer-path {
    flex: 1 1 9em;
    min-width: 9em;
    display: flex;
    align-items: center;
    min-height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    cursor: text;
  }
  .file-explorer-path:hover {
    border-color: var(--border-strong, var(--text-muted));
  }
  .file-explorer-path-editing {
    border-color: var(--accent);
  }
  .file-explorer-path-input {
    flex: 1;
    min-width: 0;
    padding: var(--space-1) var(--space-2);
    border: none;
    outline: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: var(--fs-sm);
  }
  /* パンくず: 幅に収まらないときは、左（上の階層）から隠れる（▸ は、縮めない）。いちばん右（今のフォルダ）だけは、長ければ「…」で縮める */
  .file-explorer-crumbs {
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0;
    overflow: hidden;
    white-space: nowrap;
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .file-explorer-crumbs-clipped {
    mask-image: linear-gradient(to right, transparent 0, #000 1.5em);
  }
  /* 押しても何もないところ（パスの書き換えに入る）。右に、最低限これだけは残す */
  .file-explorer-path-gap {
    flex: 1 0 1.5em;
    align-self: stretch;
  }
  .file-explorer-crumbs > :global(.file-explorer-crumb-arrow) {
    flex: none;
  }
  .file-explorer-crumb-chevron {
    flex: none;
    display: inline-flex;
    align-items: center;
    padding: var(--space-2) var(--space-1);
    border: none;
    border-radius: var(--radius-xs);
    background: none;
    color: inherit;
  }
  .file-explorer-crumb-chevron:hover,
  .file-explorer-crumb-chevron[aria-expanded='true'] {
    background: var(--surface-3, var(--surface));
    color: var(--text);
  }
  /* パンくずの ▸ の一覧は、多ければ縦にスクロールする */
  .file-explorer-context > :global(.file-explorer-crumb-menu) {
    max-height: min(60vh, 24em);
    overflow-y: auto;
  }
  /* 下端: 件数 */
  .file-explorer-footer {
    flex: none;
    display: flex;
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--border);
    background: var(--surface-2);
  }
  .file-explorer-crumb {
    flex: none;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-xs);
    background: none;
    color: inherit;
    font-size: inherit;
  }
  /* 今のフォルダ。長ければここだけが縮む */
  .file-explorer-crumb-current {
    flex: 0 1 auto;
    min-width: 3em;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--text);
    font-weight: var(--fw-semibold);
  }
  /* 画面の文字は、選んでコピーできなくてよい（入力欄の中は、これまでどおり） */
  .file-explorer {
    user-select: none;
    -webkit-user-select: none;
  }
  .file-explorer :global(input),
  .file-explorer :global(textarea) {
    user-select: text;
    -webkit-user-select: text;
  }
  .file-explorer-body {
    flex: 1;
    min-height: 0;
    padding: var(--space-4);
  }
  /* タッチ: 項目の長押しは、文字の選択（ブラウザが指の操作を取り上げ、なぞりでの範囲の選択が途切れる）にしない。名前の書き換えの入力欄は、そのまま */
  @media (pointer: coarse) {
    .file-explorer-item {
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
    }
    .file-explorer-item .file-explorer-rename {
      user-select: text;
      -webkit-user-select: text;
    }
  }
  /* 囲んで選んでいる間は、文字を選択させない */
  .file-explorer-body-banding {
    user-select: none;
  }
  /* マウスで囲んでいる四角（画面の座標。押したものには触らない） */
  .file-explorer-band {
    position: fixed;
    z-index: 1;
    pointer-events: none;
    border: 1px solid var(--accent);
    background: color-mix(in oklch, var(--accent) 18%, transparent);
  }
  /* 詳細: 狭い画面では、列を縮めずに横へはみ出させ、スワイプで見る（右の余白は無くし、右端に固定した「…」の外に列が覗かないようにする） */
  .file-explorer-body-details {
    overflow-x: auto;
    padding-right: 0;
  }
  .file-explorer-status {
    margin: var(--space-8) var(--space-7);
    text-align: center;
  }
  .file-explorer-error {
    color: var(--danger);
    overflow-wrap: anywhere;
  }
  .file-explorer-retry {
    display: flex;
    justify-content: center;
  }
  .file-explorer-list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .file-explorer-uploads {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-3) var(--space-4);
    list-style: none;
    border-bottom: 1px solid var(--border);
    flex: none;
    font-size: var(--fs-sm);
  }
  .file-explorer-upload {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .file-explorer-upload-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-explorer-upload-progress,
  .file-explorer-upload-error {
    flex: none;
    color: var(--text-muted);
  }
  .file-explorer-upload-failed .file-explorer-upload-error {
    color: var(--danger);
    overflow-wrap: anywhere;
  }
  .file-explorer-mkdir {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }
  .file-explorer-mkdir-hint {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .file-explorer-mkdir-error {
    margin: 0;
    color: var(--danger);
    font-size: var(--fs-sm);
  }
  .file-explorer-item {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }
  /* 切り取りの途中（貼り付けるまで残る）。消えたわけではないので薄くする */
  .file-explorer-item-cut {
    opacity: 0.5;
  }
  .file-explorer-selection-count {
    font-size: var(--fs-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }
  /* 選んだ項目は、行全体（「…」を含む）を明るい水色にする。「…」は詳細では右端に固定して下が透けないよう、色は不透明 */
  /* 貼り付けのボタンに乗せたときの、貼る内容の一覧 */
  .file-explorer-paste {
    position: relative;
    display: inline-flex;
  }
  .file-explorer-paste-preview {
    position: absolute;
    top: calc(100% + var(--space-2));
    left: 0;
    z-index: 20;
    width: max-content;
    min-width: 160px;
    max-width: min(320px, 80vw);
    max-height: 280px;
    overflow: hidden;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    box-shadow: 0 4px 16px rgb(0 0 0 / 0.3);
    font-size: var(--fs-sm);
    pointer-events: none;
  }
  .file-explorer-paste-preview p,
  .file-explorer-paste-preview ul,
  .file-explorer-paste-preview pre {
    margin: 0;
  }
  .file-explorer-paste-head {
    margin-bottom: var(--space-2) !important;
    color: var(--text-muted);
  }
  .file-explorer-paste-preview ul {
    padding-left: var(--space-5);
  }
  .file-explorer-paste-preview li {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-explorer-paste-preview img {
    display: block;
    max-width: 100%;
    max-height: 220px;
    object-fit: contain;
  }
  .file-explorer-paste-preview pre {
    max-height: 220px;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: inherit;
  }
  /* 削除のボタン（押せるときだけ、危険の色） */
  :global(.icon-btn.file-explorer-danger:not(:disabled)) {
    color: var(--danger);
  }
  .file-explorer-item {
    --file-explorer-item-bg: var(--bg);
    border-radius: var(--radius-sm);
  }
  .file-explorer-item-selected {
    --file-explorer-item-bg: color-mix(in oklch, var(--accent) 18%, var(--bg));
    background: var(--file-explorer-item-bg);
  }
  /* 詳細では「…」が右端に固定され下が透けないので、選んだ行の色を「…」にも付ける（アイコン表示は付けない） */
  .file-explorer-view-details .file-explorer-item-selected > :global(.explorer-entry-actions .explorer-entry-menu-button) {
    background: var(--file-explorer-item-bg);
  }
  .file-explorer-popup {
    position: relative;
    display: inline-flex;
  }
  /* 空きスペースのメニュー: 押したところを基準にする（大きさ 0 の箱。メニューは下か、入らなければ上に出す） */
  .file-explorer-context {
    position: fixed;
    width: 0;
    height: 0;
    z-index: var(--z-menu);
  }
  .file-explorer-context > :global(.file-explorer-context-menu) {
    position: absolute;
    top: 0;
    left: 0;
    min-width: 12em;
    /* 項目の文字を折り返さない（本体が足す項目の名前が長くても） */
    width: max-content;
  }
  /* z-index は指定しない（design-system の .menu は --z-menu。ここで下げると外側の幕（-1）に覆われて項目が押せない） */
  .file-explorer-popup > :global(.file-explorer-popup-menu) {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 12em;
    /* 項目の文字を折り返さない（本体が足す項目の名前が長くても） */
    width: max-content;
    max-width: 90vw;
  }
  .file-explorer-menu-head {
    margin: var(--space-3) 0 0;
    padding: 0 var(--space-4);
    font-size: var(--fs-xs);
  }
  /* 詳細: 名前の列は残りの幅、ほかは決まった幅。全体の幅は最低 540px（狭いときは横にはみ出す）。
     見出しと行は文字の大きさが違うので、全体と名前の幅は px でそろえる */
  .file-explorer-columns,
  .file-explorer-view-details .file-explorer-item .file-explorer-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .file-explorer-columns,
  .file-explorer-view-details {
    min-width: 540px;
  }
  /* 名前の列の幅を決めたとき: 全体の幅は、列の幅の合計（広い画面では、右に余りが出る。狭ければ横にスクロール） */
  .file-explorer-name-fixed .file-explorer-columns,
  .file-explorer-name-fixed .file-explorer-view-details {
    width: max-content;
    min-width: 100%;
  }
  /* 下に項目 1 つ分の空き（押すと選択を解除できる場所） */
  .file-explorer-view-details {
    padding-bottom: calc(2 * var(--space-4) + 1.5em);
  }
  .file-explorer-view-details .file-explorer-name,
  .file-explorer-columns .file-explorer-col-name {
    min-width: 120px;
  }
  /* 名前の列の幅を決めたとき（見出しは、行のアイコン 18px と隙間の分も足して、行の名前とそろえる） */
  .file-explorer-name-fixed .file-explorer-view-details .file-explorer-name {
    flex: none;
    width: var(--col-name);
    min-width: 0;
  }
  .file-explorer-name-fixed .file-explorer-columns .file-explorer-col-name {
    flex: none;
    width: calc(var(--col-name) + 18px + var(--space-3));
    min-width: 0;
  }
  /* 「…」は、横にスワイプしても右端に残す */
  .file-explorer-view-details .file-explorer-item > :global(.explorer-entry-actions) {
    position: sticky;
    right: 0;
    background: var(--file-explorer-item-bg);
  }
  /* 見出しの「…」の列の空き（行の右の余白 + 隙間 + 「…」34px にそろえる） */
  .file-explorer-col-actions {
    flex: none;
    width: calc(var(--space-5) + var(--space-2) + 34px - var(--space-3));
  }
  /* 見出しは、縦にスクロールしても上端に残す（横は行と一緒に動く）。文字は選べない */
  .file-explorer-columns {
    position: sticky;
    top: calc(-1 * var(--space-4));
    z-index: 2;
    margin-top: calc(-1 * var(--space-4));
    padding: calc(var(--space-2) + var(--space-4)) 0 var(--space-2) var(--space-5);
    background: var(--bg);
    color: var(--text-muted);
    font-size: var(--fs-sm);
    border-bottom: 1px solid var(--border);
    user-select: none;
    -webkit-user-select: none;
  }
  .file-explorer-col-name {
    flex: 1;
    min-width: 0;
  }
  /* 列の文字は折り返さない。幅が足りなければ、はみ出た分は隠れる */
  .file-explorer-view-details .file-explorer-col-kind,
  .file-explorer-view-details .file-explorer-col-size,
  .file-explorer-view-details .file-explorer-col-date,
  .file-explorer-columns .file-explorer-col-kind,
  .file-explorer-columns .file-explorer-col-size,
  .file-explorer-columns .file-explorer-col-date {
    white-space: nowrap;
    overflow: hidden;
  }
  .file-explorer-view-details .file-explorer-col-kind {
    flex: none;
    width: var(--col-kind, 4.5em);
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .file-explorer-view-details .file-explorer-col-size {
    flex: none;
    width: var(--col-size, 5.5em);
    text-align: right;
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .file-explorer-view-details .file-explorer-col-date {
    flex: none;
    width: var(--col-modified, 8em);
    color: var(--text-muted);
    font-size: var(--fs-sm);
  }
  .file-explorer-columns .file-explorer-col-kind,
  .file-explorer-columns .file-explorer-col-size,
  .file-explorer-columns .file-explorer-col-date {
    flex: none;
  }
  .file-explorer-columns .file-explorer-col-kind {
    width: var(--col-kind, 4.5em);
  }
  .file-explorer-columns .file-explorer-col-size {
    width: var(--col-size, 5.5em);
    text-align: right;
  }
  .file-explorer-columns .file-explorer-col-date {
    width: var(--col-modified, 8em);
  }
  /* 作成日時の列は、決めていなければ、更新日時の列と同じ幅 */
  .file-explorer-view-details .file-explorer-col-created,
  .file-explorer-columns .file-explorer-col-created {
    width: var(--col-created, var(--col-modified, 8em));
  }
  /* 見出しの列の右の境目（つまむところ）。はみ出た分を隠す列でも切れないよう、列の右の端の内側に置く */
  .file-explorer-columns .file-explorer-col-name,
  .file-explorer-columns .file-explorer-col-kind,
  .file-explorer-columns .file-explorer-col-size,
  .file-explorer-columns .file-explorer-col-date {
    position: relative;
  }
  /* 見出しの文字は、押せる（その列で並べ替える）。右寄せの列は、文字を右に寄せる */
  .file-explorer-col-sort {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .file-explorer-col-sort:hover,
  .file-explorer-col-sorted {
    color: var(--text);
  }
  .file-explorer-col-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .file-explorer-columns .file-explorer-col-size {
    display: flex;
    justify-content: flex-end;
  }
  .file-explorer-col-grip {
    position: absolute;
    top: 0;
    bottom: 0;
    right: 0;
    width: 10px;
    cursor: col-resize;
    touch-action: none;
  }
  .file-explorer-col-grip::after {
    content: '';
    position: absolute;
    top: 2px;
    bottom: 2px;
    right: 1px;
    width: 2px;
    border-radius: 1px;
    background: transparent;
  }
  .file-explorer-col-grip:hover::after {
    background: var(--border);
  }
  /* アイコン（グリッド）: 並べ目。画像は正方形の縮小 */
  /* 項目の間と下に空き（押すと選択を解除できる場所）。下は項目 1 つ分（正方形の画像 + 名前）くらい。
     狭い画面は 2 列で項目が画面の半分ほどになるので、幅に合わせる（広い画面は 180px で止める） */
  .file-explorer-view-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: var(--space-6);
    padding-bottom: calc(min(50vw, 180px) + 2em);
  }
  /* マウスの画面（デスクトップ）は、広くても大きくしない（列の幅を固定して、余りは右に空ける） */
  @media (pointer: fine) {
    .file-explorer-view-grid {
      grid-template-columns: repeat(auto-fill, 104px);
      gap: var(--space-5);
      padding-bottom: calc(104px + 3em);
    }
  }
  .file-explorer-view-grid .file-explorer-item {
    position: relative;
    flex-direction: column;
    align-items: stretch;
    gap: 0;
  }
  .file-explorer-view-grid .file-explorer-row {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-4);
    padding: var(--space-2);
  }
  .file-explorer-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    border-radius: var(--radius-xs);
    color: var(--entry-color, var(--text-muted));
    overflow: hidden;
  }
  /* SVG は透ける（線の色は黒）ので、白と灰色の市松模様を敷く */
  .file-explorer-thumb-alpha {
    background-color: #fff;
    background-image: conic-gradient(#c8c8c8 25%, transparent 0 50%, #c8c8c8 0 75%, transparent 0);
    background-size: 16px 16px;
  }
  /* 画像は欠けないよう、全体を枠に収める（枠に地の色は付けない） */
  .file-explorer-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .file-explorer-view-grid .file-explorer-name {
    flex: none;
    text-align: center;
    font-size: var(--fs-sm);
  }

  .file-explorer-row {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    flex: 1;
    min-width: 0;
    padding: var(--space-4) var(--space-5);
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    text-align: left;
    text-decoration: none;
    font-size: var(--fs-base);
  }
  /* カーソル（フォーカスのある項目）の枠。選んだ項目の塗りとは別で、PC は、押した項目・矢印で移った項目にいつも付く（フォーカスは 1 つ） */
  .file-explorer-row:focus-visible,
  .file-explorer-item-cursor > .file-explorer-row {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }
  /* アイコン（詳細）。選択モードの印と同じ箱（18px）に入れ、置き換えても位置がずれないようにする */
  .file-explorer-icon {
    flex: none;
    display: flex;
    justify-content: center;
    width: 18px;
    color: var(--entry-color, var(--text-muted));
  }
  .file-explorer-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 名前の文字（押すと書き換える） */
  .file-explorer-name-text {
    display: inline-flex;
    max-width: 100%;
    vertical-align: bottom;
    cursor: text;
    color: var(--entry-color, inherit);
  }
  /* 収まらないときは、名前の本体だけを「…」で省略して、拡張子は残す（verylongfil….txt） */
  .file-explorer-name-stem {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .file-explorer-name-ext {
    flex: none;
    white-space: nowrap;
  }
  .file-explorer-name-editing {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    overflow: visible;
    white-space: normal;
  }
  .file-explorer-rename {
    width: 100%;
    min-width: 0;
    padding: var(--space-1) var(--space-3);
    border: 1px solid var(--accent);
    border-radius: var(--radius-xs);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    line-height: 1.4;
    resize: none;
    overflow: hidden;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* 枠（青）でフォーカスが分かるので、フォーカスの輪（白）は出さない */
  .file-explorer-rename:focus,
  .file-explorer-rename:focus-visible {
    outline: none;
  }
  .file-explorer-rename[aria-invalid='true'] {
    border-color: var(--danger);
  }
  .file-explorer-rename-error {
    font-size: var(--fs-xs);
    overflow-wrap: anywhere;
  }
  .file-explorer-rename-error {
    color: var(--danger);
  }
  @media (hover: hover) {
    .file-explorer-row:hover {
      background: var(--hover);
    }
  }
  /* 内部ドラッグ: フォルダ・パンくずのドロップターゲット（青い輪郭） */
  .file-explorer-item-drag-target {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-radius: var(--radius-sm);
  }
  .file-explorer-crumb.file-explorer-crumb-drag-over {
    background: color-mix(in oklch, var(--accent) 20%, var(--bg));
    outline: 2px solid var(--accent);
    outline-offset: -1px;
  }
  /* 現在フォルダ（body）がドロップ先のとき */
  .file-explorer-body.file-explorer-body-drag-target {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: var(--radius-sm);
  }
  /* 外部ファイルドロップ中のオーバーレイ（ドロップ可能を示す枠） */
  .file-explorer-body.file-explorer-body-external-drop {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
    border-radius: var(--radius-sm);
  }
  .file-explorer {
    position: relative;
  }
</style>
