<script lang="ts">
	import { MessageSearchIndex } from '$lib/frontend/helpers';
	import type { ContextLabel } from '$lib/frontend/gamePage.svelte';
	import type { MediaRecord, Message } from '$lib/frontend/types';
	import MessageCard from './MessageCard.svelte';

	let {
		messages,
		mediaByMessage,
		recoveryMessage,
		busy,
		editingMessageId,
		statusText,
		contextLabel,
		showStop,
		canUndo,
		inputDraft = $bindable(''),
		onStartEdit,
		onCancelEdit,
		onSaveEdit,
		onResendEdit,
		onDelete,
		onRegenerate,
		onTranslate,
		onOpenMedia,
		onOpenViewer,
		onDeleteMedia,
		onImprove,
		onSummarize,
		onUndoSummary,
		onSend,
		onStop,
		onNewGame
	}: {
		messages: Message[];
		mediaByMessage: Map<string, MediaRecord[]>;
		recoveryMessage: string | null;
		busy: boolean;
		editingMessageId: string | null;
		statusText: string;
		contextLabel: ContextLabel;
		showStop: boolean;
		canUndo: boolean;
		inputDraft: string;
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
		onImprove: () => void;
		onSummarize: () => void;
		onUndoSummary: () => void;
		onSend: () => void;
		onStop: () => void;
		onNewGame: () => void;
	} = $props();

	const EMPTY_ATTACHMENTS: MediaRecord[] = [];
	const searchIndex = new MessageSearchIndex();
	let historySearch = $state('');
	let messagesBox: HTMLDivElement | undefined = $state(undefined);
	let wasAtBottom = true;

	const visibleMessages = $derived.by(() => {
		const query = historySearch.trim().toLocaleLowerCase();
		const items = messages.map((message, index) => ({ message, index }));
		return query ? items.filter(({ message }) => searchIndex.matches(message, query)) : items;
	});

	$effect(() => {
		const box = messagesBox;
		void messages.length;
		if (box && wasAtBottom) {
			requestAnimationFrame(() => {
				box.scrollTop = box.scrollHeight;
			});
		}
	});

	function messagesScroll(): void {
		if (!messagesBox) return;
		wasAtBottom = messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight < 80;
	}
</script>

<main class="layout">
	<section class="panel game" aria-label="Chat">
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="messages"
			aria-live="polite"
			bind:this={messagesBox}
			onscroll={messagesScroll}
			role="presentation"
		>
			{#if recoveryMessage}
				<section class="recovery-notice">
					<p>{recoveryMessage}</p>
					<button type="button" class="danger" onclick={onNewGame}>Start new game</button>
				</section>
			{:else if messages.length === 0}
				<section class="chat-empty">
					<h1>Start your story</h1>
					<p>Enter a first-person action below, or use <code>[OOC: …]</code> to guide the narrator.</p>
				</section>
			{:else}
				{#each visibleMessages as { message, index } (message.id ?? `idx-${index}`)}
					<MessageCard
						{message}
						{index}
						isLast={index === messages.length - 1}
						attachments={mediaByMessage.get(message.id ?? '') ?? EMPTY_ATTACHMENTS}
						{busy}
						editing={editingMessageId !== null && editingMessageId === message.id}
						onStartEdit={onStartEdit}
						onCancelEdit={onCancelEdit}
						onSaveEdit={onSaveEdit}
						onResendEdit={onResendEdit}
						onDelete={onDelete}
						onRegenerate={onRegenerate}
						onTranslate={onTranslate}
						onOpenMedia={onOpenMedia}
						onOpenViewer={onOpenViewer}
						onDeleteMedia={onDeleteMedia}
					/>
				{/each}
			{/if}
		</div>

		<label class="history-search hidden">
			<span>Search history</span>
			<input type="search" placeholder="Find in messages…" bind:value={historySearch} />
		</label>

		<div class="composer">
			<textarea
				placeholder="First-person action… [OOC: ...] for out-of-character requests."
				rows="3"
				bind:value={inputDraft}
				onkeydown={(event) => {
					if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
						event.preventDefault();
						onSend();
					}
				}}
			></textarea>
			<div class="composer-status" class:busy aria-live="polite" aria-busy={busy} role="status">
				<span class="status-indicator" aria-hidden="true"></span>
				<span>{statusText || 'Ready'}</span>
			</div>
			<div class="composer-actions">
				<div class="summarize-group" class:warning={contextLabel.warning}>
					<button
						class="summarize"
						type="button"
						disabled={busy || messages.length === 0}
						title="Replace the narrator's active context with a compact summary. The full history stays visible."
						onclick={onSummarize}>Summarize context</button
					>
					{#if canUndo}
						<button class="ghost" type="button" disabled={busy} onclick={onUndoSummary}>Undo summary</button>
					{/if}
					<span
						class="context-tokens"
						class:warning={contextLabel.warning}
						title={contextLabel.title}
					>{contextLabel.text}</span>
				</div>
				<div class="composer-primary-actions">
					<button class="ghost" type="button" disabled={busy} onclick={onImprove}>Improve</button>
					{#if !showStop}
						<button type="button" disabled={busy} onclick={onSend}>Send</button>
					{:else}
						<button class="danger" type="button" onclick={onStop}>Stop</button>
					{/if}
				</div>
			</div>
		</div>
	</section>
</main>
