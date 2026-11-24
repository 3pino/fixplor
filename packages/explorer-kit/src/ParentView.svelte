<script lang="ts">
  import { tick, untrack } from 'svelte';
  import EntryGlyph from './EntryGlyph.svelte';
  import { kindLabel, sortEntries } from './listing';
  import { parentOf } from './path';
  import { displayEntry, entryLabel } from './trashFolder';
  import type { Explorer } from './explorer';
  import type { Entry, EntryStyle } from './types';

  // 親フォルダのビュー: いま開いているフォルダの「親フォルダ」の中身を、全部並べる（通常の一覧と同じ並び順）。
  // いま開いているフォルダは、選んでいるときと同じ背景にする。
  // 項目を押す（Enter）と、一覧（メインのビュー）がこの親フォルダを開いて、その項目を選んでフォーカスする。開くのは、一覧でする。
  let { explorer, entryStyle }: { explorer: Explorer; entryStyle?: (e: Entry) => EntryStyle | null } = $props();

  // 一覧の部品と同じく、この部品の一生のあいだ、explorer は変わらない（別の置き場所は {#key} で作り直す）
  // svelte-ignore state_referenced_locally
  const { nav, index, host, view } = explorer;
  const dir = $derived(nav.dir);
  const parent = $derived(parentOf(dir));
  /** いちばん上には、親が無い */
  const atTop = $derived(dir === '');
  const listed = $derived(atTop ? undefined : index.state(parent));
  // 一覧が無い（まだ読んでいない・変わって捨てられた）ときは、読み込む
  $effect(() => {
    if (atTop) return;
    if (index.state(parent) === undefined) untrack(() => index.ensure(parent));
  });

  const rows = $derived.by((): Entry[] => {
    if (listed?.kind !== 'ok') return [];
    const v = view.of(parent);
    return sortEntries([...listed.entries.values()].map(displayEntry), v.sortKey, v.sortOrder, (e) => kindLabel(e, host.isImage));
  });

  let listEl: HTMLElement | undefined = $state();
  // 開いているフォルダが見えるところへ
  $effect(() => {
    void rows;
    void dir;
    void tick().then(() => listEl?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: 'nearest' }));
  });

  /**
   * 一覧にこの項目を見せる: 親フォルダを開き、その項目を選んでカーソル（フォーカス）を置く。
   * 親フォルダは、いま開いているフォルダとは必ず違う（上へ上がることになる）
   */
  function press(e: Entry): void {
    explorer.revealRequest = e.path;
    nav.open(parent);
  }
</script>

<nav class="parent-view" aria-label="親フォルダ">
  {#if listed?.kind === 'error'}
    <p class="parent-note muted">読み込めませんでした</p>
  {:else if listed?.kind === 'missing'}
    <p class="parent-note muted">フォルダが見つかりません</p>
  {:else if listed?.kind === 'loading'}
    <p class="parent-note muted">読み込み中…</p>
  {/if}
  <ul class="parent-list" bind:this={listEl}>
    {#each rows as e (e.path)}
      {@const look = entryStyle?.(e) ?? null}
      <li class="parent-item" style:--entry-color={look?.color} style:opacity={look?.opacity}>
        <button type="button" class="parent-row" class:parent-current={e.path === dir} aria-current={e.path === dir ? 'true' : undefined} title={e.name} onclick={() => press(e)}>
          <span class="parent-icon"><EntryGlyph {look} kind={e.iconKind === 'dir' || e.kind === 'dir' ? 'enter' : host.isImage(e.name, e.mime) ? 'image' : 'file'} size={16} /></span>
          <span class="parent-name">{entryLabel(e)}</span>
        </button>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .parent-view {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow-y: auto;
    font-size: var(--fs-sm, 0.9em);
  }
  .parent-note {
    margin: 0;
    padding: var(--space-2) var(--space-3);
  }
  .parent-list {
    margin: 0;
    padding: var(--space-2);
    list-style: none;
  }
  .parent-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    width: 100%;
    padding: var(--space-1) var(--space-3);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
  }
  .parent-row:hover {
    background: var(--surface-2, color-mix(in oklch, var(--text) 8%, var(--bg)));
  }
  /* いま開いているフォルダ（一覧で選んだ項目と同じ背景） */
  .parent-current,
  .parent-current:hover {
    background: color-mix(in oklch, var(--accent) 18%, var(--bg));
  }
  .parent-icon {
    flex: none;
    display: inline-flex;
    color: var(--entry-color, var(--text-muted));
  }
  .parent-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--entry-color, inherit);
  }
</style>
