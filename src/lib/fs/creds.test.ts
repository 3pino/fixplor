import { describe, expect, it } from 'vitest';
import { createCreds } from './creds';
import type { Call } from './call';

describe('資格情報の口（Rust へ渡すだけ）', () => {
  const rec = () => {
    const calls: [string, unknown][] = [];
    const call: Call = async <T>(cmd: string, args?: Record<string, unknown> | Uint8Array) => {
      calls.push([cmd, args]);
      if (cmd === 'dav_cred_info') return { user: 'taro', base: 'https://h/' } as T;
      return undefined as T;
    };
    return { calls, creds: createCreds(call) };
  };

  it('info・set・clear は、置き場所の id つきの dav_cred_* になる。パスワードは set のときだけ渡す（null なら保管済みを使う）', async () => {
    const { calls, creds } = rec();
    expect(await creds.info('p1')).toEqual({ user: 'taro', base: 'https://h/' });
    await creds.set('p1', 'https://h/', 'taro', 'pw');
    await creds.set('p1', 'https://h/', 'taro', null);
    await creds.clear('p1');
    expect(calls).toEqual([
      ['dav_cred_info', { place: 'p1' }],
      ['dav_cred_set', { place: 'p1', base: 'https://h/', user: 'taro', password: 'pw', key: null }],
      ['dav_cred_set', { place: 'p1', base: 'https://h/', user: 'taro', password: null, key: null }],
      ['dav_cred_clear', { place: 'p1' }],
    ]);
  });

  it('Rust の失敗は FsError（code つき）になる（キーチェーンが使えない など）', async () => {
    const creds = createCreds(async () => {
      throw { code: 'keychain', message: 'キーチェーンが使えません: x' };
    });
    await expect(creds.set('p', 'https://h/', 'u', 'p')).rejects.toMatchObject({ name: 'FsError', code: 'keychain', message: 'キーチェーンが使えません: x' });
  });
});
