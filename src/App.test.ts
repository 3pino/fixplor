// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import type { FsEntry } from './lib/fs/types';

// アプリ全体（外枠 + 共有の部品 + この端末の置き場所）を、Rust の代わりの偽物の上で動かす。
// 偽物は、OS のパスをキーにしたメモリの中の木。呼ばれたコマンドを覚える。
const fake = vi.hoisted(() => {
  const tree = new Map<string, 'file' | 'dir'>();
  const calls: [string, unknown][] = [];
  const parent = (p: string): string => p.slice(0, p.lastIndexOf('/')) || '/';
  const entry = (path: string): FsEntry => ({
    name: path.slice(path.lastIndexOf('/') + 1), path, kind: tree.get(path)!, size: tree.get(path) === 'dir' ? null : 4, modified: 1_700_000_000_000,
    hidden: path.slice(path.lastIndexOf('/') + 1).startsWith('.'), readonly: false, symlink: false,
  });
  const invoke = async (cmd: string, args?: Record<string, string>): Promise<unknown> => {
    calls.push([cmd, args]);
    switch (cmd) {
      case 'fs_start_dir': return '/home/me';
      case 'fs_places': return [{ kind: 'home', path: '/home/me', name: '' }, { kind: 'root', path: '/', name: '' }];
      case 'fs_list': {
        if (tree.get(args!.path) !== 'dir') throw { code: 'not_found', message: args!.path };
        return [...tree.keys()].filter((p) => p !== '/' && parent(p) === args!.path).map(entry);
      }
      case 'fs_mkdir': tree.set(args!.path, 'dir'); return entry(args!.path);
      case 'fs_trash': tree.delete(args!.path); return null;
      case 'fs_move': tree.set(args!.to, tree.get(args!.from)!); tree.delete(args!.from); return entry(args!.to);
      case 'fs_open': return null;
      case 'fs_search': {
        // Rust の代わり: 根の下の、名前に文字を含む項目を、入れ物（onHits）へ流す
        const { dir, text, onHits } = args as unknown as { dir: string; text: string; onHits: { onmessage: (b: FsEntry[]) => void } };
        onHits.onmessage([...tree.keys()].filter((p) => p.startsWith(dir + '/') && p.slice(p.lastIndexOf('/') + 1).toLowerCase().includes(text.toLowerCase())).map(entry));
        return { partial: null };
      }
      case 'fs_search_cancel': return true;
      default: throw { code: 'unsupported', message: cmd };
    }
  };
  return { tree, calls, invoke };
});
vi.mock('@tauri-apps/api/core', () => ({ Channel: class { onmessage: (b: unknown) => void = () => {}; }, invoke: fake.invoke, convertFileSrc: (p: string, proto = 'asset') => `${proto}://localhost/${encodeURIComponent(p)}` }));

import App from './App.svelte';
import { settings } from './lib/settings.svelte';
import { bookmarks } from './lib/bookmarks.svelte';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};

let app: ReturnType<typeof mount> | undefined;
let target: HTMLElement;

beforeEach(() => {
  localStorage.clear();
  bookmarks.reload();
  settings.showHidden = false;
  settings.dirs = {};
  // 一覧の横のビュー（親フォルダ・プレビュー）は、読み込みの回数を数える試験のじゃまになるので、既定では出さない（試験で必要なときだけ出す）
  settings.views = { hidden: ['parents', 'preview'], swipe: 'places' };
  localStorage.clear();
  fake.calls.length = 0;
  fake.tree.clear();
  for (const [p, k] of [['/', 'dir'], ['/home', 'dir'], ['/home/me', 'dir'], ['/home/me/docs', 'dir'], ['/home/me/docs/in.txt', 'file'], ['/home/me/a.txt', 'file'], ['/home/me/.env', 'file']] as const) fake.tree.set(p, k);
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
  document.body.innerHTML = '';
});

const names = (): string[] => [...target.querySelectorAll('.file-explorer-name-text')].map((n) => n.textContent ?? '');
const called = (cmd: string): unknown[] => fake.calls.filter((c) => c[0] === cmd).map((c) => c[1]);
const button = (label: string): HTMLButtonElement => {
  const b = [...document.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.getAttribute('aria-label') === label || x.textContent?.trim() === label);
  if (!b) throw new Error(`ボタンがありません: ${label}`);
  return b;
};
const row = (name: string): HTMLElement => {
  const el = [...target.querySelectorAll<HTMLElement>('.file-explorer-name-text')].find((n) => n.textContent === name)?.closest<HTMLElement>('.file-explorer-item');
  if (!el) throw new Error(`項目がありません: ${name}`);
  return el;
};

