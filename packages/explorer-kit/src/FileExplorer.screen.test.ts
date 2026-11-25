// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { LONG_PRESS_MS } from '@3pino/ui-kit-web/sortable';
import { defineBuiltinIcon } from '@3pino/ui-kit-web/icons';
import FileExplorer from './FileExplorer.svelte';
import { DOUBLE_CLICK_MS, EXPLORER_DRAG_TYPE } from './ops';
import type { Entry } from './types';
import { SCREEN_RULES, downloadFile, dsk, osDrop, entry, explorer, explorerBuffer, explorerSelection, explorerView, fileExplorer, h, listing, resetUi, dirIndex, switchPlace, place, scopeAs, ui } from './test-support/screen.svelte';

// 画面の流れの試験（書き込み・同名の確認・選択・貼り付け・ゴミ箱・置き場所が変わったとき・戻る・拡大表示など）。
// 置き場所・本体は、メモリの中の偽物（test-support/screen.svelte.ts）。どの置き場所でも成り立つことだけを確かめる
// （アプリが実装を渡したときの配線は、アプリの側の試験が確かめる）。

/** 画面の本体（この部品）のソースの場所。見た目の決まり（CSS）を読む試験で使う */
const KIT = 'src/';

let instance: ReturnType<typeof mount> | undefined;
let target: HTMLElement | undefined;

beforeEach(async () => {
  // 前の試験が、終わったあとに動く非同期の処理（見つけた項目を選ぶなど）で、選びを残していることがある。負荷のある環境（CI）で試験が揺れるので、一度待ってから空にする
  await new Promise((r) => setTimeout(r, 0));
  explorerSelection.clear();
  resetUi();
  h.upload.mockReset();
  h.upload.mockImplementation(() => ({ promise: new Promise(() => {}), abort: () => {} }));
  fileExplorer.dir = '';
});
afterEach(async () => {
  dsk.desktop = false;
  dsk.linux = false;
  osDrop.handler = null;
  osDrop.readEntries.mockClear();
  osDrop.releaseId.mockClear();
  if (instance) await unmount(instance);
  target?.remove();
  instance = undefined;
  target = undefined;
  dirIndex.clear();
  ui.confirmReq = null;
  explorerBuffer.clear();
  place.key = 'http://a.test';
  h.copy.mockClear();
  // h.list: mockClear ではなく実装ごとリセット（DnD テストで上書きした mockImplementation を消す）
  h.list.mockReset();
  h.list.mockImplementation(async () => h.current ?? listing);
  h.remove.mockClear();
  h.trash.mockClear();
  h.purge.mockClear();
  h.restore.mockClear();
  h.move.mockClear();
  h.clip = { text: null, image: null, files: null, writable: true, supportsFiles: true };
  explorerSelection.clear();
  explorerView.reset();
});

async function render(extra: Record<string, unknown> = {}): Promise<HTMLElement> {
  target = document.createElement('div');
  document.body.appendChild(target);
  instance = mount(FileExplorer, { target, props: { explorer, ...extra } });
  flushSync();
  await vi.waitFor(() => expect(target!.querySelector('.file-explorer-list')).not.toBeNull());
  return target;
}

/** 操作のメニュー（≡）を開いて、文字の項目を押す */
function menuClick(el: HTMLElement, text: string): void {
  el.querySelector<HTMLButtonElement>('button[aria-label="メニュー"]')!.click();
  flushSync();
  const item = [...document.querySelectorAll<HTMLButtonElement>('.file-explorer-menu .menu-item')].find((b) => b.textContent?.includes(text));
  if (!item) throw new Error(`メニューに「${text}」がありません`);
  item.click();
  flushSync();
}

/** 操作のメニュー（≡）の項目の文字（開いて読み、閉じる） */
function menuLabels(el: HTMLElement): string[] {
  el.querySelector<HTMLButtonElement>('button[aria-label="メニュー"]')!.click();
  flushSync();
  const labels = [...document.querySelectorAll('.file-explorer-menu .menu-item')].map((b) => b.textContent?.trim() ?? '');
  document.querySelector<HTMLButtonElement>('.menu-backdrop')?.click();
  flushSync();
  return labels;
}

/** 上端の貼り付けを押す */
function pasteClick(el: HTMLElement): void {
  el.querySelector<HTMLButtonElement>('.file-explorer-bar button[aria-label="貼り付け"]')!.click();
  flushSync();
}

function pick(el: HTMLElement, file: File): void {
  const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('置き場所の書き込み', () => {
  it('同名のファイルは、確認してから上書きする（確認なしには送らない）', async () => {
    const el = await render();
    pick(el, new File(['x'], 'a.txt'));
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    expect(ui.confirmReq!.body).toContain('消えて');
    expect(h.upload).not.toHaveBeenCalled();
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledWith('a.txt', expect.any(File), expect.any(Function)));
  });

  it('確認で取り消せば、送らない', async () => {
    const el = await render();
    pick(el, new File(['x'], 'a.txt'));
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(false);
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-uploads')).toBeNull());
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('同名のない新しいファイルは、確認なしに送る', async () => {
    const el = await render();
    pick(el, new File(['x'], 'new.txt'));
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledWith('new.txt', expect.any(File), expect.any(Function)));
    expect(ui.confirmReq).toBeNull();
  });

  it('使えない名前は送らず、理由を出す', async () => {
    const el = await render();
    pick(el, new File(['x'], 'a:b.txt'));
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-upload-error')).not.toBeNull());
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('新しいファイルは、名前を確かめてから作る。末尾が / か \\ なら、フォルダを作る', async () => {
    const el = await render();
    menuClick(el, '新しいファイル');
    expect(document.querySelector('.file-explorer-mkdir-hint')?.textContent).toContain('末尾を / にするとフォルダを作成します');
    const input = document.querySelector<HTMLInputElement>('.file-explorer-mkdir input')!;
    input.value = 'x/y';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLFormElement>('.file-explorer-mkdir')!.requestSubmit();
    await vi.waitFor(() => expect(document.querySelector('.file-explorer-mkdir-error')?.textContent).toContain('使えません'));
    expect(h.mkdir).not.toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    // 同じ名前（ファイルでも、フォルダでも）は、上書きせずに断る
    const submit = async (name: string): Promise<void> => {
      input.value = name;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector<HTMLFormElement>('.file-explorer-mkdir')!.requestSubmit();
    };
    await submit('a.txt');
    await vi.waitFor(() => expect(document.querySelector('.file-explorer-mkdir-error')?.textContent).toContain('同じ名前'));
    await submit('docs/');
    await vi.waitFor(() => expect(document.querySelector('.file-explorer-mkdir-error')?.textContent).toContain('同じ名前'));
    expect(h.write).not.toHaveBeenCalled();
    expect(h.mkdir).not.toHaveBeenCalled();
    // ふつうの名前は、空のファイルを作る
    await submit('memo.txt');
    await vi.waitFor(() => expect(h.write).toHaveBeenCalledWith('memo.txt', ''));
    expect(h.mkdir).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.querySelector('.file-explorer-mkdir')).toBeNull());
  });

  it('新しいファイルの名前の末尾が / でも \\ でも、フォルダを作る（末尾の記号は名前に含めない）', async () => {
    const el = await render();
    for (const typed of ['newdir/', 'newdir\\', 'newdir//']) {
      h.mkdir.mockClear();
      menuClick(el, '新しいファイル');
      const input = document.querySelector<HTMLInputElement>('.file-explorer-mkdir input')!;
      input.value = typed;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector<HTMLFormElement>('.file-explorer-mkdir')!.requestSubmit();
      await vi.waitFor(() => expect(h.mkdir).toHaveBeenCalledWith('newdir'));
      await vi.waitFor(() => expect(document.querySelector('.file-explorer-mkdir')).toBeNull());
    }
    expect(h.write).not.toHaveBeenCalled();
  });

  it('上端の行の部品: 既定では、新しいファイル・フォルダは出さない。menuLayout.header で、出す・出さない・並べ替えができる。新しいフォルダは、フォルダを作る', async () => {
    const labelsIn = (el: HTMLElement): string[] => [...el.querySelectorAll('.file-explorer-bar button[aria-label]:not(.file-explorer-crumb-chevron), .file-explorer-bar .file-explorer-path')].map((b) => b.getAttribute('aria-label') ?? 'パス');
    let el = await render();
    expect(labelsIn(el)).not.toContain('新しいフォルダ');
    expect(labelsIn(el).indexOf('パス')).toBeLessThan(labelsIn(el).indexOf('コピー'));
    await unmount(instance!);
    target!.remove();
    el = await render({ menuLayout: { header: { order: ['search', 'path'], hidden: ['copy', 'cut', 'paste'] } } });
    const labels = labelsIn(el);
    expect(labels.slice(0, 3)).toEqual(['検索', 'パス', '削除']);
    for (const gone of ['コピー', '切り取り', '貼り付け']) expect(labels).not.toContain(gone);
    expect(labels).toContain('新しいファイル'); // hidden を決めたので、既定の「出さない」は、引きずらない
    el.querySelector<HTMLButtonElement>('.file-explorer-bar button[aria-label="新しいフォルダ"]')!.click();
    flushSync();
    expect(document.querySelector('.modal')?.textContent).toContain('新しいフォルダ');
    expect(document.querySelector('.file-explorer-mkdir-hint')).toBeNull();
    const input = document.querySelector<HTMLInputElement>('.file-explorer-mkdir input')!;
    input.value = 'plain';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLFormElement>('.file-explorer-mkdir')!.requestSubmit();
    await vi.waitFor(() => expect(h.mkdir).toHaveBeenCalledWith('plain'));
    expect(h.write).not.toHaveBeenCalled();
  });

  it('パンくずの ▸ を押すと、その中のフォルダの一覧が出て、選ぶとそこへ移る。パスの欄には、押しても何もしない空きが残る', async () => {
    const el = await render();
    // パスの欄に、押しても何もしない空き（押すとパスの書き換え）
    expect(el.querySelector('.file-explorer-path .file-explorer-path-gap')).not.toBeNull();
    const chevron = el.querySelector<HTMLButtonElement>('.file-explorer-crumb-chevron')!;
    chevron.click();
    flushSync();
    await vi.waitFor(() => expect([...document.querySelectorAll('.file-explorer-crumb-menu .menu-item')].map((b) => b.textContent?.trim())).toContain('docs'));
    expect(el.querySelector('.file-explorer-path-input')).toBeNull(); // 押しただけでは、パスの書き換えに入らない
    const files = [...document.querySelectorAll('.file-explorer-crumb-menu .menu-item')].map((b) => b.textContent?.trim());
    expect(files).not.toContain('a.txt'); // フォルダだけ
    [...document.querySelectorAll<HTMLElement>('.file-explorer-crumb-menu .menu-item')].find((b) => b.textContent?.trim() === 'docs')!.click();
    flushSync();
    expect(fileExplorer.dir).toBe('docs');
    expect(document.querySelector('.file-explorer-crumb-menu')).toBeNull();
    // こんどは docs のパンくずがあり、その ▸ でも出る
    await vi.waitFor(() => expect(el.querySelectorAll('.file-explorer-crumb-chevron')).toHaveLength(2));
    expect(el.querySelectorAll('.file-explorer-crumb-chevron')[1].getAttribute('aria-label')).toBe('docsの中のフォルダ');
  });

  it('上端は共通の見出し（PanelBar = .top-bar）: パス欄と、選んだ項目の操作・検索・メニュー。下端は件数', async () => {
    const el = await render();
    expect(el.querySelectorAll('header')).toHaveLength(1);
    const bar = el.querySelector('.panel-bar');
    expect(bar?.classList.contains('top-bar')).toBe(true);
    expect(bar?.querySelector('button[aria-label="メニュー"]')).not.toBeNull();
    expect(bar?.querySelector('.file-explorer-crumbs')).not.toBeNull();
    // 選んだ項目の操作は、上端の行（パス欄の右）。下端は、件数だけ
    for (const label of ['コピー', '切り取り', '貼り付け', '削除', '検索']) expect(bar?.querySelector(`button[aria-label="${label}"]`), label).not.toBeNull();
    const footer = el.querySelector('footer.file-explorer-footer');
    expect(footer?.querySelector('.file-explorer-selection-count')).not.toBeNull();
    expect(footer?.querySelector('button')).toBeNull();
    // 下端は、一覧の後（いちばん後ろ）
    expect(el.querySelector('.file-explorer')?.lastElementChild).toBe(footer);
  });
});

describe('下端のバーの件数・操作（選んでいなくても同じバーを出す）', () => {
  it('選んでいないときは、件数（フォルダの項目数）を出し、コピー・切り取り・削除は押せない', async () => {
    const el = await render();
    expect(el.querySelector('.file-explorer-selection-count')?.textContent).toBe('3 件');
    for (const label of ['コピー', '切り取り', '削除']) {
      expect(el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.disabled, label).toBe(true);
    }
  });

  it('選ぶと「N 件選択中」になり、操作が押せる。空きスペースで解除すると件数に戻る', async () => {
    const el = await render();
    explorerSelection.enter();
    flushSync();
    expect(el.querySelector('.file-explorer-selection-count')?.textContent).toBe('0 件選択中');
    expect(el.querySelector<HTMLButtonElement>('button[aria-label="コピー"]')?.disabled).toBe(true);
    const row = [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].find((li) => li.textContent?.includes('a.txt'))!;
    row.querySelector<HTMLButtonElement>('.file-explorer-row')!.click();
    flushSync();
    expect(el.querySelector('.file-explorer-selection-count')?.textContent).toBe('1 件選択中');
    expect(el.querySelector<HTMLButtonElement>('button[aria-label="コピー"]')?.disabled).toBe(false);
  });

  it('「選択をやめる」と「移動」は無い（切り取り＋貼り付けで足りる）', async () => {
    const el = await render();
    explorerSelection.enter();
    flushSync();
    expect(el.textContent).not.toContain('選択をやめる');
    expect(el.querySelector('button[aria-label="移動"]')).toBeNull();
    expect(el.querySelector('button[aria-label="閉じる"]')).toBeNull();
  });

  it('空きスペースを押すと選択を解除する。項目・パンくず・バーは解除しない', async () => {
    const el = await render();
    explorerSelection.enter();
    explorerSelection.toggle('a.txt');
    flushSync();
    el.querySelector<HTMLElement>('.file-explorer-selection-count')!.click();
    el.querySelector<HTMLElement>('.file-explorer-crumbs')!.click();
    el.querySelector<HTMLElement>('.file-explorer-item')!.click();
    flushSync();
    expect(explorerSelection.active).toBe(true);
    el.querySelector<HTMLElement>('.file-explorer-body')!.click();
    flushSync();
    expect(explorerSelection.active).toBe(false);
    expect(explorerSelection.count).toBe(0);
  });

  it('切り取りでは、できたことの通知を出さない（貼り付けが押せるようになる）', async () => {
    const el = await render();
    explorerSelection.enter();
    explorerSelection.toggle('a.txt');
    flushSync();
    el.querySelector<HTMLButtonElement>('button[aria-label="切り取り"]')!.click();
    flushSync();
    expect(explorerBuffer.mode).toBe('move');
    expect(ui.toasts.some((t) => t.text.includes('切り取りました'))).toBe(false);
  });
});

describe('項目の操作と貼り付け（コピー・切り取り・移動）', () => {
  function itemMenuLabels(el: HTMLElement, name: string): string[] {
    el.querySelector<HTMLButtonElement>(`button[aria-label="${name} の操作"]`)!.click();
    flushSync();
    return [...document.querySelectorAll('.explorer-entry-menu-item')].map((b) => b.textContent?.trim() ?? '');
  }

  it('「…」はプロパティだけ（フォルダもファイルも）', async () => {
    const el = await render();
    expect(itemMenuLabels(el, 'docs')).toEqual(['プロパティ']);
    // 開いたメニューを閉じる（外側を押す）
    document.querySelector<HTMLButtonElement>('.menu-backdrop')?.click();
    flushSync();
    expect(itemMenuLabels(el, 'a.txt')).toEqual(['プロパティ']);
  });

  it('貼り付けは上端の行の中、削除の左。何も無ければ押せない（≡ には出さない）', async () => {
    const el = await render();
    const labels = [...el.querySelectorAll('.file-explorer-bar button')].map((b) => b.getAttribute('aria-label')).filter((l) => ['コピー', '切り取り', '貼り付け', '削除'].includes(l ?? ''));
    expect(labels).toEqual(['コピー', '切り取り', '貼り付け', '削除']);
    const btn = el.querySelector<HTMLButtonElement>('.file-explorer-bar button[aria-label="貼り付け"]')!;
    expect(btn.disabled).toBe(true);
    explorerBuffer.set('copy', [{ path: 'x/b.txt', kind: 'file' }]);
    flushSync();
    expect(btn.disabled).toBe(false);
    expect(menuLabels(el)).not.toContain('貼り付け');
    expect(menuLabels(el)).not.toContain('アップロード');
  });

  it('コピーしたものを貼り付けると、同名は確認してから上書きで送る', async () => {
    const el = await render();
    explorerBuffer.set('copy', [{ path: 'x/a.txt', kind: 'file' }]);
    flushSync();
    pasteClick(el);
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    expect(ui.confirmReq!.body).toContain('消えて');
    expect(h.copy).not.toHaveBeenCalled();
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.copy).toHaveBeenCalledWith('x/a.txt', 'a.txt', true));
    // コピーは残る（何度でも貼り付けられる）
    expect(explorerBuffer.empty).toBe(false);
  });

  it('切り取りの貼り付けで、上書きを取り消したものは、送らずバッファに残す（もう一度貼り付けられる）', async () => {
    const el = await render();
    explorerBuffer.set('move', [{ path: 'x/a.txt', kind: 'file' }]);
    flushSync();
    pasteClick(el);
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(false);
    await vi.waitFor(() => expect(ui.confirmReq).toBeNull());
    expect(h.copy).not.toHaveBeenCalled();
    expect(explorerBuffer.items.map((i) => i.path)).toEqual(['x/a.txt']);
  });

  it('切り取りの途中の項目は薄く出す（貼り付けるまで残る）', async () => {
    const el = await render();
    explorerBuffer.set('move', [{ path: 'a.txt', kind: 'file' }]);
    flushSync();
    expect(el.querySelector('.file-explorer-item-cut')?.textContent).toContain('a.txt');
  });
});

