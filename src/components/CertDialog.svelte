<script lang="ts">
  import { onMount } from 'svelte';
  import Modal from '@3pino/ui-kit-web/Modal.svelte';
  import Button from '@3pino/ui-kit-web/Button.svelte';
  import { copyText } from '@3pino/app-kit-web/core/clipboard';
  import { expiryText, formatFingerprint, type Probe } from '../lib/fs/pins';
  import type { DavPlace } from '../lib/places.svelte';

  // ネットワークの場所の証明書を確かめて、信頼するか決めるダイアログ。開くと、すぐ確かめる（握手だけ。要求もパスワードも送らない）。
  // 見せるのは、証明書の指紋（SHA-256）。サーバーの管理者から聞いた指紋と同じときだけ、信頼してもらう。
  // previous があるのは、前に信頼した証明書と変わったとき（前の指紋を並べて、警告する）。
  let {
    place,
    previous = null,
    probe,
    ontrust,
    onclose,
  }: {
    place: DavPlace;
    /** 前に信頼した指紋（16 進 64 桁）。無ければ null */
    previous?: string | null;
    probe: (base: string) => Promise<Probe>;
    /** 信頼する。できなければ理由の文を返す（できたら null） */
    ontrust: (fingerprint: string) => Promise<string | null>;
    onclose: () => void;
  } = $props();

  // SFTP は、証明書ではなくサーバーのホスト鍵（SSH の身元）を確かめる
  // svelte-ignore state_referenced_locally
  const ssh = place.url.startsWith('sftp:');
  const subject = ssh ? 'ホスト鍵' : '証明書';

  let phase = $state<{ kind: 'loading' } | { kind: 'error'; text: string } | { kind: 'trusted' } | { kind: 'cert'; fingerprint: string; notAfter: string | null }>({ kind: 'loading' });
  let error = $state('');
  let busy = $state(false);

  onMount(() => {
    void probe(place.url).then(
      (r) => (phase = r.trusted || !r.fingerprint ? { kind: 'trusted' } : { kind: 'cert', fingerprint: r.fingerprint, notAfter: r.not_after }),
      (e: unknown) => (phase = { kind: 'error', text: e instanceof Error ? e.message : String(e) }),
    );
  });

  const same = $derived(phase.kind === 'cert' && previous !== null && phase.fingerprint === previous);

  async function trust(): Promise<void> {
    if (phase.kind !== 'cert') return;
    busy = true;
    try {
      error = (await ontrust(phase.fingerprint)) ?? '';
    } finally {
      busy = false;
    }
  }
</script>

<Modal title={previous ? `${subject}が変わりました` : `${subject}を確認`} {onclose}>
  <div class="cert">
    <p class="cert-target">{place.name}（{place.url}）</p>
    {#if phase.kind === 'loading'}
      <p class="cert-note" role="status">確かめています…</p>
    {:else if phase.kind === 'error'}
      <p class="cert-error" role="alert">確かめられませんでした: {phase.text}</p>
    {:else if phase.kind === 'trusted'}
      <p class="cert-note" role="status">このサーバーの{subject}は、この PC が信頼しています。固定は要りません（再読み込みしてください）。</p>
    {:else}
      {#if previous}
        <p class="cert-warn" role="alert">前に信頼した{subject}と違います。サーバーの{subject}を入れ替えたのでなければ、別のものに成り代わられているかもしれません。</p>
        <p class="cert-label">前に信頼した指紋</p>
        <code class="cert-fp cert-fp-old">{formatFingerprint(previous)}</code>
        <p class="cert-label">いま示された指紋</p>
      {:else}
        {#if ssh}
          <p class="cert-note">初めてつなぐサーバーです。サーバーの管理者から聞いた、ホスト鍵の指紋（SHA-256。サーバーで <code>ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code> などで確かめられます）と同じときだけ、信頼してください。</p>
        {:else}
          <p class="cert-note">このサーバーの証明書は、公的な認証局では確認できません。サーバーの管理者から聞いた指紋（SHA-256）と同じときだけ、信頼してください。</p>
        {/if}
        <p class="cert-label">指紋（SHA-256）</p>
      {/if}
      <code class="cert-fp">{formatFingerprint(phase.fingerprint)}</code>
      {#if expiryText(phase.notAfter)}<p class="cert-note">有効期限: {expiryText(phase.notAfter)}</p>{/if}
      {#if same}<p class="cert-note">前に信頼した{subject}と同じです。</p>{/if}
      <p class="cert-note">信頼すると、この場所は、この{subject}だけを受け入れます{ssh ? '' : '（期限や名前は見ません）'}。あとから外せます。</p>
    {/if}
    {#if error}<p class="cert-error" role="alert">{error}</p>{/if}
    <div class="modal-actions">
      {#if phase.kind === 'cert'}
        <Button class="cert-copy" onclick={() => void copyText(formatFingerprint(phase.kind === 'cert' ? phase.fingerprint : ''))}>指紋をコピー</Button>
      {/if}
      <Button onclick={onclose}>{phase.kind === 'cert' ? 'キャンセル' : '閉じる'}</Button>
      {#if phase.kind === 'cert'}
        <Button class="cert-trust" variant="primary" disabled={busy} onclick={() => void trust()}>この{subject}を信頼する</Button>
      {/if}
    </div>
  </div>
</Modal>

<style>
  .cert {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .cert p {
    margin: 0;
    font-size: var(--fs-base);
  }
  .cert-target {
    overflow-wrap: anywhere;
    color: var(--text-muted);
  }
  .cert-note {
    color: var(--text-muted);
  }
  .cert-warn,
  .cert-error {
    color: var(--danger, var(--text));
    overflow-wrap: anywhere;
  }
  .cert-label {
    color: var(--text-muted);
  }
  .cert-fp {
    font-family: var(--font-mono, monospace);
    overflow-wrap: anywhere;
    user-select: all;
  }
  .cert-fp-old {
    opacity: 0.7;
  }
  .cert :global(.cert-copy) {
    margin-right: auto;
  }
</style>
