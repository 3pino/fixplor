// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FsEntry } from './lib/fs/types';
import { hotkeys } from './lib/hotkeys.svelte';

// ウィンドウの操作（最後のタブを閉じる・別のウィンドウで開く）は、呼んだことだけを覚える偽物にする
const win = vi.hoisted(() => ({ quit: vi.fn(async () => {}), exit: vi.fn(async () => {}), controls: vi.fn(() => false), open: vi.fn(async (_tab: { place: string; dir: string }, _at?: { x: number; y: number }) => {}) }));
vi.mock('./lib/windowControls', async (orig) => ({ ...(await orig<typeof import('./lib/windowControls')>()), hasWindowControls: win.controls, quitWindow: win.quit, exitApp: win.exit, openTabInNewWindow: win.open }));

// タブ: この端末（メモリの中の木）と、追加したネットワークの場所（WebDAV の偽物）を、複数のタブで開く。
const fake = vi.hoisted(() => {
  const tree = new Map<string, 'file' | 'dir'>();
  const dav = new Map<string, 'file' | 'dir'>();
  const calls: [string, unknown][] = [];
  const parent = (p: string): string => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) || '/' : '');
  const entry = (path: string): FsEntry => ({
    name: path.slice(path.lastIndexOf('/') + 1), path, kind: tree.get(path)!, size: tree.get(path) === 'dir' ? null : 4, modified: 1_700_000_000_000,
    hidden: false, readonly: false, symlink: false,
  });
  const davRaw = (path: string) => ({ name: path.slice(path.lastIndexOf('/') + 1), path, kind: dav.get(path)!, size: dav.get(path) === 'dir' ? null : 4, modified: 1_700_000_000_000, hidden: false, mime: null, etag: `e-${path}` });
  const invoke = async (cmd: string, args?: Record<string, string>): Promise<unknown> => {
    calls.push([cmd, args]);
    switch (cmd) {
      case 'fs_start_dir': return '/home/me';
      case 'fs_places': return [{ kind: 'home', path: '/home/me', name: '' }];
      case 'fs_list': return [...tree.keys()].filter((p) => p !== '/' && parent(p) === args!.path).map(entry);
      case 'dav_cred_info': return null;
      case 'dav_pin_info': return null;
      case 'dav_list': return [...dav.keys()].filter((p) => parent(p) === args!.path && p !== '').map(davRaw);
      case 'dav_cancel': return false;
      default: throw { code: 'unsupported', message: cmd };
    }
  };
  return { tree, dav, calls, invoke };
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: fake.invoke, convertFileSrc: (p: string, proto = 'asset') => `${proto}://localhost/${encodeURIComponent(p)}` }));
// 作ったエクスプローラーが受け取ったバッファを覚える（タブのあいだで共有されるかを見る）
const made = vi.hoisted(() => ({ buffers: [] as { place: string; buffer: unknown }[] }));
vi.mock('@3pino/explorer-kit', async (orig) => {
  const real = await orig<typeof import('@3pino/explorer-kit')>();
  return { ...real, createExplorer: (o: Parameters<typeof real.createExplorer>[0]) => (made.buffers.push({ place: o.labels.root, buffer: o.buffer }), real.createExplorer(o)) };
});
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

import App from './App.svelte';
import { places } from './lib/places.svelte';
import { bookmarks } from './lib/bookmarks.svelte';
import { settings } from './lib/settings.svelte';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};

let app: ReturnType<typeof mount> | undefined;
let target: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  bookmarks.reload();
  for (const p of [...places.list]) places.remove(p.id);
  settings.showHidden = false;
  settings.dirs = {};
  localStorage.clear();
  hotkeys.reload();
  bookmarks.reload();
  fake.calls.length = 0;
  made.buffers.length = 0;
  fake.tree.clear();
  for (const [p, k] of [['/', 'dir'], ['/home', 'dir'], ['/home/me', 'dir'], ['/home/me/docs', 'dir'], ['/home/me/docs/in.txt', 'file'], ['/home/me/pics', 'dir'], ['/home/me/a.txt', 'file']] as const) fake.tree.set(p, k);
  fake.dav.clear();
  fake.dav.set('movies', 'dir');
  fake.dav.set('b.txt', 'file');
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

const start = async (): Promise<void> => {
  app = mount(App, { target });
  await settle();
};
const names = (): string[] => [...target.querySelectorAll('.file-explorer-name-text')].map((n) => n.textContent ?? '');
const tabEls = (): HTMLElement[] => [...target.querySelectorAll<HTMLElement>('.tabs .tab:not(.tab-ghost)')];
const tabLabels = (): string[] => tabEls().map((t) => t.querySelector('.tab-label')!.textContent!);
const activeLabel = (): string => target.querySelector('.tab-active .tab-label')!.textContent!;
const button = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.getAttribute('aria-label') === label || x.textContent?.trim() === label);
  if (!b) throw new Error(`ボタンがありません: ${label}`);
  return b;
};
const key = async (k: string, init: KeyboardEventInit = { ctrlKey: true }): Promise<KeyboardEvent> => {
  const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(ev);
  await settle();
  return ev;
};
/** キーの記録は、ダイアログの「記録終了」を押して確定する */
const dialogText = (): string => document.querySelector('[role="dialog"]')?.textContent ?? '';
const commitKey = async (): Promise<void> => {
  const done = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((b) => b.textContent?.trim() === '記録終了');
  done?.click();
  await settle();
};
/** 設定の「ホットキー」の画面を開き、節（既定は「タブ」）を開く */
const openHotkeys = async (...groups: string[]): Promise<void> => {
  await click(target.querySelector('.settings-link-hotkeys')!);
  for (const g of groups.length > 0 ? groups : ['タブ']) {
    const t = [...target.querySelectorAll<HTMLElement>('.hotkey-group-toggle')].find((b) => b.textContent?.includes(g));
    if (t?.getAttribute('aria-expanded') !== 'true') await click(t!);
  }
};
/** パス（パンくず）のいちばん上から、フォルダを順に開いて行く（場所の欄は無い） */
const goTo = async (path: string): Promise<void> => {
  target.querySelector<HTMLElement>('.file-explorer-crumb')!.click();
  await settle();
  for (const seg of path.split('/').filter(Boolean)) {
    const name = [...target.querySelectorAll<HTMLElement>('.file-explorer-name-text')].find((n) => n.textContent === seg);
    // PC では、押すと選ぶので、ダブルクリックで開く
    name!.closest('.file-explorer-item')!.querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
  }
};
const click = async (el: Element): Promise<void> => {
  (el as HTMLElement).click();
  await settle();
};
const savedTabs = (): { v: number; tabs: { place: string; dir: string }[]; active: number } => JSON.parse(localStorage.getItem('fixplor.tabs')!);
/** jsdom には DataTransfer が無いので、使う口だけの偽物を持たせたドラッグのイベント */
function drag(type: string, types: string[], data: Record<string, string> = {}): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { types, getData: (t: string) => data[t] ?? '', setData: () => {}, effectAllowed: '' } });
  return ev;
}

