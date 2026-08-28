<script lang="ts">
	import ModalFrame from './ModalFrame.svelte';

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
	subtitle="The active player character. Avoid changing the character's name mid-story."
	{onClose}
>
	{#snippet children()}
		<label>
			<span>Player character</span>
			<textarea
				data-modal-autofocus
				rows="16"
				maxlength="10000"
				bind:value={content}
			></textarea>
		</label>
		<div class="character-guidance">
			<p>
				Always keep the <code># PC (Player character)</code> heading. It identifies this character as the
				player-controlled protagonist whose actions and perspective anchor the story.
			</p>
			<p>
				Power-user trick: the current prompt format also lets you append a <code># World Description</code>
				section below the character. Everything here is included in each relevant AI request, so keep it
				concise.
			</p>
		</div>
		<span class="field-note character-storage-note"
			>Saved to your local, Git-ignored prompts.local.yaml and applied without restarting.</span
		>
	{/snippet}
	{#snippet footer()}
		<button type="button" disabled={!canSave} onclick={() => onSave(content)}>Save</button>
	{/snippet}
</ModalFrame>
