<script lang="ts">
  import FileIcon from '@lucide/svelte/icons/file';
  import FileText from '@lucide/svelte/icons/file-text';
  import Folder from '@lucide/svelte/icons/folder';
  import ImageIcon from '@lucide/svelte/icons/image';
  import NamedIcon from '@3pino/ui-kit-web/Icon.svelte';
  import type { EntryStyle } from './types';

  // 項目のアイコン 1 つ。本体が決めた見た目（アイコンの部品・登録簿の名前・画像の URL）があればそれ。無ければ、種類のアイコン。
  // kind は、開いたときの動き（'enter' = フォルダ・'image'・'pdf'・それ以外 = ファイル）
  let { look = null, kind, size }: { look?: EntryStyle | null; kind: string; size: number } = $props();
  const custom = $derived(look?.icon);
</script>

{#if custom && typeof custom === 'function'}
  {@const Custom = custom}
  <Custom {size} />
{:else if custom && 'iconName' in custom}
  <NamedIcon icon={custom.iconName} {size} />
{:else if custom}
  <img class="entry-glyph-img" src={custom.src} alt="" width={size} height={size} />
{:else if kind === 'enter'}<Folder {size} />{:else if kind === 'image'}<ImageIcon {size} />{:else if kind === 'pdf'}<FileText {size} />{:else}<FileIcon {size} />{/if}

<style>
  .entry-glyph-img {
    object-fit: contain;
  }
</style>