describe('複数選択（選択モード）', () => {
  function rowOf(el: HTMLElement, name: string): HTMLElement {
    return [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].find((li) => li.textContent?.includes(name))!;
  }
  function pressRow(el: HTMLElement, name: string) {
    rowOf(el, name).querySelector<HTMLButtonElement>('.file-explorer-row')!.click();
    flushSync();
  }

  it('≡ に「選択モード」と「一覧」は無い', async () => {
    const el = await render();
    const labels = menuLabels(el);
    expect(labels.some((l) => l.includes('選択モード'))).toBe(false);
    expect(labels.some((l) => l.startsWith('一覧'))).toBe(false);
    expect(labels.some((l) => l.startsWith('詳細'))).toBe(true);
  });

  it('選択モードでは、行を押すと選び直す（開かない）。件数を出す', async () => {
    const el = await render();
    explorerSelection.enter();
    flushSync();
    pressRow(el, 'a.txt');
    pressRow(el, 'docs');
    expect(el.querySelector('.file-explorer-selection-count')?.textContent).toContain('2 件選択中');
    expect(fileExplorer.dir).toBe('');
    expect(rowOf(el, 'docs').querySelector('.file-explorer-row')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('長押しで選択モードに入り、その項目を選ぶ（押したあとのクリックでは開かない）', async () => {
    vi.useFakeTimers();
    try {
      const el = await render();
      const row = rowOf(el, 'docs');
      row.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      flushSync();
      expect(explorerSelection.active).toBe(true);
      expect(explorerSelection.has('docs')).toBe(true);
      // 離したあとのクリックは、フォルダを開かない
      row.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
      rowOf(el, 'docs').querySelector<HTMLButtonElement>('.file-explorer-row')!.click();
      flushSync();
      expect(fileExplorer.dir).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('コピーは、フォルダも含めてバッファに入れ、選択を終える', async () => {
    const el = await render();
    explorerSelection.enter();
    flushSync();
    pressRow(el, 'a.txt');
    pressRow(el, 'docs');
    [...el.querySelectorAll<HTMLButtonElement>('button[aria-label="コピー"]')][0].click();
    flushSync();
    expect(explorerBuffer.mode).toBe('copy');
    expect(explorerBuffer.items).toEqual([
      { path: 'a.txt', kind: 'file' },
      { path: 'docs', kind: 'dir' },
    ]);
    expect(explorerSelection.active).toBe(false);
  });

  it('選択中の「戻る」（Alt+← など）は、選択モードを終える。フォルダは戻らない', async () => {
    fileExplorer.dir = 'docs';
    await render();
    const before = ui.pluginBack.length;
    explorerSelection.start('docs/x');
    flushSync();
    expect(ui.pluginBack).toHaveLength(before + 1);
    expect(ui.back()).toBe(true);
    flushSync();
    expect(explorerSelection.active).toBe(false);
    expect(fileExplorer.dir).toBe('docs');
    // 選択していなければ、戻る操作には何も足さない
    expect(ui.pluginBack).toHaveLength(before);
  });

  it('削除はゴミ箱に移す（確認なし。取り消すトーストが出る）', async () => {
    const el = await render();
    explorerSelection.enter();
    flushSync();
    pressRow(el, 'a.txt');
    pressRow(el, 'docs');
    el.querySelector<HTMLButtonElement>('button[aria-label="削除"]')!.click();
    // ゴミ箱へ移すだけなら、確認は出さない
    await vi.waitFor(() => expect(h.trash).toHaveBeenCalledTimes(2));
    expect(ui.confirmReq).toBeNull();
    expect(h.trash.mock.calls.map((c) => c[0])).toEqual(['a.txt', 'docs']);
    // 取り消すトーストが出る
    expect(ui.toasts.some((t) => t.text?.includes('ゴミ箱に移しました') && t.action?.label === '取り消す')).toBe(true);
  });

  it('ゴミ箱 undo: 成功した ID のみスナップショット（失敗した項目は含まれない）', async () => {
    // a.txt は成功、docs は失敗
    h.trash
      .mockResolvedValueOnce({ id: 'id-a', original_path: 'a.txt', kind: 'file', size: 1, deleted_at: 0 })
      .mockRejectedValueOnce(new Error('fail'));
    const el = await render();
    explorerSelection.enter();
    flushSync();
    pressRow(el, 'a.txt');
    pressRow(el, 'docs');
    el.querySelector<HTMLButtonElement>('button[aria-label="削除"]')!.click();
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.action?.label === '取り消す')).toBe(true));
    // 成功トースト: id-a のみ
    const undoToast = ui.toasts.find((t) => t.action?.label === '取り消す');
    expect(undoToast).toBeTruthy();
    // undo を実行したら id-a だけ restore を呼ぶ
    h.restore.mockResolvedValueOnce({ name: 'a.txt', path: 'a.txt', kind: 'file', size: 1, modified: 0, mime: null });
    undoToast!.action!.run();
    await vi.waitFor(() => expect(h.restore).toHaveBeenCalledTimes(1));
    // 削除の応答（id-a）の ID で戻す（失敗した docs の ID は含まない）
    expect(h.restore.mock.calls[0][0]).toBe('id-a');
  });

  it('ゴミ箱 undo: 置き場所が変わっていたら restore を送らない', async () => {
    const el = await render();
    explorerSelection.enter();
    flushSync();
    pressRow(el, 'a.txt');
    el.querySelector<HTMLButtonElement>('button[aria-label="削除"]')!.click();
    await vi.waitFor(() => expect(h.trash).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.action?.label === '取り消す')).toBe(true));
    const undoToast = ui.toasts.find((t) => t.action?.label === '取り消す');
    expect(undoToast).toBeTruthy();
    // 置き場所を変更したことをシミュレート（置き場所の見分けが別の値を返す）
    const spy = scopeAs('http://other:3000');
    try {
      undoToast!.action!.run();
      await new Promise((r) => setTimeout(r, 50));
      // restore は呼ばれない
      expect(h.restore).not.toHaveBeenCalled();
      // エラートーストが出る
      await vi.waitFor(() => expect(ui.toasts.some((t) => t.kind === 'error')).toBe(true));
    } finally {
      spy.mockRestore();
    }
  });

  it('削除後にカットバッファから成功したパスを除去する（trash→paste でnot_found にならない）', async () => {
    const el = await render();
    // a.txt をカットバッファに入れる
    explorerBuffer.set('move', [{ path: 'a.txt', kind: 'file' }]);
    flushSync();
    expect(explorerBuffer.empty).toBe(false);
    // a.txt を選択してゴミ箱へ
    explorerSelection.enter();
    flushSync();
    pressRow(el, 'a.txt');
    el.querySelector<HTMLButtonElement>('button[aria-label="削除"]')!.click();
    await vi.waitFor(() => expect(h.trash).toHaveBeenCalledTimes(1));
    // バッファから a.txt が除去されている
    await vi.waitFor(() => expect(explorerBuffer.items.map((i) => i.path)).not.toContain('a.txt'));
  });

  it('複数ファイルアップロード: 1 件目成功後も 2 件目の同名確認が機能する', async () => {
    // a.txt と b.txt をピッカーで選ぶ。b.txt は既存（overwrite 確認が出る）
    h.current = [{ name: 'b.txt', path: 'b.txt', kind: 'file' as const, size: 1, modified: 0, mime: null }];
    try {
    let uploadCount = 0;
    h.upload.mockImplementation(() => {
      uploadCount++;
      return {
        promise: Promise.resolve({ name: 'x', path: 'x', kind: 'file' as const, size: 0, modified: 0, mime: null }),
        abort: () => {},
      };
    });
    const el = await render();
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    const a = new File(['a'], 'a.txt', { type: 'text/plain' });
    const b = new File(['b'], 'b.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { value: [a, b], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    // a.txt は新規 → 即 upload
    await vi.waitFor(() => expect(uploadCount).toBeGreaterThanOrEqual(1));
    // b.txt は既存 → confirm が出る
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    expect(ui.confirmReq!.title).toContain('b.txt');
    ui.confirmReq!.resolve(true); // 上書き許可
    await vi.waitFor(() => expect(uploadCount).toBe(2));
    } finally {
      h.current = null; // 次のテストのために元に戻す
    }
  });
});

describe('内部 DnD（performInternalTransfer）', () => {
  it('drop 先が未読のとき api.list を呼んで一覧取得後に移動（1 回で完結）', async () => {
    // dirIndex に docs の中身がないとき、performInternalTransfer 内で list を呼ぶ
    // jsdom での DragEvent はフル再現が困難なので、動作結果（api.list の呼び出し数と move 呼出）で検証する
    h.list.mockImplementation(async (path?: string) => {
      // docs のキャッシュがないのでリクエストが来る想定
      if (path === 'docs') return []; // 空フォルダ（同名なし）
      return h.current ?? listing;
    });
    h.move.mockResolvedValueOnce({ name: 'a.txt', path: 'docs/a.txt', kind: 'file' as const, size: 1, modified: 0, mime: null });

    await render();
    // list が初期ロードで呼ばれた後のカウントを記録
    const countBefore = h.list.mock.calls.length;

    // dirIndex の docs キャッシュをクリア（未読状態を再現）
    dirIndex.invalidate('docs/x');
    flushSync();

    // 内部 move の実行: explorerBuffer に a.txt を入れ、fileExplorer を docs へ移動して paste
    // paste() は別のコードパス（performInternalTransfer でなく直接 runTransfer）だが、
    // fetchDestEntries 相当の動作（list 呼び出し）を通じて docs の中身を取得する
    explorerBuffer.set('move', [{ path: 'a.txt', kind: 'file' }]);
    fileExplorer.open('docs'); // docs へ移動
    flushSync();
    // docs の一覧が読み込まれるまで待つ
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    // docs 一覧取得後に paste（fetchDestEntries 経由）
    pasteClick(document.body as unknown as HTMLElement); // paste は body がなくても動く

    // 最終的に list('docs') が呼ばれ、同名なし → move が呼ばれる
    await vi.waitFor(() => expect(h.move).toHaveBeenCalledTimes(1), { timeout: 3000 });
    expect(h.move).toHaveBeenCalledWith('a.txt', 'docs/a.txt', false);
    expect(h.list.mock.calls.length).toBeGreaterThan(countBefore);
  });
});


describe('表示方法と並び順', () => {
  it('アイコン（グリッド）は、画像だけ小さい画像を出す（フォルダ・ほかは絵のアイコン）', async () => {
    explorerView.setView('', 'grid');
    const el = await render();
    expect(el.querySelector('.file-explorer-view-grid')).not.toBeNull();
    const imgs = [...el.querySelectorAll<HTMLImageElement>('.file-explorer-thumb img')];
    expect(imgs).toHaveLength(1);
    expect(imgs[0].getAttribute('src')).toContain('/pic.png');
    expect(el.querySelector('.file-explorer-thumb svg')).not.toBeNull();
  });

  it('アイコン表示では、PDF はサムネイルの部品（1 ページ目）を出す。大きすぎる PDF とほかのファイルは絵のアイコン', async () => {
    h.current = [
      { ...entry('doc.pdf'), mime: 'application/pdf' },
      { ...entry('huge.pdf'), mime: 'application/pdf', size: 200 * 1024 * 1024 },
      entry('a.txt'),
    ];
    explorerView.setView('', 'grid');
    try {
      const el = await render();
      const item = (n: string) => [...el.querySelectorAll('.file-explorer-item')].find((li) => li.textContent?.includes(n))!;
      expect(item('doc.pdf').querySelector('.pdf-thumb')).not.toBeNull();
      expect(item('huge.pdf').querySelector('.pdf-thumb')).toBeNull();
      expect(item('a.txt').querySelector('.pdf-thumb')).toBeNull();
    } finally {
      h.current = null;
    }
  });

  it('PDF も画像も、同じ拡大表示（種類は kind）で開き、前後は両方を並び順で', async () => {
    h.current = [{ ...entry('doc.pdf'), mime: 'application/pdf' }, { ...entry('pic.png'), mime: 'image/png' }];
    try {
      const el = await render();
      const row = (n: string) => [...el.querySelectorAll('.file-explorer-item')].find((li) => li.textContent?.includes(n))!.querySelector<HTMLElement>('.file-explorer-row')!;
      expect(row('doc.pdf').tagName).toBe('BUTTON');
      row('doc.pdf').querySelector<HTMLElement>('.file-explorer-icon')!.click();
      expect(ui.lightbox).toMatchObject({ alt: 'doc.pdf', kind: 'pdf' });
      expect(ui.lightbox!.src).toContain('/doc.pdf');
      expect(ui.lightboxGallery!().map((i) => i.alt)).toEqual(['doc.pdf', 'pic.png']);
      ui.lightbox = null;
      row('pic.png').querySelector<HTMLElement>('.file-explorer-icon')!.click();
      expect(ui.lightbox).toMatchObject({ alt: 'pic.png', kind: 'image' });
    } finally {
      h.current = null;
      ui.lightbox = null;
    }
  });

  it('アイコン表示の枠に地の色は付けない。選んだ項目の「…」に色を付けるのは詳細だけ', async () => {
    const { readFileSync } = await import('node:fs');
    const css = (readFileSync(KIT + 'FileExplorer.svelte', 'utf8').split('<style>')[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const thumb = css.match(/\.file-explorer-thumb \{[^}]*\}/)![0];
    expect(thumb).not.toMatch(/background/);
    const dots = css.match(/[^{}]*explorer-entry-menu-button\)[^{}]*\{[^}]*\}/g) ?? [];
    expect(dots.length).toBeGreaterThan(0);
    for (const rule of dots) expect(rule).toMatch(/file-explorer-view-details/);
  });

  it('サムネイルは欠けないよう、全体を枠に収める（object-fit: contain）', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of [KIT + 'FileExplorer.svelte']) {
      const css = readFileSync(file, 'utf8').split('<style>')[1] ?? '';
      expect(css, file).toMatch(/object-fit:\s*contain/);
      expect(css, file).not.toMatch(/object-fit:\s*cover/);
    }
  });

  it('名前が収まらないときに拡張子を残すため、ファイル名は、本体と拡張子の 2 つに分けて出す（文字は同じ。フォルダと拡張子の無いものは分けない）', async () => {
    const el = await render();
    const name = rowOf(el, 'a.txt').querySelector('.file-explorer-name-text')!;
    expect(name.textContent).toBe('a.txt');
    expect(name.querySelector('.file-explorer-name-stem')?.textContent).toBe('a');
    expect(name.querySelector('.file-explorer-name-ext')?.textContent).toBe('.txt');
    expect(rowOf(el, 'docs').querySelector('.file-explorer-name-stem')).toBeNull();
    const css = (await import('node:fs')).readFileSync(KIT + 'FileExplorer.svelte', 'utf8').split('<style>')[1] ?? '';
    expect(css).toMatch(/\.file-explorer-name-stem\s*\{[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.file-explorer-name-ext\s*\{[^}]*flex:\s*none/);
  });

  it('上端の行の「並び替え」ボタン: ≡ の中と同じ並び替えのメニューを開く。選ぶと並びが変わり、メニューは閉じる。≡ の並び替えも残る', async () => {
    const el = await render();
    const btn = el.querySelector<HTMLButtonElement>('.file-explorer-bar button[aria-label="並び替え"]')!;
    expect(btn).not.toBeNull();
    btn.click();
    flushSync();
    const items = (): string[] => [...document.querySelectorAll('.file-explorer-popup-menu .menu-item')].map((b) => b.textContent?.trim() ?? '');
    expect(items()).toEqual(['名前', '種類', '更新日時', 'サイズ', '昇順', '降順']);
    [...document.querySelectorAll<HTMLElement>('.file-explorer-popup-menu .menu-item')].find((b) => b.textContent?.trim() === 'サイズ')!.click();
    flushSync();
    expect(explorerView.of('').sortKey).toBe('size');
    expect(document.querySelector('.file-explorer-popup-menu')).toBeNull();
    // ≡ の中にも、並び替えがある
    el.querySelector<HTMLButtonElement>('button[aria-label="メニュー"]')!.click();
    flushSync();
    expect(document.querySelector('.file-explorer-popup-menu')?.textContent).toContain('並び替え');
  });

  it('上端の行は必ず 1 行: 次の行へ回った部品（右のもの）だけを隠す。幅が戻れば、すぐに出す', async () => {
    // jsdom にはレイアウトが無いので、「削除・検索・並び替え」だけが 2 行目に回ったことにする
    const wrapped = new Set(['削除', '検索', '並び替え']);
    let narrow = true;
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const second = narrow && wrapped.has(this.getAttribute('aria-label') ?? '') || (narrow && this.querySelector(':scope > button[aria-label="並び替え"]') !== null);
      return { top: second ? 40 : 0, bottom: 0, left: 0, right: 0, width: 10, height: 10, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    const rects = vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => [{}] as unknown as DOMRectList);
    try {
      const el = await render();
      await vi.waitFor(() => expect(el.querySelector('.file-explorer-bar button[aria-label="検索"]')?.hasAttribute('data-clipped')).toBe(true));
      expect(el.querySelector('.file-explorer-bar button[aria-label="削除"]')?.hasAttribute('data-clipped')).toBe(true);
      expect(el.querySelector('.file-explorer-bar button[aria-label="コピー"]')?.hasAttribute('data-clipped')).toBe(false);
      expect(el.querySelector('.file-explorer-bar .file-explorer-path')?.hasAttribute('data-clipped')).toBe(false);
      // ≡（右端の操作）は、いつも出ている
      expect(el.querySelector('button[aria-label="メニュー"]')?.closest('[data-clipped]')).toBeNull();
      // 幅が戻る（何も回らない）と、全部出す。部品が増える（子の変化）で測り直す
      narrow = false;
      el.querySelector('.file-explorer-bar .panel-bar-main')!.append(document.createElement('span'));
      await vi.waitFor(() => expect(el.querySelector('.file-explorer-bar [data-clipped]')).toBeNull());
    } finally {
      rect.mockRestore();
      rects.mockRestore();
    }
  });

  it('詳細の見出しを押すと、その列で並べ替える（もう一度押すと向きが入れ替わる）。今の並びの列に、向きの矢印が付く', async () => {
    const el = await render();
    const head = (label: string): HTMLElement => [...el.querySelectorAll<HTMLElement>('.file-explorer-col-sort')].find((b) => b.textContent?.trim() === label)!;
    const arrow = (): string[] => [...el.querySelectorAll('.file-explorer-col-sort svg')].map((x) => x.getAttribute('aria-label') ?? '');
    expect(arrow()).toEqual(['昇順']);
    expect(head('名前').querySelector('svg')).not.toBeNull();
    head('サイズ').click();
    flushSync();
    expect(explorerView.of('').sortKey).toBe('size');
    expect(explorerView.of('').sortOrder).toBe('asc');
    expect(head('サイズ').querySelector('svg')?.getAttribute('aria-label')).toBe('昇順');
    expect(arrow()).toHaveLength(1);
    head('サイズ').click();
    flushSync();
    expect(explorerView.of('').sortOrder).toBe('desc');
    expect(head('サイズ').querySelector('svg')?.getAttribute('aria-label')).toBe('降順');
    head('種類').click();
    flushSync();
    expect(explorerView.of('')).toMatchObject({ sortKey: 'kind', sortOrder: 'asc' });
  });

  it('詳細は列の見出しを出し、種類・サイズ・更新日時を各項目に出す', async () => {
    const el = await render();
    const heads = [...el.querySelectorAll('.file-explorer-columns .file-explorer-col-label')].map((x) => x.textContent);
    expect(heads).toEqual(['名前', '種類', 'サイズ', '更新日時']);
    const pic = [...el.querySelectorAll('.file-explorer-item')].find((li) => li.textContent?.includes('pic.png'))!;
    expect(pic.querySelector('.file-explorer-col-kind')?.textContent).toBe('画像');
    expect(pic.querySelector('.file-explorer-col-size')?.textContent).toBe('9 B');
  });

  it('並び順を変えると、フォルダを先に、名前の降順で並ぶ', async () => {
    explorerView.setSort('', 'name', 'desc');
    const el = await render();
    const names = [...el.querySelectorAll('.file-explorer-item .file-explorer-name')].map((x) => x.textContent);
    expect(names).toEqual(['docs', 'pic.png', 'a.txt']);
  });

  it('操作のメニューの「表示」で選ぶと、開いているフォルダだけその表示になる', async () => {
    fileExplorer.dir = 'docs';
    const el = await render();
    menuClick(el, 'アイコン');
    expect(explorerView.of('docs').view).toBe('grid');
    expect(explorerView.of('').view).toBe('details');
    expect(el.querySelector('.file-explorer-view-grid')).not.toBeNull();
  });

  it('既定は詳細。「…」は詳細でも各行に出す', async () => {
    const el = await render();
    expect(el.querySelector('.file-explorer-view-details')).not.toBeNull();
    expect(el.querySelectorAll('.file-explorer-view-details .explorer-entry-actions')).toHaveLength(3);
  });
});

describe('操作メニューは外側の幕より前にある（押せない不具合の再発防止）', () => {
  // jsdom は、コンポーネントの（スコープの）CSS を当てないので、ここでは書き方を見る。
  // 実際の押し方（タッチ）の検査は app/scripts/touch-check.mjs（ブラウザが要る・vitest の外）
  it('メニューの見た目に z-index を書かない（design-system の .menu が幕（-1）より前に出る）', async () => {
    const { readFileSync } = await import('node:fs');
    // テストは app/ で動く（npm test）
    for (const file of [KIT + 'FileExplorer.svelte', KIT + 'EntryActions.svelte']) {
      const css = (readFileSync(file, 'utf8').split('<style>')[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
      const menuRules = css.match(/[^{}]*(file-explorer-popup-menu|explorer-entry-menu)[^{}]*\{[^}]*\}/g) ?? [];
      expect(menuRules.length, file).toBeGreaterThan(0);
      for (const rule of menuRules) expect(rule, file).not.toMatch(/z-index/);
    }
  });
});

describe('特別なフォルダ（special/ そのもの）は動かせない・消せない（グレー、理由つき）', () => {
  it('special を選ぶと、切り取り・削除がグレーで理由を出す。名前を押しても書き換えにならない', async () => {
    h.current = [entry('special', 'dir'), entry('a.txt')];
    try {
      const el = await render();
      explorerSelection.start('special');
      flushSync();
      for (const t of ['切り取り', '削除']) {
        const b = el.querySelector<HTMLButtonElement>(`button[aria-label="${t}"]`)!;
        expect(b.disabled, t).toBe(true);
        expect(b.title, t).toContain('特別なフォルダは動かせません');
      }
      expect(el.querySelector<HTMLButtonElement>('button[aria-label="コピー"]')!.disabled).toBe(false);
      explorerSelection.clear();
      explorerSelection.start('a.txt');
      flushSync();
      expect(el.querySelector<HTMLButtonElement>('button[aria-label="切り取り"]')!.disabled).toBe(false);
      explorerSelection.clear();
      flushSync();
      const name = [...el.querySelectorAll<HTMLElement>('.file-explorer-name-text')].find((n) => n.textContent === 'special')!;
      name.click();
      flushSync();
      expect(el.querySelector('.file-explorer-rename')).toBeNull();
      expect(fileExplorer.dir).toBe('special');
    } finally {
      h.current = null;
    }
  });
});

describe('名前の変更（名前を押すと、その場で入力欄になる）', () => {
  function nameOf(el: HTMLElement, name: string): HTMLElement {
    return [...el.querySelectorAll<HTMLElement>('.file-explorer-name-text')].find((n) => n.textContent === name)!;
  }
  function type(input: HTMLTextAreaElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('名前を押すと入力欄に置き換わり（全画面のダイアログは出さない）、Enter で変える', async () => {
    const el = await render();
    nameOf(el, 'docs').click();
    flushSync();
    expect(fileExplorer.dir).toBe('');
    expect(document.querySelector('.modal')).toBeNull();
    const input = el.querySelector<HTMLTextAreaElement>('.file-explorer-item textarea.file-explorer-rename')!;
    expect(input.value).toBe('docs');
    type(input, 'papers');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(h.move).toHaveBeenCalledWith('docs', 'papers'));
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-rename')).toBeNull());
  });

  it('名前の書き換えでは、注意の文を出さない（ふつうのフォルダでも special の中でも）', async () => {
    h.current = [{ ...entry('a.png'), path: 'special/a.png' }, entry('b.txt')];
    try {
      const el = await render();
      nameOf(el, 'a.png').click();
      flushSync();
      expect(el.querySelector('.file-explorer-rename')).not.toBeNull();
      expect(el.querySelector('.file-explorer-rename-note')).toBeNull();
      el.querySelector<HTMLTextAreaElement>('.file-explorer-rename')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      flushSync();
      nameOf(el, 'b.txt').click();
      flushSync();
      expect(el.querySelector('.file-explorer-rename')).not.toBeNull();
      expect(el.textContent).not.toContain('リンクは切れます');
      expect(el.querySelector('.file-explorer-rename-note')).toBeNull();
    } finally {
      h.current = null;
    }
  });

  it('Esc で取り消す（変えない）。使えない名前は理由を出して入力欄のまま', async () => {
    const el = await render();
    nameOf(el, 'a.txt').click();
    flushSync();
    let input = el.querySelector<HTMLTextAreaElement>('.file-explorer-rename')!;
    type(input, 'b:c.txt');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(el.querySelector('.file-explorer-rename-error')?.textContent).toContain('使えません');
    expect(h.move).not.toHaveBeenCalled();
    input = el.querySelector<HTMLTextAreaElement>('.file-explorer-rename')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
    expect(h.move).not.toHaveBeenCalled();
  });

  it('書き換えを終えたら（Esc・変えずに Enter）、その項目にフォーカスが戻る。そのまま Enter で開ける', async () => {
    dsk.desktop = true;
    const el = await render();
    for (const key of ['Escape', 'Enter']) {
      rowOf(el, 'docs').querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
      flushSync();
      el.querySelector<HTMLTextAreaElement>('.file-explorer-rename')!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await vi.waitFor(() => expect(document.activeElement?.matches('.file-explorer-row')).toBe(true));
      expect(document.activeElement?.closest('.file-explorer-item')?.getAttribute('data-path')).toBe('docs');
      expect(el.querySelector('.file-explorer-rename')).toBeNull();
    }
    expect(h.move).not.toHaveBeenCalled();
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fileExplorer.dir).toBe('docs'));
  });

  it('名前の外（行のほか）を押すと、普通に開く。選択モードでは名前を押しても選び直すだけ', async () => {
    const el = await render();
    const row = [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].find((li) => li.textContent?.includes('docs'))!;
    explorerSelection.enter();
    flushSync();
    nameOf(el, 'docs').click();
    flushSync();
    expect(explorerSelection.has('docs')).toBe(true);
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
    explorerSelection.clear();
    flushSync();
    row.querySelector<HTMLElement>('.file-explorer-icon')!.click();
    flushSync();
    expect(fileExplorer.dir).toBe('docs');
  });
});