describe('タブ', () => {
  it('起動は 1 つのタブ（この端末のホーム）。1 つだけでも閉じるボタンを出す', async () => {
    await start();
    expect(tabLabels()).toEqual(['me']);
    expect(target.querySelectorAll('.tab-close')).toHaveLength(1);
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
  });

  it('＋と Ctrl+T で、新しいタブ（いま見ている置き場所のいちばん上。この端末はホーム）を右隣に作って見る', async () => {
    await start();
    await goTo('/home/me/docs');
    expect(activeLabel()).toBe('docs');
    await click(button('新しいタブ'));
    expect(tabLabels()).toEqual(['docs', 'me']);
    expect(activeLabel()).toBe('me');
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
    const ev = await key('t');
    expect(ev.defaultPrevented).toBe(true);
    expect(tabLabels()).toEqual(['docs', 'me', 'me']);
    expect(tabEls().map((t) => t.classList.contains('tab-active'))).toEqual([false, false, true]);
  });

  it('タブごとにフォルダ・戻る履歴を持つ。切り替えても、それぞれのまま', async () => {
    await start();
    await click(button('新しいタブ'));
    await goTo('/home/me/pics');
    expect(names()).toEqual([]);
    await click(tabEls()[0].querySelector('.tab-main')!);
    expect(activeLabel()).toBe('me');
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
    await click(tabEls()[1].querySelector('.tab-main')!);
    expect(activeLabel()).toBe('pics');
    // 2 つめのタブで「上へ」しても、1 つめは動かない
    await click(button('上のフォルダへ'));
    expect(activeLabel()).toBe('me');
    await click(tabEls()[0].querySelector('.tab-main')!);
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
  });

  it('閉じる: ×・Ctrl+W・真ん中のボタン。見ているタブを閉じたら右隣（なければ左）。最後の 1 つを閉じると、ウィンドウを閉じる', async () => {
    await start();
    await key('t');
    await key('t');
    await goTo('/home/me/pics'); // 3 つめ
    expect(tabLabels()).toEqual(['me', 'me', 'pics']);
    await key('w'); // 見ている 3 つめを閉じる → 左
    expect(tabLabels()).toEqual(['me', 'me']);
    expect(tabEls()[1].classList.contains('tab-active')).toBe(true);
    await click(tabEls()[0].querySelector('.tab-close')!); // 見ていない 1 つめを閉じる → 見ているタブはそのまま
    expect(tabLabels()).toEqual(['me']);
    expect(win.quit).not.toHaveBeenCalled();
    // 最後の 1 つ: Ctrl+W でも、ウィンドウを閉じる（タブの保存は、そのまま残る）
    const ev = await key('w');
    expect(win.quit).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
    expect(tabLabels()).toEqual(['me']);
    await click(tabEls()[0].querySelector('.tab-close')!);
    expect(win.quit).toHaveBeenCalledTimes(2);
    // 真ん中のボタン
    await key('t');
    const mid = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
    tabEls()[1].dispatchEvent(mid);
    await settle();
    expect(tabLabels()).toEqual(['me']);
  });

  it('Ctrl+Tab・Ctrl+Shift+Tab・Ctrl+PageDown/PageUp・Ctrl+数字で切り替える（端はつながる。9 は最後）', async () => {
    await start();
    await key('t');
    await key('t');
    await goTo('/home/me/pics');
    await key('t'); // 4 つ: me me pics me → 4 つめを見る
    expect(tabLabels()).toEqual(['me', 'me', 'pics', 'me']);
    const at = (): number => tabEls().findIndex((t) => t.classList.contains('tab-active'));
    expect(at()).toBe(3);
    await key('Tab');
    expect(at()).toBe(0);
    await key('Tab', { ctrlKey: true, shiftKey: true });
    expect(at()).toBe(3);
    await key('PageUp');
    expect(at()).toBe(2);
    await key('PageDown');
    expect(at()).toBe(3);
    await key('1');
    expect(at()).toBe(0);
    await key('3');
    expect(at()).toBe(2);
    await key('9');
    expect(at()).toBe(3);
    // Ctrl の無い T は、何もしない
    await key('t', {});
    expect(tabLabels()).toHaveLength(4);
  });

  it('右クリックのメニュー: 複製（同じフォルダ）・左右へ移す・ほかを閉じる・閉じる', async () => {
    await start();
    await goTo('/home/me/docs');
    await key('t');
    await goTo('/home/me/pics');
    expect(tabLabels()).toEqual(['docs', 'pics']);
    tabEls()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await settle();
    await click(button('複製'));
    expect(tabLabels()).toEqual(['docs', 'docs', 'pics']);
    expect(activeLabel()).toBe('docs');
    expect(names()).toEqual(['in.txt']);
    // 複製のタブ（2 つめ）を左へ
    tabEls()[1].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector<HTMLButtonElement>('[role=menu] button[disabled]')).toBeNull();
    await click(button('右へ移す'));
    expect(tabLabels()).toEqual(['docs', 'pics', 'docs']);
    // 端のタブは、その向きへは移せない
    tabEls()[2].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await settle();
    expect(button('右へ移す').disabled).toBe(true);
    await click(button('ほかのタブを閉じる'));
    expect(tabLabels()).toEqual(['docs']);
    expect(activeLabel()).toBe('docs');
  });

  it('ドラッグで並べ替える（タブを、ほかのタブへ落とす）', async () => {
    await start();
    await goTo('/home/me/docs');
    await key('t');
    await goTo('/home/me/pics');
    await key('t');
    expect(tabLabels()).toEqual(['docs', 'pics', 'me']);
    tabEls()[2].dispatchEvent(drag('dragstart', ['application/x-fixplor-tab']));
    tabEls()[0].dispatchEvent(drag('drop', ['application/x-fixplor-tab'], { 'application/x-fixplor-tab': '2' }));
    await settle();
    expect(tabLabels()).toEqual(['me', 'docs', 'pics']);
    // 見ているタブは、並べ替えても同じタブ（「me」のまま）
    expect(activeLabel()).toBe('me');
  });

  it('フォルダをタブの欄へドラッグして落とすと、新しいタブで開く（見ているタブは変えない）。ファイル・知らない項目は開かない。落とす前に、点線のタブで位置（隙間）を見せる', async () => {
    await start();
    // フォルダを含むドラッグには、フォルダの印も付く（ファイルだけのドラッグには付かない）
    const types = ['application/x-explorer-kit-items', 'application/x-explorer-kit-has-dir'];
    const ghost = (): HTMLElement | null => target.querySelector('.tab-ghost');
    // ファイルだけのドラッグは、受けない（何も見せない）
    const over = drag('dragover', [types[0]]);
    target.querySelector('.tabs')!.dispatchEvent(over);
    await settle();
    expect(over.defaultPrevented).toBe(false);
    expect(ghost()).toBeNull();
    const overDir = drag('dragover', types);
    target.querySelector('.tabs')!.dispatchEvent(overDir);
    await settle();
    expect(overDir.defaultPrevented).toBe(true);
    // タブの無いところの上: いちばん後ろに、点線のタブ
    expect(ghost()).not.toBeNull();
    expect(tabEls()).toHaveLength(1);
    target.querySelector('.tabs')!.dispatchEvent(drag('drop', types, { [types[0]]: 'home/me/docs|home/me/a.txt|home/me/nowhere' }));
    await settle();
    expect(ghost()).toBeNull();
    expect(tabLabels()).toEqual(['me', 'docs']);
    // 見ているタブは、そのまま
    expect(activeLabel()).toBe('me');
    // 「＋」の上でも同じ（欄の中）。いま見ているフォルダの一覧で、見つかるものだけ
    target.querySelector('.tab-add')!.dispatchEvent(drag('drop', types, { [types[0]]: 'home/me/pics' }));
    await settle();
    expect(tabLabels()).toEqual(['me', 'docs', 'pics']);
    expect(activeLabel()).toBe('me');
  });

  it('タブの上へ落とすと、そのタブの隣（右半分なら後ろ）に作る。タブの欄を出ると、点線のタブは消える', async () => {
    await start();
    await key('t');
    await click(tabEls()[0].querySelector('.tab-main')!);
    const types = ['application/x-explorer-kit-items', 'application/x-explorer-kit-has-dir'];
    tabEls()[0].dispatchEvent(drag('dragover', types));
    await settle();
    const all = [...target.querySelectorAll('.tabs .tab')];
    expect(all.map((t) => t.classList.contains('tab-ghost'))).toEqual([false, true, false]);
    target.querySelector('.tabbar')!.dispatchEvent(new Event('dragleave', { bubbles: true }));
    await settle();
    expect(target.querySelector('.tab-ghost')).toBeNull();
    tabEls()[0].dispatchEvent(drag('dragover', types));
    await settle();
    tabEls()[0].dispatchEvent(drag('drop', types, { [types[0]]: 'home/me/docs' }));
    await settle();
    expect(tabLabels()).toEqual(['me', 'docs', 'me']);
  });

  it('タブをウィンドウの外へドラッグして離すと、別のウィンドウで開き、このウィンドウのタブは閉じる（1 つだけのタブは動かさない・ウィンドウの中なら動かさない）', async () => {
    await start();
    // dragstart してから dragend（ドラッグ中でなければ、何もしない）
    const end = (el: Element, init: { dropEffect: string; x: number; y: number }): void => {
      el.dispatchEvent(drag('dragstart', []));
      const ev = new Event('dragend', { bubbles: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { dropEffect: init.dropEffect } });
      for (const [k, v] of Object.entries({ clientX: init.x, clientY: init.y, screenX: init.x + 300, screenY: init.y + 200 })) Object.defineProperty(ev, k, { value: v });
      el.dispatchEvent(ev);
    };
    // 1 つだけのタブ
    end(tabEls()[0], { dropEffect: 'none', x: -40, y: 10 });
    await settle();
    expect(win.open).not.toHaveBeenCalled();
    await key('t');
    await goTo('/home/me/docs');
    // ウィンドウの中で離した（取り消し）
    end(tabEls()[1], { dropEffect: 'none', x: 100, y: 10 });
    await settle();
    expect(win.open).not.toHaveBeenCalled();
    // 受け取られた（ほかのタブの上など）
    end(tabEls()[1], { dropEffect: 'move', x: -40, y: 10 });
    await settle();
    expect(win.open).not.toHaveBeenCalled();
    // ウィンドウの外
    end(tabEls()[1], { dropEffect: 'none', x: -40, y: 10 });
    await settle();
    expect(win.open).toHaveBeenCalledWith({ place: 'local', dir: 'home/me/docs' }, { x: 260, y: 210 });
    expect(tabLabels()).toEqual(['me']);
  });

  it('別のウィンドウで開いたとき（?place=…&dir=…）は、そのタブ 1 つで始める。タブの保存は、元のウィンドウのものを上書きしない', async () => {
    localStorage.setItem('fixplor.tabs', JSON.stringify({ v: 1, active: 0, tabs: [{ place: 'local', dir: '/home/me' }, { place: 'local', dir: '/home/me/pics' }] }));
    const before = localStorage.getItem('fixplor.tabs');
    history.replaceState(null, '', '/?place=local&dir=%2Fhome%2Fme%2Fdocs');
    try {
      await start();
      expect(tabLabels()).toEqual(['docs']);
      await key('t');
      expect(tabLabels()).toEqual(['docs', 'me']);
      expect(localStorage.getItem('fixplor.tabs')).toBe(before);
    } finally {
      history.replaceState(null, '', '/');
    }
  });

  it('設定のタブ: 左下の行で開く（1 つだけ）。タブとして保存・復元される。設定の画面では、場所の欄は出さない', async () => {
    await start();
    await click(target.querySelector('.about-row')!);
    expect(tabLabels()).toEqual(['me', '設定']);
    expect(activeLabel()).toBe('設定');
    expect(target.querySelector('[role="region"][aria-label="設定"]')).not.toBeNull();
    expect(target.querySelector('.file-explorer')).toBeNull();
    expect(target.textContent).toContain('ホットキー');
    expect(target.textContent).toContain('バージョン');
    expect(savedTabs().tabs.map((t) => t.place)).toEqual(['local', 'fixplor:settings']);
    // 設定の画面では、場所の欄は出さない
    expect(target.querySelector('nav.places')).toBeNull();
    // もう一度押しても、増やさない（見ているタブへ移るだけ）
    await click(tabEls()[0].querySelector('.tab-main')!);
    expect(target.querySelector('nav.places')).not.toBeNull();
    await click(target.querySelector('.about-row')!);
    expect(tabLabels()).toEqual(['me', '設定']);
    expect(activeLabel()).toBe('設定');
    // 起動し直すと、設定のタブも戻る
    void unmount(app!);
    app = undefined;
    document.body.innerHTML = '';
    target = document.createElement('div');
    document.body.append(target);
    await start();
    expect(tabLabels()).toEqual(['me', '設定']);
  });

  it('ネットワークの場所もタブで開く。タブの中で置き場所を切り替えても、その置き場所のフォルダ・選びは保つ', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    await start();
    await click(button('自宅'));
    expect(activeLabel()).toBe('自宅');
    expect(names()).toEqual(['movies', 'b.txt']);
    await key('t'); // 自宅のいちばん上
    expect(tabLabels()).toEqual(['自宅', '自宅']);
    await click(target.querySelector('.places .menu-item')!); // この端末（ホーム）へ戻る: このタブだけ
    expect(tabLabels()).toEqual(['自宅', 'me']);
    await click(tabEls()[0].querySelector('.tab-main')!);
    expect(names()).toEqual(['movies', 'b.txt']);
  });

  it('切り取り・コピーのバッファは、同じ置き場所のタブで共有する。別の置き場所とは共有しない（パスが別のものになる）', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    await start();
    await key('t');
    await click(button('自宅'));
    await key('t');
    const byPlace = (root: string): unknown[] => made.buffers.filter((b) => b.place === root).map((b) => b.buffer);
    const local = byPlace('コンピューター');
    const dav = byPlace('自宅');
    expect(local).toHaveLength(2);
    expect(local[0]).toBeDefined();
    expect(local[0]).toBe(local[1]);
    expect(dav.length).toBeGreaterThanOrEqual(1);
    expect(dav[0]).not.toBe(local[0]);
  });

  it('置き場所を外すと、その置き場所を見ていたタブは、この端末へ戻る', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    await start();
    await click(button('自宅'));
    await key('t');
    expect(tabLabels()).toEqual(['自宅', '自宅']);
    await click(button('「自宅」を直す'));
    await click(button('一覧から外す'));
    await click(button('外す'));
    expect(places.list).toEqual([]);
    expect(tabLabels()).toEqual(['me', 'me']);
    expect(names()).toEqual(['docs', 'pics', 'a.txt']);
  });

  it('タブ（置き場所・フォルダ・見ているタブ）を保存し、次の起動で戻す', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    await start();
    await goTo('/home/me/docs');
    await click(button('新しいタブ'));
    await click(button('自宅'));
    await click(tabEls()[0].querySelector('.tab-main')!);
    expect(savedTabs()).toEqual({ v: 1, tabs: [{ place: 'local', dir: 'home/me/docs' }, { place: p.place.id, dir: '' }], active: 0 });
    void unmount(app!);
    app = undefined;
    document.body.innerHTML = '';
    target = document.createElement('div');
    document.body.append(target);
    fake.calls.length = 0;
    await start();
    expect(tabLabels()).toEqual(['docs', '自宅']);
    expect(activeLabel()).toBe('docs');
    expect(names()).toEqual(['in.txt']);
    // ネットワークの場所のタブは、見るまでつながない
    expect(fake.calls.filter((c) => c[0] === 'dav_list')).toEqual([]);
    await click(tabEls()[1].querySelector('.tab-main')!);
    expect(names()).toEqual(['movies', 'b.txt']);
  });

  it('保存が壊れている・外した置き場所だけなら、ホームの 1 つで始める。外した置き場所のタブは捨てる', async () => {
    localStorage.setItem('fixplor.tabs', '{ broken');
    await start();
    expect(tabLabels()).toEqual(['me']);
    void unmount(app!);
    app = undefined;
    document.body.innerHTML = '';
    target = document.createElement('div');
    document.body.append(target);
    localStorage.setItem('fixplor.tabs', JSON.stringify({ v: 1, active: 1, tabs: [{ place: 'local', dir: 'home/me/pics' }, { place: 'gone-place', dir: 'x' }] }));
    await start();
    expect(tabLabels()).toEqual(['pics']);
  });

  it('タブは 20 個まで（超えたら知らせて、作らない）', async () => {
    await start();
    for (let i = 0; i < 25; i++) await key('t');
    expect(tabLabels()).toHaveLength(20);
    expect(document.querySelector('.toast')!.textContent).toContain('タブは 20 個まで');
  });

  it('ホットキーは、設定で変えられる。変えると、前のキーは効かなくなり、新しいキーが効く。保存され、既定に戻せる', async () => {
    await start();
    await click(target.querySelector('.about-row')!); // 設定のタブ
    await openHotkeys(); // 「ホットキー」の画面
    const row = (id: string): HTMLElement => target.querySelector<HTMLElement>(`[data-command="${id}"]`)!;
    // 新しいタブに、Ctrl+Y を足す（記録）
    (row('tab.new').querySelector('button[aria-label="新しいタブのキーを追加"]') as HTMLElement).click();
    await settle();
    expect(dialogText()).toContain('キーを押してください');
    // 記録の間は、ほかの操作は働かない（Ctrl+T も、タブを作らずに記録される）
    const before = tabLabels().length;
    await key('Control', { ctrlKey: true }); // 修飾キーだけは、続きを待つ
    expect(dialogText()).toContain('キーを押してください');
    await key('y');
    expect(tabLabels()).toHaveLength(before);
    await commitKey();
    expect(row('tab.new').textContent).toContain('Ctrl+Y');
    expect(JSON.parse(localStorage.getItem('fixplor.hotkeys')!)).toEqual({ 'tab.new': ['Ctrl+T', 'Ctrl+Y'] });
    await key('y');
    expect(tabLabels()).toHaveLength(before + 1);
    await click(tabEls()[1].querySelector('.tab-main')!); // 設定のタブへ戻る（ホットキーの画面と、開いた節は、そのまま残っている）
    expect(row('tab.new')).not.toBeNull();
    // Ctrl+T を外す → 効かない
    (row('tab.new').querySelector('button[aria-label="新しいタブの Ctrl+T を外す"]') as HTMLElement).click();
    await settle();
    await key('t');
    expect(tabLabels()).toHaveLength(before + 1);
    // 既定に戻す → Ctrl+T が効く。保存も消える
    (row('tab.new').querySelector('button[aria-label="新しいタブのキーを既定に戻す"]') as HTMLElement).click();
    await settle();
    expect(localStorage.getItem('fixplor.hotkeys')).toBe('{}');
    await key('t');
    expect(tabLabels()).toHaveLength(before + 2);
  });

  it('記録は、もう一度「＋」を押すと取り消す。Esc も、記録できる。ほかの操作と同じキーを足すと、警告を出す', async () => {
    await start();
    await click(target.querySelector('.about-row')!);
    await openHotkeys('タブ', '選択');
    const row = (id: string): HTMLElement => target.querySelector<HTMLElement>(`[data-command="${id}"]`)!;
    (row('tab.prev').querySelector('button[aria-label="前のタブのキーを追加"]') as HTMLElement).click();
    await settle();
    (row('tab.prev').querySelector('button[aria-label="前のタブのキーを追加"]') as HTMLElement).click(); // もう一度で取り消し
    await settle();
    expect(row('tab.prev').textContent).not.toContain('キーを押してください');
    expect(localStorage.getItem('fixplor.hotkeys')).toBeNull();
    expect(row('tab.prev').querySelector('[role="img"]')).toBeNull();
    (row('tab.prev').querySelector('button[aria-label="前のタブのキーを追加"]') as HTMLElement).click();
    await settle();
    await key('t'); // 「新しいタブ」と同じ
    await commitKey();
    expect(row('tab.prev').textContent).toContain('同じキーが、ほかの操作にもあります');
    expect(row('tab.prev').textContent).toContain('新しいタブ');
    expect(row('tab.new').textContent).toContain('同じキーが、ほかの操作にもあります');
    // Esc も記録できる（「選択解除」の既定と同じなので、警告が出る）
    (row('tab.next').querySelector('button[aria-label="次のタブのキーを追加"]') as HTMLElement).click();
    await settle();
    await key('Escape', {});
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true, cancelable: true })); // 短く押す（長押しではキャンセル）
    await settle();
    await commitKey();
    expect(row('tab.next').textContent).toContain('Esc');
    expect(row('tab.next').textContent).toContain('選択解除');
  });

  it('一覧の操作（名前の変更・検索など）のホットキーも、設定のとおりになる', async () => {
    localStorage.setItem('fixplor.hotkeys', JSON.stringify({ rename: ['F3'], search: [] }));
    hotkeys.reload();
    await start();
    const row = target.querySelector<HTMLElement>('.file-explorer-item[data-path="home/me/docs"] .file-explorer-row')!;
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true, cancelable: true }));
    await settle();
    expect(target.querySelector('.file-explorer-rename')).toBeNull();
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true }));
    await settle();
    expect(target.querySelector('.file-explorer-rename')).not.toBeNull();
  });

  it('設定を開く（Ctrl+, と F12）・完全終了（Ctrl+Q・Ctrl+Shift+W）。設定は 1 つだけ', async () => {
    await start();
    await key(',');
    expect(tabLabels()).toEqual(['me', '設定']);
    expect(activeLabel()).toBe('設定');
    await click(tabEls()[0].querySelector('.tab-main')!);
    await key('F12', {});
    expect(tabLabels()).toEqual(['me', '設定']);
    expect(activeLabel()).toBe('設定');
    expect(win.exit).not.toHaveBeenCalled();
    await key('q');
    await key('W', { ctrlKey: true, shiftKey: true });
    expect(win.exit).toHaveBeenCalledTimes(2);
    expect(win.quit).not.toHaveBeenCalled();
  });

  it('上の階層へ（Ctrl+↑）・隠しファイルの表示を切り替える（. キー）・番号のタブへ（変えられる）', async () => {
    await start();
    await goTo('/home/me/docs');
    expect(names()).toEqual(['in.txt']);
    const ev = await key('ArrowUp');
    expect(ev.defaultPrevented).toBe(true);
    expect(names()).toContain('docs');
    expect(settings.showHidden).toBe(false);
    await key('.', {});
    expect(settings.showHidden).toBe(true);
    await key('.', {});
    expect(settings.showHidden).toBe(false);
    // 文字を打っている入力欄の中では、修飾キーのないホットキーは働かない
    const input = document.createElement('input');
    target.append(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '.', bubbles: true, cancelable: true }));
    await settle();
    expect(settings.showHidden).toBe(false);
    // 「3 番目のタブへ」を Ctrl+Y に付け替える
    await key('t');
    await key('t');
    hotkeys.set('tab.goto3', ['Ctrl+Y']);
    await click(tabEls()[0].querySelector('.tab-main')!);
    await key('3');
    expect(tabEls().indexOf(target.querySelector<HTMLElement>('.tab-active')!)).toBe(0);
    await key('y');
    expect(tabEls().indexOf(target.querySelector<HTMLElement>('.tab-active')!)).toBe(2);
  });

  it('ホットキー（設定で付ける）: ほかのタブを閉じる・タブを左へ・右へ移す（端では何もしない）', async () => {
    await start();
    await key('t');
    await key('t');
    expect(tabLabels()).toHaveLength(3);
    hotkeys.set('tab.moveLeft', ['Alt+Shift+ArrowLeft']);
    hotkeys.set('tab.moveRight', ['Alt+Shift+ArrowRight']);
    hotkeys.set('tab.closeOthers', ['Ctrl+Shift+O']);
    // いちばん右のタブを、見分けるために、別のフォルダへ
    await goTo('/home/me/docs');
    expect(tabLabels()).toEqual(['me', 'me', 'docs']);
    await key('ArrowRight', { altKey: true, shiftKey: true }); // 右端では何もしない
    expect(tabLabels()).toEqual(['me', 'me', 'docs']);
    await key('ArrowLeft', { altKey: true, shiftKey: true });
    expect(tabLabels()).toEqual(['me', 'docs', 'me']);
    expect(activeLabel()).toBe('docs');
    await key('ArrowLeft', { altKey: true, shiftKey: true });
    await key('ArrowLeft', { altKey: true, shiftKey: true }); // 左端では何もしない
    expect(tabLabels()).toEqual(['docs', 'me', 'me']);
    await key('ArrowRight', { altKey: true, shiftKey: true });
    expect(tabLabels()).toEqual(['me', 'docs', 'me']);
    await key('o', { ctrlKey: true, shiftKey: true });
    expect(tabLabels()).toEqual(['docs']);
    await key('o', { ctrlKey: true, shiftKey: true }); // 1 つしか無いときは何もしない
    expect(tabLabels()).toEqual(['docs']);
  });

  it('選んだフォルダを、新しいタブで開いてそこへ移る（Ctrl+Enter）・今のタブに残って開く（既定のキーは無し）・新しいウィンドウ（Ctrl+Shift+Enter）で開く', async () => {
    await start();
    await goTo('/home/me');
    // 移ると、最初の項目（docs）が選ばれている
    await settle();
    // 選んだものが無いとき・ファイルのときは、何もしない
    await key('Enter', { ctrlKey: true });
    expect(tabLabels()).toEqual(['me', 'docs']);
    expect(activeLabel()).toBe('docs');
    // 今のタブに残って開く操作（キーは、設定で付ける）
    await click(tabEls()[0].querySelector('.tab-main')!);
    hotkeys.set('file.openNewTab', ['Ctrl+Alt+Enter']);
    // 画面を作り直した（タブを切り替えた）ので、最初の項目は選ばれていない。選ぶ
    [...target.querySelectorAll<HTMLElement>('.file-explorer-item')].find((li) => li.dataset.path === 'home/me/docs')!.querySelector<HTMLElement>('.file-explorer-row')!.click();
    await settle();
    await key('Enter', { ctrlKey: true, altKey: true });
    expect(tabLabels()).toEqual(['me', 'docs', 'docs']);
    expect(activeLabel()).toBe('me');
    hotkeys.reset('file.openNewTab');
    // ウィンドウの操作が無い環境（ブラウザ）では、新しいウィンドウは開かない
    await key('Enter', { ctrlKey: true, shiftKey: true });
    expect(win.open).not.toHaveBeenCalled();
    win.controls.mockReturnValue(true);
    await key('Enter', { ctrlKey: true, shiftKey: true });
    expect(win.open).toHaveBeenCalledTimes(1);
    expect(win.open.mock.calls[0][0].dir).toBe('home/me/docs');
    win.controls.mockReturnValue(false);
  });

  it('選んだ項目（無ければ、いまのフォルダ）のパスを、OS の形でコピーする（Ctrl+Shift+C）', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void written.push(t) }, configurable: true });
    await start();
    await goTo('/home/me');
    await settle();
    await key('Escape', {}); // 移ると最初の項目が選ばれているので、選びを外す
    await key('C', { ctrlKey: true, shiftKey: true });
    expect(written.at(-1)).toBe('/home/me');
    const row = [...target.querySelectorAll<HTMLElement>('.file-explorer-item')].find((li) => li.dataset.path === 'home/me/a.txt')!;
    row.querySelector<HTMLElement>('.file-explorer-row')!.click();
    await settle();
    await key('C', { ctrlKey: true, shiftKey: true });
    expect(written.at(-1)).toBe('/home/me/a.txt');
  });
});

