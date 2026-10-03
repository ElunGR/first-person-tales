<script lang="ts">
	import ModalFrame from './ModalFrame.svelte';
	import { MAX_DESCRIPTION_CHARS } from '$lib/descriptions';

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

	$effect(() => {
		if (open) content = character;
	});

	const canSave = $derived(content.trim().length > 0 && !busy);
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
			<textarea
				data-modal-autofocus
				rows="16"
				maxlength={MAX_DESCRIPTION_CHARS}
				bind:value={content}
			></textarea>
		</label>
		<span class="field-note system-heading-note"
			>First-level headings (<code>#</code>) are reserved for system sections and are saved as second-level
			headings (<code>##</code>).</span
		>
	{/snippet}
	{#snippet footer()}
		<button type="button" disabled={!canSave} onclick={() => onSave(content)}>Save</button>
	{/snippet}
</ModalFrame>
