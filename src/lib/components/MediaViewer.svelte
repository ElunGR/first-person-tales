<script lang="ts">
	import type { MediaRecord } from '$lib/frontend/types';

	let {
		open,
		media,
		returnFocus,
		onClose
	}: {
		open: boolean;
		media: MediaRecord | null;
		returnFocus: HTMLElement | null;
		onClose: () => void;
	} = $props();

	let closeButton: HTMLButtonElement | undefined = $state(undefined);

	$effect(() => {
		if (open && closeButton) closeButton.focus();
		if (!open && returnFocus?.isConnected) returnFocus.focus();
	});
</script>

<div
	id="mediaViewerModal"
	class="modal media-viewer"
	class:hidden={!open}
	role="dialog"
	aria-modal="true"
	aria-label="Attachment viewer"
	tabindex="-1"
	onclick={(event) => {
		if (event.target === event.currentTarget) onClose();
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') onClose();
	}}
>
	<div class="media-viewer-card">
		<button bind:this={closeButton} class="ghost media-viewer-close" type="button" onclick={onClose}
			>Close</button>
		<div id="mediaViewerContent" class="media-viewer-content">
			{#if open && media}
				<img src="/images/{encodeURIComponent(media.file)}" alt="Full-size scene" />
			{/if}
		</div>
	</div>
</div>
