//! SFTP（SSH のファイル転送）の置き場所。
//!
//! 画面からは、WebDAV と同じ形（`dav_*` と同じ引数・答え）で使う（コマンドは `sftp_*`）。接続先は `sftp://host:22/home/me/`（パスは、サーバーの絶対パス）。
//!  - 接続は、置き場所ごとにつないだまま使い回す（`pool::Pool`）。切れていたら、1 回だけつなぎ直して操作をやり直す。
//!  - サーバーの身元（ホスト鍵）は、指紋（SHA-256）を固定して確かめる（`webdav::pin::Pins`。証明書の固定と同じ置き場）。
//!    固定が無ければ `tls`（確認が要る）、固定と違えば `cert_changed` で断る（画面は、確認のダイアログを出す）。
//!  - 資格情報（ユーザー名・パスワード、または秘密鍵）は OS のキーチェーン（`webdav::secret::Creds`）。
//!  - 書き込み（`dav_put_chunk`・`dav_put_finish`・`dav_cancel`）は、WebDAV と同じコマンドを使う（job の名前で見つける）。

pub mod commands;
pub mod ops;
pub mod pool;

pub use pool::{probe, Pool};

#[cfg(test)]
mod tests;
