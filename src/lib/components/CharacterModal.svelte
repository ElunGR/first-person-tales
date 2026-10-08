<script lang="ts">
	import ModalFrame from './ModalFrame.svelte';
	import { MAX_CHARACTER_DESCRIPTION_CHARS, descriptionUsage } from '$lib/descriptions';

	let {
		open,
		busy,
		character,
		onClose,
		onSave
	}: {
		open: boolean;
		busy: boolean;
		character: string;
		onClose: () => void;
		onSave: (content: string) => void;
	} = $props();

	let content = $state('');
	let saveAttempted = $state(false);

	$effect(() => {
		if (open) {
			content = character;
			saveAttempted = false;
		}
	});

	const usage = $derived(descriptionUsage(content, MAX_CHARACTER_DESCRIPTION_CHARS));
	const canSave = $derived(content.trim().length > 0 && !busy);
	const limitError = $derived(saveAttempted && usage.over);

	function save(): void {
		if (!canSave) return;
		if (usage.over) {
			saveAttempted = true;
			return;
		}
		saveAttempted = false;
		onSave(content);
	}
</script>

<ModalFrame
	{open}
	id="characterModal"
	label="Player character"
	title="Character"
	subtitle="Avoid changing the character mid-story."
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
		{/if}
	{/snippet}
	{#snippet footer()}
		<button type="button" disabled={!canSave} onclick={save}>Save</button>
	{/snippet}
</ModalFrame>
