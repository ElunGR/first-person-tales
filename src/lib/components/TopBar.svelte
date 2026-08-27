<script lang="ts">
	let {
		busy,
		onSettings,
		onCharacter,
		onNewGame,
		onExportJson,
		onExportMarkdown,
		onImport
	}: {
		busy: boolean;
		onSettings: () => void;
		onCharacter: () => void;
		onNewGame: () => void;
		onExportJson: () => void;
		onExportMarkdown: () => void;
		onImport: () => void;
	} = $props();

	let menuOpen = $state(false);
	let menuEl: HTMLDivElement | undefined = $state(undefined);

	function toggleMenu(): void {
		menuOpen = !menuOpen;
	}

	function closeMenu(returnFocus = false): void {
		if (!menuOpen) return;
		menuOpen = false;
		if (returnFocus) document.getElementById('btnMore')?.focus();
	}

	function menuItemKeydown(event: KeyboardEvent): void {
		if (!menuEl) return;
		const items = [...menuEl.querySelectorAll<HTMLButtonElement>('button')];
		const current = items.indexOf(event.currentTarget as HTMLButtonElement);
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
			items[(next + items.length) % items.length]?.focus();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			closeMenu(true);
		}
	}

	function moreKeydown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!menuOpen) toggleMenu();
			requestAnimationFrame(() => {
				const first = menuEl?.querySelector<HTMLButtonElement>('button');
				first?.focus();
			});
		}
	}

	function clickItem(action: () => void): void {
		closeMenu();
		action();
	}
</script>

<svelte:window
	onclick={(event) => {
		const target = event.target as HTMLElement;
		if (menuOpen && !menuEl?.contains(target) && target.id !== 'btnMore') closeMenu();
	}}
/>

<header class="topbar">
	<div class="brand">First Person Tales</div>
	<div class="topbar-actions">
		<div class="advanced-actions">
			<button
				id="btnMore"
				class="ghost"
				type="button"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				aria-controls="advancedMenu"
				disabled={busy}
				onclick={toggleMenu}
				onkeydown={moreKeydown}
			>Export / Import</button>
			{#if menuOpen}
				<div
					id="advancedMenu"
					bind:this={menuEl}
					class="advanced-menu"
					role="menu"
					aria-label="Export and import"
					tabindex="-1"
					onkeydown={menuItemKeydown}
				>
					<button class="ghost" type="button" role="menuitem" onclick={() => clickItem(onExportJson)}
						>Export JSON</button>
					<button class="ghost" type="button" role="menuitem" onclick={() => clickItem(onExportMarkdown)}
						>Export Markdown</button>
					<button class="ghost" type="button" role="menuitem" onclick={() => clickItem(onImport)}>Import</button>
				</div>
			{/if}
		</div>
		<button class="ghost" type="button" disabled={busy} onclick={onSettings}>Settings</button>
		<button class="ghost" type="button" disabled={busy} onclick={onCharacter}>Character</button>
		<button class="danger" type="button" disabled={busy} onclick={onNewGame}>New game</button>
	</div>
</header>
