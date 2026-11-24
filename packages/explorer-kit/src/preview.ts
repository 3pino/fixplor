// プレビュー（右のビュー）で、テキストの先頭を読む。ネットワークの先でも、必要な分だけで切り上げる。

/** 読む上限（バイト） */
export const PREVIEW_MAX_BYTES = 64 * 1024;
/** 出す上限（行） */
export const PREVIEW_MAX_LINES = 100;

/** 中身が文字か（NUL を含む・UTF-8 として読めない文字が多いものは、文字ではない） */
export function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i++) if (bytes[i] === 0) return false;
  const sample = new TextDecoder('utf-8').decode(bytes.subarray(0, n));
  if (sample.length === 0) return true;
  let bad = 0;
  for (const ch of sample) if (ch === '\uFFFD') bad++;
  // 途中で切れた最後の 1 文字は、数えない
  return bad <= 1 || bad / sample.length < 0.02;
}

/** 先頭から最大 maxLines 行。切ったか（行の上限か、バイトの上限か）も返す */
export function headOf(text: string, bytesCut: boolean, maxLines = PREVIEW_MAX_LINES): { text: string; truncated: boolean } {
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length <= maxLines) return { text: lines.join('\n'), truncated: bytesCut };
  return { text: lines.slice(0, maxLines).join('\n'), truncated: true };
}

export type HeadRead = { bytes: Uint8Array; more: boolean };

/** url の先頭を max バイトまで読む（それ以上は読まずに切り上げる）。signal で中断できる */
export async function readHead(url: string, signal: AbortSignal, max = PREVIEW_MAX_BYTES, fetcher: typeof fetch = fetch): Promise<HeadRead> {
  const res = await fetcher(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!res.body) {
    const all = new Uint8Array(await res.arrayBuffer());
    return { bytes: all.subarray(0, max), more: all.length > max };
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let more = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total >= max) {
      more = true;
      void reader.cancel().catch(() => {});
      break;
    }
  }
  const out = new Uint8Array(Math.min(total, max));
  let at = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, out.length - at);
    if (take <= 0) break;
    out.set(c.subarray(0, take), at);
    at += take;
  }
  return { bytes: out, more: more || total > max };
}