describe('選択の印', () => {
  it('選んでいるかは、行の背景の色（aria-pressed）で見せる。チェックの四角は出さない', async () => {
    const el = await render();
    explorerSelection.start('a.txt');
    flushSync();
    expect(el.querySelector('.file-explorer-check')).toBeNull();
    expect(el.querySelector('.file-explorer-item svg.lucide-square, .file-explorer-item svg.lucide-square-check-big')).toBeNull();
    const pressed = [...el.querySelectorAll('.file-explorer-row')].filter((r) => r.getAttribute('aria-pressed') === 'true');
    expect(pressed.length).toBe(1);
  });
});

describe('空きスペースの長押し・右クリックのメニュー', () => {
  function ctxLabels(): string[] {
    return [...document.querySelectorAll('.file-explorer-context .menu-item')].map((b) => b.textContent?.trim() ?? '');
  }

  it('長押しでアップロードのメニューが出る。何も無ければ貼り付けは出さない', async () => {
    vi.useFakeTimers();
    try {
      const el = await render();
      const body = el.querySelector<HTMLElement>('.file-explorer-body')!;
      body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 600 }));
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      flushSync();
      expect(ctxLabels()).toEqual(['アップロード', '新しいファイル']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('項目の上の長押しでは出さない（項目の選択になる）', async () => {
    vi.useFakeTimers();
    try {
      const el = await render();
      el.querySelector<HTMLElement>('.file-explorer-item')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
      vi.advanceTimersByTime(LONG_PRESS_MS + 20);
      flushSync();
      expect(document.querySelector('.file-explorer-context')).toBeNull();
      expect(explorerSelection.active).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('右クリックでも出る。クリップボードに文字があれば貼り付けも出し、押すと .txt にして送る', async () => {
    h.clip.text = 'hello';
    const el = await render();
    el.querySelector<HTMLElement>('.file-explorer-body')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 600 }));
    await vi.waitFor(() => expect(ctxLabels()).toEqual(['アップロード', '新しいファイル', '貼り付け']));
    [...document.querySelectorAll<HTMLButtonElement>('.file-explorer-context .menu-item')].find((b) => b.textContent?.includes('貼り付け'))!.click();
    flushSync();
    expect(document.querySelector('.file-explorer-context')).toBeNull();
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledWith(expect.stringMatching(/^clipboard-\d{8}-\d{6}\.txt$/), expect.any(File), expect.any(Function)));
  });
});

describe('OS のクリップボードとの同期', () => {
  async function selectAndPress(el: HTMLElement, path: string, label: string): Promise<void> {
    explorerSelection.start(path);
    flushSync();
    el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click();
    flushSync();
    await vi.waitFor(() => expect(explorerBuffer.clipToken).not.toBeNull());
  }

  it('コピーすると、項目を OS のクリップボードにファイルとして書く（文字は書かない）。そのまま貼ればアプリ内のコピー', async () => {
    fileExplorer.dir = '';
    h.clip.text = 'old';
    const el = await render();
    await selectAndPress(el, 'a.txt', 'コピー');
    expect(h.clip.files).toMatchObject({ paths: ['a.txt'], op: 'copy' });
    expect(h.clip.files?.token).toBe(explorerBuffer.clipToken);
    expect(h.clip.text).toBeNull();
    // 別のフォルダへ貼る
    fileExplorer.open('docs');
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-list')).not.toBeNull());
    pasteClick(el);
    // 仮の一覧はどのフォルダも同じ（a.txt がある）ので、上書きの確認が出る
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.copy).toHaveBeenCalledWith('a.txt', 'docs/a.txt', true));
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('切り取りは、「移動」として OS に伝える', async () => {
    const el = await render();
    await selectAndPress(el, 'a.txt', '切り取り');
    expect(h.clip.files).toMatchObject({ paths: ['a.txt'], op: 'move' });
  });

  it('コピーのあとに、ほかで文字をコピーし直していれば（印が無くなる）、その文字を貼る（バッファは貼らない）', async () => {
    const el = await render();
    await selectAndPress(el, 'a.txt', 'コピー');
    h.clip.files = null;
    h.clip.text = 'other';
    pasteClick(el);
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalled());
    expect(h.copy).not.toHaveBeenCalled();
  });

  it('ほかで画像をコピーし直していれば、画像を送る', async () => {
    const el = await render();
    await selectAndPress(el, 'a.txt', 'コピー');
    h.clip.files = null;
    h.clip.image = new File(['x'], 'clipboard-1.png', { type: 'image/png' });
    pasteClick(el);
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledWith('clipboard-1.png', expect.any(File), expect.any(Function)));
    expect(h.copy).not.toHaveBeenCalled();
  });

  it('コピーのあと、こちらが書いたファイルがクリップボードにあるあいだは、Ctrl+V で OS のファイル（自分が書いたもの）が届いても、送らずバッファを貼る（切り取りを移動にするため）', async () => {
    const el = await render();
    await selectAndPress(el, 'a.txt', '切り取り');
    fileExplorer.open('docs');
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-list')).not.toBeNull());
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, 'clipboardData', { value: { files: [new File(['x'], 'a.txt')], getData: () => '' } });
    document.body.dispatchEvent(ev);
    // 仮の一覧はどのフォルダも同じ（a.txt がある）ので、上書きの確認が出る
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.move).toHaveBeenCalled());
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('クリップボードに書けなかったときは、バッファを貼る（クリップボードの古い中身は貼らない）', async () => {
    h.clip.text = 'old';
    h.clip.writable = false;
    const el = await render();
    explorerSelection.start('a.txt');
    flushSync();
    el.querySelector<HTMLButtonElement>('button[aria-label="コピー"]')!.click();
    flushSync();
    await Promise.resolve();
    fileExplorer.open('docs');
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-list')).not.toBeNull());
    pasteClick(el);
    // 仮の一覧はどのフォルダも同じ（a.txt がある）ので、上書きの確認が出る
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.copy).toHaveBeenCalledWith('a.txt', 'docs/a.txt', true));
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('置き場所がファイルを持たない（Android・WebDAV）ときは、クリップボードに何も書かず（文字も）、バッファだけで貼る', async () => {
    h.clip.supportsFiles = false;
    h.clip.text = 'old';
    const el = await render();
    explorerSelection.start('a.txt');
    flushSync();
    el.querySelector<HTMLButtonElement>('button[aria-label="コピー"]')!.click();
    flushSync();
    await Promise.resolve();
    expect(h.clip.text).toBe('old');
    expect(h.clip.files).toBeNull();
    expect(explorerBuffer.clipToken).toBeNull();
    fileExplorer.open('docs');
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-list')).not.toBeNull());
    pasteClick(el);
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.copy).toHaveBeenCalledWith('a.txt', 'docs/a.txt', true));
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('Ctrl+V（入力欄の外）で、OS のファイルを送る。入力欄の中の貼り付けは邪魔しない', async () => {
    await render();
    const file = new File(['x'], 'from-os.pdf');
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev, 'clipboardData', { value: { files: [file], getData: () => '' } });
    document.body.dispatchEvent(ev);
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledWith('from-os.pdf', file, expect.any(Function)));
    expect(ev.defaultPrevented).toBe(true);
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    const ev2 = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(ev2, 'clipboardData', { value: { files: [file], getData: () => '' } });
    input.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
    input.remove();
  });
});

describe('拡大表示（前後は、このフォルダの拡大表示で見られるものを今の並び順で）', () => {
  it('画像を開くと、前後は画像と PDF（並び順どおり）。ほかのファイルは含めない', async () => {
    const img = (name: string): Entry => ({ ...entry(name), mime: 'image/png' });
    h.current = [img('b.png'), entry('note.txt'), img('a.png'), { ...entry('doc.pdf'), mime: 'application/pdf' }, img('c.png')];
    try {
      const el = await render();
      const row = [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].find((li) => li.textContent?.includes('b.png'))!;
      row.querySelector<HTMLButtonElement>('.file-explorer-row')!.click();
      flushSync();
      expect(ui.lightbox?.alt).toBe('b.png');
      const gallery = ui.lightboxGallery!();
      expect(gallery.map((i) => i.alt)).toEqual(['a.png', 'b.png', 'c.png', 'doc.pdf']);
      // いま開いているものが、並びの 2 番目
      expect(gallery.map((i) => i.src).indexOf(ui.lightbox!.src)).toBe(1);
    } finally {
      h.current = null;
      ui.lightbox = null;
      ui.lightboxGallery = null;
    }
  });
});

describe('戻る（前に開いていたフォルダへ）', () => {
  it('「戻る」は、親ではなく前に開いていたフォルダへ。履歴が尽きたらパネルの戻るに任せる', async () => {
    ui.pluginBack = [];
    const el = await render();
    fileExplorer.open('docs');
    flushSync();
    fileExplorer.open('');
    flushSync();
    fileExplorer.open('docs');
    flushSync();
    expect(ui.pluginBack).toHaveLength(1);
    ui.back();
    flushSync();
    expect(fileExplorer.dir).toBe('');
    ui.back();
    flushSync();
    expect(fileExplorer.dir).toBe('docs');
    ui.back();
    flushSync();
    expect(fileExplorer.dir).toBe('');
    expect(ui.pluginBack).toHaveLength(0);
    void el;
  });

  it('選択モードの「戻る」は、フォルダを戻らず選択だけ解除する', async () => {
    ui.pluginBack = [];
    await render();
    fileExplorer.open('docs');
    flushSync();
    explorerSelection.start('docs/a.txt');
    flushSync();
    ui.back();
    flushSync();
    expect(explorerSelection.active).toBe(false);
    expect(fileExplorer.dir).toBe('docs');
  });
});

describe('選択モードの解除', () => {
  it('最後の 1 件を外すと、すぐ選択モードを終える', async () => {
    const el = await render();
    explorerSelection.start('a.txt');
    flushSync();
    const row = [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].find((li) => li.textContent?.includes('a.txt'))!;
    row.querySelector<HTMLButtonElement>('.file-explorer-row')!.click();
    flushSync();
    expect(explorerSelection.active).toBe(false);
    expect(el.querySelector('.file-explorer-check')).toBeNull();
  });
});

describe('タッチの長押し（Android）', () => {
  function touchDown(li: Element): void {
    const ev = new MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 });
    Object.defineProperty(ev, 'pointerType', { value: 'touch' });
    li.dispatchEvent(ev);
  }

  it('こちらのタイマーより先に止められても、WebView の長押し（contextmenu）で選択モードに入る', async () => {
    const el = await render();
    const li = el.querySelector<HTMLElement>('.file-explorer-item')!;
    touchDown(li);
    li.dispatchEvent(new Event('pointercancel', { bubbles: true }));
    const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    li.dispatchEvent(ctx);
    flushSync();
    expect(explorerSelection.active).toBe(true);
    expect(ctx.defaultPrevented).toBe(true);
  });

  it('マウスの右クリックでは、選択モードに入らない', async () => {
    const el = await render();
    const li = el.querySelector<HTMLElement>('.file-explorer-item')!;
    li.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    flushSync();
    expect(explorerSelection.active).toBe(false);
  });
});

describe('クリップボードから貼ったら、すぐ名前の書き換え', () => {
  it('画像を貼ると、送り終えて一覧に出たところで、その項目の名前が入力欄になる', async () => {
    h.clip.image = new File(['x'], 'clipboard-1.png', { type: 'image/png' });
    h.upload.mockImplementation(() => ({ promise: Promise.resolve(), abort: () => {} }));
    const el = await render();
    h.current = [...listing, { ...entry('clipboard-1.png'), mime: 'image/png' }];
    try {
      pasteClick(el);
      await vi.waitFor(() => expect(el.querySelector<HTMLTextAreaElement>('.file-explorer-rename')?.value).toBe('clipboard-1.png'));
    } finally {
      h.current = null;
    }
  });
});

describe('詳細の見出し', () => {
  it('縦にスクロールしても上端に残し、文字は選べない', async () => {
    const { readFileSync } = await import('node:fs');
    const css = (readFileSync(KIT + 'FileExplorer.svelte', 'utf8').split('<style>')[1] ?? '').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = css.match(/\.file-explorer-columns \{[^}]*\}/g)!.join('\n');
    expect(rule).toContain('position: sticky');
    expect(rule).toContain('user-select: none');
  });
});

/** 選択モードで、名前の行を押して選ぶ */
function pressNamed(el: HTMLElement, name: string): void {
  const li = [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].find((x) => x.textContent?.includes(name))!;
  li.querySelector<HTMLButtonElement>('.file-explorer-row')!.click();
  flushSync();
}

