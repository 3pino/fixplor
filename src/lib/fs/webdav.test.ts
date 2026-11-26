import { describe, expect, it, vi } from 'vitest';
import { createDavFs, davProxyUrl, type DavProgress } from './webdav';
import { FsError, type DavEntry } from './types';
import type { Call } from './call';

const BASE = 'https://h.example/dav/';
const ID = 'place-1';

const raw = (name: string, over: Partial<DavEntry> = {}): DavEntry => ({
  name,
  path: name,
  kind: 'file',
  size: 3,
  modified: 1000,
  hidden: false,
  mime: 'text/plain',
  etag: `e-${name}`,
  ...over,
});

type Rec = { cmd: string; args: unknown; headers?: Record<string, string> };

/** Rust の代わり。呼ばれた順に記録し、reply で返事を決める */
function fake(reply: (cmd: string, args: unknown, headers?: Record<string, string>) => unknown = () => undefined) {
  const calls: Rec[] = [];
  const call: Call = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>) => {
    calls.push({ cmd, args, headers });
    const r = reply(cmd, args, headers);
    if (r instanceof Error) throw r;
    return r as T;
  };
  return { calls, call };
}

function make(reply?: Parameters<typeof fake>[0], extra: Partial<Parameters<typeof createDavFs>[0]> = {}) {
  const f = fake(reply);
  const fs = createDavFs({ id: ID, base: BASE, proxySrc: (p) => `proxy://x/${p}`, call: f.call, onProgress: async () => () => {}, ...extra });
  return { ...f, fs };
}

describe('一覧', () => {
  it('Rust の項目を、画面の形に直す（種類・大きさ・更新日時・MIME）', async () => {
    const { fs } = make(() => [raw('a.txt'), raw('d', { kind: 'dir', size: null, modified: null, mime: null, etag: null })]);
    expect(await fs.api.list('docs')).toEqual([
      { name: 'a.txt', path: 'a.txt', kind: 'file', size: 3, modified: 1000, mime: 'text/plain' },
      { name: 'd', path: 'd', kind: 'dir', size: 0, modified: 0, mime: null },
    ]);
  });

  it('接続先とパスをそのまま Rust へ渡す。隠しファイルは、設定に従う', async () => {
    let show = false;
    const { fs, calls } = make(() => [raw('a'), raw('.h', { hidden: true })], { showHidden: () => show });
    expect((await fs.api.list('x/y')).map((e) => e.name)).toEqual(['a']);
    expect(calls[0]).toMatchObject({ cmd: 'dav_list', args: { place: ID, base: BASE, path: 'x/y' } });
    show = true;
    expect((await fs.api.list('x/y')).map((e) => e.name)).toEqual(['a', '.h']);
  });

  it('Rust の失敗は FsError（code つき）になる。形の違うものは io', async () => {
    const { fs } = make(() => Object.assign(new Error('x'), { code: 'offline', message: '接続できません: x' }));
    await expect(fs.api.list('')).rejects.toMatchObject({ name: 'FsError', code: 'offline' });
    const odd = make(() => new Error('boom'));
    await expect(odd.fs.api.list('')).rejects.toMatchObject({ code: 'io' });
    const plain = make(() => {
      throw { code: 'auth', message: '認証' };
    });
    await expect(plain.fs.api.list('')).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('SFTP（接続先が sftp:// なら、sftp_* のコマンド。書き込みの続き・中止は共通）', () => {
  const SFTP = 'sftp://nas.example:22/home/me/';

  it('一覧・作成・移動・コピー・削除・大きさは sftp_*、接続先とパスをそのまま渡す', async () => {
    const { fs, calls } = make(() => [raw('a.txt')], { base: SFTP });
    await fs.api.list('x');
    await fs.api.mkdir('x/y').catch(() => {});
    await fs.api.move('a', 'b').catch(() => {});
    await fs.api.copy('a', 'b').catch(() => {});
    await fs.api.remove?.('a');
    await fs.api.size('a').catch(() => {});
    expect(calls.map((c) => c.cmd)).toEqual(['sftp_list', 'sftp_mkdir', 'sftp_move', 'sftp_copy', 'sftp_remove', 'sftp_size']);
    expect(calls[0]).toMatchObject({ args: { place: ID, base: SFTP, path: 'x' } });
  });

  it('書き込みは sftp_put_open で始め、中身を送る・終えるのは WebDAV と同じ dav_put_chunk・dav_put_finish', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_put_finish' ? raw('n.txt', { path: 'n.txt' }) : undefined), { base: SFTP });
    await fs.api.write('n.txt', 'abc');
    expect(calls.map((c) => c.cmd)).toEqual(['sftp_put_open', 'dav_put_chunk', 'dav_put_finish']);
  });

  it('開くときの受け取りも sftp_download。中止は dav_cancel', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'sftp_download' ? '/tmp/fixplor-dav/x/a.pdf' : undefined), { base: SFTP });
    await fs.open('a.pdf');
    expect(calls.map((c) => c.cmd)).toEqual(['sftp_download', 'fs_open']);
  });

  it('WebDAV（https）は今までどおり dav_*', async () => {
    const { fs, calls } = make(() => [raw('a.txt')]);
    await fs.api.list('');
    expect(calls[0].cmd).toBe('dav_list');
  });
});

