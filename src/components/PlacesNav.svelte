<script lang="ts" module>
  /** 左の欄の 1 項目（ブックマーク・ドライブ・ネットワークの場所） */
  export type NavEntry = {
    key: string;
    label: string;
    title?: string;
    /** いま見ている場所か */
    current: boolean;
    /** つながらなかった理由（あれば、印を出す） */
    broken?: string | null;
    open: () => void;
    /** 新しいタブで開いて、そのタブへ移る */
    openTab: () => void;
    /** 新しいタブで開く（いまのタブに残る） */
    openTabStay?: () => void;
    openWindow?: () => void;
    /** ブックマークから外す（ブックマークだけ） */
    remove?: () => void;
    /** 設定を直す・外す（ネットワークの場所だけ） */
    edit?: () => void;
    /** 見た目のルールが決めた、アイコン・色・不透明度（ブックマークだけ。一覧のフォルダと同じ見た目） */
    look?: EntryStyle | null;
  };
</script>

<script lang="ts">
  import Plus from '@lucide/svelte/icons/plus';
  import Pencil from '@lucide/svelte/icons/pencil';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import Trash from '@lucide/svelte/icons/trash-2';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import IconButton from '@3pino/ui-kit-web/IconButton.svelte';
  import Icon from '@3pino/ui-kit-web/Icon.svelte';
  import Menu from '@3pino/ui-kit-web/Menu.svelte';
  import MenuItem from '@3pino/ui-kit-web/MenuItem.svelte';
  import { EXPLORER_DRAG_DIR_TYPE, EXPLORER_DRAG_TYPE, explorerDragItems, type EntryStyle } from '@3pino/explorer-kit';

  // 左の欄の中身。上から「ブックマーク」（追加・削除できる。フォルダをドラッグして落としても足せる）、「ドライブ」（この端末のドライブ・SD カード・WSL・ネットワークの場所）。
  // 項目を右クリック（長押し）すると、新しいタブ・新しいウィンドウで開く・ブックマークから外す、のメニュー。

  let {
    bookmarks,
    drives,
    canWindow,
    canAddBookmark,
    onaddbookmark,
    onaddnetwork,
    ondropdirs,
    onmovebookmark,
    onmoveinto,
  }: {
    bookmarks: NavEntry[];
    drives: NavEntry[];
    /** 新しいウィンドウで開けるか（デスクトップだけ） */
    canWindow: boolean;
    /** 「いま見ているフォルダ」を足せるか（設定を見ているとき・すでにあるときは足せない） */
    canAddBookmark: boolean;
    onaddbookmark: () => void;
    onaddnetwork: () => void;
    /** エクスプローラーからフォルダをドラッグして落とした（フォルダのパス） */
    ondropdirs: (paths: string[]) => void;
    /** ブックマークを並べ替えた（key と、動かしたあとの位置。ブックマークの一覧の中での 0 から数えた番号） */
    onmovebookmark: (key: string, toIndex: number) => void;
    /** 一覧の項目をドラッグして、ブックマークの上に落とした（ブックマークの key と、移動かコピーか） */
    onmoveinto: (key: string, op: 'move' | 'copy') => void;
  } = $props();

  let menu = $state.raw<{ entry: NavEntry; x: number; y: number } | null>(null);
  /** フォルダをドラッグして、「追加」の空きの上に来ている */
  let addDropping = $state(false);
  /** フォルダをドラッグして、左の欄（場所の欄）の上に来ている（「追加」の空きは、このときだけ出す） */
  let dirOverNav = $state(false);
  function windowDragOver(ev: DragEvent): void {
    dirOverNav = isDirDrag(ev) && ev.target instanceof Element && ev.target.closest('.places') !== null;
  }
  const windowDragEnd = (): void => {
    dirOverNav = false;
  };
  /** 一覧の項目をドラッグして、上に来ているブックマーク（落とすと、その中へ移る） */
  let moveInto = $state<string | null>(null);

  // ---- ブックマークの並べ替え（ドラッグ・メニューの「上へ」「下へ」）。タブと同じく、ほかの行がずれて空き、落とすと滑って収まる ----
  /** ドラッグしているブックマークの番号 */
  let dragging = $state<number | null>(null);
  /** 落とす席（いま指の下の、行の席の番号） */
  let over = $state<number | null>(null);
  /** 動かしている行の高さ。ほかの行をずらす量 */
  let dragShift = $state(0);
  /** ドラッグを始めた直後は、元の行を消さない（ブラウザがドラッグの絵を取るまで） */
  let dragHidden = $state(false);
  /** 落とした直後（並びを入れ替えるまで）は、ずれの動き（transition）を止める */
  let settling = $state(false);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let listEl: HTMLElement | undefined = $state();
  const BOOKMARK_DRAG = 'application/x-fixplor-bookmark';

  const indexOf = (key: string): number => bookmarks.findIndex((b) => b.key === key);
  const isBookmarkDrag = (ev: DragEvent): boolean => !!ev.dataTransfer?.types.includes(BOOKMARK_DRAG);
  const isItemDrag = (ev: DragEvent): boolean => !isBookmarkDrag(ev) && !!ev.dataTransfer?.types.includes(EXPLORER_DRAG_TYPE);

  /**
   * ポインターの y が、何番目の行の「席」の上か。席は、ずらす前の（レイアウトの）位置で決める。
   * 見た目の位置（ずらしたあと）で決めると、ずれた行が指の下に来て、行き来してしまう
   */
  function slotAt(clientY: number, fallback: number): number {
    const el = listEl;
    const rows = [...(el?.querySelectorAll<HTMLElement>('[data-row-key]') ?? [])];
    // 高さが測れない（画面が無い環境）ときは、指の下の行
    if (!el || rows.length === 0 || rows.every((r) => r.offsetHeight === 0)) return fallback;
    const top = el.getBoundingClientRect().top;
    for (let k = 0; k < rows.length; k++) {
      if (clientY < top + rows[k].offsetTop + rows[k].offsetHeight) return k;
    }
    return rows.length - 1;
  }
  /** k 番目の行を、動かしている行の空きの分だけずらす量（px） */
  function shiftOf(k: number): number {
    if (dragging === null || over === null || dragging === over) return 0;
    if (dragging < over && k > dragging && k <= over) return -dragShift;
    if (dragging > over && k >= over && k < dragging) return dragShift;
    return 0;
  }

  function bookmarkDragStart(ev: DragEvent, e: NavEntry): void {
    if (!ev.dataTransfer) return;
    dragging = indexOf(e.key);
    dragShift = (ev.currentTarget as HTMLElement).getBoundingClientRect().height;
    // ブラウザがドラッグの絵を取るのは、この処理のあと。先に消すと、絵も消えるので、少し待つ
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = null;
      if (dragging !== null) dragHidden = true;
    }, 0);
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData(BOOKMARK_DRAG, e.key);
  }
  function bookmarkDragOver(ev: DragEvent, e: NavEntry): void {
    if (isBookmarkDrag(ev)) {
      if (dragging === null) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      over = slotAt(ev.clientY, indexOf(e.key));
    } else if (isItemDrag(ev)) {
      // 一覧の項目: そのブックマークのフォルダへ移る（Ctrl を押していればコピー）
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = ev.ctrlKey ? 'copy' : 'move';
      moveInto = e.key;
    }
  }
  /** 行の並びの空き（行と行のあいだ・末尾）の上: 動かしている行の席を追う */
  function listDragOver(ev: DragEvent): void {
    if (!isBookmarkDrag(ev) || dragging === null) return;
    ev.preventDefault();
    over = slotAt(ev.clientY, over ?? dragging);
  }
  function bookmarkDragLeave(e: NavEntry): void {
    if (moveInto === e.key) moveInto = null;
  }
  function bookmarkDrop(ev: DragEvent, e: NavEntry): void {
    if (isBookmarkDrag(ev)) {
      if (dragging === null) return;
      ev.preventDefault();
      ev.stopPropagation();
      commitDrop(slotAt(ev.clientY, indexOf(e.key)));
    } else if (isItemDrag(ev)) {
      ev.preventDefault();
      ev.stopPropagation();
      moveInto = null;
      onmoveinto(e.key, ev.ctrlKey ? 'copy' : 'move');
    }
  }
  function listDrop(ev: DragEvent): void {
    if (!isBookmarkDrag(ev) || dragging === null) return;
    ev.preventDefault();
    commitDrop(over ?? dragging);
  }
  /** 落とす: ずれた見た目の位置から滑らせるため、いまの位置を覚えてから、動きを止めて並べ替える */
  function commitDrop(to: number): void {
    const from = dragging;
    if (from === null || from === to) {
      bookmarkDragEnd();
      return;
    }
    const key = bookmarks[from]?.key;
    settling = true;
    droppedFrom = rowTops();
    bookmarkDragEnd();
    if (key !== undefined) onmovebookmark(key, to);
  }
  function bookmarkDragEnd(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = null;
    dragging = null;
    over = null;
    dragHidden = false;
  }

  // ---- 並びが変わったときの動き（FLIP: 変わる前の位置から、新しい位置へ滑らせる） ----
  const rowTops = (): Map<string, number> => {
    const m = new Map<string, number>();
    listEl?.querySelectorAll<HTMLElement>('[data-row-key]').forEach((el) => m.set(el.dataset.rowKey ?? '', el.getBoundingClientRect().top));
    return m;
  };
  const orderKey = (): string => bookmarks.map((b) => b.key).join(',');
  let before = new Map<string, number>();
  let droppedFrom: Map<string, number> | null = null;
  $effect.pre(() => {
    void orderKey();
    before = droppedFrom ?? rowTops();
    droppedFrom = null;
  });
  $effect(() => {
    void orderKey();
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      listEl?.querySelectorAll<HTMLElement>('[data-row-key]').forEach((el) => {
        const old = before.get(el.dataset.rowKey ?? '');
        if (old === undefined || typeof el.animate !== 'function') return;
        const dy = old - el.getBoundingClientRect().top;
        if (Math.abs(dy) < 1) return;
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' });
      });
    }
    settling = false;
  });

  /** メニューから（メニューを閉じると項目が消えるので、key を先に受け取っておく） */
  function moveFromMenu(key: string, step: -1 | 1): void {
    menu = null;
    moveBy(key, step);
  }
  function moveBy(key: string, step: -1 | 1): void {
    const to = indexOf(key) + step;
    if (to >= 0 && to < bookmarks.length) onmovebookmark(key, to);
  }
  function openMenu(ev: MouseEvent, entry: NavEntry): void {
    ev.preventDefault();
    menu = { entry, x: ev.clientX, y: ev.clientY };
  }
  function pick(run: () => void): void {
    menu = null;
    run();
  }

  const isDirDrag = (ev: DragEvent): boolean => !!ev.dataTransfer?.types.includes(EXPLORER_DRAG_TYPE) && !!ev.dataTransfer.types.includes(EXPLORER_DRAG_DIR_TYPE);
  /** 末尾の「追加」の空き: フォルダをここへ落とすと、ブックマークに足す */
  function addOver(ev: DragEvent): void {
    if (!isDirDrag(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'link';
    addDropping = true;
  }
  function addLeave(ev: DragEvent): void {
    if (ev.relatedTarget instanceof Node && (ev.currentTarget as HTMLElement).contains(ev.relatedTarget)) return;
    addDropping = false;
  }
  function addDrop(ev: DragEvent): void {
    if (!isDirDrag(ev)) return;
    ev.preventDefault();
    addDropping = false;
    const dirs = (explorerDragItems() ?? []).filter((i) => i.kind === 'dir').map((i) => i.path);
    if (dirs.length > 0) ondropdirs(dirs);
  }
</script>

<svelte:window ondragover={windowDragOver} ondragend={windowDragEnd} ondrop={windowDragEnd} ondragleave={(ev) => { if (ev.relatedTarget === null) dirOverNav = false; }} />

{#snippet row(e: NavEntry, sortable = false, k = -1)}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="place-row"
    class:place-row-dragging={sortable && dragging === k && dragHidden}
    class:place-row-drop={sortable && moveInto === e.key}
    data-row-key={sortable ? e.key : undefined}
    style:transform={sortable && shiftOf(k) !== 0 ? `translateY(${shiftOf(k)}px)` : undefined}
    draggable={sortable}
    ondragstart={sortable ? (ev) => bookmarkDragStart(ev, e) : undefined}
    ondragover={sortable ? (ev) => bookmarkDragOver(ev, e) : undefined}
    ondragleave={sortable ? () => bookmarkDragLeave(e) : undefined}
    ondrop={sortable ? (ev) => bookmarkDrop(ev, e) : undefined}
    ondragend={sortable ? bookmarkDragEnd : undefined}
  >
    <button
      class="menu-item place-open"
      type="button"
      data-bookmark={sortable ? e.key : undefined}
      aria-current={e.current ? 'page' : undefined}
      title={e.broken ? `つながりません: ${e.broken}` : e.title}
      onclick={e.open}
      oncontextmenu={(ev) => openMenu(ev, e)}
    >
      <!-- ブックマークのアイコン: 見た目のルールどおり（一覧のフォルダと同じ。ルールが無ければ、folder） -->
      {#if sortable}<span class="place-icon" style:color={e.look?.color} style:opacity={e.look?.opacity} aria-hidden="true"><Icon icon={e.look?.icon && 'iconName' in e.look.icon ? e.look.icon.iconName : 'folder'} size={16} /></span>{/if}<span class="place-label" style:opacity={sortable ? e.look?.opacity : undefined}>{e.label}</span>{#if e.broken}<span class="place-broken" role="img" aria-label="つながりません">!</span>{/if}
    </button>
    {#if e.edit}
      <IconButton label={`「${e.label}」を直す`} title="直す・外す" onclick={e.edit}><Pencil size={14} /></IconButton>
    {/if}
  </div>
{/snippet}

<section class="places-section" aria-label="ブックマーク">
  <div class="places-head places-head-first">
    <span class="places-title">ブックマーク</span>
    <IconButton class="places-add" label="いま開いているフォルダをブックマークに追加" title={canAddBookmark ? 'いま開いているフォルダを追加' : 'ここは追加できません（設定の画面・追加済み）'} iconSize={14} disabled={!canAddBookmark} onclick={onaddbookmark}><Plus size={14} /></IconButton>
  </div>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="places-list" class:places-list-settling={settling} bind:this={listEl} ondragover={listDragOver} ondrop={listDrop}>
    {#each bookmarks as e, k (e.key)}
      {@render row(e, true, k)}
    {/each}
  </div>
  <!-- 末尾の空き: フォルダをドラッグして左の欄の上に持ってきたときだけ出る。ここへ落とすと、ブックマークに足せる -->
  {#if dirOverNav || addDropping}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="places-add-slot" class:places-add-slot-drop={addDropping} ondragover={addOver} ondragleave={addLeave} ondrop={addDrop}>
      <Plus size={14} />
      <span class="muted">フォルダをここへドロップして追加</span>
    </div>
  {/if}
</section>

<section class="places-section" aria-label="ドライブ">
  <div class="places-head">
    <span class="places-title">ドライブ</span>
    <IconButton class="places-add" label="ネットワークの場所を追加" title="ネットワークの場所を追加" iconSize={14} onclick={onaddnetwork}><Plus size={14} /></IconButton>
  </div>
  {#each drives as e (e.key)}
    {@render row(e)}
  {/each}
</section>

{#if menu}
  {@const entry = menu.entry}
  <div class="places-menu-anchor" style:left="{menu.x}px" style:top="{menu.y}px">
    <Menu class="places-menu" label="場所の操作" onclose={() => (menu = null)}>
      <MenuItem icon={Plus} onclick={() => pick(entry.openTab)}>新しいタブで開く</MenuItem>
      {#if canWindow && entry.openWindow}
        <MenuItem icon={ExternalLink} onclick={() => pick(entry.openWindow!)}>新しいウィンドウで開く</MenuItem>
      {/if}
      {#if entry.edit}
        <MenuItem icon={Pencil} onclick={() => pick(entry.edit!)}>直す・外す</MenuItem>
      {/if}
      {#if entry.remove}
        <MenuItem icon={ArrowUp} disabled={indexOf(entry.key) <= 0} onclick={() => moveFromMenu(entry.key, -1)}>上へ移動</MenuItem>
        <MenuItem icon={ArrowDown} disabled={indexOf(entry.key) < 0 || indexOf(entry.key) >= bookmarks.length - 1} onclick={() => moveFromMenu(entry.key, 1)}>下へ移動</MenuItem>
        <MenuItem icon={Trash} danger onclick={() => pick(entry.remove!)}>ブックマークから削除</MenuItem>
      {/if}
    </Menu>
  </div>
{/if}

<style>
  .places-section {
    display: flex;
    flex-direction: column;
    flex: none;
    border-radius: var(--radius-sm);
  }
  /* ブックマークをドラッグして並べ替えるとき: 動かしている行は消え（空きに、ほかの行がずれて入る）、落とすと滑って収まる */
  .places-list {
    position: relative;
  }
  .places-list .place-row {
    transition: transform 0.15s ease;
  }
  .places-list-settling .place-row {
    transition: none;
  }
  .place-row-dragging {
    opacity: 0;
  }
  /* 一覧の項目をドラッグして、ブックマークの上に来たとき（その中へ移る）の印 */
  .place-row-drop {
    outline: 1px dashed var(--accent);
    background: var(--accent-soft);
  }
  /* 末尾の「追加」の空き（フォルダを落として足せることを示す） */
  .places-add-slot {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-1) var(--space-2) 0;
    padding: var(--space-1) var(--space-2);
    min-height: 26px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    font-size: var(--fs-sm, 0.85em);
  }
  .places-add-slot-drop {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }
  .places-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: var(--space-4);
    padding-inline: var(--space-2);
  }
  .places-head-first {
    margin-top: 0;
  }
  .places-title {
    color: var(--text-muted);
    font-size: var(--fs-sm, 0.85em);
  }
  /* 追加のボタンは小さく（押す範囲は、見出しの高さに収める） */
  .places-head :global(.places-add) {
    width: 22px;
    height: 22px;
    padding: 0;
  }
  .places-section :global(.menu-item) {
    width: 100%;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--fs-base);
  }
  .places-section :global(.menu-item[aria-current='page']) {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .place-row {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }
  .place-row :global(.place-open) {
    flex: 1;
    min-width: 0;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* ブックマークのアイコン（色はルールのもの。無ければ文字の色）。文字は長ければ 「…」 */
  .place-icon {
    flex: none;
    display: inline-flex;
    vertical-align: middle;
    margin-right: var(--space-3);
  }
  .place-label {
    vertical-align: middle;
  }
  .place-broken {
    margin-left: var(--space-2);
    color: var(--danger);
    font-weight: bold;
  }
  .places-menu-anchor {
    position: fixed;
    z-index: var(--z-menu, 50);
  }
  /* .menu は位置を持たない。position が無いと z-index が効かず、外側を押したら閉じる幕（fixed）が、メニューを覆ってしまう */
  .places-menu-anchor :global(.places-menu) {
    position: absolute;
    top: 0;
    left: 0;
    width: max-content;
  }
</style>