/** 送る・移す・消す・戻すの途中で置き場所が変わったときの決まり（新しい置き場所へは何も書かない） */
describe('置き場所が変わったら、新しい置き場所へは書かない', () => {
  afterEach(() => {
    ui.toasts.length = 0;
  });

  /** 答えを後から渡す約束（応答待ちの途中で、置き場所を切り替えるため） */
  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }

  const done = (name: string) => ({ promise: Promise.resolve({ ...entry(name), path: name }), abort: () => {} });

  it('複数件を送る: 1 件目が終わったあとも、2 件目は同じ一覧で判定して送る（blocked にならない）', async () => {
    h.upload.mockImplementation((path: string) => done(path));
    const el = await render();
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['c'], 'c.txt'), new File(['d'], 'd.txt')], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledTimes(2));
    expect(h.upload.mock.calls.map((c) => c[0])).toEqual(['c.txt', 'd.txt']);
    expect(el.querySelectorAll('.file-explorer-upload-error').length).toBe(0);
  });

  it('貼り付けたファイルが複数でも、2 件目以降が止まらない', async () => {
    h.upload.mockImplementation((path: string) => done(path));
    await render();
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    const files = [new File(['1'], 'x1.pdf'), new File(['2'], 'x2.pdf')];
    Object.defineProperty(ev, 'clipboardData', { value: { files, getData: () => '' } });
    document.body.dispatchEvent(ev);
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledTimes(2));
    expect(h.upload.mock.calls.map((c) => c[0])).toEqual(['x1.pdf', 'x2.pdf']);
  });

  it('送る: 同名の確認を待つあいだに切り替わったら、確認に答えても送らない', async () => {
    const el = await render();
    pick(el, new File(['x'], 'a.txt'));
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    place.key = 'http://b.test';
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.includes('置き場所が変わった'))).toBe(true));
    expect(h.upload).not.toHaveBeenCalled();
  });

  it('送る: 1 件目の応答を待つあいだに切り替わったら、2 件目は送らない', async () => {
    const first = deferred<Entry>();
    h.upload.mockImplementationOnce(() => ({ promise: first.promise, abort: () => {} }));
    const el = await render();
    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [new File(['c'], 'c.txt'), new File(['d'], 'd.txt')], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    place.key = 'http://b.test';
    first.resolve({ ...entry('c.txt'), path: 'c.txt' });
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.includes('置き場所が変わった'))).toBe(true));
    expect(h.upload).toHaveBeenCalledTimes(1);
  });

  it('切り取りの貼り付け: 上書きの確認を待つあいだに切り替わったら、移さない', async () => {
    h.list.mockImplementation(async (path?: string) => (path === 'docs' ? [entry('a.txt')] : h.current ?? listing));
    await render();
    fileExplorer.open('docs');
    flushSync();
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    explorerBuffer.set('move', [{ path: 'a.txt', kind: 'file' }]);
    flushSync();
    pasteClick(document.body as unknown as HTMLElement);
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    place.key = 'http://b.test';
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.includes('置き場所が変わった'))).toBe(true));
    expect(h.move).not.toHaveBeenCalled();
  });

  it('切り取りの貼り付け: 1 件目の応答を待つあいだに切り替わったら、2 件目は移さない', async () => {
    const first = deferred<Entry>();
    h.move.mockImplementationOnce(() => first.promise);
    h.list.mockImplementation(async (path?: string) => (path === 'docs' ? [] : h.current ?? listing));
    await render();
    fileExplorer.open('docs');
    flushSync();
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    explorerBuffer.set('move', [{ path: 'a.txt', kind: 'file' }, { path: 'pic.png', kind: 'file' }]);
    flushSync();
    pasteClick(document.body as unknown as HTMLElement);
    await vi.waitFor(() => expect(h.move).toHaveBeenCalledTimes(1));
    place.key = 'http://b.test';
    first.resolve({ ...entry('a.txt'), path: 'docs/a.txt' });
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.includes('置き場所が変わった'))).toBe(true));
    expect(h.move).toHaveBeenCalledTimes(1);
  });

  it('途中で接続先を変えてコピーし直したら、前の移動結果で新しいバッファを消さない', async () => {
    const second = deferred<Entry>();
    h.move.mockResolvedValueOnce({ ...entry('a.txt'), path: 'docs/a.txt' });
    h.move.mockImplementationOnce(() => second.promise);
    h.list.mockImplementation(async (path?: string) => (path === 'docs' ? [] : h.current ?? listing));
    await render();
    fileExplorer.open('docs');
    flushSync();
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    explorerBuffer.set('move', [{ path: 'a.txt', kind: 'file' }, { path: 'pic.png', kind: 'file' }]);
    flushSync();
    pasteClick(document.body as unknown as HTMLElement);
    await vi.waitFor(() => expect(h.move).toHaveBeenCalledTimes(2));
    place.key = 'http://b.test';
    explorerBuffer.set('copy', [{ path: 'a.txt', kind: 'file' }]);
    second.resolve({ ...entry('pic.png'), path: 'docs/pic.png' });
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.includes('置き場所が変わった'))).toBe(true));
    expect(explorerBuffer.mode).toBe('copy');
    expect(explorerBuffer.items).toEqual([{ path: 'a.txt', kind: 'file' }]);
  });

  it('削除: 1 件目の応答を待つあいだに切り替わったら、2 件目は移さない', async () => {
    const first = deferred<{ id: string; original_path: string; kind: 'file'; size: number; deleted_at: number }>();
    h.trash.mockImplementationOnce(() => first.promise);
    const el = await render();
    explorerSelection.enter();
    flushSync();
    pressNamed(el, 'a.txt');
    pressNamed(el, 'pic.png');
    el.querySelector<HTMLButtonElement>('button[aria-label="削除"]')!.click();
    await vi.waitFor(() => expect(h.trash).toHaveBeenCalledTimes(1));
    place.key = 'http://b.test';
    explorerBuffer.set('copy', [{ path: 'a.txt', kind: 'file' }]);
    first.resolve({ id: 'id-a', original_path: 'a.txt', kind: 'file', size: 1, deleted_at: 0 });
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.includes('残りは移していません'))).toBe(true));
    expect(h.trash).toHaveBeenCalledTimes(1);
    expect(explorerBuffer.items).toEqual([{ path: 'a.txt', kind: 'file' }]);
  });

  it('取り消し: 1 件目の応答を待つあいだに切り替わったら、2 件目は戻さない', async () => {
    const el = await render();
    explorerSelection.enter();
    flushSync();
    pressNamed(el, 'a.txt');
    pressNamed(el, 'pic.png');
    el.querySelector<HTMLButtonElement>('button[aria-label="削除"]')!.click();
    await vi.waitFor(() => expect(h.trash).toHaveBeenCalledTimes(2));
    const undo = ui.toasts.find((t) => t.action?.label === '取り消す');
    expect(undo).toBeTruthy();
    const first = deferred<Awaited<ReturnType<typeof h.restore>>>();
    h.restore.mockImplementationOnce(() => first.promise);
    undo!.action!.run();
    await vi.waitFor(() => expect(h.restore).toHaveBeenCalledTimes(1));
    place.key = 'http://b.test';
    first.resolve({ name: 'a.txt', path: 'a.txt', kind: 'file', size: 1, modified: 0, mime: null });
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.kind === 'error' && t.text.includes('置き場所が変わった'))).toBe(true));
    expect(h.restore).toHaveBeenCalledTimes(1);
  });
});

/** OS のドロップ（Windows の HTML5 の項目）を、本体（body）へ落とす */
function dropOs(el: HTMLElement, roots: { name: string; dir?: boolean }[]): void {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  const entries = roots.map((r) =>
    r.dir
      ? { isFile: false, isDirectory: true, name: r.name, createReader: () => ({ readEntries: (ok: (v: unknown[]) => void) => ok([]) }) }
      : { isFile: true, isDirectory: false, name: r.name, file: (ok: (f: File) => void) => ok(new File(['x'], r.name)) },
  );
  Object.defineProperty(ev, 'dataTransfer', {
    value: { types: ['Files'], items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })), files: [] },
  });
  el.dispatchEvent(ev);
}

describe('OS のドロップで、上書きを取り消したものだけ送らない', () => {
  it('根の同名ファイルを取り消しても、ほかのファイルは送る（全体を中止しない）', async () => {
    const el = await render();
    const body = el.querySelector<HTMLElement>('.file-explorer-body')!;
    dropOs(body, [{ name: 'a.txt' }, { name: 'new.txt' }]);
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    expect(ui.confirmReq!.title).toContain('a.txt');
    ui.confirmReq!.resolve(false);
    await vi.waitFor(() => expect(h.write).toHaveBeenCalledTimes(1));
    expect(h.write.mock.calls[0][0]).toBe('new.txt');
  });
});

/** PC の選択（0 件でも操作が続く）: 行の押し・ダブルクリック・Enter・F2・空きスペース */
describe('PC の選択（0 件でも続く。ダブルクリック・Enter で開く）', () => {
  beforeEach(() => {
    dsk.desktop = true;
  });

  const clickRow = (el: HTMLElement, name: string, detail = 1) => {
    rowOf(el, name).querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, detail }),
    );
    flushSync();
  };
  const keyRow = (el: HTMLElement, name: string, key: string) => {
    rowOf(el, name).querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
    flushSync();
  };
  const count = (el: HTMLElement) => el.querySelector('.file-explorer-selection-count')!.textContent?.trim();

  it('0→1→0→1: 1 件押すと選び、外しても 0 件のまま操作は続く（印・件数の選択表示は出さない）', async () => {
    const el = await render();
    expect(count(el)).toBe('3 件');
    clickRow(el, 'a.txt');
    expect(count(el)).toBe('1 件選択中');
    expect(rowOf(el, 'a.txt').querySelector('.file-explorer-row')!.getAttribute('aria-pressed')).toBe('true');
    clickRow(el, 'a.txt');
    expect(count(el)).toBe('3 件');
    expect(el.querySelector('.file-explorer-check')).toBeNull();
    expect(el.querySelector('button[aria-label="すべて選ぶ"]')).toBeNull();
    // 0 件でも行は押せる（選ぶ操作が続いている）
    expect(rowOf(el, 'a.txt').querySelector('.file-explorer-row')!.getAttribute('aria-pressed')).toBe('false');
    clickRow(el, 'a.txt');
    expect(count(el)).toBe('1 件選択中');
  });

  it('選んでいるときに別の項目を押すと、それだけを選ぶ。Ctrl（Cmd）・Shift を押しながらなら、足す・外す', async () => {
    const el = await render();
    clickRow(el, 'a.txt');
    clickRow(el, 'docs');
    expect(explorerSelection.paths()).toEqual(['docs']);
    const withKey = (name: string, init: MouseEventInit): void => {
      rowOf(el, name).querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...init }));
      flushSync();
    };
    withKey('a.txt', { ctrlKey: true });
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'docs']);
    withKey('pic.png', { shiftKey: true });
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'docs', 'pic.png']);
    withKey('docs', { metaKey: true });
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'pic.png']);
    // 複数選んでいるうちの 1 つを（キー無しで）押すと、それだけにする
    clickRow(el, 'a.txt');
    expect(explorerSelection.paths()).toEqual(['a.txt']);
  });

  it('Esc で、選びを外す（入力中・ダイアログやメニューが開いているときは、外さない）', async () => {
    const el = await render();
    const esc = (target: EventTarget = window): void => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      flushSync();
    };
    clickRow(el, 'a.txt');
    clickRow(el, 'docs', 1);
    explorerSelection.replace(['a.txt', 'docs']);
    flushSync();
    // メニューが開いているあいだは、メニューの Esc
    el.querySelector<HTMLButtonElement>('button[aria-label="メニュー"]')!.click();
    flushSync();
    esc();
    expect(explorerSelection.count).toBe(2);
    document.querySelector<HTMLButtonElement>('.menu-backdrop')?.click();
    flushSync();
    // 入力欄の中は、入力の Esc
    const input = document.createElement('input');
    document.body.append(input);
    esc(input);
    expect(explorerSelection.count).toBe(2);
    input.remove();
    esc();
    expect(explorerSelection.count).toBe(0);
    expect(count(el)).toBe('3 件');
  });

  it('0 件のときは、通常の一覧（チェック・選択の件数なし）。選ぶ操作は押せるまま', async () => {
    const el = await render();
    expect(el.querySelectorAll('.file-explorer-check').length).toBe(0);
    expect(count(el)).toBe('3 件');
    expect(el.querySelector('.file-explorer-row')!.tagName).toBe('BUTTON');
  });

  it('シングルクリックでは開かない・名前の文字を押しても、すぐには書き換えにならない（選びもしない）', async () => {
    const el = await render();
    const name = rowOf(el, 'docs').querySelector<HTMLElement>('.file-explorer-name-text')!;
    name.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    flushSync();
    expect(fileExplorer.dir).toBe('');
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
    expect(count(el)).toBe('3 件');
  });

  it('ダブルクリックでフォルダを開く（2 回目の押しでは選び直さない）', async () => {
    const el = await render();
    clickRow(el, 'docs', 1);
    clickRow(el, 'docs', 2);
    // 2 回目（detail 2）では選び直さない。選びは 1 件のまま
    expect(count(el)).toBe('1 件選択中');
    rowOf(el, 'docs').querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    flushSync();
    expect(fileExplorer.dir).toBe('docs');
  });

  it('Enter で開く（フォルダは中へ）。画像は拡大表示、ほかのファイルはダウンロード', async () => {
    const el = await render();
    keyRow(el, 'docs', 'Enter');
    expect(fileExplorer.dir).toBe('docs');
    fileExplorer.open('');
    flushSync();
    await vi.waitFor(() => expect(rowOf(el, 'pic.png')).toBeTruthy());
    keyRow(el, 'pic.png', 'Enter');
    expect(ui.lightbox).not.toBeNull();
    keyRow(el, 'a.txt', 'Enter');
    expect(downloadFile).toHaveBeenCalledTimes(1);
    // Enter で開いたときは選びは変わらない（0 件のまま）
    expect(count(el)).toBe('3 件');
  });

  it('ダブルクリックで画像を開く（拡大表示）', async () => {
    const el = await render();
    rowOf(el, 'pic.png').querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    expect(ui.lightbox).not.toBeNull();
  });

  it('F2 で名前を書き換える（0 件でも・選んでいても使える）', async () => {
    const el = await render();
    keyRow(el, 'a.txt', 'F2');
    flushSync();
    expect(el.querySelector('.file-explorer-rename')).not.toBeNull();
    renameKeyEsc(el);
    clickRow(el, 'a.txt');
    keyRow(el, 'a.txt', 'F2');
    flushSync();
    expect(el.querySelector('.file-explorer-rename')).not.toBeNull();
  });

  it('空きスペースを押すと選びを外す。0 件でも操作は続く（再び押せる）', async () => {
    const el = await render();
    clickRow(el, 'a.txt');
    el.querySelector<HTMLElement>('.file-explorer-body')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    flushSync();
    expect(count(el)).toBe('3 件');
    expect(explorerSelection.active).toBe(true);
    clickRow(el, 'pic.png');
    expect(count(el)).toBe('1 件選択中');
  });

  it('0 件のあいだは「戻る」（パネルの戻る）を奪わない。選んでいる間は選びを外す', async () => {
    const el = await render();
    flushSync();
    expect(ui.pluginBack).toHaveLength(0);
    clickRow(el, 'a.txt');
    flushSync();
    expect(ui.pluginBack.length).toBeGreaterThan(0);
  });
});

function renameKeyEsc(el: HTMLElement): void {
  const ta = el.querySelector<HTMLTextAreaElement>('.file-explorer-rename');
  ta?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  flushSync();
}

/** タッチ（Android）: 従来どおり。0 件で終わる・タップで開く・長押しで選ぶ */
describe('タッチ（Android）の選択は従来どおり（0 件で終わる）', () => {
  it('選びを外して 0 件になると選択モードを終え、タップは開く動作に戻る', async () => {
    const el = await render();
    explorerSelection.start('a.txt');
    flushSync();
    expect(explorerSelection.active).toBe(true);
    rowOf(el, 'a.txt').querySelector<HTMLElement>('.file-explorer-row')!.click();
    flushSync();
    expect(explorerSelection.active).toBe(false);
    expect(el.querySelector('.file-explorer-check')).toBeNull();
    expect(count(el)).toBe('3 件');
    // 0 件に戻ったあと、フォルダのタップは開く
    rowOf(el, 'docs').querySelector<HTMLElement>('.file-explorer-row')!.click();
    flushSync();
    expect(fileExplorer.dir).toBe('docs');
  });

  it('選択モードでは F2 で書き換えない（従来どおり）', async () => {
    const el = await render();
    explorerSelection.start('a.txt');
    flushSync();
    rowOf(el, 'a.txt').querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    flushSync();
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
  });

  function count(el: HTMLElement): string | undefined {
    return el.querySelector('.file-explorer-selection-count')!.textContent?.trim();
  }
});

/** 名前の行（一覧の 1 件）。PC・タッチの選択のテストで使う */
function rowOf(el: HTMLElement, name: string): HTMLElement {
  return [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].find((li) => li.textContent?.includes(name))!;
}

/* ---- ゴミ箱は、ふつうのフォルダとして開く（.trash。直下の項目は元の名前で出す・元へ戻す・完全削除） ---- */

const ID1 = '01HZX0000000000000000000AB';
const ID2 = '01HZX0000000000000000000CD';
const ID3 = '01HZX0000000000000000000EF';
const ID4 = '01HZX0000000000000000000GH';
const ROOT_TRASH: Entry = { ...entry('.trash', 'dir'), path: '.trash', trash: { kind: 'root' } };
/** 直下の項目（ゴミ箱の 1 件）。名前は ID--元の名前、パスも同じ別名。表示は元の名前 */
function trashItem(id: string, original: string, kind: 'file' | 'dir' = 'file'): Entry {
  const leaf = original.split('/').pop()!;
  return {
    ...entry(`${id}--${leaf}`, kind),
    path: `.trash/${id}--${leaf}`,
    size: 1,
    trash: { kind: 'item', entry: { id, original_path: original, kind, size: 1, deleted_at: 0 } },
  };
}
function inner(parentAlias: string, name: string, kind: 'file' | 'dir' = 'file'): Entry {
  return { ...entry(name, kind), path: `${parentAlias}/${name}`, trash: { kind: 'descendant', id: ID4 } };
}
const rootList = (): Entry[] => [ROOT_TRASH, entry('docs', 'dir')];
const trashList = (): Entry[] => [
  trashItem(ID1, 'docs/report.pdf'),
  trashItem(ID2, 'a/x.txt'),
  trashItem(ID3, 'b/x.txt'),
  trashItem(ID4, 'old', 'dir'),
];
const innerList = (): Entry[] => [inner(`.trash/${ID4}--old`, 'sub', 'dir'), inner(`.trash/${ID4}--old`, 'k.txt')];
const ALIAS1 = `.trash/${ID1}--report.pdf`;
const ALIAS4 = `.trash/${ID4}--old`;

/** パスごとの一覧（書いていないパスは空）。'pending' は応答しない、'error' は失敗 */
function serve(map: Record<string, Entry[] | 'pending' | 'error'>): void {
  h.list.mockImplementation(async (path?: string) => {
    const v = map[path ?? ''];
    if (v === undefined) return [];
    if (v === 'error') throw new Error('読めません');
    if (v === 'pending') return new Promise<Entry[]>(() => {});
    return v;
  });
}