describe('書き込み（黙って上書きしない）', () => {
  const opens = (calls: Rec[]) => calls.filter((c) => c.cmd === 'dav_put_open').map((c) => c.args as { ifMatch: string | null; size: number; job: string; path: string });

  it('一覧に無かったパスへの書き込みは「作成」（ETag なし）。open・chunk・finish の順で、中身はバイト列、job は同じもの', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_put_finish' ? raw('新 規.txt', { path: '新 規.txt' }) : undefined));
    await fs.api.write('新 規.txt', 'abc');
    expect(calls.map((c) => c.cmd)).toEqual(['dav_put_open', 'dav_put_chunk', 'dav_put_finish']);
    const [open] = opens(calls);
    expect(open).toEqual({ place: ID, base: BASE, path: '新 規.txt', size: 3, ifMatch: null, job: expect.any(String) });
    expect(calls[1].args).toEqual(new TextEncoder().encode('abc'));
    expect(calls[1].headers).toEqual({ 'x-job': encodeURIComponent(open.job) });
    expect(calls[2].args).toEqual({ job: open.job });
  });

  it('大きいファイルは、4 MiB ずつ順に流す（全体を一度にメモリへ載せない）。空のファイルは chunk なし', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_put_finish' ? raw('big') : undefined));
    await fs.api.write('big', new Blob([new Uint8Array(9 * 1024 * 1024)]));
    const sizes = calls.filter((c) => c.cmd === 'dav_put_chunk').map((c) => (c.args as Uint8Array).length);
    expect(sizes).toEqual([4 * 1024 * 1024, 4 * 1024 * 1024, 1024 * 1024]);
    expect(opens(calls)[0].size).toBe(9 * 1024 * 1024);
    const empty = make((cmd) => (cmd === 'dav_put_finish' ? raw('e') : undefined));
    await empty.fs.api.write('e', '');
    expect(empty.calls.map((c) => c.cmd)).toEqual(['dav_put_open', 'dav_put_finish']);
  });

  it('途中で送れなくなったら、サーバーの本当の答え（dav_put_finish の失敗）を返す', async () => {
    const { fs, calls } = make((cmd) => {
      if (cmd === 'dav_put_chunk') return Object.assign(new Error('x'), { code: 'io', message: '送信が止まりました' });
      if (cmd === 'dav_put_finish') return Object.assign(new Error('x'), { code: 'exists', message: '同名' });
      return undefined;
    });
    await expect(fs.api.write('a', 'x')).rejects.toMatchObject({ code: 'exists' });
    expect(calls.map((c) => c.cmd)).toEqual(['dav_put_open', 'dav_put_chunk', 'dav_put_finish']);
  });

  it('一覧で読んだ ETag があるパスへの書き込みは、その ETag を ifMatch に付ける（上書き）', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_list' ? [raw('a.txt', { etag: '5-abc' })] : raw('a.txt', { etag: '6-def' })));
    await fs.api.list('');
    await fs.api.write('a.txt', new Blob(['hello']));
    expect(opens(calls)[0].ifMatch).toBe('5-abc');
    // 書いた結果の ETag を覚える（続けて上書きできる）
    await fs.api.write('a.txt', 'again');
    expect(opens(calls)[1].ifMatch).toBe('6-def');
  });

  it('ETag を返さないサーバーのファイルは、一覧のあとでも「作成」になる（上書きは通さない）', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_list' ? [raw('a.txt', { etag: null })] : raw('a.txt', { etag: null })));
    await fs.api.list('');
    await fs.api.write('a.txt', 'x');
    expect(opens(calls)[0].ifMatch).toBeNull();
  });

  it('消した・移したパスの ETag は忘れる（同じ名前の新しいファイルを、古い ETag で上書きしない）', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_list' ? [raw('a.txt'), raw('dir/b.txt', { path: 'dir/b.txt' })] : cmd === 'dav_move' ? raw('c.txt') : raw('x')));
    await fs.api.list('');
    await fs.api.move('a.txt', 'c.txt');
    await fs.api.remove!('dir');
    await fs.api.write('a.txt', '1');
    await fs.api.write('dir/b.txt', '2');
    expect(opens(calls).map((o) => o.ifMatch)).toEqual([null, null]);
  });

  it('読んだあとに相手が変わっていた（precondition）は、そのまま失敗として返る', async () => {
    const { fs } = make((cmd) => (cmd === 'dav_put_finish' ? Object.assign(new Error('412'), { code: 'precondition' }) : undefined));
    await expect(fs.api.write('a', 'x')).rejects.toMatchObject({ code: 'precondition' });
  });
});

