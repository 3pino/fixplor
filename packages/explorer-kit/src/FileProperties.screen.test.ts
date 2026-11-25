// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { readFileSync } from 'node:fs';
import FileProperties from './FileProperties.svelte';
import FilePropertiesHost from './test-support/FilePropertiesHost.svelte';
import type { Entry } from './types';
import { explorer, fileActionRun, h } from './test-support/screen.svelte';

// プロパティの画面（読むだけ）。置き場所・本体は、メモリの中の偽物（test-support/screen.svelte.ts）

let instance: ReturnType<typeof mount> | undefined;
let target: HTMLElement | undefined;
afterEach(async () => {
  if (instance) await unmount(instance);
  target?.remove();
  instance = undefined;
  target = undefined;
  h.size.mockReset();
  h.size.mockImplementation(async () => ({ size: 12345, files: 3, dirs: 1 }));
  h.clip = { text: null, image: null, files: null, writable: true, supportsFiles: true };
  fileActionRun.mockClear();
});

const base: Entry = { name: 'a.txt', path: 'docs/a.txt', kind: 'file', size: 2048, modified: 1_700_000_000_000, mime: 'text/plain' };

function open(entry: Entry, onclose: () => void = () => {}): string {
  target = document.createElement('div');
  document.body.appendChild(target);
  instance = mount(FileProperties, { target, props: { explorer, entry, onclose } });
  flushSync();
  return document.body.textContent ?? '';
}

describe('プロパティ（読むだけ）', () => {
  it('名前・パス・種類（MIME）・サイズ・更新日時を出す。作成日時は出さない（置き場所が持たない）', () => {
    const text = open(base);
    expect(text).toContain('docs/a.txt');
    expect(text).toContain('TXT');
    expect(text).toContain('text/plain');
    expect(text).toContain('2.0 KB');
    expect(text).not.toContain('作成日時');
  });

  it('フォルダは計算中になり、サイズ取得後は件数を出す', async () => {
    open({ ...base, name: 'docs', path: 'docs', kind: 'dir', size: 0, mime: null, modified: 0 });
    expect(document.body.textContent).toContain('計算中');
    await vi.waitFor(() => expect(document.body.textContent).toContain('12,345'));
    expect(document.body.textContent).toContain('3 ファイル');
  });

  it('置き場所が足した項目の欄（部品が知らないもの）は出さない', () => {
    const text = open({ ...base, path: 'special/a.txt', extra_id: 'F1', other: 'M1' } as typeof base);
    expect(text).not.toContain('F1');
    expect(text).not.toContain('M1');
  });

  it('名前・パスを押すとコピーする（サイズ・更新日時は押せない）', async () => {
    open(base);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.file-properties-copy')];
    expect(buttons.map((b) => b.textContent)).toEqual(['a.txt', 'docs/a.txt']);
    buttons[1].click();
    await vi.waitFor(() => expect(h.clip.text).toBe('docs/a.txt'));
  });

  it('見出し（名前・パスなど）は選べない', () => {
    const src = readFileSync('src/FileProperties.svelte', 'utf8');
    expect(src).toMatch(/\.file-properties dt \{[^}]*user-select: none/);
  });

  it('本体の操作（host.fileAction）は、ファイルにだけ出す。押すと、ファイルの名前を渡して閉じる', () => {
    const onclose = vi.fn();
    open(base, onclose);
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('本体の操作'))!;
    btn.click();
    expect(onclose).toHaveBeenCalled();
    expect(fileActionRun).toHaveBeenCalledWith(expect.objectContaining({ path: 'docs/a.txt' }), 'a.txt');
  });

  it('フォルダには本体の操作を出さない', () => {
    const text = open({ ...base, name: 'docs', path: 'docs', kind: 'dir', size: 0, mime: null });
    expect(text).not.toContain('本体の操作');
  });
});

describe('フォルダサイズの stale ガード', () => {
  it('A→B→A の完了順逆転で最初の A のレスポンスを無視し、最後の A のレスポンスを表示する', async () => {
    // サイズの呼び出し順: A1(pending)→B(resolved immediately)→A2(pending)。完了順: B → A1(stale) → A2(accepted)
    let resolveA1!: (v: { size: number; files: number; dirs: number }) => void;
    let resolveA2!: (v: { size: number; files: number; dirs: number }) => void;
    h.size
      .mockImplementationOnce(() => new Promise((r) => { resolveA1 = r; }))
      .mockResolvedValueOnce({ size: 999, files: 1, dirs: 0 })
      .mockImplementationOnce(() => new Promise((r) => { resolveA2 = r; }));

    const dirA: Entry = { ...base, name: 'docs', path: 'docs', kind: 'dir', size: 0, mime: null, modified: 0 };
    const dirB: Entry = { ...base, name: 'sub', path: 'sub', kind: 'dir', size: 0, mime: null, modified: 0 };

    // 1 つのプロパティを開いたまま、見る項目を A → B → A と切り替える
    target = document.createElement('div');
    document.body.appendChild(target);
    const host = mount(FilePropertiesHost, { target, props: { explorer, entry: dirA } });
    instance = host;
    flushSync();
    expect(document.body.textContent).toContain('計算中');

    host.show(dirB);
    flushSync();
    await vi.waitFor(() => expect(document.body.textContent).toContain('999'));

    host.show(dirA);
    flushSync();

    // A1 のレスポンスを今届ける（stale: 切り替えで世代が進んでいる）。出ない
    resolveA1({ size: 1111, files: 5, dirs: 2 });
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    expect(document.body.textContent).not.toContain('5 ファイル');
    expect(document.body.textContent).toContain('計算中');

    // A2 のレスポンス（採用）
    resolveA2({ size: 2222, files: 7, dirs: 3 });
    await vi.waitFor(() => expect(document.body.textContent).toContain('7 ファイル'));
    expect(document.body.textContent).not.toContain('5 ファイル');
  });
});

describe('ゴミ箱の項目（直下）は、元の名前と元の場所で出す', () => {
  const ID = '01HZX0000000000000000000AB';
  const trashed: Entry = {
    name: `${ID}--report.pdf`,
    path: `.trash/${ID}--report.pdf`,
    kind: 'file',
    size: 2048,
    modified: 1_700_000_000_000,
    mime: 'application/pdf',
    trash: { kind: 'item', entry: { id: ID, original_path: 'docs/report.pdf', kind: 'file', size: 2048, deleted_at: 0 } },
  };

  it('名前は元の名前、パスは別名のまま、元の場所を別に出す', () => {
    const text = open(trashed);
    expect(text).toContain('report.pdf');
    expect(text).toContain(`.trash/${ID}--report.pdf`);
    expect(text).toContain('元の場所');
    expect(text).toContain('docs/report.pdf');
    expect(document.querySelector('.file-properties-copy')?.textContent?.trim()).toBe('report.pdf');
  });

  it('ふつうの項目には「元の場所」を出さない', () => {
    const text = open(base);
    expect(text).not.toContain('元の場所');
  });
});
