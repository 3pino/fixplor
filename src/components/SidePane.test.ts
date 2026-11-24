// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount, createRawSnippet } from 'svelte';
import SidePane from './SidePane.svelte';

let target: HTMLElement;
let app: ReturnType<typeof mount> | undefined;

const body = createRawSnippet(() => ({ render: () => '<p class="inner">中身</p>' }));
const render = (side: 'left' | 'right', storageKey = 'fixplor.test.side'): void => {
  app = mount(SidePane, { target, props: { label: 'テスト', storageKey, side, min: 100, max: 300, initial: 200, children: body } });
  flushSync();
};
const handle = (): HTMLElement => target.querySelector('[role="separator"]')!;
const pane = (): HTMLElement => target.querySelector('aside')!;
const press = (key: string, init: KeyboardEventInit = {}): void => {
  handle().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  flushSync();
};

beforeEach(() => {
  localStorage.clear();
  target = document.createElement('div');
  document.body.append(target);
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
  target.remove();
});

describe('横のビューの枠', () => {
  it('中身を出す。初めは initial の幅。つまみは、左の枠なら右、右の枠なら左にある', () => {
    render('left');
    expect(pane().style.width).toBe('200px');
    expect(pane().querySelector('.inner')?.textContent).toBe('中身');
    expect(pane().nextElementSibling).toBe(handle());
    unmount(app!);
    target.replaceChildren();
    render('right');
    expect(pane().previousElementSibling).toBe(handle());
    expect(handle().getAttribute('aria-label')).toBe('テストの幅');
  });

  it('矢印キーで幅を変え（広げる向きは、枠の側による）、範囲に収める。Home で元の幅。変えた幅は保存する', () => {
    render('left');
    press('ArrowRight');
    expect(pane().style.width).toBe('210px');
    press('ArrowLeft', { shiftKey: true });
    expect(pane().style.width).toBe('170px');
    expect(localStorage.getItem('fixplor.test.side')).toBe('170');
    for (let i = 0; i < 10; i++) press('ArrowLeft', { shiftKey: true });
    expect(pane().style.width).toBe('100px');
    press('Home');
    expect(pane().style.width).toBe('200px');
    unmount(app!);
    target.replaceChildren();
    render('right');
    press('ArrowLeft');
    expect(pane().style.width).toBe('210px');
  });

  it('保存した幅から始める（範囲の外は収める。壊れた値は initial）', () => {
    localStorage.setItem('fixplor.test.side', '999');
    render('left');
    expect(pane().style.width).toBe('300px');
    unmount(app!);
    target.replaceChildren();
    localStorage.setItem('fixplor.test.side', 'abc');
    render('left');
    expect(pane().style.width).toBe('200px');
  });
});
