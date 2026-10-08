<script lang="ts">
	import ModalFrame from './ModalFrame.svelte';
	import { MAX_WORLD_DESCRIPTION_CHARS, descriptionUsage } from '$lib/descriptions';

	let {
		open,
		busy,
		world,
		onClose,
		onSave
	}: {
		open: boolean;
		busy: boolean;
		world: string;
		onClose: () => void;
		onSave: (content: string) => void;
	} = $props();

	let content = $state('');
	let saveAttempted = $state(false);

	$effect(() => {
		if (open) {
			content = world;
			saveAttempted = false;
		}
	});

	const usage = $derived(descriptionUsage(content, MAX_WORLD_DESCRIPTION_CHARS));
	const limitError = $derived(saveAttempted && usage.over);

	function save(): void {
		if (busy) return;
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
	id="worldModal"
	label="World description"
	title="World"
	subtitle="Optional. Leave empty to remove the world description from AI context."
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
		<button type="button" disabled={busy} onclick={save}>Save</button>
	{/snippet}
</ModalFrame>