describe('fixplor の画面（この端末のファイル）', () => {
  it('ホームを開いて並べる。隠しファイルは出さない。パスは、いちばん上からのフォルダの名前', async () => {
    app = mount(App, { target });
    await settle();
    expect(called('fs_list')).toEqual([{ path: '/home/me' }]);
    expect(names()).toEqual(['docs', 'a.txt']);
    expect([...target.querySelectorAll('.file-explorer-crumb')].map((c) => c.textContent)).toEqual(['コンピューター', 'home', 'me']);
    expect(target.querySelector('input[aria-label="場所"]')).toBeNull();
    expect([...target.querySelectorAll('.places .menu-item')].map((b) => b.textContent)).toEqual(['me', 'コンピューター']);
  });

  describe('一覧の横のビュー（親フォルダ・プレビュー）', () => {
    const parentRows = (): string[] => [...target.querySelectorAll('.parent-view .parent-name')].map((n) => n.textContent ?? '');
    const current = (): string | undefined => target.querySelector('.parent-view [aria-current="true"] .parent-name')?.textContent ?? undefined;
    const arrow = async (key: string): Promise<void> => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await settle();
    };

    it('親フォルダ: 親の中身を全部並べ、いま開いているフォルダを選んでいる背景にする。フォルダを押すとそこへ移る', async () => {
      settings.views = { hidden: ['preview'], swipe: 'places' };
      app = mount(App, { target });
      await settle();
      expect(parentRows()).toEqual(['me']);
      expect(current()).toBe('me');
      expect(target.querySelector('.side-pane[aria-label="親フォルダ"]')).not.toBeNull();
      expect(target.querySelector('.side-pane[aria-label="プレビュー"]')).toBeNull();
      // docs へ入ると、親は me（docs・a.txt。隠しファイルは出さない）
      row('docs').querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle();
      await vi.waitFor(() => expect(parentRows()).toEqual(['docs', 'a.txt']));
      expect(current()).toBe('docs');
      // 親の中の項目（ファイル）を押すと、一覧がその親フォルダを開き、その項目を選んでフォーカスする
      const prow = (name: string): HTMLButtonElement => [...target.querySelectorAll<HTMLButtonElement>('.parent-row')].find((b) => b.textContent?.trim() === name)!;
      const selectedInMain = (): string[] => [...target.querySelectorAll('.file-explorer-item-selected .file-explorer-name-text')].map((n) => n.textContent ?? '');
      prow('a.txt').click();
      await settle();
      await vi.waitFor(() => expect(names()).toEqual(['docs', 'a.txt']));
      expect([...target.querySelectorAll('.file-explorer-crumb')].map((c) => c.textContent)).toEqual(['コンピューター', 'home', 'me']);
      await vi.waitFor(() => expect(selectedInMain()).toEqual(['a.txt']));
      expect(document.activeElement).toBe(row('a.txt').querySelector('.file-explorer-row'));
      expect(row('a.txt').classList.contains('file-explorer-item-cursor')).toBe(true);
      // 親も一つ上がる。フォルダを押しても、中へは入らず、一覧にそのフォルダを見せる
      await vi.waitFor(() => expect(parentRows()).toEqual(['me']));
      prow('me').click();
      await settle();
      expect([...target.querySelectorAll('.file-explorer-crumb')].map((c) => c.textContent)).toEqual(['コンピューター', 'home']);
      await vi.waitFor(() => expect(selectedInMain()).toEqual(['me']));
      expect(document.activeElement).toBe(row('me').querySelector('.file-explorer-row'));
      await vi.waitFor(() => expect(parentRows()).toEqual(['home']));
    });

    it('プレビュー: カーソルが無ければ何も出さない。フォルダは直下、テキストは先頭を色付きで、SVG は市松模様の上に', async () => {
      fake.tree.set('/home/me/logo.svg', 'file');
      fake.tree.set('/home/me/main.js', 'file');
      settings.views = { hidden: ['parents'], swipe: 'places' };
      const fetched: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        fetched.push(url);
        return new Response('const a = 1;\nconsole.log(a);\n');
      });
      try {
        app = mount(App, { target });
        await settle();
        const pane = (): HTMLElement => target.querySelector('.side-pane[aria-label="プレビュー"]')!;
        expect(pane()).not.toBeNull();
        expect(pane().querySelector('.preview-head')).toBeNull(); // 開いた直後はカーソルが無い
        await arrow('ArrowDown');
        expect(pane().querySelector('.preview-title')?.textContent).toBe('docs');
        await vi.waitFor(() => expect([...pane().querySelectorAll('.preview-name')].map((n) => n.textContent)).toEqual(['in.txt']));
        // 並びはフォルダが先、名前順: docs・a.txt・logo.svg・main.js
        expect(names()).toEqual(['docs', 'a.txt', 'logo.svg', 'main.js']);
        await arrow('ArrowDown');
        await arrow('ArrowDown');
        expect(pane().querySelector('.preview-title')?.textContent).toBe('logo.svg');
        expect(pane().querySelector('img.preview-svg')).not.toBeNull();
        await arrow('ArrowDown');
        expect(pane().querySelector('.preview-title')?.textContent).toBe('main.js');
        await vi.waitFor(() => expect(pane().querySelector('.preview-code .hljs-keyword')?.textContent).toBe('const'));
        expect(fetched.some((u) => u.includes('main.js'))).toBe(true);
        expect(fetched.some((u) => u.includes('logo.svg'))).toBe(false); // 画像は、文字としては読まない
      } finally {
        vi.unstubAllGlobals();
      }
    });

  });

  it('隠しファイルの切り替えは、読み直して反映し、次に開いたときも覚えている', async () => {
    app = mount(App, { target });
    await settle();
    // 隠しファイルの切り替えは、≡ のメニューの中
    button('メニュー').click();
    await settle();
    button('隠しファイルを表示').click();
    await settle();
    expect(names()).toEqual(['docs', '.env', 'a.txt']);
    expect(localStorage.getItem('fixplor.showHidden')).toBe('1');
  });

  it('F5 で、一覧を再読み込みする（メニューには、再読み込みの項目を置かない）', async () => {
    app = mount(App, { target });
    await settle();
    expect(called('fs_list')).toHaveLength(1);
    const ev = new KeyboardEvent('keydown', { key: 'F5', bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    await settle();
    expect(ev.defaultPrevented).toBe(true);
    expect(called('fs_list')).toHaveLength(2);
    button('メニュー').click();
    await settle();
    expect([...target.querySelectorAll('[role="menuitem"], .menu-item')].some((b) => /再読み込み|読み直す/.test(b.textContent ?? ''))).toBe(false);
  });

  it('上のフォルダへ・戻る', async () => {
    app = mount(App, { target });
    await settle();
    button('上のフォルダへ').click();
    await settle();
    expect(names()).toEqual(['me']);
    button('戻る').click();
    await settle();
    expect(names()).toEqual(['docs', 'a.txt']);
  });

  it('Alt+← で戻る（Ctrl・Shift を一緒に押したときは、別の操作なので戻らない）', async () => {
    app = mount(App, { target });
    await settle();
    button('上のフォルダへ').click();
    await settle();
    expect(names()).toEqual(['me']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, ctrlKey: true, bubbles: true }));
    await settle();
    expect(names()).toEqual(['me']);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    await settle();
    expect(names()).toEqual(['docs', 'a.txt']);
  });

  it('画像は拡大表示で開く（前後の画像へ移れる）。「保存」は既定のアプリで開く。Esc で閉じる。画像でないファイルは、拡大表示にしない', async () => {
    fake.tree.set('/home/me/p.png', 'file');
    fake.tree.set('/home/me/q.png', 'file');
    app = mount(App, { target });
    await settle();
    const open = (name: string): void => {
      row(name).querySelector('.file-explorer-row, a, button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    };
    open('a.txt');
    await settle();
    expect(document.querySelector('.lightbox')).toBeNull();
    expect(called('fs_open')).toEqual([{ path: '/home/me/a.txt' }]);
    open('p.png');
    await settle();
    const view = document.querySelector('.lightbox')!;
    expect(view.querySelector('img')!.getAttribute('src')).toBe('asset://localhost/' + encodeURIComponent('/home/me/p.png'));
    expect(view.querySelector('.lightbox-file-name')!.textContent).toBe('p.png');
    // 次の画像へ
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    // 切り替えのアニメーションのあとで、次の画像になる
    await vi.waitFor(() => expect(document.querySelector('.lightbox-file-name')!.textContent).toBe('q.png'));
    // 保存 = 既定のアプリで開く
    document.querySelector<HTMLElement>('.lightbox-download')!.click();
    await settle();
    expect(called('fs_open').at(-1)).toEqual({ path: '/home/me/q.png' });
    expect(document.querySelector('.lightbox')).toBeNull();
    open('p.png');
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.querySelector('.lightbox')).toBeNull();
  });

  it('無いフォルダは、無いと出す（落ちない）', async () => {
    app = mount(App, { target });
    await settle();
    // 開こうとしたフォルダが、そのあいだに消えていた
    fake.tree.delete('/home/me/docs');
    row('docs').querySelector<HTMLElement>('.file-explorer-row')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(names()).toEqual([]);
    expect(target.querySelector('.file-explorer')!.textContent).toMatch(/見つかりません|ありません/);
  });

  it('ダブルクリック: フォルダは中へ、ファイルは OS の既定のアプリで開く', async () => {
    app = mount(App, { target });
    await settle();
    row('a.txt').querySelector('.file-explorer-row, a, button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(called('fs_open')).toEqual([{ path: '/home/me/a.txt' }]);
    row('docs').querySelector('.file-explorer-row, a, button')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(names()).toEqual(['in.txt']);
  });

  it('選んで削除: 確認なしで OS のゴミ箱へ。「取り消す」は出さない（ここからは戻せない）', async () => {
    app = mount(App, { target });
    await settle();
    row('a.txt').querySelector<HTMLElement>('.file-explorer-row, a, button')!.click();
    await settle();
    button('削除').click();
    await settle();
    // ゴミ箱へ移すだけなので、確認は出ない
    expect(document.querySelector('.modal')).toBeNull();
    expect(called('fs_trash')).toEqual([{ path: '/home/me/a.txt' }]);
    expect(names()).toEqual(['docs']);
    const toast = document.querySelector('.toast')!;
    expect(toast.textContent).toContain('1 件をゴミ箱に移しました');
    expect(toast.querySelector('.toast-action')).toBeNull();
    // 閉じるボタンで消える（本体の状態を、土台の部品へつないである）
    toast.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!.click();
    await settle();
    expect(document.querySelector('.toast')).toBeNull();
  });
});