describe('操作', () => {
  it('作成・移動・コピーは Rust の dav_* に、overwrite を明示して渡す（既定は false）', async () => {
    const { fs, calls } = make(() => raw('x'));
    await fs.api.mkdir('d');
    await fs.api.move('a', 'b');
    await fs.api.move('a', 'b', true);
    await fs.api.copy('a', 'b');
    await fs.api.copy('a', 'b', true);
    expect(calls.map((c) => [c.cmd, c.args])).toEqual([
      ['dav_mkdir', { place: ID, base: BASE, path: 'd' }],
      ['dav_move', { place: ID, base: BASE, from: 'a', to: 'b', overwrite: false }],
      ['dav_move', { place: ID, base: BASE, from: 'a', to: 'b', overwrite: true }],
      ['dav_copy', { place: ID, base: BASE, from: 'a', to: 'b', overwrite: false }],
      ['dav_copy', { place: ID, base: BASE, from: 'a', to: 'b', overwrite: true }],
    ]);
  });

  it('削除は完全な削除（dav_remove）。ゴミ箱の口は使えない', async () => {
    const { fs, calls } = make();
    await fs.api.remove!('a');
    expect(calls[0]).toMatchObject({ cmd: 'dav_remove', args: { place: ID, base: BASE, path: 'a' } });
    for (const f of [() => fs.api.trash('a'), () => fs.api.restore('x'), () => fs.api.purge('x')]) {
      await expect(f()).rejects.toMatchObject({ code: 'unsupported' });
    }
    expect(calls).toHaveLength(1);
  });

  it('大きさ: 数え終わった値を返す。途中で打ち切られたら、全体の値として見せず失敗にする', async () => {
    const ok = make(() => ({ size: 10, files: 2, dirs: 1, partial: false }));
    expect(await ok.fs.api.size('d')).toEqual({ size: 10, files: 2, dirs: 1 });
    const part = make(() => ({ size: 10, files: 2, dirs: 1, partial: true }));
    await expect(part.fs.api.size('d')).rejects.toMatchObject({ code: 'too_large' });
  });
});