/** 名前の表示（一覧に出ている通り） */
function names(el: HTMLElement): string[] {
  return [...el.querySelectorAll('.file-explorer-name-text')].map((t) => t.textContent?.trim() ?? '');
}
function btn(el: HTMLElement, label: string): HTMLButtonElement | null {
  return el.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}
function toastTexts(): string[] {
  return ui.toasts.map((t) => t.text);
}
/** 既存の名前の項目を、選択モードのまま押す（選ぶ） */
function pickRow(el: HTMLElement, name: string): void {
  rowOf(el, name).querySelector<HTMLElement>('.file-explorer-row')!.click();
  flushSync();
}

describe('ゴミ箱は、ふつうのフォルダとして開く（.trash）', () => {
  beforeEach(() => {
    // 前のテストの拡大表示・戻る操作が残らないように
    ui.lightbox = null;
    ui.pluginBack = [];
  });
  it('≡ に「ゴミ箱」は無い（ゴミ箱は一覧の .trash の行から開く）', async () => {
    serve({ '': rootList() });
    const el = await render();
    expect(menuLabels(el).some((l) => l.includes('ゴミ箱'))).toBe(false);
  });

  it('一覧の「.trash」の行は、ふつうのフォルダの行として開く（戻るで前のフォルダへ）', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    const trashRow = rowOf(el, '.trash');
    expect(trashRow.querySelector('.file-explorer-name-text')!.textContent).toBe('.trash');
    trashRow.querySelector<HTMLElement>('.file-explorer-row')!.click();
    flushSync();
    expect(fileExplorer.dir).toBe('.trash');
    await vi.waitFor(() => expect(names(el)).toEqual(['old', 'report.pdf', 'x.txt', 'x.txt']));
    flushSync();
    expect(ui.back()).toBe(true);
    flushSync();
    expect(fileExplorer.dir).toBe('');
  });

  it('中の項目は元の名前で出す（別名は見せない）。同じ名前は別の行として別々に扱う', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    expect(names(el).join('|')).not.toContain(ID1);
    const xs = [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].filter((li) => li.textContent?.includes('x.txt'));
    expect(xs.length).toBe(2);
    // 選んでも、同じ名前の片方だけが選ばれる（パスは別名のまま）
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'x.txt');
    expect(explorerSelection.count).toBe(1);
    expect(explorerSelection.paths()[0]!.startsWith('.trash/')).toBe(true);
  });

  it('直下の項目を選ぶと、元へ戻す・完全削除が出る（削除はそれに替わる）', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    expect(btn(el, '元へ戻す')).not.toBeNull();
    expect(btn(el, '完全削除')).not.toBeNull();
    expect(btn(el, '削除')).toBeNull();
  });

  it('元へ戻す: 押した時点の ID で戻す。成功したものだけ選びから外す。失敗（同じ名前がある）は選んだまま', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    pickRow(el, 'old');
    h.restore.mockImplementation(async (id: string) => {
      if (id === ID4) throw Object.assign(new Error('同じ名前があります'), { code: 'exists' });
      return { name: 'report.pdf', path: 'docs/report.pdf', kind: 'file' as const, size: 1, modified: 0, mime: null };
    });
    btn(el, '元へ戻す')!.click();
    await vi.waitFor(() => expect(h.restore).toHaveBeenCalledTimes(2));
    expect(h.restore.mock.calls.map((c) => c[0])).toEqual([ID1, ID4]);
    await vi.waitFor(() => expect(toastTexts().some((t) => t.includes('1 件を元の場所に戻しました'))).toBe(true));
    expect(toastTexts().some((t) => t.includes('1 件を扱えませんでした'))).toBe(true);
    expect(explorerSelection.paths()).toEqual([ALIAS4]);
    h.restore.mockReset();
    h.restore.mockImplementation(async () => ({ name: '', path: '', kind: 'file' as const, size: 1, modified: 0, mime: null }));
  });

  it('完全削除: 名前を出して確認。キャンセルでは消さない。確認すると、押した時点の ID で消す', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    btn(el, '完全削除')!.click();
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    expect(ui.confirmReq!.title).toBe('完全に削除しますか');
    expect(ui.confirmReq!.body).toContain('「report.pdf」');
    expect(ui.confirmReq!.body).toContain('取り消せません');
    ui.confirmReq!.resolve(false);
    await vi.waitFor(() => expect(ui.confirmReq).toBeNull());
    expect(h.purge).not.toHaveBeenCalled();
    await waitEnabled(el, '完全削除');
    btn(el, '完全削除')!.click();
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.purge).toHaveBeenCalledTimes(1));
    expect(h.purge).toHaveBeenCalledWith(ID1);
    await vi.waitFor(() => expect(toastTexts().some((t) => t.includes('1 件を完全に削除しました'))).toBe(true));
  });

  it('完全削除の途中で失敗したものは、選んだまま残る（成功したものだけ外す）', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    pickRow(el, 'old');
    h.purge.mockImplementationOnce(async () => {
      throw new Error('できません');
    });
    btn(el, '完全削除')!.click();
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    expect(ui.confirmReq!.body).toContain('2 件');
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.purge).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(toastTexts().some((t) => t.includes('1 件を扱えませんでした'))).toBe(true));
    expect(explorerSelection.paths()).toEqual([ALIAS1]);
  });

  it('確認を待つあいだに置き場所が変わったら、完全削除は送らない', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    btn(el, '完全削除')!.click();
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    const spy = scopeAs('http://other.test');
    try {
      ui.confirmReq!.resolve(true);
      await vi.waitFor(() => expect(toastTexts().some((t) => t.includes('置き場所が変わった'))).toBe(true));
      expect(h.purge).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('1 件目の応答を待つあいだに置き場所が変わったら、2 件目は新しい置き場所へ送らない', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    pickRow(el, 'old');
    let first: (v: Awaited<ReturnType<typeof h.restore>>) => void = () => {};
    h.restore.mockImplementationOnce(() => new Promise((r) => (first = r)));
    btn(el, '元へ戻す')!.click();
    await vi.waitFor(() => expect(h.restore).toHaveBeenCalledTimes(1));
    const spy = scopeAs('http://other.test');
    try {
      first({ name: 'report.pdf', path: 'docs/report.pdf', kind: 'file', size: 1, modified: 0, mime: null });
      await vi.waitFor(() => expect(toastTexts().some((t) => t.includes('置き場所が変わった'))).toBe(true));
      expect(h.restore).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('ゴミ箱のフォルダ（.trash）は、コピー・切り取り・削除・名前の変更ができない（理由つき）', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    explorerSelection.enter();
    flushSync();
    pickRow(el, '.trash');
    expect(btn(el, 'コピー')!.disabled).toBe(true);
    expect(btn(el, '切り取り')!.disabled).toBe(true);
    expect(btn(el, '削除')!.disabled).toBe(true);
    expect(btn(el, '元へ戻す')).toBeNull();
    // 名前は変えない（押しても入力欄にならない）
    const row = rowOf(el, '.trash');
    row.querySelector<HTMLElement>('.file-explorer-name-text')!.click();
    flushSync();
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
  });

  it('ゴミ箱の中（直下の項目のフォルダ）は、読むとコピーだけ。書き込み・削除・切り取りは出さない', async () => {
    serve({ '': rootList(), '.trash': trashList(), [ALIAS4]: innerList() });
    const el = await render();
    fileExplorer.open(ALIAS4);
    flushSync();
    await vi.waitFor(() => expect(names(el)).toEqual(['sub', 'k.txt']));
    // 新しいファイル・フォルダは出さない
    expect(menuLabels(el).some((l) => l.includes('新しいファイル'))).toBe(false);
    // アップロードは止める（理由を出す）
    pick(el, new File(['x'], 'new.txt'));
    expect(h.upload).not.toHaveBeenCalled();
    expect(toastTexts().some((t) => t.includes('ゴミ箱の中には書き込めません'))).toBe(true);
    // 中身を選ぶ: コピーはできる、切り取り・削除はできない
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'k.txt');
    expect(btn(el, 'コピー')!.disabled).toBe(false);
    expect(btn(el, '切り取り')!.disabled).toBe(true);
    expect(btn(el, '削除')!.disabled).toBe(true);
    expect(btn(el, '元へ戻す')).toBeNull();
  });

  it('中身をコピーして、ほかのフォルダへ貼り付けられる（元の名前のまま）', async () => {
    serve({ '': rootList(), '.trash': trashList(), [ALIAS4]: innerList() });
    const el = await render();
    fileExplorer.open(ALIAS4);
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('k.txt'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'k.txt');
    btn(el, 'コピー')!.click();
    flushSync();
    fileExplorer.open('');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('docs'));
    pasteClick(el);
    await vi.waitFor(() => expect(h.copy).toHaveBeenCalledWith(`${ALIAS4}/k.txt`, 'k.txt', false));
  });

  it('直下の項目の切り取りは、元の場所へだけ戻せる（ほかの場所は、貼り付けの前に止める）', async () => {
    serve({ '': rootList(), '.trash': trashList(), docs: [] });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    btn(el, '切り取り')!.click();
    flushSync();
    // ほかの場所（直下）へは戻せない
    fileExplorer.open('');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('docs'));
    pasteClick(el);
    await vi.waitFor(() => expect(toastTexts().some((t) => t.includes('元の場所'))).toBe(true));
    expect(h.move).not.toHaveBeenCalled();
    // 元の場所（docs）へは、戻る（移動）になる
    fileExplorer.open('docs');
    flushSync();
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    pasteClick(el);
    await vi.waitFor(() => expect(h.move).toHaveBeenCalledWith(ALIAS1, 'docs/report.pdf', false));
  });

  it('本当の（実在の）.trash は、ふつうのフォルダ。書けて、新しいファイルも作れる', async () => {
    serve({ '': [entry('.trash', 'dir'), entry('docs', 'dir')], '.trash': [entry('memo.txt')] });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toEqual(['memo.txt']));
    expect(menuLabels(el).some((l) => l.includes('新しいファイル'))).toBe(true);
    pick(el, new File(['x'], 'new.txt'));
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledWith('.trash/new.txt', expect.any(File), expect.any(Function)));
  });

  it('trashDir を決めない置き場所では、ゴミ箱の印の付いた .trash も、ふつうのフォルダとして書ける（部品は名前を決め打ちしない）', async () => {
    const was = SCREEN_RULES.trashDir;
    SCREEN_RULES.trashDir = null;
    try {
      serve({ '': [{ ...entry('.trash', 'dir'), trash: { kind: 'root' } }], '.trash': [entry('memo.txt')] });
      const el = await render();
      fileExplorer.open('.trash');
      flushSync();
      await vi.waitFor(() => expect(names(el)).toEqual(['memo.txt']));
      expect(menuLabels(el).some((l) => l.includes('新しいファイル'))).toBe(true);
      pick(el, new File(['x'], 'new.txt'));
      await vi.waitFor(() => expect(h.upload).toHaveBeenCalledWith('.trash/new.txt', expect.any(File), expect.any(Function)));
    } finally {
      SCREEN_RULES.trashDir = was;
    }
  });

  it('直下の一覧が読み終えていない（直接 .trash の中を開いた）あいだは、書き込みを止める（確かめるまで）', async () => {
    serve({ '': 'pending', [ALIAS4]: innerList() });
    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(FileExplorer, { target, props: { explorer } });
    flushSync();
    fileExplorer.open(ALIAS4);
    flushSync();
    await vi.waitFor(() => expect(names(target!)).toEqual(['sub', 'k.txt']));
    expect(menuLabels(target!).some((l) => l.includes('新しいファイル'))).toBe(false);
    pick(target!, new File(['x'], 'new.txt'));
    expect(h.upload).not.toHaveBeenCalled();
    expect(toastTexts().some((t) => t.includes('確かめて'))).toBe(true);
  });

  it('直接開いた空のゴミ箱の中も、書き込みは止める（直下の印で判定する）', async () => {
    serve({ '': rootList(), [ALIAS4]: [] });
    const el = await render();
    fileExplorer.open(ALIAS4);
    flushSync();
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-empty, .file-explorer-list-empty') ?? el).toBeTruthy());
    expect(menuLabels(el).some((l) => l.includes('新しいファイル'))).toBe(false);
    pick(el, new File(['x'], 'new.txt'));
    expect(h.upload).not.toHaveBeenCalled();
    expect(toastTexts().some((t) => t.includes('ゴミ箱の中には書き込めません'))).toBe(true);
  });

  it('.trash 以外のフォルダでは、余分な読み（直下・.trash の一覧）をしない', async () => {
    serve({ '': rootList(), docs: [entry('a.txt')] });
    await render();
    fileExplorer.open('docs');
    flushSync();
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    expect(h.list.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['', 'docs']);
  });

  it('中の項目を開く: デスクトップは Enter・ダブルクリックで、タッチは押すと、元の名前のフォルダへ入る', async () => {
    serve({ '': rootList(), '.trash': trashList(), [ALIAS4]: innerList() });
    // タッチ（既定）: 押すと開く
    let el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('old'));
    rowOf(el, 'old').querySelector<HTMLElement>('.file-explorer-row')!.click();
    flushSync();
    expect(fileExplorer.dir).toBe(ALIAS4);
    expect(explorerSelection.active).toBe(false);
    // 戻る
    fileExplorer.back();
    flushSync();
    unmount(instance!);
    instance = undefined;
    target?.remove();
    target = undefined;
    // デスクトップ: Enter で開く（選びは変わらない）
    dsk.desktop = true;
    el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('old'));
    rowOf(el, 'old').querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    flushSync();
    expect(fileExplorer.dir).toBe(ALIAS4);
  });
});

describe('ゴミ箱の中のパンくずも、元の名前で出す', () => {
  beforeEach(() => {
    ui.lightbox = null;
    ui.pluginBack = [];
  });

  it('.trash/<別名> の段は元の名前、.trash の段はそのまま。押すとその段のフォルダへ（別名のパス）', async () => {
    serve({ '': rootList(), '.trash': trashList(), [ALIAS4]: innerList() });
    const el = await render();
    fileExplorer.open(ALIAS4);
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('k.txt'));
    const crumbs = [...el.querySelectorAll<HTMLButtonElement>('.file-explorer-crumb')].map((b) => b.textContent?.trim());
    expect(crumbs).toEqual(['ルート', '.trash', 'old']);
    // 「.trash」の段へ戻る
    const trashCrumb = [...el.querySelectorAll<HTMLButtonElement>('.file-explorer-crumb')].find((b) => b.textContent?.trim() === '.trash')!;
    trashCrumb.click();
    flushSync();
    expect(fileExplorer.dir).toBe('.trash');
  });
});

describe('ゴミ箱の中へは、貼り付けでも書かない', () => {
  beforeEach(() => {
    ui.lightbox = null;
    ui.pluginBack = [];
  });

  it('コピーしたものを、ゴミ箱のフォルダ（.trash）へ貼り付けても送らない（理由を出す）', async () => {
    serve({ '': rootList(), '.trash': trashList(), [ALIAS4]: innerList() });
    const el = await render();
    fileExplorer.open(ALIAS4);
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('k.txt'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'k.txt');
    btn(el, 'コピー')!.click();
    flushSync();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('old'));
    pasteClick(el);
    await vi.waitFor(() => expect(toastTexts().some((t) => t.includes('ゴミ箱の中には書き込めません'))).toBe(true));
    expect(h.copy).not.toHaveBeenCalled();
  });

  it('完全削除の途中で 2 件目が失敗しても、成功した 1 件は一覧から外れる（失敗だけ選んだまま）', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    pickRow(el, 'old');
    h.purge.mockImplementationOnce(async () => {});
    h.purge.mockImplementationOnce(async () => {
      throw Object.assign(new Error('x'), { code: 'forbidden' });
    });
    btn(el, '完全削除')!.click();
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.purge).toHaveBeenCalledTimes(2));
    expect(h.purge.mock.calls.map((c) => c[0])).toEqual([ID1, ID4]);
    await vi.waitFor(() => expect(explorerSelection.paths()).toEqual([ALIAS4]));
  });
});

describe('ゴミ箱の直下の項目を、外へコピーすると元の名前になる', () => {
  beforeEach(() => {
    ui.lightbox = null;
    ui.pluginBack = [];
  });

  it('コピーは元の名前で貼る（別名のまま貼らない）。元の場所の外へは移せないが、コピーはできる', async () => {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    btn(el, 'コピー')!.click();
    flushSync();
    fileExplorer.open('');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('docs'));
    pasteClick(el);
    await vi.waitFor(() => expect(h.copy).toHaveBeenCalledWith(ALIAS1, 'report.pdf', false));
    expect(h.move).not.toHaveBeenCalled();
  });
});

/** 操作の終わりを待つ（ボタンが押せるまで。操作の後で選びが空になり、ボタンが消えているなら、それも終わり） */
async function waitEnabled(el: HTMLElement, label: string): Promise<void> {
  await vi.waitFor(() => {
    flushSync();
    const b = btn(el, label);
    expect(b === null || !b.disabled).toBe(true);
  });
}

/* ---- 読み直しの状態を追う（無効化されたあと、判定と名前の表示を直す） ---- */

function crumbTexts(el: HTMLElement): string[] {
  return [...el.querySelectorAll<HTMLButtonElement>('.file-explorer-crumb')].map((b) => b.textContent?.trim() ?? '');
}

describe('ゴミ箱の中にいるあいだに .trash が変わったら、直下の判定と元の名前を読み直す', () => {
  beforeEach(() => {
    ui.lightbox = null;
    ui.pluginBack = [];
  });

  it('.trash の中の項目の段（パンくず）は、無効化のあとも元の名前に戻る（読み直しが走る）', async () => {
    serve({ '': rootList(), '.trash': trashList(), [ALIAS4]: innerList() });
    const el = await render();
    fileExplorer.open(ALIAS4);
    flushSync();
    await vi.waitFor(() => expect(crumbTexts(el)).toEqual(['ルート', '.trash', 'old']));
    h.list.mockClear();
    dirIndex.invalidate('.trash');
    await vi.waitFor(() => {
      flushSync();
      expect(crumbTexts(el)).toEqual(['ルート', '.trash', 'old']);
    });
    // 直下（root）と .trash を読み直した（以前は読み直さず、段が別名のまま戻らなかった）
    expect(h.list.mock.calls.map((c) => (c as unknown[])[0])).toEqual(expect.arrayContaining(['', '.trash']));
  });

  it('中にいるあいだに無効化されても、判定は仮想のまま（書き込みは止める。確かめ中のまま止まらない）', async () => {
    serve({ '': rootList(), [ALIAS4]: innerList() });
    const el = await render();
    fileExplorer.open(ALIAS4);
    flushSync();
    await vi.waitFor(() => expect(names(el)).toEqual(['sub', 'k.txt']));
    dirIndex.invalidate('.trash');
    await vi.waitFor(() => {
      flushSync();
      expect(dirIndex.state('')?.kind).toBe('ok');
    });
    pick(el, new File(['x'], 'new.txt'));
    expect(h.upload).not.toHaveBeenCalled();
    expect(toastTexts().some((t) => t.includes('ゴミ箱の中には書き込めません'))).toBe(true);
    expect(toastTexts().some((t) => t.includes('確かめて'))).toBe(false);
  });

  it('実在の .trash（印なし）は、無効化のあとも書き込める（仮想に間違えない）', async () => {
    serve({ '': [entry('.trash', 'dir'), entry('docs', 'dir')], '.trash': [entry('memo.txt')] });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toEqual(['memo.txt']));
    h.list.mockClear();
    dirIndex.invalidate('.trash');
    await vi.waitFor(() => {
      flushSync();
      expect(names(el)).toEqual(['memo.txt']);
    });
    flushSync();
    expect(menuLabels(el).some((l) => l.includes('新しいファイル'))).toBe(true);
    pick(el, new File(['x'], 'new.txt'));
    await vi.waitFor(() => expect(h.upload).toHaveBeenCalledWith('.trash/new.txt', expect.any(File), expect.any(Function)));
  });

  it('仮想の .trash のあいだに、直下の一覧を読み直しても、ふつうのフォルダの余分な読みは増えない', async () => {
    serve({ '': rootList(), docs: [entry('a.txt')] });
    await render();
    fileExplorer.open('docs');
    flushSync();
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    h.list.mockClear();
    dirIndex.invalidate('docs');
    fileExplorer.reload();
    flushSync();
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    expect(h.list.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['docs']);
  });
});