describe('検索（この端末）', () => {
  it('虫めがねから、サブフォルダも探せる。見つかった項目の「場所を開く」で、そのフォルダへ移って項目を選ぶ', async () => {
    app = mount(App, { target });
    await settle();
    button('検索').click();
    await settle();
    const box = target.querySelector<HTMLInputElement>('.file-explorer-search-sub input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    const input = target.querySelector<HTMLInputElement>('input[aria-label="名前で検索"]')!;
    input.value = 'IN';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 120));
      flushSync();
    }
    expect(called('fs_search')).toEqual([expect.objectContaining({ dir: '/home/me', text: 'IN', showHidden: false })]);
    expect([...target.querySelectorAll('.file-explorer-hit-name')].map((n) => n.textContent)).toEqual(['in.txt']);
    button('in.txt のある場所を開く').click();
    await settle();
    expect([...target.querySelectorAll('.file-explorer-crumb')].map((c) => c.textContent)).toEqual(['コンピューター', 'home', 'me', 'docs']);
    expect(row('in.txt').querySelector('[aria-pressed="true"]')).not.toBeNull();
  });
});

/** Android の狭い画面: 右へのスワイプで場所の欄を出し、左へのスワイプ・外側・戻るで閉じる。デスクトップは、どんなに狭くても、いつも見える */
describe('場所の欄（Android の狭い画面のドロワー）', () => {
  const platform = (android: boolean): void => {
    (window as unknown as Record<string, unknown>).__FIXPLOR_PLATFORM__ = { os: android ? 'android' : 'linux', desktop: !android, android, capabilities: null };
  };
  beforeEach(() => platform(true));
  const setNarrow = (narrow: boolean): void => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (q: string) => ({ matches: narrow, media: q, addEventListener() {}, removeEventListener() {} }),
    });
  };
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).matchMedia;
    delete (window as unknown as Record<string, unknown>).__FIXPLOR_PLATFORM__;
  });

  /** 指で（x1,y1）から（x2,y2）へ動かす */
  const swipe = (from: [number, number], to: [number, number], at: Element = target): void => {
    const touch = (type: string, [x, y]: [number, number]): void => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] });
      at.dispatchEvent(ev);
    };
    touch('touchstart', from);
    for (let i = 1; i <= 4; i++) touch('touchmove', [from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4]);
    touch('touchend', to);
  };
  const nav = (): HTMLElement => target.querySelector<HTMLElement>('nav.places')!;
  const isOpen = (): boolean => nav().classList.contains('places-open');

  it('右へスワイプすると場所の欄が出る（バージョンの行も入っている）。左へスワイプすると閉じる', async () => {
    setNarrow(true);
    app = mount(App, { target });
    await settle();
    expect(isOpen()).toBe(false);
    swipe([40, 300], [220, 310]);
    flushSync();
    expect(isOpen()).toBe(true);
    expect(nav().querySelector('.about-row')).not.toBeNull();
    expect(target.querySelector('.nav-scrim-open')).not.toBeNull();
    swipe([220, 300], [40, 305], nav());
    flushSync();
    expect(isOpen()).toBe(false);
  });

  it('デスクトップは、狭くても、スワイプで出す引き出しにしない（場所の欄は、いつもの場所に見えている）', async () => {
    platform(false);
    setNarrow(true);
    app = mount(App, { target });
    await settle();
    expect(target.querySelector('.app')!.classList.contains('app-android')).toBe(false);
    swipe([40, 300], [220, 310]);
    flushSync();
    expect(isOpen()).toBe(false);
  });

  it('設定の画面では、スワイプしても何も開かない（場所の欄も、暗い幕も無い。幕だけ残って操作できなくならない）。開いたまま設定へ移っても閉じる', async () => {
    setNarrow(true);
    app = mount(App, { target });
    await settle();
    swipe([40, 300], [220, 310]);
    await settle();
    expect(isOpen()).toBe(true);
    nav().querySelector<HTMLButtonElement>('.about-row')!.click();
    await settle();
    expect(target.querySelector('nav.places')).toBeNull();
    expect(target.querySelector('.nav-scrim')).toBeNull();
    swipe([40, 300], [220, 310]);
    await settle();
    expect(target.querySelector('nav.places')).toBeNull();
    expect(target.querySelector('.nav-scrim')).toBeNull();
  });

  it('縦のスワイプ・短い動きでは出ない。広い画面（場所の欄がいつも見える）でも出さない', async () => {
    setNarrow(true);
    app = mount(App, { target });
    await settle();
    swipe([100, 100], [140, 400]);
    swipe([100, 300], [130, 300]);
    flushSync();
    expect(isOpen()).toBe(false);
    setNarrow(false);
    swipe([40, 300], [220, 310]);
    flushSync();
    expect(isOpen()).toBe(false);
  });

  it('横にスクロールしている一覧の上のスワイプは、その一覧のスクロール（場所の欄を出さない）', async () => {
    setNarrow(true);
    app = mount(App, { target });
    await settle();
    const body = target.querySelector<HTMLElement>('.file-explorer-body')!;
    body.style.overflowX = 'auto';
    Object.defineProperty(body, 'scrollLeft', { value: 80, configurable: true });
    swipe([40, 300], [220, 310], body);
    flushSync();
    expect(isOpen()).toBe(false);
  });

  it('外側（暗くした部分）を押す・戻る・場所の欄の行を押す、のどれでも閉じる', async () => {
    setNarrow(true);
    app = mount(App, { target });
    await settle();
    const open = async (): Promise<void> => {
      swipe([40, 300], [220, 310]);
      await settle();
      expect(isOpen()).toBe(true);
    };
    await open();
    target.querySelector<HTMLElement>('.nav-scrim')!.click();
    await settle();
    expect(isOpen()).toBe(false);
    await open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    await settle();
    expect(isOpen()).toBe(false);
    await open();
    nav().querySelector<HTMLElement>('.places-title')!.click(); // 場所の欄の中を押す（この試験の端末には、場所の項目が無い）
    await settle();
    expect(isOpen()).toBe(false);
    await open();
    nav().querySelector<HTMLButtonElement>('.about-row')!.click(); // 「設定」の行を押す（設定の画面では、場所の欄は出さない）
    await settle();
    expect(target.querySelector('nav.places')).toBeNull();
  });
});
