// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const dep = vi.hoisted(() => ({ check: vi.fn(), link: vi.fn(async (_u: string) => {}) }));
vi.mock('../lib/dependencies', async (orig) => ({ ...(await orig<typeof import('../lib/dependencies')>()), checkDependency: dep.check, openLink: dep.link }));

import DependencySettings from './DependencySettings.svelte';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
  }
};

let app: ReturnType<typeof mount> | undefined;
const copied: string[] = [];

beforeEach(() => {
  document.body.innerHTML = '';
  copied.length = 0;
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true });
  dep.check.mockReset();
  dep.link.mockClear();
});
afterEach(() => {
  if (app) void unmount(app);
  app = undefined;
});

const show = async (os: 'windows' | 'linux'): Promise<void> => {
  app = mount(DependencySettings, { target: document.body, props: { os } });
  await settle();
};
const row = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-dependency="${id}"]`)!;

describe('設定の「依存」', () => {
  it('入っていないものは「入っていません」と、入れるコマンド（この OS 向け）。コピーできる。まとめて入れるコマンドも出る', async () => {
    dep.check.mockResolvedValue(null);
    await show('linux');
    expect(row('fd').textContent).toContain('入っていません');
    expect(row('fd').querySelector('.dep-command')!.textContent).toBe('sudo apt install fd-find');
    expect(row('fd').textContent).toContain('fdfind');
    expect(document.querySelector('.dep-bulk-command')!.textContent).toBe('sudo apt install fd-find');
    (row('fd').querySelector('.dep-copy') as HTMLElement).click();
    await settle();
    expect(copied).toEqual(['sudo apt install fd-find']);
    expect(row('fd').querySelector('.dep-copied')?.textContent).toBe('コピーしました');
    (document.querySelector('.dep-bulk-copy') as HTMLElement).click();
    await settle();
    expect(copied).toEqual(['sudo apt install fd-find', 'sudo apt install fd-find']);
  });

  it('入っているものは、名前と版を出し、まとめてのコマンドは出さない。GitHub を開ける。もう一度確認できる', async () => {
    dep.check.mockResolvedValue({ command: 'fdfind', version: 'fdfind 10.3.0' });
    await show('windows');
    expect(row('fd').textContent).toContain('入っています（fdfind 10.3.0）');
    expect(document.querySelector('.dep-bulk-command')).toBeNull();
    expect(document.querySelector('.deps-bulk')!.textContent).toContain('入れるものはありません');
    (row('fd').querySelector('.dep-link') as HTMLElement).click();
    expect(dep.link).toHaveBeenCalledWith('https://github.com/sharkdp/fd');
    // 入れたあとに、もう一度確認すると、変わる
    dep.check.mockResolvedValue(null);
    (document.querySelector('.dep-recheck') as HTMLElement).click();
    await settle();
    expect(row('fd').textContent).toContain('入っていません');
    expect(document.querySelector('.dep-bulk-command')!.textContent).toBe('winget install sharkdp.fd');
  });

  it('確かめられなかったときは、そう出す（入っていない扱いにはしない）', async () => {
    dep.check.mockRejectedValue(new Error('x'));
    await show('windows');
    expect(row('fd').textContent).toContain('確認できませんでした');
    expect(document.querySelector('.dep-bulk-command')).toBeNull();
  });
});
