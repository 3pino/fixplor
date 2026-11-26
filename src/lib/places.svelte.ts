import { read, write } from './settings.svelte';

// 追加したネットワークの置き場所（WebDAV・SFTP）。名前と URL だけを、各デバイスに保存する（資格情報は、まだ持たない）。
// 置き場所を消しても、サーバーのファイルは消えない（覚えを外すだけ）。

export type DavPlace = { id: string; name: string; url: string };

const KEY = 'fixplor.places';

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/** 利用者が打った URL を確かめて、正しい形（末尾の / つき・検索語と # なし）にする */
export function checkUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (text === '') return { ok: false, reason: 'URL を入力してください' };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, reason: 'URL を読めません（https://… や sftp://… の形で入力してください）' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'sftp:') return { ok: false, reason: 'URL は http://・https://・sftp:// で始めてください' };
  if (u.username !== '' || u.password !== '') return { ok: false, reason: 'URL にユーザー名・パスワードは書けません' };
  u.search = '';
  u.hash = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return { ok: true, url: u.toString() };
}

function load(): DavPlace[] {
  const raw = read(KEY);
  if (raw === null) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    // 壊れた項目は捨てる
    return list.flatMap((x): DavPlace[] => {
      const p = x as Partial<DavPlace> | null;
      if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.url !== 'string') return [];
      const c = checkUrl(p.url);
      return c.ok && p.name.trim() !== '' ? [{ id: p.id, name: p.name, url: c.url }] : [];
    });
  } catch {
    return [];
  }
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

class Places {
  list = $state.raw<DavPlace[]>(load());

  private save(next: DavPlace[]): void {
    this.list = next;
    write(KEY, JSON.stringify(next));
  }

  get(id: string): DavPlace | undefined {
    return this.list.find((p) => p.id === id);
  }

  /** 追加する。名前が空なら、URL のホスト名を名前にする。URL が正しくなければ理由を返す */
  add(name: string, rawUrl: string): { ok: true; place: DavPlace } | { ok: false; reason: string } {
    const c = checkUrl(rawUrl);
    if (!c.ok) return c;
    const place = { id: newId(), name: name.trim() || new URL(c.url).host, url: c.url };
    this.save([...this.list, place]);
    return { ok: true, place };
  }

  update(id: string, name: string, rawUrl: string): { ok: true; place: DavPlace } | { ok: false; reason: string } {
    const old = this.get(id);
    if (!old) return { ok: false, reason: '置き場所が見つかりません' };
    const c = checkUrl(rawUrl);
    if (!c.ok) return c;
    const place = { id, name: name.trim() || new URL(c.url).host, url: c.url };
    this.save(this.list.map((p) => (p.id === id ? place : p)));
    return { ok: true, place };
  }

  remove(id: string): void {
    this.save(this.list.filter((p) => p.id !== id));
  }
}

export const places = new Places();
