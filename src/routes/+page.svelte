<script lang="ts">
	import ChatPanel from '$lib/components/ChatPanel.svelte';
	import CharacterModal from '$lib/components/CharacterModal.svelte';
	import MediaModal from '$lib/components/MediaModal.svelte';
	import MediaViewer from '$lib/components/MediaViewer.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import TopBar from '$lib/components/TopBar.svelte';
	import { GamePageController } from '$lib/frontend/gamePage.svelte';
	import { toast } from '$lib/frontend/toast.svelte';
	import type { MediaRecord } from '$lib/frontend/types';
	import { onMount } from 'svelte';

	const game = new GamePageController();
	let importInput: HTMLInputElement | undefined = $state(undefined);
	let viewerOpen = $state(false);
	let viewerMedia = $state<MediaRecord | null>(null);
	let viewerReturnFocus = $state<HTMLElement | null>(null);

	function openViewer(item: MediaRecord, trigger: HTMLElement): void {
		viewerMedia = item;
		viewerReturnFocus = trigger || (document.activeElement as HTMLElement | null);
		viewerOpen = true;
	}

	function closeViewer(): void {
		viewerOpen = false;
		viewerMedia = null;
	}

	function pageKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Escape') return;
		if (viewerOpen) closeViewer();
		else if (game.settingsOpen) game.settingsOpen = false;
		else if (game.characterOpen) game.characterOpen = false;
		else if (game.mediaOpen) game.closeMedia();
	}

	onMount(() => {
		game.initialize().catch((err) => toast(`Could not load game: ${(err as Error).message}`, 'err'));
	});
</script>

<svelte:window onkeydown={pageKeydown} />

<TopBar
	busy={game.busy}
	onSettings={() => (game.settingsOpen = true)}
	onCharacter={() => game.openCharacter()}
	onNewGame={() => game.newGame()}
	onExportJson={() => game.downloadHistory('json').catch((err) => toast((err as Error).message, 'err'))}
	onExportMarkdown={() => game.downloadHistory('markdown').catch((err) => toast((err as Error).message, 'err'))}
	onImport={() => {
		if (!game.busy) importInput?.click();
	}}
/>

<ChatPanel
	messages={game.messages}
	mediaByMessage={game.mediaByMessage}
	recoveryMessage={game.recoveryMessage}
	busy={game.busy}
	editingMessageId={game.editingMessageId}
	statusText={game.statusText}
	contextLabel={game.contextLabel}
	showStop={game.showStop}
	canUndo={game.canUndoSummary}
	bind:inputDraft={game.inputDraft}
	onStartEdit={(index) => game.startEdit(index)}
	onCancelEdit={() => (game.editingMessageId = null)}
	onSaveEdit={(index, content) => game.saveEdit(index, content)}
	onResendEdit={(index, content) => game.resendEdit(index, content)}
	onDelete={(index) => game.deleteMessage(index)}
	onRegenerate={(index) => game.regenerateMessage(index)}
	onTranslate={(index) => game.translateMessage(index)}
	onOpenMedia={(index) => game.openMedia(index)}
	onOpenViewer={openViewer}
	onDeleteMedia={(mediaId) => game.deleteMedia(mediaId)}
	onImprove={() => game.improveDraft()}
	onSummarize={() => game.summarize()}
	onUndoSummary={() => game.undoSummary()}
	onSend={() => game.sendCurrent()}
	onStop={() => game.stopGeneration()}
	onNewGame={() => game.newGame()}
/>

<SettingsModal
	open={game.settingsOpen}
	settings={game.settings}
	catalogs={game.modelCatalogs}
	modelStatus={game.modelStatus}
	busy={game.busy}
	onClose={() => (game.settingsOpen = false)}
	onSave={(values) => game.saveSettings(values)}
	onRefreshModels={(values) => game.refreshModels(values)}
/>

<CharacterModal
	open={game.characterOpen}
	busy={game.busy}
	character={game.characterText}
	onClose={() => (game.characterOpen = false)}
	onSave={(content) => game.saveCharacter(content)}
/>

<MediaModal
	open={game.mediaOpen}
	busy={game.busy}
	preparing={game.mediaPreparing}
	bind:preparedText={game.mediaPreparedText}
	onClose={() => game.closeMedia()}
	onPrepare={(instruction) => game.prepareMedia(instruction)}
	onGenerate={(text) => game.generateMedia(text)}
/>

<MediaViewer open={viewerOpen} media={viewerMedia} returnFocus={viewerReturnFocus} onClose={closeViewer} />

<input
	bind:this={importInput}
	type="file"
	accept="application/json"
	hidden
	onchange={async (event) => {
		const file = event.currentTarget.files?.[0];
		event.currentTarget.value = '';
		if (!file) return;
		try {
			await game.importHistory(file);
		} catch (err) {
			toast(`Could not import history: ${(err as Error).message}`, 'err');
		}
	}}
/>

<Toast />
