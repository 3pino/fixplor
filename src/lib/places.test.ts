// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { checkUrl, places } from './places.svelte';

describe('URL の確かめ', () => {
  it('http・https だけ。末尾の / を補い、検索語と # は除く', () => {
    expect(checkUrl('https://h.example/dav')).toEqual({ ok: true, url: 'https://h.example/dav/' });
    expect(checkUrl('  http://h:8080/a/b/?x=1#f ')).toEqual({ ok: true, url: 'http://h:8080/a/b/' });
    expect(checkUrl('https://h.example')).toEqual({ ok: true, url: 'https://h.example/' });
  });

  it('sftp:// も受ける（ポート・パスを保ち、末尾の / を補う）。ユーザー名つきは断る', () => {
    expect(checkUrl('sftp://nas.example')).toEqual({ ok: true, url: 'sftp://nas.example/' });
    expect(checkUrl('sftp://nas.example:2222/home/me')).toEqual({ ok: true, url: 'sftp://nas.example:2222/home/me/' });
    expect(checkUrl('sftp://me@nas.example/').ok).toBe(false);
  });

  it('空・読めない・別の種類・ユーザー名つきは理由つきで断る', () => {
    for (const bad of ['', '   ', 'not a url', 'ftp://h/', 'file:///etc', 'javascript:alert(1)', 'https://u:p@h/', 'https://u@h/']) {
      const r = checkUrl(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('置き場所の覚え', () => {
  beforeEach(() => {
    localStorage.clear();
    for (const p of [...places.list]) places.remove(p.id);
  });

  it('追加・名前と URL の変更・削除ができ、覚えは再読み込みしても残る', async () => {
    const a = places.add('家', 'https://nas.example/dav');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(places.list).toEqual([{ id: a.place.id, name: '家', url: 'https://nas.example/dav/' }]);
    const u = places.update(a.place.id, '自宅', 'http://nas.local:8080/files');
    expect(u.ok && u.place).toMatchObject({ id: a.place.id, name: '自宅', url: 'http://nas.local:8080/files/' });
    expect(JSON.parse(localStorage.getItem('fixplor.places')!)).toHaveLength(1);
    places.remove(a.place.id);
    expect(places.list).toEqual([]);
    expect(localStorage.getItem('fixplor.places')).toBe('[]');
  });

  it('名前が空なら、ホスト名を名前にする。URL が正しくなければ、覚えない', () => {
    const r = places.add('  ', 'https://nas.example:8443/dav');
    expect(r.ok && r.place.name).toBe('nas.example:8443');
    expect(places.add('x', 'nope').ok).toBe(false);
    expect(places.list).toHaveLength(1);
    expect(places.update('missing', 'x', 'https://h/').ok).toBe(false);
  });

  it('資格情報は覚えない（保存する値に、URL の名前・パスワード以外が無い）', () => {
    places.add('x', 'https://h.example/dav');
    expect(Object.keys(JSON.parse(localStorage.getItem('fixplor.places')!)[0]).sort()).toEqual(['id', 'name', 'url']);
  });
});
