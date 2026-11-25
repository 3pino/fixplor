import { describe, expect, it, vi } from 'vitest';
import { createLocalFs, openHref, pathOfOpenHref, toFsError, type Call } from './local';
import { FsError, type FsEntry } from './types';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (p: string) => `asset://${p}` }));

const raw = (path: string, over: Partial<FsEntry> = {}): FsEntry => ({
  name: path.split(/[\\/]/).pop()!, path, kind: 'file', size: 3, modified: 5, hidden: false, readonly: false, symlink: false, ...over,
});

/** Rust の代わり。呼ばれたコマンドを覚え、cmd ごとの答えを返す */
function fake(answers: Record<string, unknown>, start = '/home/me') {
  const calls: unknown[][] = [];
  const call: Call = async (cmd, args, headers) => {
    calls.push(headers ? [cmd, args, headers] : [cmd, args]);
    if (cmd === 'fs_start_dir') return start as never;
    const a = answers[cmd];
    if (a instanceof Error || (typeof a === 'object' && a !== null && 'code' in a)) throw a;
    return a as never;
  };
  return { call, calls };
}

describe('この端末の置き場所（POSIX）', () => {
  it('画面のパスを OS のパスに直して呼び、答えを画面のパスに直す', async () => {
    const { call, calls } = fake({ fs_list: [raw('/home/me/a.txt'), raw('/home/me/sub', { kind: 'dir', size: null, modified: null })], fs_move: raw('/home/me/b.txt') });
    const fs = await createLocalFs({ call });
    expect([fs.windows, fs.start]).toEqual([false, 'home/me']);
    expect(await fs.api.list('home/me')).toEqual([
      { name: 'a.txt', path: 'home/me/a.txt', kind: 'file', size: 3, modified: 5, mime: null },
      { name: 'sub', path: 'home/me/sub', kind: 'dir', size: 0, modified: 0, mime: null },
    ]);
    expect((await fs.api.move('home/me/a.txt', 'home/me/b.txt')).path).toBe('home/me/b.txt');
    expect(calls.slice(1)).toEqual([
      ['fs_list', { path: '/home/me' }],
      ['fs_move', { from: '/home/me/a.txt', to: '/home/me/b.txt', overwrite: false }],
    ]);
  });

  it('隠しファイルは、出すと決めたときだけ一覧に入れる', async () => {
    let show = false;
    const { call } = fake({ fs_list: [raw('/a/.env', { hidden: true }), raw('/a/seen')] });
    const fs = await createLocalFs({ call, showHidden: () => show });
    expect((await fs.api.list('a')).map((e) => e.name)).toEqual(['seen']);
    show = true;
    expect((await fs.api.list('a')).map((e) => e.name)).toEqual(['.env', 'seen']);
  });

  it('フォルダのサイズ（一覧の列用）は、調べる項目に上限を付けて数える。上限で止まったら partial', async () => {
    const { call, calls } = fake({ fs_size: { size: 10, files: 2, dirs: 1, partial: true } });
    const fs = await createLocalFs({ call });
    expect(await fs.api.folderSize!('home/me/sub')).toEqual({ size: 10, partial: true });
    expect(calls[1]).toEqual(['fs_size', { path: '/home/me/sub', limit: 50_000 }]);
    // プロパティの大きさは、上限なし
    await fs.api.size('home/me/sub');
    expect(calls[2]).toEqual(['fs_size', { path: '/home/me/sub' }]);
  });

  it('フォルダを指すショートカット（.lnk）は、フォルダのアイコンで見せる（種類はファイルのまま）', async () => {
    const { call } = fake({ fs_list: [raw('/a/docs.lnk', { linkKind: 'dir' }), raw('/a/f.lnk', { linkKind: 'file' }), raw('/a/x.txt')] });
    const fs = await createLocalFs({ call });
    const list = await fs.api.list('a');
    expect(list.map((e) => [e.name, e.kind, e.iconKind])).toEqual([['docs.lnk', 'file', 'dir'], ['f.lnk', 'file', undefined], ['x.txt', 'file', undefined]]);
  });

  it('書き込みは、中身を生のバイト列で、パスをヘッダーで送る', async () => {
    const { call, calls } = fake({ fs_write: raw('/a/メモ.txt') });
    const fs = await createLocalFs({ call });
    await fs.api.write('a/メモ.txt', 'hi');
    const [cmd, body, headers] = calls[1] as [string, Uint8Array, Record<string, string>];
    expect(cmd).toBe('fs_write');
    expect([...body]).toEqual([104, 105]);
    expect(decodeURIComponent(headers['x-path'])).toBe('/a/メモ.txt');
  });

  it('ゴミ箱は OS のもの。入れたときの印（id）で、元の場所へ戻せる（Ctrl+Z）。印が無いときは戻せない', async () => {
    const { call, calls } = fake({ fs_trash: '/home/me/.local/share/Trash/info/x.trashinfo', fs_os_trash_restore: '/a/x', fs_stat: raw('/a/x') });
    const fs = await createLocalFs({ call });
    expect(fs.caps).toEqual({ restore: true, trash: true });
    const t = await fs.api.trash('a/x');
    expect(t).toMatchObject({ original_path: 'a/x', id: '/home/me/.local/share/Trash/info/x.trashinfo' });
    expect(calls[1]).toEqual(['fs_trash', { path: '/a/x' }]);
    expect((await fs.api.restore(t.id)).path).toBe('a/x');
    expect(calls.find((c) => c[0] === 'fs_os_trash_restore')?.[1]).toEqual({ id: '/home/me/.local/share/Trash/info/x.trashinfo' });
    // 印を見つけられなかったときは、id が空で、戻せない
    const none = fake({ fs_trash: null });
    const fs2 = await createLocalFs({ call: none.call });
    expect((await fs2.api.trash('a/y')).id).toBe('');
    await expect(fs2.api.restore('')).rejects.toMatchObject({ code: 'unsupported' });
  });

  it('失敗は code を保つ。無いフォルダは「無い」と見分ける', async () => {
    const { call } = fake({ fs_list: { code: 'not_found', message: '/nope' }, fs_mkdir: { code: 'exists', message: 'x' } });
    const fs = await createLocalFs({ call });
    const missing = await fs.api.list('nope').catch((e) => e);
    expect(missing).toBeInstanceOf(FsError);
    expect(fs.isMissing(missing)).toBe(true);
    const exists = await fs.api.mkdir('a').catch((e) => e);
    expect([exists.code, fs.isMissing(exists)]).toEqual(['exists', false]);
    expect(toFsError({ code: 'weird' }).code).toBe('io');
  });

  it('名前の決まり: POSIX では : などを使える。区切りと空は使えない', async () => {
    const fs = await createLocalFs({ call: fake({}).call });
    expect(fs.rules.nameError('', 'a:b?.txt')).toBeNull();
    expect(fs.rules.nameError('', 'a/b')).not.toBeNull();
    expect(fs.rules.nameError('', ' ')).not.toBeNull();
    expect(fs.rules.specialDir).toBeNull();
  });

  it('画像だけ、サムネイルの URL を持つ', async () => {
    const fs = await createLocalFs({ call: fake({}).call });
    const e = { name: 'a.png', path: 'p/a.png', kind: 'file' as const, size: 1, modified: 0, mime: null };
    expect(fs.urls.thumbUrl(e)).toBe('asset:///p/a.png');
    expect(fs.urls.thumbUrl({ ...e, name: 'a.txt' })).toBeNull();
    expect(pathOfOpenHref(fs.urls.href(e))).toBe('p/a.png');
  });
});