describe('送る（進み具合・中止）', () => {
  function withProgress() {
    let handler: ((p: DavProgress) => void) | null = null;
    let stopped = 0;
    return {
      onProgress: async (h: (p: DavProgress) => void) => {
        handler = h;
        return () => void stopped++;
      },
      emit: (p: DavProgress) => handler?.(p),
      stopped: () => stopped,
    };
  }

  it('自分の job の進みだけを割合にして知らせ、終わったら受け取りをやめる', async () => {
    const pr = withProgress();
    let job = '';
    const { fs } = make((cmd, a) => {
      if (cmd === 'dav_put_finish') return raw('f.bin');
      if (cmd !== 'dav_put_open') return undefined;
      job = (a as { job: string }).job;
      pr.emit({ job: 'someone-else', done: 99, total: 100 });
      pr.emit({ job, done: 25, total: 100 });
      pr.emit({ job, done: 100, total: 100 });
      return undefined;
    }, { onProgress: pr.onProgress });
    const seen: number[] = [];
    await fs.api.upload('f.bin', new Blob(['x']), (r) => seen.push(r)).promise;
    expect(seen).toEqual([0.25, 1]);
    expect(pr.stopped()).toBe(1);
  });

  it('失敗しても、進みの受け取りはやめる', async () => {
    const pr = withProgress();
    const { fs } = make(() => Object.assign(new Error('x'), { code: 'offline' }), { onProgress: pr.onProgress });
    await expect(fs.api.upload('a', new Blob(['x'])).promise).rejects.toMatchObject({ code: 'offline' });
    expect(pr.stopped()).toBe(1);
  });

  it('abort は、送っている job を中止する（dav_cancel）。止まったら、続きの中身は送らず、結果は aborted', async () => {
    let release: () => void = () => {};
    const { fs, calls } = make((cmd) => {
      if (cmd === 'dav_put_chunk') return new Promise<void>((r) => (release = r));
      if (cmd === 'dav_put_finish') return Object.assign(new Error('x'), { code: 'aborted' });
      return true;
    });
    const h = fs.api.upload('a', new Blob([new Uint8Array(9 * 1024 * 1024)]));
    await vi.waitFor(() => expect(calls.some((c) => c.cmd === 'dav_put_chunk')).toBe(true));
    h.abort();
    const open = calls.find((c) => c.cmd === 'dav_put_open')!.args as { job: string };
    expect((calls.find((c) => c.cmd === 'dav_cancel')!.args as { job: string }).job).toBe(open.job);
    release();
    await expect(h.promise).rejects.toMatchObject({ code: 'aborted' });
    expect(calls.filter((c) => c.cmd === 'dav_put_chunk')).toHaveLength(1);
  });

  it('接続の最中に中止されたら、開き終わった時点でもう一度中止を伝える（取っ手が間に合わなくても止まる）。中身は送らない', async () => {
    let release: () => void = () => {};
    const { fs, calls } = make((cmd) => {
      if (cmd === 'dav_put_open') return new Promise<void>((r) => (release = r));
      if (cmd === 'dav_put_finish') return Object.assign(new Error('x'), { code: 'aborted' });
      return true;
    });
    const h = fs.api.upload('a', new Blob(['x']));
    await vi.waitFor(() => expect(calls.some((c) => c.cmd === 'dav_put_open')).toBe(true));
    h.abort();
    release();
    await expect(h.promise).rejects.toMatchObject({ code: 'aborted' });
    expect(calls.filter((c) => c.cmd === 'dav_cancel')).toHaveLength(2);
    expect(calls.some((c) => c.cmd === 'dav_put_chunk')).toBe(false);
  });

  it('送り始める前に中止したら、送らない', async () => {
    const { fs, calls } = make(() => raw('a'));
    const h = fs.api.upload('a', new Blob(['x']));
    h.abort();
    await expect(h.promise).rejects.toMatchObject({ code: 'aborted' });
    expect(calls.some((c) => c.cmd === 'dav_put_open')).toBe(false);
  });
});

