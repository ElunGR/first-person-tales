<script lang="ts">
	import ModalFrame from './ModalFrame.svelte';
	import { MAX_WORLD_DESCRIPTION_CHARS, descriptionUsage } from '$lib/descriptions';

	let {
		open,
		busy,
		world,
		onClose,
		onSave,
		onExpand
	}: {
		open: boolean;
		busy: boolean;
		world: string;
		onClose: () => void;
		onSave: (content: string) => void;
		onExpand: (idea: string) => Promise<string | null>;
	} = $props();

	let content = $state('');
	let saveAttempted = $state(false);
	let expanding = $state(false);
	/** Editor text from before the last expansion; null when there is nothing to restore. */
	let undoContent = $state<string | null>(null);

	$effect(() => {
		if (open) {
			content = world;
			saveAttempted = false;
			expanding = false;
			undoContent = null;
		}
	});

	const usage = $derived(descriptionUsage(content, MAX_WORLD_DESCRIPTION_CHARS));
	const limitError = $derived(saveAttempted && usage.over);
	const canExpand = $derived(!busy && !expanding && content.trim().length > 0 && !usage.over);

	function save(): void {
		if (busy) return;
		if (usage.over) {
			saveAttempted = true;
			return;
		}
		saveAttempted = false;
		onSave(content);
	}

	/**
	 * One explicit paid request. The result replaces the editor text, never the
	 * saved world: the player reads it, may restore the previous text with Undo,
	 * and saves only by pressing Save. Asking first would only add a click: the
	 * editor itself is the safety net, and nothing is written to disk here.
	 */
	async function expand(): Promise<void> {
		if (!canExpand) return;
		const previous = content;
		expanding = true;
		try {
			const text = await onExpand(content);
			if (text !== null) {
				undoContent = previous;
				content = text;
				saveAttempted = false;
			}
		} finally {
			expanding = false;
		}
	}

	function undoExpand(): void {
		if (undoContent === null || busy || expanding) return;
		content = undoContent;
		undoContent = null;
		saveAttempted = false;
	}
</script>

<ModalFrame
	{open}
	id="worldModal"
	label="World description"
	title="World"
	subtitle="Optional. Leave empty to remove the world description from AI context. Expand idea writes a full description from a short seed; nothing is saved until you press Save."
	{onClose}
>
	{#snippet children()}
		<label>
			<span>Description</span>
			<div class="counter-field">
				<textarea data-modal-autofocus rows="16" bind:value={content}></textarea>
				<span class="char-counter" aria-hidden="true">{usage.count}/{usage.limit}</span>
			</div>
		</label>
		{#if limitError}
			<span class="field-note limit-error"
				>Too long: {usage.count} of {usage.limit} characters. Shorten the text, then save again.</span
			>
		{:else if expanding}
			<span class="field-note">Expanding the idea… this is one request; your text returns if you undo.</span>
		{:else if undoContent !== null}
			<span class="field-note">Expanded from your idea. Undo restores the text you had; Save writes this one.</span>
		{/if}
	{/snippet}
	{#snippet footer()}
		<div class="row right modal-action-group">
			<button class="ghost" type="button" disabled={!canExpand} onclick={expand}>
				{expanding ? 'Expanding…' : 'Expand idea'}
			</button>
			{#if undoContent !== null}
				<button class="ghost" type="button" disabled={busy || expanding} onclick={undoExpand}>Undo</button>
			{/if}
			<button type="button" disabled={busy} onclick={save}>Save</button>
		</div>
	{/snippet}
</ModalFrame>