describe('この端末の置き場所（Windows）', () => {
  it('いちばん上はドライブの一覧。そこへは書けない', async () => {
    const { call, calls } = fake({ fs_places: [{ kind: 'home', path: 'C:\\Users\\me', name: '' }, { kind: 'volume', path: 'C:\\', name: 'C:' }, { kind: 'volume', path: 'D:\\', name: 'D:' }], fs_list: [raw('C:\\Users')] }, 'C:\\Users\\me');
    const fs = await createLocalFs({ call });
    expect([fs.windows, fs.start]).toEqual([true, 'C:/Users/me']);
    expect((await fs.api.list('')).map((e) => [e.name, e.path, e.kind])).toEqual([['C:', 'C:', 'dir'], ['D:', 'D:', 'dir']]);
    expect((await fs.api.list('C:')).map((e) => e.path)).toEqual(['C:/Users']);
    expect(calls.at(-1)).toEqual(['fs_list', { path: 'C:\\' }]);
    await expect(fs.api.mkdir('')).rejects.toMatchObject({ code: 'unsupported' });
    expect(fs.osPath('C:/Users/me')).toBe('C:\\Users\\me');
    expect(fs.rules.nameError('C:', 'a:b')).not.toBeNull();
  });
});

describe('WSL の中は、ゴミ箱へ移せない（確認のうえ完全に削除する）', () => {
  it('Windows の \\\\wsl$\\…・\\\\wsl.localhost\\… だけ。ふつうのドライブ・Linux では移せる', async () => {
    const win = await createLocalFs({ call: fake({ fs_places: [{ kind: 'home', path: 'C:\\Users\\me', name: '' }] }, 'C:\\Users\\me').call });
    const wsl = win.fromOsPath('\\\\wsl$\\Ubuntu\\home\\me\\a.txt');
    expect(win.osPath(wsl)).toBe('\\\\wsl$\\Ubuntu\\home\\me\\a.txt');
    expect(win.api.trashable?.(wsl)).toBe(false);
    expect(win.api.trashable?.(win.fromOsPath('\\\\wsl.localhost\\Ubuntu\\x'))).toBe(false);
    expect(win.api.trashable?.('C:/Users/me/a.txt')).toBe(true);
    const lin = await createLocalFs({ call: fake({}).call });
    expect(lin.api.trashable?.('home/me/a.txt')).toBe(true);
  });
});

describe('既定のアプリで開くための URL', () => {
  it('パスを往復できる。ほかの URL は受けない', () => {
    expect(pathOfOpenHref(openHref('home/me/a b#1.txt'))).toBe('home/me/a b#1.txt');
    expect(pathOfOpenHref('https://example.com/')).toBeNull();
  });
});