describe('見る・開く', () => {
  it('画像・PDF は、Rust の中継（fixdav）の URL で読む。置き場所の id・接続先・パスを段ごとに符号化し、更新日時と大きさを付ける。画像でないものの縮小版は無い', () => {
    const { fs } = make();
    const img = { name: 'p q.png', path: 'a b/p q.png', kind: 'file' as const, size: 1, modified: 7, mime: 'image/png' };
    const url = `proxy://x/${ID}/${encodeURIComponent(BASE)}/a%20b/p%20q.png?v=7-1`;
    expect(fs.urls.thumbUrl(img)).toBe(url);
    expect(fs.urls.readUrl(img)).toBe(url);
    expect(fs.urls.thumbUrl({ ...img, name: 'a.txt', path: 'a.txt', mime: 'text/plain' })).toBeNull();
    expect(fs.urls.thumbUrl({ ...img, kind: 'dir' })).toBeNull();
    const pdf = { ...img, name: 'd.pdf', path: 'd.pdf', mime: 'application/pdf' };
    expect(fs.urls.pdfSource(pdf)).toEqual({ url: `proxy://x/${ID}/${encodeURIComponent(BASE)}/d.pdf?v=7-1`, key: `${ID}:d.pdf:7:1` });
    expect(fs.urls.pdfSource({ ...pdf, size: 51 * 1024 * 1024 })).toBeNull();
    expect(fs.urls.pdfSource(img)).toBeNull();
  });

  it('表示の URL から、元のパスをたどれる（拡大表示の「保存」で、既定のアプリで開く）。作っていない URL は分からない', () => {
    const { fs } = make();
    const url = fs.urls.readUrl({ name: 'a.png', path: 'x/a.png', kind: 'file', size: 1, modified: 0, mime: null })!;
    expect(fs.sources.pathOf(url)).toBe('x/a.png');
    expect(fs.sources.pathOf('proxy://other')).toBeNull();
  });

  it('davProxyUrl: 日本語・記号・空の段も崩れない（Rust の parse_path が元に戻す形）', () => {
    expect(davProxyUrl('id', 'https://h/dav', '日本/a#b?c', 'v', (p) => `s://${p}`)).toBe(`s://id/${encodeURIComponent('https://h/dav')}/${encodeURIComponent('日本')}/a%23b%3Fc?v=v`);
  });

  it('認証が通らなかったら（auth）、知らせる口を呼んで、失敗はそのまま返す。ほかの失敗では呼ばない', async () => {
    const onAuthError = vi.fn();
    const bad = make(() => Object.assign(new Error('x'), { code: 'auth' }), { onAuthError });
    await expect(bad.fs.api.list('')).rejects.toMatchObject({ code: 'auth' });
    expect(onAuthError).toHaveBeenCalledTimes(1);
    const off = make(() => Object.assign(new Error('x'), { code: 'offline' }), { onAuthError });
    await expect(off.fs.api.list('')).rejects.toMatchObject({ code: 'offline' });
    expect(onAuthError).toHaveBeenCalledTimes(1);
  });

  it('開く: 一時のフォルダへ受け取ってから、その場所を既定のアプリで開く', async () => {
    const { fs, calls } = make((cmd) => (cmd === 'dav_download' ? '/tmp/fixplor-dav/x/a.pdf' : undefined));
    await fs.open('docs/a.pdf');
    expect(calls[0]).toMatchObject({ cmd: 'dav_download', args: { place: ID, base: BASE, path: 'docs/a.pdf' } });
    expect(calls[1]).toMatchObject({ cmd: 'fs_open', args: { path: '/tmp/fixplor-dav/x/a.pdf' } });
  });

  it('名前の決まり: 空・/ を含む名前は使えない。特別なフォルダは無い', () => {
    const { fs } = make();
    expect(fs.rules.specialDir).toBeNull();
    expect(fs.rules.nameError('', '')).not.toBeNull();
    expect(fs.rules.nameError('', 'a/b')).not.toBeNull();
    expect(fs.rules.nameError('', 'ok.txt')).toBeNull();
  });

  it('「無い」の判定は not_found・not_dir だけ', () => {
    const { fs } = make();
    expect(fs.isMissing(new FsError('not_found', ''))).toBe(true);
    expect(fs.isMissing(new FsError('offline', ''))).toBe(false);
    expect(fs.isMissing(new Error('x'))).toBe(false);
  });
});

describe('検索（サーバーに検索が無いので、手元で読む）', () => {
  it('フォルダを 1 つずつ dav_list で読み、名前に含むものを渡す。隠しファイルは出さない設定なら除く', async () => {
    const { fs, calls } = make((cmd, args) => {
      if (cmd !== 'dav_list') return undefined;
      const path = (args as { path: string }).path;
      if (path === '') return [raw('Cat.txt'), raw('sub', { kind: 'dir', size: null, mime: null, etag: null }), raw('.cat-hidden', { hidden: true })];
      if (path === 'sub') return [raw('sub/cat2.md', { path: 'sub/cat2.md' })];
      return [];
    });
    const got: string[] = [];
    const out = await fs.api.search!({ dir: '', text: 'cat' }, { hits: (e) => got.push(...e.map((x) => x.path)), signal: new AbortController().signal });
    expect(got).toEqual(['Cat.txt', 'sub/cat2.md']);
    expect(out).toEqual({ partial: null });
    expect(calls.filter((c) => c.cmd === 'dav_list').map((c) => (c.args as { path: string }).path)).toEqual(['', 'sub']);
  });
});
