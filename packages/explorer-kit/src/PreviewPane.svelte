<script lang="ts">
  import { untrack } from 'svelte';
  import EntryGlyph from './EntryGlyph.svelte';
  import { formatSize, formatStamp } from './format';
  import { highlightCode } from './highlight';
  import { isSvgName } from './kinds';
  import { kindLabel, sortEntries } from './listing';
  import { headOf, looksLikeText, readHead } from './preview';
  import { displayEntry, entryLabel } from './trashFolder';
  import type { Explorer } from './explorer';
  import type { Entry, EntryStyle } from './types';

  // プレビューのビュー: いまカーソルのある項目（entry）の中身を見せる。何も無ければ、何も出さない。
  //   フォルダ: 直下の項目を、通常の一覧と同じ並びで
  //   画像（SVG を含む）・PDF: 絵で（SVG は透けるので、市松模様の上に。currentColor は黒）
  //   テキスト: 先頭の 100 行（64KB まで）。言語が分かれば色付け
  //   ほか: 種類・サイズ・更新日時
  let { explorer, entry, entryStyle }: { explorer: Explorer; entry: Entry | null; entryStyle?: (e: Entry) => EntryStyle | null } = $props();

  // svelte-ignore state_referenced_locally
  const { index, host, urls, view } = explorer;
  const PdfThumb = host.PdfThumb;

  /** 中身を読まない拡張子（動画・音声・書庫・実行ファイルなど。読んでも文字ではない） */
  const OPAQUE = /\.(mp4|m4v|mkv|mov|avi|webm|wmv|mp3|m4a|flac|wav|ogg|opus|aac|zip|7z|rar|gz|bz2|xz|zst|tar|tgz|iso|dmg|exe|dll|so|dylib|bin|apk|jar|class|woff2?|ttf|otf|ico|psd|docx?|xlsx?|pptx?|odt|ods|odp)$/i;

  const isImage = $derived(entry !== null && entry.kind === 'file' && host.isImage(entry.name, entry.mime));
  const pdf = $derived(entry !== null && entry.kind === 'file' && !entry.trash && !isImage ? urls.pdfSource(entry) : null);
  /** 先頭を読んで文字か確かめるもの */
  const textual = $derived(entry !== null && entry.kind === 'file' && !entry.trash && !isImage && pdf === null && !OPAQUE.test(entry.name));

  type Text = { text: string; html: string | null; truncated: boolean };
  let text = $state<Text | null>(null);
  let textState = $state<'idle' | 'loading' | 'binary' | 'error' | 'ready'>('idle');
  $effect(() => {
    const e = entry;
    if (!e || !textual) {
      text = null;
      textState = 'idle';
      return;
    }
    text = null;
    textState = 'loading';
    const ctl = new AbortController();
    // 矢印で素早く動かしているあいだは、読まない
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { bytes, more } = await readHead(untrack(() => urls.readUrl(e)), ctl.signal);
          if (ctl.signal.aborted) return;
          if (!looksLikeText(bytes)) {
            textState = 'binary';
            return;
          }
          let s = new TextDecoder('utf-8').decode(bytes);
          // 上限で切れた最後の 1 文字は、読めない
          if (more) s = s.replace(/\uFFFD$/, '');
          const head = headOf(s, more);
          const html = await highlightCode(head.text, e.name);
          if (ctl.signal.aborted) return;
          text = { text: head.text, html, truncated: head.truncated };
          textState = 'ready';
        } catch {
          if (!ctl.signal.aborted) textState = 'error';
        }
      })();
    }, 150);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  });

  // フォルダは、直下の一覧
  $effect(() => {
    const e = entry;
    if (e?.kind !== 'dir') return;
    if (index.state(e.path) === undefined) untrack(() => index.ensure(e.path));
  });
  const children = $derived.by((): Entry[] => {
    if (entry?.kind !== 'dir') return [];
    const st = index.state(entry.path);
    if (st?.kind !== 'ok') return [];
    const v = view.of(entry.path);
    return sortEntries([...st.entries.values()].map(displayEntry), v.sortKey, v.sortOrder, (x) => kindLabel(x, host.isImage));
  });
  const childState = $derived(entry?.kind === 'dir' ? index.state(entry.path) : undefined);

  const glyphKind = (e: Entry): string => (e.iconKind === 'dir' || e.kind === 'dir' ? 'enter' : host.isImage(e.name, e.mime) ? 'image' : 'file');
  const look = $derived(entry ? (entryStyle?.(entry) ?? null) : null);
</script>

