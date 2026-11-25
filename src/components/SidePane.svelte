<script lang="ts">
  import type { Snippet } from 'svelte';
  import { read, write } from '../lib/settings.svelte';

  // 一覧の横に置くビュー（親フォルダ・プレビュー）の枠。幅は、境目のつまみで変えられる（ドラッグ・左右の矢印キー・Home で元の幅）。
  // 幅は各デバイスに保存する。side は、この枠が一覧の左か右か（つまみは、一覧に近い側の反対 = 外側ではなく、一覧との境目に付く）
  let {
    label,
    storageKey,
    side,
    min = 140,
    max = 640,
    initial = 240,
    children,
  }: {
    /** 画面読み上げ・つまみの名前に使う */
    label: string;
    /** 幅を保存するキー（localKeys.ts に登録する） */
    storageKey: string;
    side: 'left' | 'right';
    min?: number;
    max?: number;
    initial?: number;
    children: Snippet;
  } = $props();

  const clamp = (w: number): number => Math.min(max, Math.max(min, Math.round(w)));
  // 初めの幅だけ、保存した値と initial から決める
  // svelte-ignore state_referenced_locally
  const saved = Number(read(storageKey));
  // svelte-ignore state_referenced_locally
  let width = $state(Number.isFinite(saved) && saved > 0 ? clamp(saved) : initial);
  let dragging = $state(false);
  let paneEl: HTMLElement | undefined = $state();

  function start(ev: PointerEvent): void {
    if (ev.button !== 0 || !paneEl) return;
    ev.preventDefault();
    const box = paneEl.getBoundingClientRect();
    dragging = true;
    const move = (e: PointerEvent): void => {
      width = clamp(side === 'left' ? e.clientX - box.left : box.right - e.clientX);
    };
    const up = (): void => {
      dragging = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      write(storageKey, String(width));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  function key(ev: KeyboardEvent): void {
    const step = ev.shiftKey ? 40 : 10;
    // 左の枠は右へ、右の枠は左へ動かすと、広がる
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft';
    const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    if (ev.key === grow) width = clamp(width + step);
    else if (ev.key === shrink) width = clamp(width - step);
    else if (ev.key === 'Home') width = initial;
    else return;
    ev.preventDefault();
    write(storageKey, String(width));
  }
</script>

{#snippet handle()}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_tabindex -->
  <div
    class="side-resizer"
    class:side-resizer-active={dragging}
    role="separator"
    aria-orientation="vertical"
    aria-label="{label}の幅"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={width}
    tabindex="0"
    onpointerdown={start}
    onkeydown={key}
  ></div>
{/snippet}

{#if side === 'right'}{@render handle()}{/if}
<aside class="side-pane" class:side-pane-left={side === 'left'} aria-label={label} style:width="{width}px" bind:this={paneEl}>
  {@render children()}
</aside>
{#if side === 'left'}{@render handle()}{/if}

<style>
  /* 窓が狭いときは、幅の指定より縮む（隠さない）。縮む下限は min-width */
  .side-pane {
    flex: 0 1 auto;
    min-width: 120px;
    min-height: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  /* 幅を変えるつまみ（細い線。ドラッグの間は強調する） */
  .side-resizer {
    flex: none;
    width: 5px;
    margin-inline: -2px;
    cursor: col-resize;
    background: linear-gradient(var(--border), var(--border)) center / 1px 100% no-repeat;
    touch-action: none;
    z-index: 1;
  }
  .side-resizer:hover,
  .side-resizer:focus-visible,
  .side-resizer-active {
    background: linear-gradient(var(--accent), var(--accent)) center / 2px 100% no-repeat;
    outline: none;
  }
</style>