describe('検索（Rust の fs_search。結果は少しずつ届く）', () => {
  /** Rust の代わり: fs_search は、渡された入れ物（onHits）へ batch を流してから答える。止められたら記録する */
  function searcher(batches: FsEntry[][], outcome = { partial: null as string | null }, start = '/home/me') {
    const calls: [string, Record<string, unknown>][] = [];
    const channel: { onmessage: (b: FsEntry[]) => void } = { onmessage: () => {} };
    const call: Call = async (cmd, args) => {
      if (cmd === 'fs_start_dir') return start as never;
      if (cmd === 'fs_places') return [{ kind: 'volume', path: 'C:\\', name: 'C:' }, { kind: 'volume', path: 'D:\\', name: 'D:' }] as never;
      calls.push([cmd, args as Record<string, unknown>]);
      if (cmd === 'fs_search') for (const b of batches) channel.onmessage(b);
      return (cmd === 'fs_search' ? outcome : true) as never;
    };
    return { call, calls, newChannel: async () => channel };
  }

  it('OS のパスで頼み、届いた項目を画面の形に直して渡す。隠しファイルを出すかも伝える。上限で止めた理由を返す', async () => {
    const s = searcher([[raw('/home/me/a/cat.png')], [raw('/home/me/cat.txt'), raw('/home/me/b/c/cat', { kind: 'dir', size: null })]], { partial: 'scan' });
    const fs = await createLocalFs({ call: s.call, newChannel: s.newChannel, showHidden: () => true });
    const got: string[] = [];
    const out = await fs.api.search!({ dir: 'home/me', text: 'cat' }, { hits: (e) => got.push(...e.map((x) => `${x.path}:${x.kind}`)), signal: new AbortController().signal });
    expect(got).toEqual(['home/me/a/cat.png:file', 'home/me/cat.txt:file', 'home/me/b/c/cat:dir']);
    expect(out).toEqual({ partial: 'scan' });
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0][0]).toBe('fs_search');
    expect(s.calls[0][1]).toMatchObject({ dir: '/home/me', text: 'cat', showHidden: true });
    expect(String(s.calls[0][1].job)).toMatch(/^search-\d+$/);
    expect(s.calls[0][1].onHits).toBeDefined();
  });

  it('中止すると、Rust の検索も止める（job で）。中止したあとに届いた結果は渡さない', async () => {
    const calls: [string, Record<string, unknown>][] = [];
    const channel: { onmessage: (b: FsEntry[]) => void } = { onmessage: () => {} };
    const ac = new AbortController();
    const call: Call = async (cmd, args) => {
      if (cmd === 'fs_start_dir') return '/home/me' as never;
      calls.push([cmd, args as Record<string, unknown>]);
      if (cmd === 'fs_search') {
        // 検索の途中で中止され、そのあと結果が届き、Rust は止まった（aborted）と答える
        ac.abort();
        channel.onmessage([raw('/home/me/late')]);
        throw { code: 'aborted', message: '中止しました' };
      }
      return true as never;
    };
    const fs = await createLocalFs({ call, newChannel: async () => channel });
    const got: string[] = [];
    await expect(fs.api.search!({ dir: 'home/me', text: 'x' }, { hits: (e) => got.push(...e.map((x) => x.path)), signal: ac.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(got).toEqual([]);
    expect(calls.map((c) => c[0])).toEqual(['fs_search', 'fs_search_cancel']);
    expect(calls[1][1]).toEqual({ job: calls[0][1].job });
  });

  it('始める前から中止されていたら、Rust を呼ばない', async () => {
    const s = searcher([]);
    const fs = await createLocalFs({ call: s.call, newChannel: s.newChannel });
    const ac = new AbortController();
    ac.abort();
    await expect(fs.api.search!({ dir: 'home/me', text: 'x' }, { hits: () => {}, signal: ac.signal })).rejects.toMatchObject({ code: 'aborted' });
    expect(s.calls).toEqual([]);
  });

  it('Windows のいちばん上からは、ドライブを 1 つずつ探す（件数の上限で止まったら、残りは探さない）', async () => {
    const s = searcher([[raw('C:\\a\\cat')]], { partial: null }, 'C:\\Users\\me');
    const fs = await createLocalFs({ call: s.call, newChannel: s.newChannel });
    const out = await fs.api.search!({ dir: '', text: 'cat' }, { hits: () => {}, signal: new AbortController().signal });
    expect(s.calls.filter((c) => c[0] === 'fs_search').map((c) => c[1].dir)).toEqual(['C:\\', 'D:\\']);
    expect(out).toEqual({ partial: null });
    const s2 = searcher([], { partial: 'hits' }, 'C:\\Users\\me');
    const fs2 = await createLocalFs({ call: s2.call, newChannel: s2.newChannel });
    const out2 = await fs2.api.search!({ dir: '', text: 'cat' }, { hits: () => {}, signal: new AbortController().signal });
    expect(s2.calls.filter((c) => c[0] === 'fs_search')).toHaveLength(1);
    expect(out2).toEqual({ partial: 'hits' });
  });
});