<section class="preview" aria-label="プレビュー">
  {#if entry}
    <header class="preview-head">
      <span class="preview-title" title={entry.name}>{entryLabel(entry)}</span>
      <span class="preview-meta muted">{entry.kind === 'file' ? `${kindLabel(entry, host.isImage)}・${formatSize(entry.size)}` : 'フォルダ'}</span>
    </header>
    <div class="preview-body">
      {#if entry.kind === 'dir'}
        {#if childState?.kind === 'error'}
          <p class="preview-note muted">読み込めませんでした</p>
        {:else if childState?.kind === 'missing'}
          <p class="preview-note muted">フォルダが見つかりません</p>
        {:else if childState?.kind !== 'ok'}
          <p class="preview-note muted">読み込み中…</p>
        {:else if children.length === 0}
          <p class="preview-note muted">空のフォルダです</p>
        {:else}
          <ul class="preview-list">
            {#each children as c (c.path)}
              {@const cl = entryStyle?.(c) ?? null}
              <li class="preview-item" style:--entry-color={cl?.color} style:opacity={cl?.opacity}>
                <span class="preview-icon"><EntryGlyph look={cl} kind={glyphKind(c)} size={16} /></span>
                <span class="preview-name">{entryLabel(c)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      {:else if isImage}
        <div class="preview-image">
          <img class:preview-svg={isSvgName(entry.name, entry.mime)} src={urls.readUrl(entry)} alt={entry.name} />
        </div>
      {:else if pdf && PdfThumb}
        <div class="preview-pdf"><PdfThumb url={pdf.url} key={pdf.key} /></div>
      {:else if textState === 'ready' && text}
        {#if text.text === ''}
          <p class="preview-note muted">空のファイルです</p>
        {:else}
          <pre class="preview-code"><code>{#if text.html !== null}{@html text.html}{:else}{text.text}{/if}</code></pre>
          {#if text.truncated}<p class="preview-note muted">…（先頭だけを表示しています）</p>{/if}
        {/if}
      {:else if textState === 'loading'}
        <p class="preview-note muted">読み込み中…</p>
      {:else if textState === 'error'}
        <p class="preview-note muted">読み込めませんでした</p>
      {:else}
        <div class="preview-info" style:--entry-color={look?.color}>
          <span class="preview-big"><EntryGlyph {look} kind={glyphKind(entry)} size={48} /></span>
          <p class="preview-note muted">{textState === 'binary' || OPAQUE.test(entry.name) ? 'プレビューできません' : ''}</p>
          {#if entry.modified}<p class="preview-note muted">{formatStamp(entry.modified, Date.now())}</p>{/if}
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    font-size: var(--fs-sm, 0.9em);
  }
  .preview-head {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
  }
  .preview-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--fw-semibold, 600);
  }
  .preview-meta {
    font-size: 0.9em;
  }
  .preview-body {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .preview-note {
    margin: 0;
    padding: var(--space-2) var(--space-4);
  }
  .preview-list {
    margin: 0;
    padding: var(--space-2);
    list-style: none;
  }
  .preview-item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-3);
  }
  .preview-icon {
    flex: none;
    display: inline-flex;
    color: var(--entry-color, var(--text-muted));
  }
  .preview-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--entry-color, inherit);
  }
  .preview-image {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3);
    min-height: 100%;
    box-sizing: border-box;
  }
  .preview-image img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  /* SVG は透ける（線の色は黒）ので、白と灰色の市松模様を敷く。大きさを持たない SVG は、幅いっぱいに */
  .preview-svg {
    width: 100%;
    height: auto;
    background-color: #fff;
    background-image: conic-gradient(#c8c8c8 25%, transparent 0 50%, #c8c8c8 0 75%, transparent 0);
    background-size: 16px 16px;
  }
  .preview-pdf {
    padding: var(--space-3);
  }
  .preview-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-6, 24px) var(--space-4);
  }
  .preview-big {
    display: inline-flex;
    color: var(--entry-color, var(--text-muted));
  }
  .preview-code {
    margin: 0;
    padding: var(--space-3) var(--space-4);
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: 0.85em;
    line-height: 1.5;
    white-space: pre;
    tab-size: 4;
    color: var(--text);
  }
  /* 色付け（暗い背景向け。色相は、アプリの色に合わせず、読みやすさを優先） */
  .preview-code :global(.hljs-comment),
  .preview-code :global(.hljs-quote) {
    color: #7f8a6a;
    font-style: italic;
  }
  .preview-code :global(.hljs-keyword),
  .preview-code :global(.hljs-selector-tag),
  .preview-code :global(.hljs-doctag),
  .preview-code :global(.hljs-meta .hljs-keyword) {
    color: #d98cc5;
  }
  .preview-code :global(.hljs-string),
  .preview-code :global(.hljs-regexp),
  .preview-code :global(.hljs-addition),
  .preview-code :global(.hljs-meta .hljs-string) {
    color: #9fc66a;
  }
  .preview-code :global(.hljs-number),
  .preview-code :global(.hljs-literal),
  .preview-code :global(.hljs-symbol),
  .preview-code :global(.hljs-bullet) {
    color: #e0a15a;
  }
  .preview-code :global(.hljs-title),
  .preview-code :global(.hljs-section),
  .preview-code :global(.hljs-function .hljs-title) {
    color: #6fb4e8;
  }
  .preview-code :global(.hljs-built_in),
  .preview-code :global(.hljs-type),
  .preview-code :global(.hljs-class .hljs-title) {
    color: #5fc9c0;
  }
  .preview-code :global(.hljs-attr),
  .preview-code :global(.hljs-attribute),
  .preview-code :global(.hljs-variable),
  .preview-code :global(.hljs-template-variable),
  .preview-code :global(.hljs-params) {
    color: #e6c07b;
  }
  .preview-code :global(.hljs-tag),
  .preview-code :global(.hljs-name),
  .preview-code :global(.hljs-selector-id),
  .preview-code :global(.hljs-selector-class),
  .preview-code :global(.hljs-deletion) {
    color: #e5766f;
  }
  .preview-code :global(.hljs-meta),
  .preview-code :global(.hljs-link) {
    color: #a0a0b8;
  }
  .preview-code :global(.hljs-emphasis) {
    font-style: italic;
  }
  .preview-code :global(.hljs-strong) {
    font-weight: bold;
  }
</style>
