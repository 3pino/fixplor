# @3pino/explorer-kit

ファイルエクスプローラーの共有の部品（Svelte 5）。特定のアプリの言葉は持たず、使うアプリが「置き場所」と「本体から借りる機能」を渡して、自分の画面を作ります（例: [fixplor](https://github.com/3pino/fixplor) は「この端末」を、サーバーのアプリは「サーバーのフォルダ」を渡す）。

- **画面**: `FileExplorer.svelte`（一覧・アイコン表示・選択・コピー／切り取り／貼り付け・ドラッグ・名前の変更・ゴミ箱・外からの取り込み）、`FileProperties.svelte`、`EntryActions.svelte`。ボタン・メニュー・ダイアログなどの小さな部品は [@3pino/ui-kit-web](https://github.com/3pino/ui-kit-web) のもの
- **決まり**（見た目を持たない）: 名前・同名の扱い（`ops`）、移動とコピーの進め方（`transfer`）、ゴミ箱の仮想フォルダ（`trashFolder`）、並び順（`listing`）、フォルダごとの表示（`dirs`）
- **状態**: 開いているフォルダ（`ExplorerNav`）・一覧の写し（`DirIndex`）・選択・切り取り／コピーの控え・表示方法

見た目は [@3pino/design-system](https://github.com/3pino/design-system) の CSS を前提にしています（取り込む側のアプリが読み込む）。
取り込む側は、`@3pino/ui-kit-web` も依存に入れてください（peer です）。

## 2 つの口

部品は、次の 2 つだけを通して外とやりとりします（`src/types.ts`）。

| 口 | 中身 | 例: サーバーのフォルダ | 例: この端末（fixplor） |
| --- | --- | --- | --- |
| 置き場所 `ExplorerApi`（＋`EntryUrls`・`Rules`・`ScopeSource`） | 一覧・書き込み・移動・コピー・ゴミ箱・大きさ。パスは、いちばん上からの相対（区切り `/`） | サーバーの API | Rust のコマンド |
| 本体から借りる機能 `ExplorerHost` | 通知・確認・「戻る」・拡大表示・クリップボード・保存・OS からのドロップ・この端末の種類 | アプリの既存の機能 | 自分の実装 |

`Rules` は置き場所ごとの決まり（特別なフォルダ・名前・文）。
- **特別なフォルダ** `specialDir`: そのフォルダそのものは動かせない・消せない／中にはファイルだけ（フォルダは作れない）／中と外の間は移動できない（コピーはできる）／中では、大文字・小文字だけが違う名前を同じ名前として扱う。無い置き場所は `null`。
- **文** `texts`（省ける）: 特別なフォルダの理由・確認の文などを、アプリの言葉で渡せる（`RuleTexts`）。省くと一般の文になる。
- 画面に出る呼び名は `labels`（`root`・`upload`、置き場所が切り替わるなら `scope`）で渡す。
- ドラッグで運ぶ項目の印は `EXPLORER_DRAG_TYPE`（`application/x-explorer-kit-items`）。ほかのドロップ先が、この部品のドラッグかを見分けるのに使える。
- **仮想のゴミ箱のフォルダ**（置き場所が、いちばん上の直下に `.trash` のような名前で見せ、一覧の項目に印 `Entry.trash` を付けるもの）は、`Rules.trashDir` にその名前を渡したときだけ働く（部品は名前を決め打ちしない）。省く・`null` なら、どのフォルダもふつうのフォルダ。
- **ゴミ箱の無い置き場所**（ネットワークドライブなど）は、`createExplorer({ caps: { trash: false } })`。削除は完全な削除になり、部品は `api.trash` の代わりに `api.remove(path)`（その置き場所が実装する）を呼ぶ。確認は「完全に削除します。元に戻せません」で、「取り消す」は出ない。
- 項目（`Entry`）は、部品が読む欄だけを型に持つ。置き場所が足した欄（自分の URL を作るための ID など）は、部品はそのまま運ぶだけで読まない（置き場所の側で、型を足して取り出す）。

## 使い方

このパッケージは、fixplor リポジトリの npm ワークスペース（`packages/explorer-kit`）。fixplor のアプリとプラグイン（`plugins/fixplor`）は、ワークスペースから取り込む（`"@3pino/explorer-kit": "*"`）。
別のアプリへ使うときは、このディレクトリのソースをそのまま取り込む（`npm pack` した tgz か、リポジトリのパス指定）。

配布はソースのまま（`.svelte`・`.svelte.ts`・`.ts`）。取り込む側の Vite（`@sveltejs/vite-plugin-svelte`）が変換します。
開発サーバーの依存の事前バンドルは JS だけを想定しているので、取り込む側の `vite.config.ts` で外してください。

```ts
optimizeDeps: { exclude: ['@3pino/explorer-kit', '@3pino/ui-kit-web'] },
```

```ts
import { createExplorer } from '@3pino/explorer-kit';

export const explorer = createExplorer({ api, urls, rules, host, viewStore, labels: { root: 'この端末', upload: 'アップロード' } });
```

```svelte
<script lang="ts">
  import FileExplorer from '@3pino/explorer-kit/FileExplorer.svelte';
  import { explorer } from './explorer';
</script>

<FileExplorer {explorer} />
```

`explorer` は、その部品の一生のあいだ同じものを渡します（別の置き場所を見せるときは `{#key}` で作り直す）。

一覧のホットキー（検索 `Ctrl+F`・開く `Enter`・名前の変更 `F2`・選択解除 `Escape`・パス入力欄にフォーカス `Ctrl+L`・最初・最後の項目を選ぶ `Home`／`End`・上下左右の項目へ `ArrowUp` など・選びに足しながら上下左右へ `Shift+ArrowUp` など（`extendUp`…`extendRight`）・すべて選ぶ `Ctrl+A`・コピー `Ctrl+C`・切り取り `Ctrl+X`・貼り付け `Ctrl+V`・ゴミ箱 `Delete`・完全に削除 `Shift+Delete`・新しいファイル・詳細／アイコン表示・元に戻す `Ctrl+Z`・やり直し `Ctrl+Y`）は、`keymap` で置き換えられます（省いたものは既定。空の一覧は、キーを割り当てない。`EXPLORER_HOTKEYS`）: `<FileExplorer {explorer} keymap={{ rename: ['F3'] }} />`。キーの文字の書き方は `hotkeys.ts`（`hotkeyFromEvent`・`matchesHotkey`）。

## 確かめる

```sh
npm install                   # fixplor のルートで（ワークスペース全体）
npm run check -w @3pino/explorer-kit   # 型
npm test -w @3pino/explorer-kit        # 決まり・状態・画面の試験（ルートの npm test にも入っている）
```

画面の細かい流れ（同名の確認・貼り付け・選択・ゴミ箱の項目・OS からのドロップ・置き場所が変わったとき・プロパティ）は、
この部品の中の試験（`src/FileExplorer.screen.test.ts`・`src/FileProperties.screen.test.ts`）が、メモリの中の偽の置き場所と本体（`src/test-support/screen.svelte.ts`）で確かめます。
使うアプリの側の試験は、その置き場所・本体の配線が正しいことだけを確かめれば足ります。

## 変更するとき

- 置き場所や本体に依ることは、`types.ts` の口に足す（部品の中で、OS や通信を直接さわらない）。
- 部品の口（公開する型・関数）を変えたら、`package.json` の版を上げる（ワークスペースなので、タグは打たない）。

元に戻す・やり直しの履歴（`explorerHistory`。`history.ts`）は、アプリで 1 つ持ちます（名前の変更・移動・コピー・新しいファイル・ゴミ箱へ移す。ゴミ箱から戻せる置き場所だけ）。

本体は、`<FileExplorer>` に次の部品（Snippet）を渡して、画面に足せます: `headerItem`（上端の行に足す部品。引数は ID: `back`・`forward`・`up`・`hidden`。並びと出す／出さないは `menuLayout.header`）・`menu`（≡ のメニューの先頭の項目）・`entryMenu`（項目の右クリックのメニューの終わりの項目。1 件を選んでいるとき。引数は、選んだ項目とメニューを閉じる関数）。戻る・進むの履歴は `explorer.nav`（`back()`・`forward()`・`future`）。

詳細の列の幅は、`columnWidths`（px。`kind`・`size`・`modified`・`created`）で渡し、見出しの境目をつまんで変えたら `oncolumnwidths` で知らせます（保存は本体）。数えたフォルダのサイズの写しは `createExplorer({ folderSizeCache })` で、同じ置き場所のエクスプローラー（タブ）どうしで共有できます。

そのほか、置き場所の `api.trashable(path)`（省くと、移せる。偽なら、Delete でも確認して `api.remove` で完全に削除する）、エクスプローラーの `explorer.lastSelected`（フォルダごとの最後に選んだ項目。戻る・入るときに選び直す）、`explorer.dropDragged(destDir, op)`（一覧のドラッグを、一覧の外のドロップ先から移す・コピーする）、`nav.reload(true)`（フォルダのサイズを捨てずに読み直す）、`api.home()`（パス欄の `~` が指すホーム。省くと `~` は解かない）、`resolveTypedPath(text, cwd, home)`（パス欄に打った文字を、`~`・`.`・`..` を解いてパスにする）があります。詳細表示の列の幅（`columnWidths`）は、`name`・`kind`・`size`・`modified`・`created` すべてを決められます（`name` を決めると、列の合計が全体の幅になり、右に余りが出ても構いません）。

コピー・切り取りを OS のクリップボードにファイルとして渡すには、`host.clipboard.files`（`write(paths, op, token)`・`token()`）を渡します。省くと、アプリの中のバッファだけで貼り付けます（どちらでも、パスの文字はクリップボードに書きません）。

一覧の横に置けるビューもあります: `ParentView.svelte`（親フォルダの中身。`explorer` と `entryStyle`）と、`PreviewPane.svelte`（カーソルの項目の中身。`explorer`・`entry`・`entryStyle`）。プレビューに渡す項目は、`<FileExplorer oncursor={(e) => ...}>` で受け取ります（PC だけ。無ければ null）。テキストの色付けに highlight.js を使います（依存に入っています）。

右クリックのメニューは、`menuLayout`（`{ entry, space }`。それぞれ `{ order, hidden }`）で、項目の順番と出さない項目を決められます（項目の ID は `ENTRY_MENU_ITEMS`・`SPACE_MENU_ITEMS`。`menuOrder`・`reorderMenu`・`setMenuHidden`・`parseMenuLayouts` で、設定の画面を作れます）。項目の見た目は、`entryStyle(e)`（`{ icon, color, opacity }` か null。アイコンは部品か、`{ iconName }`（`@3pino/ui-kit-web/icons` の登録簿の名前。lucide・`defineBuiltinIcon` したロゴなど）か、`{ src }`）で渡せます。