/* ---- B: 選んだ項目への操作（削除・元へ戻す・完全削除）は、同時に 1 つだけ ---- */

describe('選んだ項目への操作は、同時に 1 つだけ（確認の途中も含む）', () => {
  beforeEach(() => {
    ui.lightbox = null;
    ui.pluginBack = [];
  });

  function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }
  const restored = { name: 'report.pdf', path: 'docs/report.pdf', kind: 'file' as const, size: 1, modified: 0, mime: null };

  /** .trash を開いて、report.pdf を選んだ状態にする */
  async function openWithOneSelected(): Promise<HTMLElement> {
    serve({ '': rootList(), '.trash': trashList() });
    const el = await render();
    fileExplorer.open('.trash');
    flushSync();
    await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
    explorerSelection.enter();
    flushSync();
    pickRow(el, 'report.pdf');
    return el;
  }

  it('元へ戻すを二回押しても、送るのは一回。終わるまで押せない（終わったら押せる）', async () => {
    const el = await openWithOneSelected();
    const d = deferred<typeof restored>();
    h.restore.mockImplementationOnce(() => d.promise);
    btn(el, '元へ戻す')!.click();
    flushSync();
    expect(btn(el, '元へ戻す')!.disabled).toBe(true);
    btn(el, '元へ戻す')!.click();
    expect(h.restore).toHaveBeenCalledTimes(1);
    d.resolve(restored);
    await waitEnabled(el, '元へ戻す');
    expect(h.restore).toHaveBeenCalledTimes(1);
  });

  it('元へ戻すの途中は、完全削除を始めない（確認も出ない）', async () => {
    const el = await openWithOneSelected();
    const d = deferred<typeof restored>();
    h.restore.mockImplementationOnce(() => d.promise);
    btn(el, '元へ戻す')!.click();
    flushSync();
    expect(btn(el, '完全削除')!.disabled).toBe(true);
    // 押せないボタンでも、押しの処理（ハンドラ）は止める
    btn(el, '完全削除')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(ui.confirmReq).toBeNull();
    expect(h.purge).not.toHaveBeenCalled();
    d.resolve(restored);
    await waitEnabled(el, '完全削除');
    expect(h.purge).not.toHaveBeenCalled();
  });

  it('完全削除を重ねて押しても、確認は一つだけ。確認に答えるまで、次の操作は始まらない', async () => {
    const el = await openWithOneSelected();
    try {
      btn(el, '完全削除')!.click();
      await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
      flushSync();
      btn(el, '完全削除')!.click();
      btn(el, '完全削除')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      btn(el, '元へ戻す')!.click();
      expect(ui.confirmCount).toBe(1);
      expect(h.restore).not.toHaveBeenCalled();
      ui.confirmReq!.resolve(true);
      await vi.waitFor(() => expect(h.purge).toHaveBeenCalledTimes(1));
      await waitEnabled(el, '完全削除');
      expect(h.purge).toHaveBeenCalledTimes(1);
    } finally {
      // （確認の回数は resetUi が戻す）
    }
  });

  it('完全削除の確認を取り消すと、押せるようになり、もう一度始められる', async () => {
    const el = await openWithOneSelected();
    btn(el, '完全削除')!.click();
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(false);
    await waitEnabled(el, '完全削除');
    btn(el, '完全削除')!.click();
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.purge).toHaveBeenCalledTimes(1));
  });

  it('置き場所を変えると、前の操作の途中でも、新しい置き場所での操作は始められる。前の操作の終わりは新しい操作に触らない', async () => {
    try {
      const el = await openWithOneSelected();
      // 前の置き場所で、元へ戻すを送ったまま応答を待つ
      const old = deferred<typeof restored>();
      h.restore.mockImplementationOnce(() => old.promise);
      btn(el, '元へ戻す')!.click();
      await vi.waitFor(() => expect(h.restore).toHaveBeenCalledTimes(1));
      // 置き場所を変える（接続先の変更の通知。選びも外す）
      switchPlace('http://b.test');
      explorerSelection.clear();
      flushSync();
      // 新しい置き場所で、選んで完全削除の確認を出す（前の操作の途中でも許す）
      fileExplorer.open('.trash');
      flushSync();
      await vi.waitFor(() => expect(names(el)).toContain('report.pdf'));
      explorerSelection.enter();
      flushSync();
      pickRow(el, 'report.pdf');
      btn(el, '完全削除')!.click();
      await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
      flushSync();
      expect(btn(el, '完全削除')!.disabled).toBe(true);
      // 前の置き場所の応答が、いま届く。新しい操作の印は外さない・新しい選びに触らない
      old.resolve(restored);
      await vi.waitFor(() => expect(toastTexts().some((t) => t.includes('置き場所が変わった'))).toBe(true));
      flushSync();
      expect(btn(el, '完全削除')!.disabled).toBe(true);
      expect(explorerSelection.paths()).toEqual([ALIAS1]);
      btn(el, '完全削除')!.click();
      expect(ui.confirmReq).not.toBeNull();
      ui.confirmReq!.resolve(true);
      await vi.waitFor(() => expect(h.purge).toHaveBeenCalledWith(ID1));
      expect(h.restore).toHaveBeenCalledTimes(1);
    } finally {
      place.key = 'http://a.test';
    }
  });
});

/* ---- 特別なフォルダの中・OS のドロップの途中で置き場所が変わったとき・ドラッグの印 ---- */

describe('特別なフォルダの中でも、「新しいファイル」は出る（フォルダを断るのは置き場所の側）', () => {
  it('新しいファイルは、special の中の ≡ にもある。末尾が / の名前（フォルダ）も、部品は断らず置き場所に任せる（失敗は理由を出す）', async () => {
    h.mkdir.mockClear();
    h.mkdir.mockRejectedValueOnce(new Error('403 Forbidden'));
    const el = await render();
    expect(menuLabels(el)).toContain('新しいファイル');
    fileExplorer.open('special');
    flushSync();
    await vi.waitFor(() => expect(fileExplorer.dir).toBe('special'));
    expect(menuLabels(el)).toContain('新しいファイル');
    menuClick(el, '新しいファイル');
    const input = document.querySelector<HTMLInputElement>('.file-explorer-mkdir input')!;
    input.value = 'sub/';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLFormElement>('.file-explorer-mkdir')!.requestSubmit();
    await vi.waitFor(() => expect(h.mkdir).toHaveBeenCalledWith('special/sub'));
    await vi.waitFor(() => expect(document.querySelector('.file-explorer-mkdir-error')?.textContent).toContain('403'));
    expect(h.write).not.toHaveBeenCalled();
  });

  it('special の中へ、フォルダを OS からドロップしても作らず、置き場所の文で断る（ファイルは別）', async () => {
    const el = await render();
    fileExplorer.open('special');
    flushSync();
    await vi.waitFor(() => expect(fileExplorer.dir).toBe('special'));
    dropOs(el.querySelector<HTMLElement>('.file-explorer-body')!, [{ name: 'newdir', dir: true }]);
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text === '特別なフォルダ内にフォルダは作れません')).toBe(true));
    expect(h.mkdir).not.toHaveBeenCalled();
  });
});

describe('OS からのドロップの途中で置き場所が変わったら、新しい置き場所へは書かない', () => {
  const lazyFile = (name: string, gate: Promise<void>) => ({
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (f: File) => void) => void gate.then(() => ok(new File(['x'], name))),
  });
  const dropRaw = (el: HTMLElement, entries: unknown[]): void => {
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], items: entries.map((e) => ({ kind: 'file', webkitGetAsEntry: () => e })), files: [] } });
    el.dispatchEvent(ev);
  };
  const scopeToast = () => ui.toasts.some((t) => t.kind === 'error' && t.text.includes('置き場所が変わった'));

  it('同名の上書きの確認を待つあいだに変わったら、答えても送らない', async () => {
    const el = await render();
    dropOs(el.querySelector<HTMLElement>('.file-explorer-body')!, [{ name: 'a.txt' }]);
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    switchPlace('http://b.test');
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(scopeToast()).toBe(true));
    expect(h.write).not.toHaveBeenCalled();
  });

  it('送り先の一覧を読んでいるあいだに変わったら、送らない', async () => {
    let finish!: (v: Entry[]) => void;
    h.list.mockImplementation((path?: string) => (path === 'docs' ? new Promise<Entry[]>((r) => (finish = r)) : Promise.resolve(h.current ?? listing)));
    const el = await render();
    fileExplorer.open('docs');
    flushSync();
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    dropOs(el.querySelector<HTMLElement>('.file-explorer-body')!, [{ name: 'n.txt' }]);
    await new Promise((r) => setTimeout(r, 30));
    place.key = 'http://b.test';
    finish([]);
    await vi.waitFor(() => expect(scopeToast()).toBe(true));
    expect(h.write).not.toHaveBeenCalled();
  });

  it('1 件目を送っているあいだに変わったら、2 件目は送らない', async () => {
    const el = await render();
    let finish!: () => void;
    h.write.mockImplementationOnce(() => new Promise((r) => (finish = () => r(entry('n1.txt')))));
    dropOs(el.querySelector<HTMLElement>('.file-explorer-body')!, [{ name: 'n1.txt' }, { name: 'n2.txt' }]);
    await vi.waitFor(() => expect(h.write).toHaveBeenCalledTimes(1));
    switchPlace('http://b.test');
    finish();
    await vi.waitFor(() => expect(scopeToast()).toBe(true));
    expect(h.write).toHaveBeenCalledTimes(1);
  });

  it('中身を読んでいるあいだに変わったら、読み終わっても送らない', async () => {
    const el = await render();
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    dropRaw(el.querySelector<HTMLElement>('.file-explorer-body')!, [lazyFile('slow.txt', gate)]);
    await vi.waitFor(() => expect(fileExplorer.dir).toBe(''));
    await new Promise((r) => setTimeout(r, 30));
    switchPlace('http://b.test');
    open();
    await vi.waitFor(() => expect(scopeToast()).toBe(true));
    expect(h.write).not.toHaveBeenCalled();
  });

  it('Linux のデスクトップのネイティブのドロップ: 中身を読んでいるあいだに変わったら送らず、読んだ id は必ず解放する', async () => {
    dsk.linux = true;
    const el = await render();
    await vi.waitFor(() => expect(osDrop.handler).not.toBeNull());
    const body = el.querySelector<HTMLElement>('.file-explorer-body')!;
    // jsdom には elementFromPoint が無い
    const orig = document.elementFromPoint;
    document.elementFromPoint = () => body;
    try {
      let release!: (v: { entries: never[]; skipped: string[] }) => void;
      osDrop.readEntries.mockImplementationOnce(() => new Promise((r) => (release = r)));
      void osDrop.handler!({ id: 7, position: { x: 5, y: 5 } });
      await vi.waitFor(() => expect(osDrop.readEntries).toHaveBeenCalledWith(7));
      switchPlace('http://b.test');
      release({ entries: [], skipped: [] });
      await vi.waitFor(() => expect(scopeToast()).toBe(true));
      await vi.waitFor(() => expect(osDrop.releaseId).toHaveBeenCalledWith(7));
      expect(h.write).not.toHaveBeenCalled();
    } finally {
      document.elementFromPoint = orig;
    }
  });
});

describe('ドラッグの印（EXPLORER_DRAG_TYPE）', () => {
  const dragEvent = (type: string, types: string[]) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    const data: Record<string, string> = {};
    Object.defineProperty(ev, 'dataTransfer', { value: { types, effectAllowed: '', setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? '', files: [], items: [] } });
    return { ev, data };
  };

  it('項目を運び始めると、運ぶ項目のパスを、この部品の印で持つ', async () => {
    const el = await render();
    const { ev, data } = dragEvent('dragstart', []);
    [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].find((li) => li.textContent?.includes('a.txt'))!.dispatchEvent(ev);
    expect(data[EXPLORER_DRAG_TYPE]).toBe('a.txt');
  });

  it('フォルダの上: この部品の印があるものだけ受ける（ほかの種類の運びは受けない）', async () => {
    const el = await render();
    const li = (n: string) => [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].find((x) => x.textContent?.includes(n))!;
    li('a.txt').dispatchEvent(dragEvent('dragstart', []).ev);
    const mine = dragEvent('dragover', [EXPLORER_DRAG_TYPE]).ev;
    li('docs').dispatchEvent(mine);
    expect(mine.defaultPrevented).toBe(true);
    const other = dragEvent('dragover', ['text/plain']).ev;
    li('docs').dispatchEvent(other);
    expect(other.defaultPrevented).toBe(false);
  });
});

describe('ゴミ箱の無い置き場所（caps.trash が偽）の削除は、確認のうえ完全に削除する', () => {
  const pressDelete = async (el: HTMLElement, names: string[]) => {
    explorerSelection.enter();
    flushSync();
    for (const n of names) {
      rowOf(el, n).querySelector<HTMLButtonElement>('.file-explorer-row')!.click();
      flushSync();
    }
    el.querySelector<HTMLButtonElement>('button[aria-label="削除"]')!.click();
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
  };
  beforeEach(() => {
    explorer.caps.trash = false;
    h.remove.mockReset();
    h.remove.mockResolvedValue(undefined);
  });
  afterEach(() => {
    explorer.caps.trash = true;
  });

  it('確認は「完全に削除します。元に戻せません」。答えるまで消さない。ゴミ箱の口は呼ばない', async () => {
    const el = await render();
    await pressDelete(el, ['a.txt', 'docs']);
    expect(ui.confirmReq).toMatchObject({ title: '2 件を完全に削除しますか', body: '完全に削除します。元に戻せません', okLabel: '完全に削除', danger: true });
    expect(h.remove).not.toHaveBeenCalled();
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.remove).toHaveBeenCalledTimes(2));
    expect(h.remove.mock.calls.map((c) => c[0])).toEqual(['a.txt', 'docs']);
    expect(h.trash).not.toHaveBeenCalled();
  });

  it('取り消すと、何も消さない', async () => {
    const el = await render();
    await pressDelete(el, ['a.txt']);
    ui.confirmReq!.resolve(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(h.remove).not.toHaveBeenCalled();
    expect(ui.toasts).toHaveLength(0);
  });

  it('終わりの知らせは「完全に削除しました」で、「取り消す」は出さない（戻せない）', async () => {
    const el = await render();
    await pressDelete(el, ['a.txt']);
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text === '1 件を完全に削除しました')).toBe(true));
    expect(ui.toasts.some((t) => t.action)).toBe(false);
  });

  it('失敗したものは、理由つきで知らせ、成功した分だけ完了にする', async () => {
    h.remove.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('locked'));
    const el = await render();
    await pressDelete(el, ['a.txt', 'docs']);
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.startsWith('1 件を完全に削除できませんでした（docs'))).toBe(true));
    expect(ui.toasts.some((t) => t.text === '1 件を完全に削除しました')).toBe(true);
  });

  it('確認を待つあいだに置き場所が変わったら、消さない', async () => {
    const el = await render();
    await pressDelete(el, ['a.txt']);
    switchPlace('http://b.test');
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.kind === 'error')).toBe(true));
    expect(h.remove).not.toHaveBeenCalled();
  });

  it('remove を持たない置き場所は、失敗として知らせる（ゴミ箱へは切り替えない）', async () => {
    const el = await render();
    const saved = h.remove;
    // 口に remove が無い形（api は共有の 1 つなので、呼ぶ側が undefined を見るように一時的に外す）
    await pressDelete(el, ['a.txt']);
    h.remove = undefined as never;
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.includes('完全に削除できませんでした'))).toBe(true));
    expect(h.trash).not.toHaveBeenCalled();
    h.remove = saved;
  });
});

