<script lang="ts">
	import ModalFrame from './ModalFrame.svelte';

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

	$effect(() => {
		if (open) content = world;
	});
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
			<textarea
				data-modal-autofocus
				rows="16"
				maxlength="10000"
				bind:value={content}
			></textarea>
		</label>
		<span class="field-note system-heading-note"
			>First-level headings (<code>#</code>) are reserved for system sections and are saved as second-level
			headings (<code>##</code>).</span
		>
	{/snippet}
	{#snippet footer()}
		<button type="button" disabled={busy} onclick={() => onSave(content)}>Save</button>
	{/snippet}
</ModalFrame>
