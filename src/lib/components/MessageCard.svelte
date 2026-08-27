<script lang="ts">
	import { formatChatHtml } from '$lib/frontend/format';
	import type { MediaRecord, Message } from '$lib/frontend/types';
	import { toast } from '$lib/frontend/toast.svelte';

	let {
		message,
		index,
		isLast,
		attachments,
		busy,
		editing,
		onStartEdit,
		onCancelEdit,
		onSaveEdit,
		onResendEdit,
		onDelete,
		onRegenerate,
		onTranslate,
		onOpenMedia,
		onOpenViewer,
		onDeleteMedia
	}: {
		message: Message;
		index: number;
		isLast: boolean;
		attachments: MediaRecord[];
		busy: boolean;
		editing: boolean;
		onStartEdit: (index: number) => void;
		onCancelEdit: () => void;
		onSaveEdit: (index: number, content: string) => void;
		onResendEdit: (index: number, content: string) => void;
		onDelete: (index: number) => void;
		onRegenerate: (index: number) => void;
		onTranslate: (index: number) => void;
		onOpenMedia: (index: number) => void;
		onOpenViewer: (media: MediaRecord, trigger: HTMLElement) => void;
		onDeleteMedia: (mediaId: string) => void;
	} = $props();

	// The edit buffer intentionally initializes from the message once; the
	// $effect below re-syncs it whenever edit mode opens.
	// svelte-ignore state_referenced_locally
	let editText = $state(message.content || '');
	let editArea: HTMLTextAreaElement | undefined = $state(undefined);

	const isBranch = $derived(message.kind === 'branch');
	const roleClass = $derived(isBranch ? 'branch' : message.role === 'user' ? 'user' : 'assistant');
	const whoLabel = $derived(isBranch ? 'Branch summary' : message.role === 'user' ? 'You' : 'Narrator');
	const canResend = $derived(message.role === 'user' && !isBranch);
	const bodyHtml = $derived(formatChatHtml(message.content || ''));

	$effect(() => {
		if (editing && editArea) {
			editText = message.content || '';
			editArea.focus();
			editArea.setSelectionRange(editArea.value.length, editArea.value.length);
			autosize();
		}
	});

	function autosize(): void {
		if (!editArea) return;
		editArea.style.height = 'auto';
		editArea.style.height = Math.min(editArea.scrollHeight, window.innerHeight * 0.6) + 'px';
	}

	function readEditContent(): string | null {
		const content = editText.trim();
		if (!content) {
			toast('Text cannot be empty', 'err');
			return null;
		}
		return content;
	}

	function saveEdit(): void {
		const content = readEditContent();
		if (content === null) return;
		if (content === message.content) {
			onCancelEdit();
			return;
		}
		onSaveEdit(index, content);
	}

	function resendEdit(): void {
		const content = readEditContent();
		if (content === null) return;
		onResendEdit(index, content);
	}

	function editKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			onCancelEdit();
		} else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			if (event.shiftKey && canResend) resendEdit();
			else saveEdit();
		}
	}
</script>

<div class="msg {roleClass}" class:has-media={attachments.length > 0} class:editing>
	{#if isBranch}
		<div class="branch-label">New branch (summary)</div>
	{/if}
	<div class="message-header">
		<span class="message-avatar" aria-hidden="true">
			{#if isBranch}
				<svg viewBox="0 0 24 24">
					<path d="M7 3.5h7l3 3V20H7z" />
					<path d="M14 3.5V7h3M9.5 11h5M9.5 14h5M9.5 17h3.5" />
				</svg>
			{:else if message.role === 'user'}
				<svg viewBox="0 0 24 24">
					<circle cx="12" cy="8" r="3.25" />
					<path d="M5.5 19c.75-3.9 3-5.85 6.5-5.85s5.75 1.95 6.5 5.85" />
				</svg>
			{:else}
				<svg viewBox="0 0 24 24">
					<path d="m12 3 1.55 5.45L19 10l-5.45 1.55L12 17l-1.55-5.45L5 10l5.45-1.55z" />
					<path d="m18.5 15 .65 2.35 2.35.65-2.35.65L18.5 21l-.65-2.35L15.5 18l2.35-.65z" />
				</svg>
			{/if}
		</span>
		<span class="who">{whoLabel}</span>
	</div>

	<div class="msg-body">
		{#if editing}
			<textarea
				class="msg-edit"
				bind:this={editArea}
				bind:value={editText}
				oninput={autosize}
				onkeydown={editKeydown}
				rows={Math.min(24, Math.max(4, (message.content || '').split('\n').length + 2))}
			></textarea>
		{:else}
			{@html bodyHtml}
		{/if}
	</div>

	{#if !editing && message.translation_ru}
		<div class="translation">{message.translation_ru}</div>
	{/if}

	{#if attachments.length}
		<div class="media-grid">
			{#each attachments as media (media.id)}
				<div class="message-attachment {media.kind}" title={media.source_text || ''}>
					<button
						type="button"
						class="attachment-preview"
						aria-label="Enlarge image"
						disabled={busy}
						onclick={(event) => onOpenViewer(media, event.currentTarget)}
					>
						<img
							class="message-image"
							src="/images/{encodeURIComponent(media.file)}"
							alt="Story scene"
							loading="lazy"
							decoding="async"
						/>
					</button>
					<div class="attachment-controls overlay">
						<button
							type="button"
							class="attachment-expand"
							title="Enlarge"
							aria-label="Enlarge attachment"
							disabled={busy}
							onclick={(event) => onOpenViewer(media, event.currentTarget)}
						>⛶</button>
						<button
							type="button"
							class="attachment-delete"
							title="Delete attachment"
							aria-label="Delete attachment"
							disabled={busy}
							onclick={() => onDeleteMedia(media.id)}
						>
							<img src="/icons/delete.svg" alt="" />
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	<div class="actions">
		{#if editing}
			<button type="button" class="edit-save" disabled={busy} onclick={saveEdit}>Save</button>
			{#if canResend}
				<button
					type="button"
					class="edit-resend"
					disabled={busy}
					title="Save the edit, delete later turns, and get a new response"
					onclick={resendEdit}
				>Save and resend</button>
			{/if}
			<button type="button" class="ghost" disabled={busy} onclick={onCancelEdit}>Cancel</button>
		{:else}
			<button
				type="button"
				class="icon-btn"
				title="Edit"
				aria-label="Edit message"
				disabled={busy}
				onclick={() => onStartEdit(index)}
			><span aria-hidden="true">✎</span></button>
			<button
				type="button"
				class="icon-btn danger-action"
				title="Delete"
				aria-label="Delete message and later history"
				disabled={busy}
				onclick={() => onDelete(index)}
			><span aria-hidden="true">🗑</span></button>
			{#if !isBranch && isLast && message.role === 'assistant'}
				<button
					type="button"
					class="icon-btn"
					title="Regenerate"
					aria-label="Regenerate narrator response"
					disabled={busy}
					onclick={() => onRegenerate(index)}
				><span aria-hidden="true">↻</span></button>
			{/if}
			{#if !isBranch && message.role === 'assistant'}
				<button type="button" disabled={busy} onclick={() => onTranslate(index)}>
					{message.translation_ru ? 'Update translation' : 'Translate'}
				</button>
				<button type="button" disabled={busy} onclick={() => onOpenMedia(index)}>Image</button>
			{/if}
		{/if}
	</div>
</div>