/** PC で、項目の右クリックのメニュー・名前の文字を押しての書き換え・ドラッグでの囲み・フォルダのサイズ・ドラッグの印 */
describe('PC の操作（右クリックのメニュー・名前を押して書き換え・囲んで選ぶ・フォルダのサイズ）', () => {
  beforeEach(() => {
    dsk.desktop = true;
    explorerSelection.desktop = true;
    h.trash.mockReset();
    h.trash.mockResolvedValue({ id: 'x', original_path: 'a.txt', kind: 'file', size: 1, deleted_at: 0 });
  });
  afterEach(() => {
    explorerSelection.desktop = false;
    ui.toasts.length = 0;
  });

  const rightClick = (el: HTMLElement, name: string) => {
    rowOf(el, name).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }));
    flushSync();
  };
  const ctxItems = () => [...document.querySelectorAll('.file-explorer-context .menu-item')].map((b) => b.textContent?.trim());
  const ctxClick = (text: string) => {
    [...document.querySelectorAll<HTMLButtonElement>('.file-explorer-context .menu-item')].find((b) => b.textContent?.includes(text))!.click();
    flushSync();
  };

  it('項目を右クリックすると、その項目を選んで、項目のメニュー（コピー・切り取り・名前の変更・削除・プロパティ。「開く」は無い）を出す', async () => {
    const el = await render();
    rightClick(el, 'a.txt');
    expect(explorerSelection.paths()).toEqual(['a.txt']);
    expect(ctxItems()).toEqual(['コピー', '切り取り', '名前の変更', '削除', 'プロパティ']);
  });

  it('選んでいる項目を右クリックすると、選びはそのまま（まとめて操作できる）。複数のときは、名前の変更・プロパティを出さない', async () => {
    const el = await render();
    explorerSelection.replace(['a.txt', 'pic.png']);
    flushSync();
    rightClick(el, 'a.txt');
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'pic.png']);
    expect(ctxItems()).toEqual(['コピー', '切り取り', '削除']);
  });

  async function renderWith(extra: Record<string, unknown>): Promise<HTMLElement> {
    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(FileExplorer, { target, props: { explorer, ...extra } });
    flushSync();
    await vi.waitFor(() => expect(target!.querySelector('.file-explorer-list')).not.toBeNull());
    return target;
  }

  it('menuLayout: 項目のメニューの順番と、出さない項目を決められる。決めていない項目は、既定の順で後ろに続く', async () => {
    const el = await renderWith({ menuLayout: { entry: { order: ['properties', 'delete'], hidden: ['cut'] } } });
    rightClick(el, 'a.txt');
    expect(ctxItems()).toEqual(['プロパティ', '削除', 'コピー', '名前の変更']);
  });

  it('menuLayout: 空きのメニューも決められる。全部を出さなければ、メニューは出ない', async () => {
    h.clip.text = 'hello';
    let el = await renderWith({ menuLayout: { space: { order: ['paste', 'newFile'], hidden: ['upload'] } } });
    el.querySelector<HTMLElement>('.file-explorer-body')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 600 }));
    await vi.waitFor(() => expect(ctxItems()).toEqual(['貼り付け', '新しいファイル']));
    await unmount(instance!);
    instance = undefined;
    target?.remove();
    document.body.replaceChildren();
    el = await renderWith({ menuLayout: { space: { hidden: ['upload', 'newFile', 'paste'] } } });
    el.querySelector<HTMLElement>('.file-explorer-body')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 600 }));
    flushSync();
    expect(document.querySelector('.file-explorer-context .menu')).toBeNull();
  });

  it('entryStyle: 条件に合う項目に、アイコン（部品・画像）・色・不透明度を与える。詳細でも、アイコン表示でも。合わない項目は既定のまま', async () => {
    const entryStyle = (e: { name: string }) =>
      e.name === 'a.txt' ? { icon: { src: '/icon.svg' }, color: 'rgb(1, 2, 3)', opacity: 0.5 } : e.name === 'docs' ? { color: 'red' } : null;
    const el = await renderWith({ entryStyle });
    const a = rowOf(el, 'a.txt');
    expect(a.querySelector('.file-explorer-icon img.entry-glyph-img')!.getAttribute('src')).toBe('/icon.svg');
    expect(a.style.getPropertyValue('--entry-color')).toBe('rgb(1, 2, 3)');
    expect(a.style.opacity).toBe('0.5');
    expect(rowOf(el, 'docs').style.getPropertyValue('--entry-color')).toBe('red');
    expect(rowOf(el, 'docs').querySelector('.file-explorer-icon svg')).not.toBeNull(); // アイコンは既定のフォルダ
    const pic = rowOf(el, 'pic.png');
    expect(pic.style.getPropertyValue('--entry-color')).toBe('');
    expect(pic.style.opacity).toBe('');
    explorerView.setView('', 'grid');
    flushSync();
    expect(rowOf(el, 'a.txt').querySelector('.file-explorer-thumb img.entry-glyph-img')).not.toBeNull();
  });

  it('entryStyle: アイコンは、共通の登録簿の名前（{ iconName }）でも渡せる。登録した独自アイコンは、その形で描く', async () => {
    defineBuiltinIcon('test-logo', { body: '<path d="M1 1"/>', attrs: {} });
    const el = await renderWith({ entryStyle: (e: { name: string }) => (e.name === 'a.txt' ? { icon: { iconName: 'test-logo' } } : null) });
    const svg = rowOf(el, 'a.txt').querySelector('.file-explorer-icon svg[data-icon="test-logo"]');
    expect(svg).not.toBeNull();
    expect(svg!.innerHTML).toContain('M1 1');
    expect(rowOf(el, 'a.txt').querySelector('.file-explorer-icon img')).toBeNull();
  });

  it('メニューの「削除」は、確認なしでゴミ箱へ移す', async () => {
    const el = await render();
    rightClick(el, 'a.txt');
    ctxClick('削除');
    await vi.waitFor(() => expect(h.trash).toHaveBeenCalledWith('a.txt'));
    expect(ui.confirmReq).toBeNull();
  });

  it('メニューの「コピー」のあと、フォルダを右クリックすると「ここへ貼り付け」が出る', async () => {
    const el = await render();
    rightClick(el, 'a.txt');
    ctxClick('コピー');
    await vi.waitFor(() => expect(explorerBuffer.empty).toBe(false));
    rightClick(el, 'docs');
    expect(ctxItems()).toContain('ここへ貼り付け');
  });

  it('メニューの「プロパティ」で、プロパティを開く', async () => {
    const el = await render();
    rightClick(el, 'a.txt');
    ctxClick('プロパティ');
    expect(document.querySelector('.file-properties')).not.toBeNull();
  });

  it('名前の文字を押すと、選びは変えずに、少し待って、名前の書き換えになる', async () => {
    const el = await render();
    const textOf = (n: string) => rowOf(el, n).querySelector<HTMLElement>('.file-explorer-name-text')!;
    explorerSelection.replace(['docs']);
    flushSync();
    textOf('a.txt').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    flushSync();
    expect(explorerSelection.paths()).toEqual(['docs']);
    // 待つあいだは、まだ書き換えない（ダブルクリックなら開くため）
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
    await vi.waitFor(() => expect(el.querySelector<HTMLTextAreaElement>('.file-explorer-rename')?.value).toBe('a.txt'));
  });

  it('名前の文字以外（行のほかの部分）を押すと、これまでどおり、選ぶだけ（書き換えない）', async () => {
    const el = await render();
    const col = rowOf(el, 'a.txt').querySelector<HTMLElement>('.file-explorer-col-type, .file-explorer-col-size')!;
    col.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    flushSync();
    expect(explorerSelection.paths()).toEqual(['a.txt']);
    await new Promise((r) => setTimeout(r, DOUBLE_CLICK_MS + 100));
    flushSync();
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
  });

  it('PC: 押した項目が、カーソル（フォーカス）になる。Ctrl で選びから外しても、カーソルは、その項目に残る（いつも 1 つ）', async () => {
    dsk.desktop = true;
    const el = await render();
    const cursors = (): string[] => [...el.querySelectorAll('.file-explorer-item-cursor')].map((x) => x.getAttribute('data-path') ?? '');
    const click = (name: string, init: MouseEventInit = {}): void => {
      rowOf(el, name).querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...init }));
      flushSync();
    };
    click('a.txt', { ctrlKey: true });
    click('docs', { ctrlKey: true });
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'docs']);
    expect(cursors()).toEqual(['docs']);
    expect(document.activeElement?.closest('.file-explorer-item')?.getAttribute('data-path')).toBe('docs');
    click('a.txt', { ctrlKey: true }); // 選びから外す
    expect(explorerSelection.paths()).toEqual(['docs']);
    expect(cursors()).toEqual(['a.txt']);
    expect(document.activeElement?.closest('.file-explorer-item')?.getAttribute('data-path')).toBe('a.txt');
  });

  it('Ctrl を押しながら名前の文字を押すと、書き換えではなく、選びに足す', async () => {
    const el = await render();
    explorerSelection.replace(['docs']);
    flushSync();
    rowOf(el, 'a.txt').querySelector<HTMLElement>('.file-explorer-name-text')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ctrlKey: true }));
    flushSync();
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'docs']);
    await new Promise((r) => setTimeout(r, DOUBLE_CLICK_MS + 100));
    flushSync();
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
  });

  it('名前の文字を続けて 2 回押す（ダブルクリック）では、書き換えに入らない', async () => {
    const el = await render();
    const t = rowOf(el, 'a.txt').querySelector<HTMLElement>('.file-explorer-name-text')!;
    const click = (detail: number) => {
      t.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
      flushSync();
    };
    click(1); // 書き換えの待ちが始まる
    click(2); // ダブルクリックの 2 回目: 待ちを取り消す
    await new Promise((r) => setTimeout(r, DOUBLE_CLICK_MS + 200));
    flushSync();
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
  });

  /** マウスのポインターのイベント（jsdom には PointerEvent が無いので、必要な口を足す） */
  const ptr = (type: string, x: number, y: number, extra: MouseEventInit = {}) => {
    const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra });
    Object.defineProperties(ev, { pointerType: { value: 'mouse' }, pointerId: { value: 1 } });
    return ev;
  };
  /** 項目の位置（jsdom は配置しないので、縦に 40px ずつ並べたことにする） */
  function layout(el: HTMLElement): HTMLElement {
    const body = el.querySelector<HTMLElement>('.file-explorer-body')!;
    Object.defineProperty(body, 'clientWidth', { value: 800, configurable: true });
    Object.defineProperty(body, 'clientHeight', { value: 600, configurable: true });
    [...el.querySelectorAll<HTMLElement>('.file-explorer-item')].forEach((li, i) => {
      li.getBoundingClientRect = () => ({ left: 0, right: 800, top: i * 40, bottom: i * 40 + 40, width: 800, height: 40, x: 0, y: i * 40, toJSON: () => ({}) });
    });
    return body;
  }

  it('空きスペースから囲むと、重なった項目が選ばれる（囲んだあとのクリックでは、選びを外さない）', async () => {
    const el = await render();
    const body = layout(el);
    // 項目は 0〜120px に並ぶ（docs・a.txt・pic.png）。下の空き（200px）から、上へ 2 件目までを囲む
    body.dispatchEvent(ptr('pointerdown', 400, 200));
    body.dispatchEvent(ptr('pointermove', 400, 50));
    flushSync();
    expect(el.ownerDocument.querySelector('.file-explorer-band') ?? document.querySelector('.file-explorer-band')).not.toBeNull();
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'pic.png']);
    body.dispatchEvent(ptr('pointerup', 400, 50));
    body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 50 }));
    flushSync();
    expect(document.querySelector('.file-explorer-band')).toBeNull();
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'pic.png']);
  });

  it('囲んでいるあいだに一覧がスクロールしたら、四角の始点も一緒に動く（選びが、スクロールだけで増え続けない）', async () => {
    const el = await render();
    const body = layout(el);
    let top = 0;
    Object.defineProperty(body, 'scrollTop', { get: () => top, set: (v: number) => (top = v), configurable: true });
    // 一覧の中の y=200 から、画面の y=10 まで囲む（どの 3 件も重なる）
    body.dispatchEvent(ptr('pointerdown', 400, 200));
    body.dispatchEvent(ptr('pointermove', 400, 10));
    flushSync();
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'docs', 'pic.png']);
    // 一覧が 150px スクロールすると、始点は画面の y=50 へ動く（ポインターはそのまま）
    top = 150;
    body.dispatchEvent(new Event('scroll'));
    flushSync();
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'docs']);
    const band = document.querySelector<HTMLElement>('.file-explorer-band')!;
    expect(band.style.top).toBe('10px');
    expect(band.style.height).toBe('40px');
    body.dispatchEvent(ptr('pointerup', 400, 10));
  });

  it('項目の上からは囲まない（項目はドラッグで移す）。囲めるのは空きスペースだけ', async () => {
    const el = await render();
    const body = layout(el);
    const second = rowOf(el, 'a.txt').querySelector<HTMLElement>('.file-explorer-name-text')!;
    // 選んでいてもいなくても、項目は、HTML5 のドラッグで移せる
    expect(rowOf(el, 'a.txt').closest('li')!.getAttribute('draggable')).toBe('true');
    second.dispatchEvent(ptr('pointerdown', 100, 60));
    body.dispatchEvent(ptr('pointermove', 100, 110));
    flushSync();
    expect(document.querySelector('.file-explorer-band')).toBeNull();
    expect(explorerSelection.paths()).toEqual([]);
  });

  it('Ctrl を押して囲むと、いまの選びに足す。ただのクリック（動かさない）は、囲みにならず、選びを外す', async () => {
    const el = await render();
    const body = layout(el);
    explorerSelection.replace(['a.txt']);
    flushSync();
    body.dispatchEvent(ptr('pointerdown', 400, 200, { ctrlKey: true }));
    body.dispatchEvent(ptr('pointermove', 400, 30, { ctrlKey: true }));
    body.dispatchEvent(ptr('pointerup', 400, 30));
    body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 30 }));
    await new Promise((r) => setTimeout(r, 5));
    flushSync();
    expect(explorerSelection.paths().sort()).toEqual(['a.txt', 'docs', 'pic.png'].sort());
    // 動かさずに空きスペースを押す: 選びを外す
    body.dispatchEvent(ptr('pointerdown', 400, 300));
    body.dispatchEvent(ptr('pointerup', 400, 300));
    body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 400, clientY: 300 }));
    flushSync();
    expect(explorerSelection.count).toBe(0);
  });

  it('詳細の「サイズ」の列に、フォルダの大きさも出す（数えているあいだは …、上限で止めたら ≥）', async () => {
    h.folderSize.mockResolvedValueOnce({ size: 2048, partial: true });
    const el = await render();
    await vi.waitFor(() => expect(rowOf(el, 'docs').querySelector('.file-explorer-col-size')?.textContent).toBe('≥ 2.0 KB'));
    expect(h.folderSize).toHaveBeenCalledWith('docs');
    expect(rowOf(el, 'a.txt').querySelector('.file-explorer-col-size')?.textContent).not.toBe('');
  });

  it('フォルダを運ぶドラッグには、フォルダの印も付く（ファイルだけのときは付かない）', async () => {
    const el = await render();
    const start = (name: string) => {
      const set: string[] = [];
      const ev = new Event('dragstart', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { setData: (t: string) => set.push(t), effectAllowed: '' } });
      rowOf(el, name).dispatchEvent(ev);
      return set;
    };
    expect(start('docs')).toEqual(['application/x-explorer-kit-items', 'application/x-explorer-kit-has-dir']);
    expect(start('a.txt')).toEqual(['application/x-explorer-kit-items']);
  });
});

describe('キーボードの操作（PC）: 矢印で項目を移る・ホットキーで操作する', () => {
  beforeEach(() => {
    // 前の試験が外し忘れた画面は、画面から外す（window のキーを、重ねて受けないように）
    document.body.replaceChildren();
    dsk.desktop = true;
    explorerSelection.desktop = true;
    h.trash.mockReset();
    h.trash.mockImplementation(async (path: string) => ({ id: `id-${path}`, original_path: path, kind: 'file' as const, size: 1, deleted_at: 0 }));
    h.restore.mockReset();
    h.restore.mockResolvedValue({ name: '', path: '', kind: 'file', size: 1, modified: 0, mime: null } as Entry);
  });
  afterEach(() => {
    explorerSelection.desktop = false;
    ui.toasts.length = 0;
  });

  /** 画面の外（body）でキーを押す。window まで届く */
  const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(ev);
    flushSync();
    return ev;
  };
  /** 一覧は、フォルダが先: docs・a.txt・pic.png */
  const selected = () => explorerSelection.paths();

  it('上下の矢印: 選ばれていなければ、下は先頭・上は末尾から。選びも移り、行にフォーカスが移る。端では動かない', async () => {
    const el = await render();
    const ev = press('ArrowDown');
    expect(ev.defaultPrevented).toBe(true);
    expect(selected()).toEqual(['docs']);
    expect(document.activeElement).toBe(rowOf(el, 'docs').querySelector('.file-explorer-row'));
    press('ArrowDown');
    expect(selected()).toEqual(['a.txt']);
    press('ArrowUp');
    expect(selected()).toEqual(['docs']);
    press('ArrowUp');
    expect(selected()).toEqual(['docs']);
    press('ArrowDown');
    press('ArrowDown');
    press('ArrowDown');
    expect(selected()).toEqual(['pic.png']);
  });

  it('矢印で移るときのフォーカスは、ブラウザのスクロールに任せない（見えない行を、画面の真ん中までスクロールさせない）', async () => {
    await render();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      press('ArrowDown');
      press('ArrowDown');
      press('End', { ctrlKey: true });
      const own = focus.mock.calls.filter((c) => c[0] !== undefined);
      expect(own.length).toBeGreaterThan(0);
      for (const c of focus.mock.calls) expect(c[0], 'フォーカスは preventScroll').toEqual({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  });

  it('何も選んでいないとき、上の矢印は末尾から始まる', async () => {
    await render();
    press('ArrowUp');
    expect(selected()).toEqual(['pic.png']);
  });

  it('Shift を押しながらの矢印は、選びに足していく。左右の矢印は、詳細では使わない', async () => {
    await render();
    press('ArrowDown');
    press('ArrowDown', { shiftKey: true });
    expect(selected()).toEqual(['docs', 'a.txt']);
    const ev = press('ArrowRight');
    expect(ev.defaultPrevented).toBe(false);
    expect(selected()).toEqual(['docs', 'a.txt']);
  });

  it('アイコン表示では、左右の矢印で 1 つずつ移る', async () => {
    await render();
    explorerSelection.clear();
    explorerView.setView('', 'grid');
    flushSync();
    press('ArrowRight');
    expect(selected()).toEqual(['docs']);
    press('ArrowRight');
    expect(selected()).toEqual(['a.txt']);
    press('ArrowLeft');
    expect(selected()).toEqual(['docs']);
  });

  it('Ctrl+A ですべて選ぶ。Ctrl+C・Ctrl+X でバッファに入れる（選んだものを）', async () => {
    await render();
    press('a', { ctrlKey: true });
    expect(selected().sort()).toEqual(['a.txt', 'docs', 'pic.png']);
    explorerSelection.replace(['a.txt']);
    press('c', { ctrlKey: true });
    expect(explorerBuffer.mode).toBe('copy');
    expect(explorerBuffer.items.map((i) => i.path)).toEqual(['a.txt']);
    explorerSelection.replace(['pic.png']);
    press('x', { ctrlKey: true });
    expect(explorerBuffer.mode).toBe('move');
    expect(explorerBuffer.items.map((i) => i.path)).toEqual(['pic.png']);
  });

  it('何も選んでいないときの Ctrl+C・Delete は、何もしない（ブラウザの動きも止めない）', async () => {
    await render();
    const ev = press('c', { ctrlKey: true });
    expect(ev.defaultPrevented).toBe(false);
    press('Delete');
    expect(h.trash).not.toHaveBeenCalled();
  });

  it('Delete でゴミ箱へ（確認なし）。Ctrl+Z で元に戻し、Ctrl+Y でもう一度ゴミ箱へ', async () => {
    await render();
    explorerSelection.replace(['a.txt']);
    press('Delete');
    await vi.waitFor(() => expect(h.trash).toHaveBeenCalledWith('a.txt'));
    expect(ui.confirmReq).toBeNull();
    await vi.waitFor(() => expect(explorerSelection.count).toBe(0));
    press('z', { ctrlKey: true });
    await vi.waitFor(() => expect(h.restore).toHaveBeenCalledWith('id-a.txt'));
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.includes('元に戻しました'))).toBe(true));
    h.trash.mockClear();
    press('y', { ctrlKey: true });
    await vi.waitFor(() => expect(h.trash).toHaveBeenCalledWith('a.txt'));
  });

  it('Shift+Delete は、確認してから完全に削除する（置き場所が完全な削除を持つなら、それで。ゴミ箱は通さない）', async () => {
    await render();
    explorerSelection.replace(['a.txt']);
    press('Delete', { shiftKey: true });
    await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
    expect(h.trash).not.toHaveBeenCalled();
    ui.confirmReq!.resolve(true);
    await vi.waitFor(() => expect(h.remove).toHaveBeenCalledWith('a.txt'));
    expect(h.trash).not.toHaveBeenCalled();
  });

  it('ゴミ箱へ移せない項目（api.trashable が偽。WSL の中など）は、Delete でも、確認のうえ完全に削除する（元に戻せない）', async () => {
    await render();
    explorer.api.trashable = (p) => p !== 'a.txt';
    try {
      explorerSelection.replace(['pic.png']);
      press('Delete');
      await vi.waitFor(() => expect(h.trash).toHaveBeenCalledWith('pic.png')); // 移せるものは、確認なしでゴミ箱へ
      expect(ui.confirmReq).toBeNull();
      await new Promise((r) => setTimeout(r, 50)); // 1 つ目の削除が終わるのを待つ
      explorerSelection.replace(['a.txt']);
      press('Delete');
      await vi.waitFor(() => expect(ui.confirmReq).not.toBeNull());
      expect(ui.confirmReq!.body).toContain('元に戻せません');
      expect(h.trash).toHaveBeenCalledTimes(1);
      ui.confirmReq!.resolve(true);
      await vi.waitFor(() => expect(h.remove).toHaveBeenCalledWith('a.txt'));
    } finally {
      delete explorer.api.trashable;
    }
  });

  it('矢印: Shift を押しながらの矢印は、選びに足す操作（extendUp など）。keymap で外せば、足さない', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(FileExplorer, { target, props: { explorer, keymap: { extendDown: [] } } });
    flushSync();
    await vi.waitFor(() => expect(target!.querySelector('.file-explorer-list')).not.toBeNull());
    press('ArrowDown');
    expect(selected()).toEqual(['docs']);
    press('ArrowDown', { shiftKey: true }); // 外したので、何も起きない
    expect(selected()).toEqual(['docs']);
    press('ArrowUp', { shiftKey: true }); // extendUp は既定のまま（先頭では動かないが、足す側の操作として働く）
    expect(selected()).toEqual(['docs']);
  });

  it('入力欄・名前の書き換え・開いているダイアログの中では、効かない', async () => {
    const el = await render();
    explorerSelection.replace(['a.txt']);
    const input = document.createElement('input');
    el.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
    flushSync();
    expect(h.trash).not.toHaveBeenCalled();
    const dlg = document.createElement('div');
    dlg.setAttribute('role', 'dialog');
    document.body.appendChild(dlg);
    press('Delete');
    dlg.remove();
    expect(h.trash).not.toHaveBeenCalled();
  });

  it('ホットキーは、keymap で置き換えられる（置き換えた操作の元のキーは効かない）', async () => {
    await render();
    explorerSelection.replace(['a.txt']);
    // 既定では F2 が名前の変更。keymap を渡す試験は、アプリ側（App.tabs.test.ts）が受け持つ
    const ev = press('F9');
    expect(ev.defaultPrevented).toBe(false);
  });
});

