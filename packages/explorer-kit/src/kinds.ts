// 名前と種類（mime）から、ファイルの種類を見分ける。本体が別の見分け方を持たないときの既定（ExplorerHost.isImage・viewerKind に渡せる）。

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;

/** SVG か（<img> で描くときは、スクリプトは動かず、currentColor は黒になる。透けるので、下に市松模様を敷く） */
export function isSvgName(name: string, mime?: string | null): boolean {
  return mime === 'image/svg+xml' || /\.svg$/i.test(name);
}

/** 画像か。mime が画像ならそれで決める。mime が無い・汎用（application/octet-stream）のときは拡張子で見る */
export function isImageName(name: string, mime?: string | null): boolean {
  if (mime && mime !== 'application/octet-stream') return mime.startsWith('image/');
  return IMAGE_EXT.test(name);
}

/** PDF か（mime が無い・汎用のときは拡張子で見る） */
export function isPdfName(name: string, mime?: string | null): boolean {
  if (mime && mime !== 'application/octet-stream') return mime === 'application/pdf';
  return /\.pdf$/i.test(name);
}

/** 拡大表示で見られる種類（'image'・'pdf'）。見られなければ null */
export function basicViewerKind(name: string, mime?: string | null): 'image' | 'pdf' | null {
  if (isImageName(name, mime)) return 'image';
  if (isPdfName(name, mime)) return 'pdf';
  return null;
}
