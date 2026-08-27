<script lang="ts">
	import ModalFrame from './ModalFrame.svelte';
	let {
		open,
		busy,
		preparing,
		preparedText = $bindable(''),
		onClose,
		onPrepare,
		onGenerate
	}: {
		open: boolean;
		busy: boolean;
		preparing: boolean;
		preparedText: string;
		onClose: () => void;
		onPrepare: (instruction: string) => void;
		onGenerate: (text: string) => void;
	} = $props();

	let instruction = $state('');

	$effect(() => {
		if (open) {
			instruction = '';
			preparedText = '';
		}
	});

	const canGenerate = $derived(preparedText.trim().length > 0 && !busy);
	const canPrepare = $derived(instruction.trim().length > 0 && !busy && !preparing);
</script>

<ModalFrame {open} id="mediaModal" label="Scene media" title="Image" cardClass="media-card" {onClose}>
	{#snippet children()}
		<label><span>What should be drawn from the scene?</span>
			<input data-modal-autofocus type="text" maxlength="1000" placeholder="For example: a glowing stone" bind:value={instruction} />
		</label>
		<label><span>Image prompt</span>
			<textarea rows="10" maxlength="10000" bind:value={preparedText}></textarea>
		</label>
	{/snippet}
	{#snippet footer()}
		<div class="row right modal-action-group">
			<button class="ghost" type="button" disabled={!canPrepare} onclick={() => onPrepare(instruction)}>
				{preparing ? 'Preparing…' : 'Prepare prompt'}
			</button>
			<button type="button" disabled={!canGenerate} onclick={() => onGenerate(preparedText)}>Generate</button>
		</div>
	{/snippet}
</ModalFrame>
