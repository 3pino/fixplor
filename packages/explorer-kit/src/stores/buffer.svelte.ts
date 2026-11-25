import type { TransferItem, TransferOp } from '../transfer';

/**
 * エクスプローラーの、アプリ内の切り取り・コピーのバッファ（文字・画像の貼り付けには使わない）。OS のクリップボードには、ファイルとしても書く（置き場所ができるとき。`clipToken`）。
 * 書けない置き場所（WebDAV・Android など）は、コピーした時点のクリップボードの中身を控える（`clipSnapshot`）。
 * 中身はパスだけ（実体は置き場所にある）。切り取りは貼り付けたら外す。コピーは何度でも貼り付けられる。
 */
export class ExplorerBuffer {
  mode = $state<TransferOp | null>(null);
  items = $state<TransferItem[]>([]);
  /**
   * コピー・切り取りのときに OS のクリップボードへファイルとして書いたときの印。書けなかった・書かない置き場所（Android など）は null。
   * 貼り付けのとき、クリップボードにまだこの印があれば、このバッファを貼る（ほかでコピーし直していれば、そちらを貼る）。
   * null のときは、`clipSnapshot` で決める
   */
  clipToken = $state<string | null>(null);
  /**
   * コピー・切り取りの時点の、OS のクリップボードの中身の控え（文字・画像の見分け）。ファイルとして書けない置き場所で使う。
   * 空のクリップボードは ''。控えられなかったら null。
   * 貼り付けのとき、クリップボードの今の中身が控えと同じなら、ほかで何もコピーしていないので、このバッファを貼る（違えば、ほかでコピーし直しているので、そちらを貼る）。
   * `clipToken` も null のとき（どちらも無い）は、クリップボードを見ずにバッファを貼る
   */
  clipSnapshot = $state<string | null>(null);

  /** OS のクリップボードと結び付けているか（印か控えがある）。結び付いていれば、貼るとき、クリップボードを見て決める */
  get tracked(): boolean {
    return this.clipToken !== null || this.clipSnapshot !== null;
  }

  get empty(): boolean {
    return this.items.length === 0;
  }

  /** 切り取り（move）かコピー（copy）で入れ替える */
  set(mode: TransferOp, items: TransferItem[]): void {
    this.mode = mode;
    this.items = [...items];
    this.clipToken = null;
    this.clipSnapshot = null;
  }

  /** 貼り付けたものを外す（切り取りのとき）。残りが無ければ空にする */
  remove(paths: readonly string[]): void {
    this.items = this.items.filter((i) => !paths.includes(i.path));
    if (this.items.length === 0) this.mode = null;
  }

  clear(): void {
    this.mode = null;
    this.items = [];
    this.clipToken = null;
    this.clipSnapshot = null;
  }

  /** 切り取りの途中か（一覧で薄く出すため） */
  isCut(path: string): boolean {
    return this.mode === 'move' && this.items.some((i) => i.path === path);
  }
}

