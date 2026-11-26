//! WebDAV（ネットワークドライブ）の置き場所。Tauri には依らない（`commands.rs` が、コマンドとして出す）。
//! 手順と決まりは `client.rs` の先頭。ローカルの `fs` とは別（こちらは、ローカルの関数を呼ばない）。

mod client;
pub mod commands;
pub mod pin;
pub mod proxy;
pub mod secret;
pub mod url;
mod xml;

pub use client::{build_client, client_builder, net_error, quote_etag, status_error, Ctx, Dav, DavEntry, Progress, SIZE_DIR_LIMIT};
pub use xml::{parse_http_date, parse_multistatus, Resource};

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_auth;
#[cfg(test)]
mod tests_pin;
