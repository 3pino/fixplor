<script lang="ts">
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import TextInput from '@3pino/ui-kit-web/TextInput.svelte';
  import { formatFingerprint } from '../lib/fs/pins';
  import type { DavPlace } from '../lib/places.svelte';

  // ネットワークの置き場所（WebDAV・SFTP）を足す・直す・外すダイアログ。名前・URL と、認証（WebDAV は任意。ユーザー名・パスワード）。
  // SFTP（sftp://）は、パスワードのかわりに秘密鍵（文章を貼る。パスフレーズは任意）も使える。
  // パスワード・秘密鍵は OS のキーチェーンへ保管され、ここへは戻ってこない（保存済みかどうかだけを知る）。
  // onsave は、保存できなければ理由の文を返す（できたら null）。onremove があるのは、直すときだけ。
  let {
    place,
    saved = null,
    savedError = '',
    focusPassword = false,
    pin = null,
    onunpin,
    onsave,
    onremove,
    onclose,
  }: {
    place?: DavPlace;
    /** 保管している資格情報（ユーザー名）。無ければ null（認証なし） */
    saved?: { user: string; has_key?: boolean } | null;
    /** 保管の様子を読めなかったときの理由（キーチェーンが使えない など） */
    savedError?: string;
    /** 開いたとき、パスワードの入れ直しから始める（認証が通らなかったとき） */
    focusPassword?: boolean;
    /** 信頼した証明書（固定）の指紋（16 進 64 桁）。無ければ null */
    pin?: string | null;
    /** 固定を解除する（押したら、ダイアログは閉じて、通常の確かめに戻る） */
    onunpin?: () => void;
    onsave: (name: string, url: string, cred: { user: string; password: string | null; key: string | null } | null) => Promise<string | null>;
    onremove?: () => void;
    onclose: () => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let name = $state(place?.name ?? '');
  // svelte-ignore state_referenced_locally
  let url = $state(place?.url ?? '');
  // svelte-ignore state_referenced_locally
  let user = $state(saved?.user ?? '');
  let password = $state('');
  // svelte-ignore state_referenced_locally
  let changing = $state(focusPassword);
  let error = $state('');
  let busy = $state(false);

  // SFTP の接続先か。秘密鍵は、SFTP だけ
  const sftp = $derived(url.trim().startsWith('sftp:'));
  // 秘密鍵（文章）を新しく入れた・保管済みの鍵を外す
  let keyText = $state('');
  let keyClear = $state(false);
  const keyChanged = $derived(sftp && (keyText.trim() !== '' || keyClear));
  // 保管済みの鍵を使い続ける（接続先を変えていないとき）
  const keepsKey = $derived(sftp && saved?.has_key === true && place !== undefined && url.trim() === place.url && !keyClear);
  // 鍵を使う（新しい鍵がある・保管済みの鍵を使い続ける）とき、「パスワード」は鍵のパスフレーズ（無くてよい）
  const useKey = $derived(sftp && (keyText.trim() !== '' || keepsKey));

  // 保管済みのパスワードを使い続けてよいのは、ユーザー名があり、接続先と鍵を変えていないとき（別のサーバーへ、保管したパスワードを渡さない）
  const keeps = $derived(saved !== null && place !== undefined && url.trim() === place.url && !changing && !keyChanged);
  const askPassword = $derived(user.trim() !== '' && !keeps);

  async function submit(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    const u = user.trim();
    if (u !== '' && askPassword && password === '' && !useKey) {
      error = 'パスワードを入力してください';
      return;
    }
    busy = true;
    try {
      const key = !sftp ? null : keyClear && keyText.trim() === '' ? '' : keyText.trim() !== '' ? `${keyText.trim()}\n` : null;
      error = (await onsave(name, url, u === '' ? null : { user: u, password: askPassword ? password : null, key })) ?? '';
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={place ? 'ネットワークの場所を直す' : 'ネットワークの場所を追加'} {onclose}>
  <form class="place-form" onsubmit={submit}>
    <label class="field-label" for="place-url">URL（WebDAV・SFTP）</label>
    <TextInput id="place-url" bind:value={url} placeholder="https://example.com/dav/ または sftp://example.com/home/me/" inputmode="url" autocapitalize="off" autocorrect="off" spellcheck="false" required />
    <label class="field-label" for="place-name">名前（省くと、サーバーの名前）</label>
    <TextInput id="place-name" bind:value={name} placeholder="自宅のサーバー" autocomplete="off" />
    <label class="field-label" for="place-user">ユーザー名{sftp ? '' : '（認証が要るときだけ）'}</label>
    <TextInput id="place-user" bind:value={user} autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" />
    {#if user.trim() !== ''}
      {#if keeps}
        <div class="place-saved">
          <span>パスワード: 保存済み（OS のキーチェーン）</span>
          <Button class="place-change" onclick={() => (changing = true)}>パスワードを変更</Button>
        </div>
      {:else}
        <label class="field-label" for="place-password">{useKey ? '秘密鍵のパスフレーズ（無ければ空。OS のキーチェーンに保管します）' : 'パスワード（OS のキーチェーンに保管します）'}</label>
        <!-- svelte-ignore a11y_autofocus -->
        <TextInput id="place-password" type="password" bind:value={password} autocomplete="new-password" autofocus={focusPassword} />
      {/if}
    {:else if saved}
      <p class="place-note">ユーザー名を空にして保存すると、保管した認証情報を消します。</p>
    {/if}
    {#if sftp && user.trim() !== ''}
      {#if keepsKey}
        <div class="place-saved">
          <span>秘密鍵: 保存済み（OS のキーチェーン）</span>
          <Button class="place-key-clear" onclick={() => (keyClear = true)}>鍵を外す</Button>
        </div>
      {:else}
        <label class="field-label" for="place-key">秘密鍵（鍵でつなぐときだけ。OpenSSH 形式の文章を貼り付けます）</label>
        <textarea id="place-key" class="place-key" bind:value={keyText} rows="4" autocapitalize="off" spellcheck="false" placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"></textarea>
      {/if}
    {/if}
    {#if pin && place}
      <div class="place-saved place-pin">
        <span>信頼した証明書: <code class="place-pin-fp">{formatFingerprint(pin)}</code>{#if url.trim() !== place.url}（URL を変えると、固定は外れます）{/if}</span>
        {#if onunpin}<Button class="place-unpin" onclick={onunpin}>信頼を解除</Button>{/if}
      </div>
    {/if}
    {#if savedError}<p class="place-error" role="alert">認証情報を読めません: {savedError}</p>{/if}
    {#if error}<p class="place-error" role="alert">{error}</p>{/if}
    <div class="modal-actions">
      {#if onremove}<Button variant="danger" class="place-remove" onclick={onremove}>一覧から外す</Button>{/if}
      <Button onclick={onclose}>キャンセル</Button>
      <Button type="submit" variant="primary" disabled={url.trim() === '' || busy}>{place ? '保存' : '追加'}</Button>
    </div>
  </form>
</Modal>

<style>
  .place-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .place-saved {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--fs-base);
  }
  .place-pin-fp {
    font-family: var(--font-mono, monospace);
    overflow-wrap: anywhere;
  }
  .place-note {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--fs-base);
  }
  .place-error {
    margin: 0;
    color: var(--danger, var(--text));
    font-size: var(--fs-base);
    overflow-wrap: anywhere;
  }
  .place-key {
    font-family: var(--font-mono, monospace);
    font-size: var(--fs-base);
    resize: vertical;
    color: var(--text);
    background: var(--surface, transparent);
    border: 1px solid var(--border, currentColor);
    border-radius: var(--radius, 4px);
    padding: var(--space-2);
  }
  .place-form :global(.place-remove) {
    margin-right: auto;
  }
</style>