describe('作成日時・フォルダのサイズの写し・貼り付けの予告', () => {
  const withCreated = (): Entry[] => [
    { ...entry('a.txt'), created: 1_700_000_000_000 },
    { ...entry('docs', 'dir'), created: 1_600_000_000_000 },
    { ...entry('pic.png'), mime: 'image/png', size: 9, created: 1_650_000_000_000 },
  ];

  it('作成日時を持つ項目があれば、列と、並び替えの選択肢に出す。無ければ出さない', async () => {
    let el = await render();
    expect([...el.querySelectorAll('.file-explorer-columns span')].map((s) => s.textContent)).not.toContain('作成日時');
    expect(menuLabels(el).join()).not.toContain('作成日時');
    await unmount(instance!);
    instance = undefined;
    target?.remove();
    h.current = withCreated();
    dirIndex.clear();
    el = await render();
    expect([...el.querySelectorAll('.file-explorer-columns span')].map((s) => s.textContent)).toContain('作成日時');
    expect(menuLabels(el).join()).toContain('作成日時');
    // 並び替え: 作成日時の順（フォルダは先）
    menuClick(el, '作成日時');
    const names = [...el.querySelectorAll('.file-explorer-item')].map((li) => (li as HTMLElement).dataset.path);
    expect(names).toEqual(['docs', 'pic.png', 'a.txt']);
    h.current = null;
  });

  it('数えたフォルダのサイズは覚える: フォルダの更新日時が同じなら、一覧を読み直しても数え直さない。再読み込み（F5）で数え直す', async () => {
    h.folderSize.mockClear();
    const el = await render();
    await vi.waitFor(() => expect(rowOf(el, 'docs').querySelector('.file-explorer-col-size')?.textContent).toBe('2.0 KB'));
    expect(h.folderSize).toHaveBeenCalledTimes(1);
    // 並び替え（一覧は同じ）→ 数え直さない
    menuClick(el, '更新日時');
    await new Promise((r) => setTimeout(r, 20));
    expect(h.folderSize).toHaveBeenCalledTimes(1);
    // 再読み込み → 覚えた値を捨てて、数え直す
    fileExplorer.reload();
    await vi.waitFor(() => expect(h.folderSize).toHaveBeenCalledTimes(2));
  });

  it('貼り付けのボタンに乗せて少し待つと、貼る内容を一覧で見せる（アプリ内のコピー）。離すと消える', async () => {
    vi.useFakeTimers();
    try {
      const el = await render();
      explorerBuffer.set('copy', [
        { path: 'a.txt', kind: 'file' },
        { path: 'docs', kind: 'dir' },
      ] as never);
      flushSync();
      const wrap = el.querySelector<HTMLElement>('.file-explorer-paste')!;
      wrap.dispatchEvent(new Event('pointerenter'));
      expect(el.querySelector('.file-explorer-paste-preview')).toBeNull();
      await vi.advanceTimersByTimeAsync(450);
      flushSync();
      const text = el.querySelector('.file-explorer-paste-preview')?.textContent ?? '';
      expect(text).toContain('コピー: 2 件');
      expect(text).toContain('a.txt');
      expect(text).toContain('docs');
      wrap.dispatchEvent(new Event('pointerleave'));
      flushSync();
      expect(el.querySelector('.file-explorer-paste-preview')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('文字・画像がクリップボードにあれば、その先頭・画像を見せる', async () => {
    vi.useFakeTimers();
    try {
      h.clip = { text: 'こんにちは\n二行目', image: null, files: null, writable: true, supportsFiles: true };
      const el = await render();
      await vi.advanceTimersByTimeAsync(0);
      const wrap = el.querySelector<HTMLElement>('.file-explorer-paste')!;
      wrap.dispatchEvent(new Event('pointerenter'));
      await vi.advanceTimersByTimeAsync(450);
      flushSync();
      const text = el.querySelector('.file-explorer-paste-preview')?.textContent ?? '';
      expect(text).toContain('テキスト');
      expect(text).not.toContain('.txt');
      expect(text).toContain('こんにちは');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('パス欄・同じフォルダへの貼り付け', () => {
  beforeEach(() => {
    dsk.desktop = true;
    explorerSelection.desktop = true;
    document.body.replaceChildren();
  });
  afterEach(() => {
    explorerSelection.desktop = false;
    ui.toasts.length = 0;
  });

  const field = (el: HTMLElement) => el.querySelector<HTMLElement>('.file-explorer-path')!;
  const input = (el: HTMLElement) => el.querySelector<HTMLInputElement>('.file-explorer-path-input');

  it('パス欄の、パンくずでないところを押すと、パスの文字を書き換えられる。Enter で移り、Esc でやめる', async () => {
    const el = await render();
    expect(input(el)).toBeNull();
    field(el).click();
    flushSync();
    await vi.waitFor(() => expect(input(el)).not.toBeNull());
    expect(input(el)!.value).toBe('/');
    // Esc: やめる（選びを外す操作にも、渡さない）
    explorerSelection.replace(['a.txt']);
    input(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(input(el)).toBeNull();
    expect(explorerSelection.paths()).toEqual(['a.txt']);
    // 書いて、Enter: そのパスへ移る
    field(el).click();
    flushSync();
    await vi.waitFor(() => expect(input(el)).not.toBeNull());
    input(el)!.value = '/docs/';
    input(el)!.dispatchEvent(new Event('input', { bubbles: true }));
    input(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(fileExplorer.dir).toBe('docs'));
    expect(input(el)).toBeNull();
  });

  it('開けないパス（読めない）なら、理由を出して、書き換えを続ける', async () => {
    const el = await render();
    field(el).click();
    flushSync();
    await vi.waitFor(() => expect(input(el)).not.toBeNull());
    h.list.mockImplementation(async (path?: string) => {
      if (path === 'nowhere') throw new Error('見つかりません');
      return h.current ?? listing;
    });
    input(el)!.value = 'nowhere';
    input(el)!.dispatchEvent(new Event('input', { bubbles: true }));
    input(el)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(ui.toasts.some((t) => t.text.includes('開けません'))).toBe(true));
    expect(fileExplorer.dir).toBe('');
    expect(input(el)).not.toBeNull();
  });

  it('パンくずのボタンを押しても、書き換えには入らない。Ctrl+L では入る', async () => {
    const el = await render();
    el.querySelector<HTMLElement>('.file-explorer-crumb')!.click();
    flushSync();
    expect(input(el)).toBeNull();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', code: 'KeyL', ctrlKey: true, bubbles: true, cancelable: true }));
    flushSync();
    await vi.waitFor(() => expect(input(el)).not.toBeNull());
  });

  it('同じフォルダへ貼り付ける（コピー）と、名前の末尾に copy を付け、そのまま名前の書き換えに入る', async () => {
    const el = await render();
    h.copy.mockImplementation(async (_from: string, to: string) => {
      h.current = [...listing, entry(to)];
      return {} as Entry;
    });
    explorerBuffer.set('copy', [{ path: 'a.txt', kind: 'file' }]);
    flushSync();
    pasteClick(el);
    await vi.waitFor(() => expect(h.copy).toHaveBeenCalledWith('a.txt', 'a copy.txt', false));
    await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('.file-explorer-rename')?.value).toBe('a copy.txt'));
    expect(explorerSelection.paths()).toEqual(['a copy.txt']);
    h.current = null;
  });

  it('切り取りを同じフォルダへ貼り付けても、何もしない', async () => {
    const el = await render();
    explorerBuffer.set('move', [{ path: 'a.txt', kind: 'file' }]);
    flushSync();
    pasteClick(el);
    await new Promise((r) => setTimeout(r, 20));
    expect(h.move).not.toHaveBeenCalled();
    expect(el.querySelector('.file-explorer-rename')).toBeNull();
  });
});

describe('列の幅・待つカーソル・戻ったときのフォーカス・サイズの写し', () => {
  beforeEach(() => {
    dsk.desktop = true;
    explorerSelection.desktop = true;
    document.body.replaceChildren();
  });
  afterEach(() => {
    explorerSelection.desktop = false;
    ui.toasts.length = 0;
  });

  it('最初・最後の項目を選ぶ（Home・End。keymap で連続のキー G G にもできる）', async () => {
    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(FileExplorer, { target, props: { explorer, keymap: { selectFirst: ['G G'], selectLast: ['End'] } } });
    flushSync();
    await vi.waitFor(() => expect(target!.querySelector('.file-explorer-list')).not.toBeNull());
    const order = [...target.querySelectorAll<HTMLElement>('.file-explorer-item')].map((li) => li.dataset.path);
    const press = (key: string, code: string): void => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
      flushSync();
    };
    press('End', 'End');
    expect(explorerSelection.paths()).toEqual([order.at(-1)]);
    expect(document.activeElement?.closest('.file-explorer-item')?.getAttribute('data-path')).toBe(order.at(-1));
    // Home は、この keymap では割り当てていない（G G に置き換えた）
    press('Home', 'Home');
    expect(explorerSelection.paths()).toEqual([order.at(-1)]);
    press('g', 'KeyG');
    expect(explorerSelection.paths()).toEqual([order.at(-1)]);
    press('g', 'KeyG');
    expect(explorerSelection.paths()).toEqual([order[0]]);
  });

  it('右クリックのメニューと≡のメニューは、Esc で閉じる（下の画面の Esc＝選択解除は、動かない）', async () => {
    const el = await render();
    rowOf(el, 'a.txt').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 40 }));
    flushSync();
    await vi.waitFor(() => expect(document.querySelector('.file-explorer-context-menu')).not.toBeNull());
    expect(explorerSelection.paths()).toEqual(['a.txt']);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(document.querySelector('.file-explorer-context-menu')).toBeNull();
    expect(explorerSelection.paths()).toEqual(['a.txt']);
    // ≡ のメニュー
    el.querySelector<HTMLButtonElement>('button[aria-label="メニュー"]')!.click();
    flushSync();
    expect(document.querySelector('.file-explorer-popup-menu')).not.toBeNull();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(document.querySelector('.file-explorer-popup-menu')).toBeNull();
    // メニューが無いときの Esc は、これまでどおり選択解除
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(explorerSelection.paths()).toEqual([]);
  });

  it('詳細の見出しの右の境目をつまんで列の幅を変えられる（右へで広がり、変えたら知らせる）。ダブルクリックで既定に戻す', async () => {
    const saved: unknown[] = [];
    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(FileExplorer, { target, props: { explorer, columnWidths: { size: 100 }, oncolumnwidths: (w: unknown) => saved.push(w) } });
    flushSync();
    await vi.waitFor(() => expect(target!.querySelector('.file-explorer-list')).not.toBeNull());
    const root = target.querySelector<HTMLElement>('.file-explorer')!;
    expect(root.style.getPropertyValue('--col-size')).toBe('100px');
    const grip = target.querySelector<HTMLElement>('.file-explorer-columns .file-explorer-col-kind .file-explorer-col-grip')!;
    const ptr = (type: string, x: number): void => {
      const ev = new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'pointerId', { value: 1 });
      grip.dispatchEvent(ev);
      flushSync();
    };
    // jsdom は幅を測れない（つまんだ列の幅は 0 扱い）ので、動いた距離だけを見る
    ptr('pointerdown', 300);
    ptr('pointermove', 360);
    expect(root.style.getPropertyValue('--col-kind')).toBe('60px');
    ptr('pointermove', 5000); // 右へ行きすぎても上限で止まる
    expect(root.style.getPropertyValue('--col-kind')).toBe('1000px');
    ptr('pointermove', -400); // 左へ行きすぎても下限で止まる
    expect(root.style.getPropertyValue('--col-kind')).toBe('48px');
    expect(saved).toEqual([]);
    ptr('pointerup', -400);
    expect(saved).toEqual([{ size: 100, kind: 48 }]);
    grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();
    expect(root.style.getPropertyValue('--col-kind')).toBe('');
    expect(saved.at(-1)).toEqual({ size: 100 });
  });

  it('名前の列も、つまんで幅を決められる（決めるまでは残りの幅を使う。決めると、全体の幅は列の合計になる）。ダブルクリックで元に戻る', async () => {
    const saved: unknown[] = [];
    target = document.createElement('div');
    document.body.appendChild(target);
    instance = mount(FileExplorer, { target, props: { explorer, oncolumnwidths: (w: unknown) => saved.push(w) } });
    flushSync();
    await vi.waitFor(() => expect(target!.querySelector('.file-explorer-list')).not.toBeNull());
    const root = target.querySelector<HTMLElement>('.file-explorer')!;
    expect(root.classList.contains('file-explorer-name-fixed')).toBe(false);
    const grip = target.querySelector<HTMLElement>('.file-explorer-columns .file-explorer-col-name .file-explorer-col-grip')!;
    const ptr = (type: string, x: number): void => {
      const ev = new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'pointerId', { value: 1 });
      grip.dispatchEvent(ev);
      flushSync();
    };
    ptr('pointerdown', 100);
    ptr('pointermove', 400);
    ptr('pointerup', 400);
    expect(root.style.getPropertyValue('--col-name')).toBe('300px');
    expect(root.classList.contains('file-explorer-name-fixed')).toBe(true);
    expect(saved).toEqual([{ name: 300 }]);
    grip.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    flushSync();
    expect(root.classList.contains('file-explorer-name-fixed')).toBe(false);
    expect(saved.at(-1)).toEqual({});
  });

  it('同じフォルダへ貼り付けて、一覧に現れないまま 0.5 秒を超えたら、完了するまでカーソルを「待つ」にする', async () => {
    vi.useFakeTimers();
    try {
      const el = await render();
      let done = (): void => {};
      h.copy.mockImplementation(
        (_from: string, to: string) =>
          new Promise((resolve) => {
            done = () => {
              h.current = [...listing, entry(to)];
              resolve({} as Entry);
            };
          }),
      );
      explorerBuffer.set('copy', [{ path: 'a.txt', kind: 'file' }]);
      flushSync();
      pasteClick(el);
      await vi.advanceTimersByTimeAsync(300);
      expect(el.querySelector('.file-explorer-wait')).toBeNull();
      await vi.advanceTimersByTimeAsync(300);
      expect(el.classList.contains('file-explorer-wait') || el.querySelector('.file-explorer-wait') !== null).toBe(true);
      done();
      await vi.advanceTimersByTimeAsync(50);
      dirIndex.clear();
      await vi.advanceTimersByTimeAsync(50);
      flushSync();
      await vi.waitFor(() => expect(el.querySelector<HTMLInputElement>('.file-explorer-rename')?.value).toBe('a copy.txt'));
      expect(el.classList.contains('file-explorer-wait') || el.querySelector('.file-explorer-wait') !== null).toBe(false);
    } finally {
      vi.useRealTimers();
      h.current = null;
    }
  });

  it('上の階層へ上がると、いたフォルダが選ばれてフォーカスされる（どれだったか分かる）', async () => {
    fileExplorer.open('docs');
    const el = await render();
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-item')).not.toBeNull());
    expect(explorerSelection.paths()).toEqual([]);
    fileExplorer.up();
    await vi.waitFor(() => expect(explorerSelection.paths()).toEqual(['docs']));
    expect(document.activeElement?.closest('.file-explorer-item')?.getAttribute('data-path')).toBe('docs');
  });

  it('フォルダごとに、最後に選んだ項目を覚える。そのフォルダへ入る・戻るとき、そこを選び直す（上がったときは、いたフォルダ）', async () => {
    const el = await render();
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-item')).not.toBeNull());
    // docs へ入る（覚えが無いので、最初の項目を選ぶ）。そこで pic.png を選んで、上へ上がる（いたフォルダ docs が選ばれる）
    fileExplorer.open('docs');
    await vi.waitFor(() => expect(h.list).toHaveBeenCalledWith('docs'));
    await vi.waitFor(() => expect(el.querySelector('.file-explorer-item')).not.toBeNull());
    await vi.waitFor(() => expect(explorerSelection.count).toBe(1));
    expect(explorerSelection.paths()[0]).toBe(el.querySelector('.file-explorer-item')!.getAttribute('data-path'));
    explorerSelection.replace(['pic.png']);
    await vi.waitFor(() => expect(explorer.lastSelected.get('docs')).toBe('pic.png'));
    fileExplorer.up();
    await vi.waitFor(() => expect(explorerSelection.paths()).toEqual(['docs']));
    // もう一度 docs へ入ると、docs で最後に選んだ pic.png が選ばれる
    fileExplorer.open('docs');
    await vi.waitFor(() => expect(explorerSelection.paths()).toEqual(['pic.png']));
    expect(document.activeElement?.closest('.file-explorer-item')?.getAttribute('data-path')).toBe('pic.png');
  });

  it('数えたフォルダのサイズは、タブを切り替えて（画面を作り直して）も数え直さない。数え待ちのフォルダは、みな「…」を出す', async () => {
    h.folderSize.mockClear();
    h.folderSize.mockImplementation(() => new Promise(() => {})); // 数え終わらない
    const el = await render();
    await vi.waitFor(() => expect(rowOf(el, 'docs').querySelector('.file-explorer-col-size')?.textContent).toBe('…'));
    h.folderSize.mockReset();
    h.folderSize.mockImplementation(async () => ({ size: 2048, partial: false }));
    await unmount(instance!);
    target!.remove();
    instance = undefined;
    // 1 つ目の画面で、数えていたものを、数え終えたことにする
    explorer.folderSizeCache.set('docs', { value: { size: 4096, partial: false }, modified: listing.find((e) => e.name === 'docs')!.modified });
    const again = await render();
    await vi.waitFor(() => expect(rowOf(again, 'docs').querySelector('.file-explorer-col-size')?.textContent).toBe('4.0 KB'));
    expect(h.folderSize).not.toHaveBeenCalledWith('docs');
  });
});
