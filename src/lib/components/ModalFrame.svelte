<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		open,
		id,
		label,
		title,
		subtitle = '',
		cardClass = '',
		onClose,
		children,
		footer
	}: {
		open: boolean;
		id: string;
		label: string;
		title: string;
		subtitle?: string;
		cardClass?: string;
		onClose: () => void;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	let card: HTMLDivElement | undefined = $state(undefined);
	let closeButton: HTMLButtonElement | undefined = $state(undefined);
	let returnFocus: HTMLElement | null = null;
	let wasOpen = false;

	$effect(() => {
		if (open && !wasOpen) {
			returnFocus = document.activeElement as HTMLElement | null;
			requestAnimationFrame(() => {
				const preferred = card?.querySelector<HTMLElement>('[data-modal-autofocus]');
				(preferred ?? closeButton)?.focus();
			});
		} else if (!open && wasOpen && returnFocus?.isConnected) {
			returnFocus.focus();
		}
		wasOpen = open;
	});

	function keydown(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			onClose();
			return;
		}
		if (event.key !== 'Tab' || !card) return;
		const focusable = [...card.querySelectorAll<HTMLElement>(
			'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
		)].filter((item) => !item.hasAttribute('hidden'));
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<div
	{id}
	class="modal"
	class:hidden={!open}
	role="dialog"
	aria-modal="true"
	aria-label={label}
	tabindex="-1"
	onkeydown={keydown}
>
	<div bind:this={card} class="modal-card {cardClass}">
		<header class="modal-head">
			<div>
				<h2 id="{id}-title">{title}</h2>
				{#if subtitle}<p class="modal-subtitle">{subtitle}</p>{/if}
			</div>
			<button bind:this={closeButton} class="ghost" type="button" onclick={onClose}>Close</button>
		</header>
		<div class="modal-body">
			{@render children()}
		</div>
		{#if footer}
			<footer class="modal-footer">
				{@render footer()}
			</footer>
		{/if}
	</div>
</div>