describe('左の欄: ブックマークとドライブ・戻る／進む', () => {
  const marks = (): (string | undefined)[] => [...target.querySelectorAll('section[aria-label="ブックマーク"] .place-open')].map((b) => b.textContent?.trim());
  const drives = (): (string | undefined)[] => [...target.querySelectorAll('section[aria-label="ドライブ"] .place-open')].map((b) => b.textContent?.trim());
  const rightClick = async (el: Element): Promise<void> => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 30 }));
    await settle();
  };
  const menuItems = (sel: string): string[] => [...document.querySelectorAll(`${sel} .menu-item`)].map((b) => b.textContent?.trim() ?? '');
  const menuClick = async (sel: string, text: string): Promise<void> => {
    await click([...document.querySelectorAll(`${sel} .menu-item`)].find((b) => b.textContent?.includes(text))!);
  };

  it('上から「ブックマーク」「ドライブ」の順。初めは、この端末のよく使うフォルダがブックマークに入っている。ネットワークの場所はドライブの節', async () => {
    places.add('自宅', 'https://nas.example/dav/');
    await start();
    expect([...target.querySelectorAll('.places-title')].map((t) => t.textContent)).toEqual(['ブックマーク', 'ドライブ']);
    expect(marks()).toEqual(['me']);
    expect(drives()).toEqual(['自宅']);
    expect(JSON.parse(localStorage.getItem('fixplor.bookmarks')!).map((b: { name: string }) => b.name)).toEqual(['me']);
  });

  it('ビューの設定で、場所の欄（デスクトップ）を出さないにできる（もとに戻すと出る）', async () => {
    await start();
    expect(target.querySelector('nav.places')).not.toBeNull();
    settings.views = { hidden: ['places'], swipe: 'places' };
    await settle();
    expect(target.querySelector('nav.places')).toBeNull();
    expect(target.querySelector('.places-resizer')).toBeNull();
    settings.views = { hidden: [], swipe: 'places' };
    await settle();
    expect(target.querySelector('nav.places')).not.toBeNull();
  });

  it('設定の「ビュー」のトグルで、場所の欄の出す・出さないを切り替えて保存する（デスクトップ。Android の「右スワイプで出す画面」の選びは出さない）', async () => {
    await start();
    await click(target.querySelector('.about-row')!);
    const sw = target.querySelector<HTMLElement>('.settings-views [role="switch"]')!;
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(target.querySelector('.settings-swipe-view')).toBeNull();
    await click(sw);
    expect(settings.views.hidden).toEqual(['places']);
    expect(JSON.parse(localStorage.getItem('fixplor.views')!).hidden).toEqual(['places']);
    await click(target.querySelector<HTMLElement>('.settings-views [role="switch"]')!);
    expect(settings.views.hidden).toEqual([]);
  });

  it('ブックマークにアイコンを付ける（見た目のルールどおり。一覧のフォルダと同じ。ルールが無ければ folder）。ドライブには付けない', async () => {
    places.add('自宅', 'https://nas.example/dav/');
    await start();
    await goTo('/home/me/docs');
    await click(target.querySelector<HTMLButtonElement>('button[aria-label="いま開いているフォルダをブックマークに追加"]')!);
    const icons = (): (string | null)[] => [...target.querySelectorAll('section[aria-label="ブックマーク"] .place-open .place-icon svg')].map((s) => s.getAttribute('data-icon'));
    expect(marks()).toEqual(['me', 'docs']);
    expect(icons()).toEqual(['folder', 'folder']);
    expect(target.querySelector('section[aria-label="ドライブ"] .place-icon')).toBeNull();
    // ルールを変えると、ブックマークのアイコンも変わる
    settings.rules = [{ id: 'x', name: 'docs', enabled: true, conditions: [{ field: 'stem', op: 'is', value: 'docs' }], look: { icon: 'book', hue: 30 } }];
    await settle();
    expect(icons()).toEqual(['folder', 'book']);
  });

  it('＋で、いま開いているフォルダを足す（足したものは、もう足せない）。右クリック（長押し）のメニューから、新しいタブで開く・ブックマークから削除', async () => {
    await start();
    await goTo('/home/me/docs');
    const add = target.querySelector<HTMLButtonElement>('button[aria-label="いま開いているフォルダをブックマークに追加"]')!;
    expect(add.disabled).toBe(false);
    await click(add);
    expect(marks()).toEqual(['me', 'docs']);
    expect(add.disabled).toBe(true);
    // 押すと、そのフォルダへ
    await click(target.querySelector('section[aria-label="ブックマーク"] .place-open')!);
    expect(names()).toContain('docs');
    await click([...target.querySelectorAll('section[aria-label="ブックマーク"] .place-open')][1]);
    expect(names()).toEqual(['in.txt']);
    // 右クリック: ウィンドウの操作が無い環境（ブラウザ）では、新しいウィンドウの項目は出ない
    await rightClick([...target.querySelectorAll('section[aria-label="ブックマーク"] .place-open')][1]);
    expect(menuItems('.places-menu-anchor')).toEqual(['新しいタブで開く', '上へ移動', '下へ移動', 'ブックマークから削除']);
    await menuClick('.places-menu-anchor', '新しいタブで開く');
    expect(tabLabels()).toEqual(['docs', 'docs']);
    await rightClick([...target.querySelectorAll('section[aria-label="ブックマーク"] .place-open')][1]);
    await menuClick('.places-menu-anchor', 'ブックマークから削除');
    expect(marks()).toEqual(['me']);
    expect(document.querySelector('.places-menu-anchor')).toBeNull();
    // 全部消しても、入れ直さない
    await rightClick(target.querySelector('section[aria-label="ブックマーク"] .place-open')!);
    await menuClick('.places-menu-anchor', 'ブックマークから削除');
    expect(marks()).toEqual([]);
    expect(target.querySelectorAll('section[aria-label="ブックマーク"] .place-row')).toHaveLength(0);
    expect(target.querySelector('.places-add-slot')).toBeNull(); // 追加の空きは、フォルダをドラッグしてきたときだけ出る
  });

  it('ホットキー（設定で付ける）: ブックマークの n 番目を開く。ブックマークから検索（絞り込み・Enter で開く・Ctrl+Enter で新しいタブ・Esc で閉じる）', async () => {
    await start();
    await goTo('/home/me/docs');
    await click(target.querySelector('button[aria-label="いま開いているフォルダをブックマークに追加"]')!);
    await goTo('/home/me/pics');
    await click(target.querySelector('button[aria-label="いま開いているフォルダをブックマークに追加"]')!);
    expect(marks()).toEqual(['me', 'docs', 'pics']);
    hotkeys.set('bookmark.goto2', ['Alt+2']);
    hotkeys.set('bookmark.goto9', ['Alt+9']);
    hotkeys.set('bookmark.search', ['Ctrl+P']);
    const here = (): string => [...target.querySelectorAll('.file-explorer-crumb')].map((c) => c.textContent?.trim()).join('/');
    await key('2', { altKey: true });
    expect(here()).toBe('コンピューター/home/me/docs');
    await key('9', { altKey: true }); // 無い番号は何もしない
    expect(here()).toBe('コンピューター/home/me/docs');
    // 検索
    await key('p');
    const input = (): HTMLInputElement => document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
    expect(document.querySelector('[role="dialog"]')!.getAttribute('aria-label')).toBe('ブックマークから検索');
    const options = (): string[] => [...document.querySelectorAll('[role="dialog"] [role="option"]')].map((o) => o.querySelector('.bookmark-search-name')?.textContent ?? '');
    expect(options()).toEqual(['me', 'docs', 'pics']);
    input().value = 'pi';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(options()).toEqual(['pics']);
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(here()).toBe('コンピューター/home/me/pics');
    // Ctrl+Enter: 新しいタブ。Esc: 閉じる
    await key('p');
    // 下に、開き方のキーを小さく出す（「フォルダを」は付けない。キーが無いものは出さない）
    expect([...document.querySelectorAll('.bookmark-search-hint')].map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['開く Enter', '新しいタブで開いて移る Ctrl+Enter']);
    // 1 つの操作に複数のキーがあれば、全部出す（開き方ごとに 1 行）。文字・Shift+文字は、入力に使うので、ここでは出さず、働かせない
    await key('Escape', {});
    hotkeys.set('file.openNewTab', ['Ctrl+Alt+Enter', 'a', 'Shift+B', 'F2']);
    await key('p');
    expect([...document.querySelectorAll('.bookmark-search-hint')].map((h) => h.textContent?.replace(/\s+/g, ' ').trim())).toEqual(['開く Enter', '新しいタブで開く Ctrl+Alt+Enter F2', '新しいタブで開いて移る Ctrl+Enter']);
    expect(document.querySelectorAll('.bookmark-search-hint')).toHaveLength(3);
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }));
    await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull(); // 文字は、ホットキーとして働かない
    await key('Escape', {});
    hotkeys.reset('file.openNewTab');
    await key('p');
    expect(document.querySelector('[role="dialog"] input')!.getAttribute('placeholder')).toBeNull();
    input().value = 'doc';
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true }));
    await settle();
    expect(tabLabels()).toEqual(['pics', 'docs']);
    await key('p');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await key('Escape', {});
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('ブックマークは並べ替えられる: ドラッグ・設定のホットキー（既定なし）・メニューの「上へ」「下へ」。並びは保存される（ほかのブックマークのパターンは変えない）', async () => {
    await start();
    await goTo('/home/me/docs');
    await click(target.querySelector('button[aria-label="いま開いているフォルダをブックマークに追加"]')!);
    await goTo('/home/me/pics');
    await click(target.querySelector('button[aria-label="いま開いているフォルダをブックマークに追加"]')!);
    expect(marks()).toEqual(['me', 'docs', 'pics']);
    const btn = (i: number): HTMLElement => [...target.querySelectorAll<HTMLElement>('section[aria-label="ブックマーク"] .place-open')][i];
    // メニュー: 下へ・上へ（端では押せない）
    await rightClick(btn(0));
    expect([...document.querySelectorAll('.places-menu-anchor .menu-item')].find((b) => b.textContent?.includes('上へ'))!.hasAttribute('disabled')).toBe(true);
    await menuClick('.places-menu-anchor', '下へ移動');
    expect(marks()).toEqual(['docs', 'me', 'pics']);
    // 既定のキーは無い（Ctrl+Alt+↓ では動かない）。ホットキーを決めると、フォーカスしているブックマークを動かす（フォーカスは残る）
    btn(1).focus();
    await key('ArrowDown', { ctrlKey: true, altKey: true });
    expect(marks()).toEqual(['docs', 'me', 'pics']);
    hotkeys.set('bookmark.moveDown', ['Ctrl+Alt+ArrowDown']);
    hotkeys.set('bookmark.moveUp', ['Ctrl+Alt+ArrowUp']);
    btn(1).focus();
    await key('ArrowDown', { ctrlKey: true, altKey: true });
    await settle();
    expect(marks()).toEqual(['docs', 'pics', 'me']);
    expect(document.activeElement?.textContent?.trim()).toBe('me');
    await key('ArrowDown', { ctrlKey: true, altKey: true }); // 端では何もしない
    expect(marks()).toEqual(['docs', 'pics', 'me']);
    // フォーカスが無ければ、いま開いているフォルダのブックマーク
    (document.activeElement as HTMLElement).blur();
    await goTo('/home/me/pics');
    await key('ArrowUp', { ctrlKey: true, altKey: true });
    expect(marks()).toEqual(['pics', 'docs', 'me']);
    await key('ArrowDown', { ctrlKey: true, altKey: true });
    expect(marks()).toEqual(['docs', 'pics', 'me']);
    hotkeys.reset('bookmark.moveDown');
    hotkeys.reset('bookmark.moveUp');
    // ドラッグ: ホームをいちばん上へ（最初の行の上半分へ落とす）
    const rowEl = (i: number): HTMLElement => btn(i).closest<HTMLElement>('.place-row')!;
    // jsdom には DragEvent・DataTransfer が無い
    const data: Record<string, string> = {};
    const ev = (type: string, y = 0): Event => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, 'clientY', { value: y });
      Object.defineProperty(e, 'dataTransfer', { value: { types: Object.keys(data), effectAllowed: '', dropEffect: '', setData: (k: string, v: string) => (data[k] = v), getData: (k: string) => data[k] ?? '' } });
      return e;
    };
    rowEl(2).getBoundingClientRect = () => ({ top: 160, bottom: 190, height: 30, left: 0, right: 100, width: 100, x: 0, y: 160, toJSON() {} });
    rowEl(2).dispatchEvent(ev('dragstart'));
    rowEl(0).dispatchEvent(ev('dragover', 105));
    await settle();
    // 動かしている行が空けた席へ、ほかの行がずれる（ホームの席へ入るので、docs・pics が 1 行ぶん下へ）
    expect(rowEl(0).style.transform).toContain('translateY');
    expect(rowEl(1).style.transform).toContain('translateY');
    rowEl(0).dispatchEvent(ev('drop', 105));
    await settle();
    expect(marks()).toEqual(['me', 'docs', 'pics']);
    expect(rowEl(0).style.transform).toBe('');
    expect(JSON.parse(localStorage.getItem('fixplor.bookmarks')!).map((b: { name: string }) => b.name)).toEqual(['me', 'docs', 'pics']);
  });

  it('一覧のフォルダを左の欄の末尾の空きへ落とすと、ブックマークに足せる。ブックマークの上へ落とすと、その中へ移す（Ctrl でコピー）', async () => {
    await start();
    const types = ['application/x-explorer-kit-items', 'application/x-explorer-kit-has-dir'];
    expect(marks()).toEqual(['me']);
    expect(target.querySelector('.places-add-slot')).toBeNull(); // ふだんは、空きを出さない
    // フォルダのドラッグ（ドラッグしている項目は、一覧の dragstart が覚える）。左の欄の上に来ると、空きが出る
    const folder = target.querySelector<HTMLElement>('.file-explorer-item[data-path="home/me/docs"]')!;
    folder.dispatchEvent(drag('dragstart', [], {}));
    target.querySelector('.places')!.dispatchEvent(drag('dragover', types));
    await settle();
    const slot = target.querySelector<HTMLElement>('.places-add-slot')!;
    slot.dispatchEvent(drag('dragover', types));
    await settle();
    expect(slot.textContent).toContain('フォルダをここへドロップして追加');
    expect(slot.classList.contains('places-add-slot-drop')).toBe(true);
    slot.dispatchEvent(drag('drop', types));
    await settle();
    expect(marks()).toEqual(['me', 'docs']);
    folder.dispatchEvent(drag('dragend', []));
    await settle();
    expect(target.querySelector('.places-add-slot')).toBeNull();
    // 項目のドラッグ（ファイルでもよい）を、ブックマークの上へ: その中へ移す。ドロップの前から、その行に印が付く
    const file = target.querySelector<HTMLElement>('.file-explorer-item[data-path="home/me/a.txt"]')!;
    file.dispatchEvent(drag('dragstart', []));
    const row = target.querySelectorAll<HTMLElement>('section[aria-label="ブックマーク"] .place-row')[1];
    row.dispatchEvent(drag('dragover', ['application/x-explorer-kit-items']));
    await settle();
    expect(row.classList.contains('place-row-drop')).toBe(true);
    fake.calls.length = 0;
    row.dispatchEvent(drag('drop', ['application/x-explorer-kit-items']));
    await settle();
    await vi.waitFor(() => expect(fake.calls.some((c) => c[0] === 'fs_move' && (c[1] as { to: string }).to === '/home/me/docs/a.txt')).toBe(true));
  });

  it('見た目のルールは一覧に効き、右クリックのメニューの並びは設定のとおりになる（設定の画面にも入口がある）', async () => {
    settings.rules = [{ id: 'r', name: 'txt', enabled: true, conditions: [{ field: 'ext', op: 'is', value: 'txt' }], look: { icon: 'star', color: 'red', opacity: 0.5 } }];
    settings.menus = { entry: { order: ['properties'], hidden: ['cut'] } };
    try {
      await start();
      const row = target.querySelector<HTMLElement>('.file-explorer-item[data-path="home/me/a.txt"]')!;
      expect(row.style.getPropertyValue('--entry-color')).toBe('red');
      expect(row.style.opacity).toBe('0.5');
      expect(target.querySelector<HTMLElement>('.file-explorer-item[data-path="home/me/docs"]')!.style.getPropertyValue('--entry-color')).toBe('');
      await rightClick(row.querySelector('.file-explorer-row')!);
      expect(menuItems('.file-explorer-context')).toEqual(['プロパティ', 'コピー', '名前の変更', '削除']); // 切り取りは出さない。ブックマークはフォルダだけ
      // 設定の画面に、入口がある
      await click(target.querySelector('.about-row')!);
      expect(target.querySelector('.settings-link-menus')).not.toBeNull();
      await click(target.querySelector('.settings-link-rules')!);
      expect(target.querySelector('.rule-editor, .rules-list')).not.toBeNull();
    } finally {
      settings.rules = [];
      settings.menus = {};
    }
  });

  it('メニューは、外側を押す幕より手前に出る（position を持つ）。新しいウィンドウは、ウィンドウの操作がある環境だけ', async () => {
    win.controls.mockReturnValue(true);
    try {
      await start();
      await rightClick(target.querySelector('section[aria-label="ブックマーク"] .place-open')!);
      expect(menuItems('.places-menu-anchor')).toEqual(['新しいタブで開く', '新しいウィンドウで開く', '上へ移動', '下へ移動', 'ブックマークから削除']);
      await menuClick('.places-menu-anchor', '新しいウィンドウで開く');
      expect(win.open).toHaveBeenCalledTimes(1);
      expect(win.open.mock.calls[0][0]).toEqual({ place: 'local', dir: 'home/me' });
    } finally {
      win.controls.mockReturnValue(false);
    }
  });

  it('一覧のフォルダを右クリックして、ブックマークに追加・削除できる', async () => {
    await start();
    await goTo('/home/me');
    const row = (): Element => [...target.querySelectorAll('.file-explorer-item')].find((li) => (li as HTMLElement).dataset.path === 'home/me/docs')!;
    await rightClick(row());
    expect(menuItems('.file-explorer-context')).toContain('ブックマークに追加');
    await menuClick('.file-explorer-context', 'ブックマークに追加');
    expect(marks()).toEqual(['me', 'docs']);
    await rightClick(row());
    expect(menuItems('.file-explorer-context')).toContain('ブックマークから削除');
    await menuClick('.file-explorer-context', 'ブックマークから削除');
    expect(marks()).toEqual(['me']);
    // ファイルには出さない
    await rightClick([...target.querySelectorAll('.file-explorer-item')].find((li) => (li as HTMLElement).dataset.path === 'home/me/a.txt')!);
    expect(menuItems('.file-explorer-context').join()).not.toContain('ブックマーク');
  });

  it('ネットワークの場所を外すと、その場所のブックマークも消える。置き場所のブックマークは、その場所で開く', async () => {
    const p = places.add('自宅', 'https://nas.example/dav/');
    if (!p.ok) throw new Error('x');
    await start();
    await click(button('自宅'));
    await goTo('/movies');
    await click(target.querySelector<HTMLButtonElement>('button[aria-label="いま開いているフォルダをブックマークに追加"]')!);
    expect(marks()).toEqual(['me', 'movies']);
    // 別の置き場所（この端末）にいても、押すと、その場所のフォルダを開く
    await click(target.querySelector('section[aria-label="ブックマーク"] .place-open')!);
    expect(activeLabel()).toBe('me');
    await click([...target.querySelectorAll('section[aria-label="ブックマーク"] .place-open')][1]);
    expect(activeLabel()).toBe('movies');
    // 右クリックには、「直す・外す」がある（ネットワークの場所）
    await rightClick([...target.querySelectorAll('section[aria-label="ドライブ"] .place-open')][0]);
    expect(menuItems('.places-menu-anchor')).toEqual(['新しいタブで開く', '直す・外す']);
    bookmarks.removePlace(p.place.id);
    await settle();
    expect(marks()).toEqual(['me']);
  });

  it('戻る（Alt+←）・進む（Alt+→）。マウスの戻る・進むのボタンも同じ。上の階層へは Alt+↑ でも', async () => {
    await start();
    await goTo('/home/me/docs');
    expect(names()).toEqual(['in.txt']);
    await key('ArrowLeft', { altKey: true });
    expect(names()).toContain('docs');
    await key('ArrowRight', { altKey: true });
    expect(names()).toEqual(['in.txt']);
    const mouse = async (button: number): Promise<MouseEvent> => {
      const ev = new MouseEvent('mouseup', { button, bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      await settle();
      return ev;
    };
    expect((await mouse(3)).defaultPrevented).toBe(true);
    expect(names()).toContain('docs');
    expect((await mouse(4)).defaultPrevented).toBe(true);
    expect(names()).toEqual(['in.txt']);
    // 進む先が無いとき、ボタンは何もしない
    expect((await mouse(4)).defaultPrevented).toBe(false);
    await key('ArrowUp', { altKey: true });
    expect(names()).toContain('docs');
    // 上端の「進む」のボタン
    await click(button('戻る'));
    await click(button('進む'));
    expect(names()).toContain('docs');
  });

  it('設定のホットキーの画面で「戻る」の操作をすると、設定のいちばん上へ戻る。節は、初めは折りたたまれていて、見出しで開く', async () => {
    await start();
    await click(target.querySelector('.about-row')!);
    await click(target.querySelector('.settings-link-hotkeys')!);
    expect(target.querySelectorAll('[data-command]')).toHaveLength(0);
    const toggles = [...target.querySelectorAll<HTMLElement>('.hotkey-group-toggle')];
    expect(toggles.map((t) => t.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false', 'false', 'false', 'false', 'false']);
    await click(toggles[1]);
    expect(target.querySelectorAll('[data-command]').length).toBeGreaterThan(5);
    await click(toggles[1]);
    expect(target.querySelectorAll('[data-command]')).toHaveLength(0);
    await key('ArrowLeft', { altKey: true });
    expect(target.querySelector('.settings-link-hotkeys')).not.toBeNull();
    expect(target.textContent).toContain('バージョン');
  });

  it('設定のキーの記録は、マウスの戻る・進むのボタンも記録できる（記録のあいだは、戻る・進むは働かない）', async () => {
    await start();
    await click(target.querySelector('.about-row')!);
    await openHotkeys('タブ');
    const row = (id: string): HTMLElement => target.querySelector<HTMLElement>(`[data-command="${id}"]`)!;
    await click(row('tab.new').querySelector('button[aria-label="新しいタブのキーを追加"]')!);
    const ev = new MouseEvent('mouseup', { button: 4, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(dialogText()).toContain('マウス進む');
    await commitKey();
    expect(row('tab.new').textContent).toContain('マウス進む');
    expect(JSON.parse(localStorage.getItem('fixplor.hotkeys')!)).toEqual({ 'tab.new': ['Ctrl+T', 'Mouse5'] });
    // 設定のタブではない見ているタブで、そのボタンが効く
    await click(tabEls()[0].querySelector('.tab-main')!);
    const before = tabLabels().length;
    window.dispatchEvent(new MouseEvent('mouseup', { button: 4, bubbles: true, cancelable: true }));
    await settle();
    expect(tabLabels()).toHaveLength(before + 1);
  });
});

