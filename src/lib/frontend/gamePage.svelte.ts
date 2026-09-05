/** Reactive controller for the local single-player page. */
import type { SettingsFormValues } from '$lib/components/SettingsModal.svelte';
import { api, isAbortError } from './api';
import { mergeReused, sameMedia, sameMessage } from './state';
import { toast } from './toast.svelte';
import type { MediaRecord, Message, ModelCatalogs, SettingsPayload, StatePayload } from './types';

const CONTEXT_REMINDER_TOKENS = 35000;
const TOKEN_NUMBER = new Intl.NumberFormat('en-US');

interface StoryResultPayload {
	message?: Message;
	state?: StatePayload;
}

export interface ContextLabel {
	text: string;
	warning: boolean;
	title: string;
}

export class GamePageController {
	messages = $state<Message[]>([]);
	media = $state<MediaRecord[]>([]);
	canUndoSummary = $state(false);
	lastTokens = $state<number | null>(null);
	recoveryMessage = $state<string | null>(null);

	busy = $state(false);
	statusText = $state('Ready');
	abortController = $state<AbortController | null>(null);
	operationId = $state<string | null>(null);
	canStopCurrentOperation = $state(false);

	settings = $state<SettingsPayload | null>(null);
	modelCatalogs = $state<ModelCatalogs>({});
	modelStatus = $state('');

	editingMessageId = $state<string | null>(null);
	inputDraft = $state('');
	settingsOpen = $state(false);
	characterOpen = $state(false);
	characterText = $state('');
	worldOpen = $state(false);
	worldText = $state('');
	mediaOpen = $state(false);
	mediaTargetIndex = $state<number | null>(null);
	mediaPreparing = $state(false);
	mediaPreparedText = $state('');

	mediaByMessage = $derived.by(() => {
		const map = new Map<string, MediaRecord[]>();
		for (const item of this.media) {
			const group = map.get(item.message_id) || [];
			group.push(item);
			map.set(item.message_id, group);
		}
		return map;
	});

	contextLabel: ContextLabel = $derived.by(() => {
		const latest = this.messages[this.messages.length - 1];
		const justSummarized = !!latest && latest.kind === 'branch';
		const shouldRemind =
			this.lastTokens !== null && this.lastTokens >= CONTEXT_REMINDER_TOKENS && !justSummarized;
		return {
			text:
				this.lastTokens === null
					? 'Last request context: —'
					: `Last request context: ${TOKEN_NUMBER.format(this.lastTokens)} tokens` +
						(shouldRemind ? ' · summarization recommended' : ''),
			warning: shouldRemind,
			title: shouldRemind
				? `The ${TOKEN_NUMBER.format(CONTEXT_REMINDER_TOKENS)}-token threshold was reached. Summarization is manual only.`
				: 'Exact prompt_tokens from the latest story request'
		};
	});

	get showStop(): boolean {
		return this.busy && this.abortController !== null && this.canStopCurrentOperation;
	}

	applyState(data: Partial<StatePayload>): void {
		this.messages = mergeReused(this.messages, data.messages || [], sameMessage);
		if (this.editingMessageId && !this.messages.some((message) => message.id === this.editingMessageId)) {
			this.editingMessageId = null;
		}
		this.media = mergeReused(this.media, data.media || [], sameMedia);
		this.canUndoSummary = !!data.can_undo_summary;
		this.lastTokens =
			Number.isInteger(data.last_narrator_prompt_tokens) && (data.last_narrator_prompt_tokens ?? -1) >= 0
				? data.last_narrator_prompt_tokens!
				: null;
		this.recoveryMessage = typeof data.recovery_message === 'string' ? data.recovery_message : null;
	}

	async initialize(): Promise<void> {
		await Promise.all([this.loadState(), this.loadSettings()]);
	}

	private async loadState(): Promise<void> {
		this.applyState(await api<StatePayload>('/state'));
	}

	private async loadSettings(): Promise<void> {
		this.settings = await api<SettingsPayload>('/settings');
	}

	async openSettings(): Promise<void> {
		if (this.busy) return;
		this.setBusy(true, 'Loading settings…');
		this.settings = null;
		try {
			await this.loadSettings();
			this.settingsOpen = true;
		} catch (err) {
			this.settingsOpen = false;
			toast(`Could not load settings: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}

	private async applyEmbeddedState(result: StoryResultPayload | null): Promise<void> {
		if (result?.state) this.applyState(result.state);
		else await this.loadState();
	}

	private async reconcileState(): Promise<boolean> {
		try {
			await this.loadState();
			return true;
		} catch {
			return false;
		}
	}

	private setBusy(value: boolean, text = ''): void {
		this.busy = value;
		this.statusText = value ? text : 'Ready';
	}

	private beginAbortable(text: string, canStop = true): AbortController {
		const controller = new AbortController();
		this.abortController = controller;
		this.canStopCurrentOperation = canStop;
		this.operationId =
			typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
				? crypto.randomUUID()
				: `${Date.now()}-${Math.random()}`;
		this.setBusy(true, text);
		return controller;
	}

	private endAbortable(controller: AbortController): void {
		if (this.abortController !== controller) return;
		this.abortController = null;
		this.canStopCurrentOperation = false;
		this.operationId = null;
		this.setBusy(false);
	}

	stopGeneration(): void {
		const controller = this.abortController;
		const operationId = this.operationId;
		if (!controller) return;
		if (operationId) {
			fetch(`/operations/${encodeURIComponent(operationId)}`, { method: 'DELETE' }).catch(() => {});
		}
		controller.abort();
	}

	startEdit(index: number): void {
		if (!this.busy) this.editingMessageId = this.messages[index]?.id ?? null;
	}

	/** How many messages a rewind from `index` would discard, `index` excluded. */
	private messagesAfter(index: number): number {
		if (index < 0 || index >= this.messages.length) return 0;
		return this.messages.length - index - 1;
	}

	/** "3 messages" / "1 message"; keeps confirmation wording consistent. */
	private countLabel(count: number): string {
		return `${count} ${count === 1 ? 'message' : 'messages'}`;
	}

	async sendCurrent(): Promise<void> {
		const raw = this.inputDraft.trim();
		if (!raw || this.busy) return;
		const controller = this.beginAbortable('Narrator is thinking…');
		try {
			const result = await api<StoryResultPayload>('/chat', {
				method: 'POST',
				body: { content: raw },
				signal: controller.signal,
				operationId: this.operationId
			});
			this.inputDraft = '';
			await this.applyEmbeddedState(result);
		} catch (err) {
			await this.reconcileState();
			if (isAbortError(err)) toast('Generation stopped', 'err');
			else toast(`Chat failed: ${(err as Error).message}`, 'err');
		} finally {
			this.endAbortable(controller);
		}
	}

	async improveDraft(): Promise<void> {
		const text = this.inputDraft.trim();
		if (!text || this.busy) return;
		const controller = this.beginAbortable('Improving text…');
		try {
			const data = await api<{ text: string }>('/improve', {
				method: 'POST', body: { text }, signal: controller.signal, operationId: this.operationId
			});
			this.inputDraft = data.text;
			toast('Draft improved');
		} catch (err) {
			if (isAbortError(err)) toast('Improvement stopped', 'err');
			else toast(`Could not improve text: ${(err as Error).message}`, 'err');
		} finally {
			this.endAbortable(controller);
		}
	}

	async saveEdit(index: number, content: string): Promise<void> {
		if (this.busy) return;
		this.setBusy(true, 'Saving…');
		try {
			const result = await api<StoryResultPayload>(`/messages/${index}`, {
				method: 'PUT', body: { content, message_id: this.messages[index]?.id ?? null }
			});
			this.editingMessageId = null;
			await this.applyEmbeddedState(result);
			toast('Message updated');
		} catch (err) {
			toast(`Could not save edit: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}

	async resendEdit(index: number, content: string): Promise<void> {
		if (this.busy) return;
		const message = this.messages[index];
		// Resend always rewinds the story to this turn, whether or not the text
		// changed, so the count decides the prompt - never the edited text.
		const discarded = this.messagesAfter(index);
		if (discarded > 0) {
			if (
				!confirm(
					`Save the edit and resend this turn? The ${this.countLabel(discarded)} after it, ` +
						'and any attached images, will be deleted.'
				)
			) {
				return;
			}
		}
		const controller = this.beginAbortable('Resending turn…');
		try {
			const result = await api<StoryResultPayload>(`/messages/${index}/resend`, {
				method: 'POST',
				body: { content, message_id: message?.id ?? null },
				signal: controller.signal,
				operationId: this.operationId
			});
			this.editingMessageId = null;
			await this.applyEmbeddedState(result);
			toast('Turn resent');
		} catch (err) {
			if (isAbortError(err)) toast('Generation stopped', 'err');
			else toast(`Could not resend turn: ${(err as Error).message}`, 'err');
			await this.reconcileState();
		} finally {
			this.endAbortable(controller);
		}
	}

	async deleteMessage(index: number): Promise<void> {
		if (this.busy) return;
		const following = this.messagesAfter(index);
		const question =
			following > 0
				? `Delete this message and the ${this.countLabel(following)} after it?`
				: 'Delete this message?';
		if (!confirm(question)) return;
		this.setBusy(true, 'Deleting…');
		try {
			this.applyState(await api<StatePayload>(`/messages/${index}`, {
				method: 'DELETE', body: { message_id: this.messages[index]?.id ?? null }
			}));
			toast('Messages deleted');
		} catch (err) {
			toast(`Could not delete messages: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}

	async regenerateMessage(index: number): Promise<void> {
		if (this.busy) return;
		const controller = this.beginAbortable('Regenerating response…');
		try {
			const result = await api<StoryResultPayload>(`/messages/${index}/regenerate`, {
				method: 'POST',
				body: { message_id: this.messages[index]?.id ?? null },
				signal: controller.signal,
				operationId: this.operationId
			});
			await this.applyEmbeddedState(result);
			toast('Response regenerated');
		} catch (err) {
			if (isAbortError(err)) toast('Generation stopped', 'err');
			else toast(`Could not regenerate response: ${(err as Error).message}`, 'err');
			await this.reconcileState();
		} finally {
			this.endAbortable(controller);
		}
	}

	async translateMessage(index: number): Promise<void> {
		if (this.busy) return;
		const message = this.messages[index];
		if (!message || message.role !== 'assistant') return;
		const controller = this.beginAbortable(`Translating message ${index + 1}…`);
		try {
			const { translation } = await api<{ translation: string }>('/translate', {
				method: 'POST', body: { text: message.content }, signal: controller.signal, operationId: this.operationId
			});
			const result = await api<StoryResultPayload>(`/messages/${index}/translation`, {
				method: 'POST', body: { translation, message_id: message.id }, signal: controller.signal
			});
			await this.applyEmbeddedState(result);
		} catch (err) {
			if (isAbortError(err)) toast('Translation stopped', 'err');
			else toast(`Could not translate: ${(err as Error).message}`, 'err');
			await this.reconcileState();
		} finally {
			this.endAbortable(controller);
		}
	}

	async summarize(): Promise<void> {
		if (this.busy || this.messages.length === 0) return;
		const controller = this.beginAbortable('Summarizing history…');
		try {
			this.applyState(await api<StatePayload>('/resummary', {
				method: 'POST', body: {}, signal: controller.signal, operationId: this.operationId
			}));
			toast('History summarized');
		} catch (err) {
			if (isAbortError(err)) toast('Summarization stopped', 'err');
			else toast(`Could not summarize: ${(err as Error).message}`, 'err');
			await this.reconcileState();
		} finally {
			this.endAbortable(controller);
		}
	}

	async undoSummary(): Promise<void> {
		if (this.busy || !this.canUndoSummary) return;
		const latestSummaryIndex = this.messages.findLastIndex((message) => message.kind === 'branch');
		const messagesAfterSummary = latestSummaryIndex < 0 ? 0 : this.messages.length - latestSummaryIndex - 1;
		if (
			messagesAfterSummary > 0 &&
			!confirm(
				`Undo this summary and delete ${messagesAfterSummary} ${messagesAfterSummary === 1 ? 'message' : 'messages'} written after it?`
			)
		) {
			return;
		}
		this.setBusy(true, 'Undoing summary…');
		try {
			this.applyState(await api<StatePayload>('/resummary/undo', { method: 'POST', body: {} }));
			toast('Summary undone');
		} catch (err) {
			toast(`Could not undo summary: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}

	async newGame(): Promise<void> {
		if (this.busy || !confirm('Start a new game? The current history and images will be deleted.')) return;
		this.setBusy(true, 'Resetting…');
		try {
			this.applyState(await api<StatePayload>('/reset', { method: 'POST' }));
			toast('New game started');
		} catch (err) {
			toast(`Could not start a new game: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}

	async downloadHistory(format: 'json' | 'markdown'): Promise<void> {
		const response = await fetch(`/export?format=${encodeURIComponent(format)}`);
		if (!response.ok) throw new Error('Could not export history');
		const blob = await response.blob();
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = format === 'markdown' ? 'history.md' : 'history.json';
		anchor.click();
		URL.revokeObjectURL(url);
	}

	async importHistory(file: File): Promise<void> {
		const raw = JSON.parse(await file.text());
		if (!confirm('Import will replace the current history. A backup will be created first. Continue?')) return;
		this.applyState(await api<StatePayload>('/import', { method: 'POST', body: { confirm: true, data: raw } }));
		toast('History imported');
	}

	private async persistSettings(values: SettingsFormValues, closeAfter = true, notify = true): Promise<void> {
		const payload = {
			active_provider: 'venice',
			narrator_temperature: values.narrator_temperature,
			narrator_top_p: values.narrator_top_p,
			narrator_frequency_penalty: values.narrator_frequency_penalty,
			narrator_presence_penalty: values.narrator_presence_penalty,
			narrator_max_tokens: values.narrator_max_tokens,
			translation_language: values.translation_language,
			providers: { venice: { text_model: values.text_model, image_model: values.image_model } },
			api_key: values.api_key || null
		};
		this.settings = await api<SettingsPayload>('/settings', { method: 'PUT', body: payload });
		if (closeAfter) this.settingsOpen = false;
		if (notify) toast('Settings saved');
	}

	saveSettings(values: SettingsFormValues): void {
		this.persistSettings(values).catch((err) => toast(`Could not save settings: ${(err as Error).message}`, 'err'));
	}

	async openCharacter(): Promise<void> {
		if (this.busy) return;
		this.characterOpen = false;
		this.setBusy(true, 'Loading character…');
		try {
			const data = await api<{ content: string }>('/character');
			this.characterText = data.content;
			this.characterOpen = true;
		} catch (err) {
			this.characterOpen = false;
			toast(`Could not load character: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}

	async saveCharacter(content: string): Promise<void> {
		if (this.busy) return;
		this.setBusy(true, 'Saving character…');
		try {
			const data = await api<{ content: string }>('/character', { method: 'PUT', body: { content } });
			this.characterText = data.content;
			this.characterOpen = false;
			toast('Character saved');
		} catch (err) {
			toast(`Could not save character: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}

	async openWorld(): Promise<void> {
		if (this.busy) return;
		this.worldOpen = false;
		this.setBusy(true, 'Loading world…');
		try {
			const data = await api<{ content: string }>('/world');
			this.worldText = data.content;
			this.worldOpen = true;
		} catch (err) {
			this.worldOpen = false;
			toast(`Could not load world: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}

	async saveWorld(content: string): Promise<void> {
		if (this.busy) return;
		this.setBusy(true, 'Saving world…');
		try {
			const data = await api<{ content: string }>('/world', { method: 'PUT', body: { content } });
			this.worldText = data.content;
			this.worldOpen = false;
			toast(data.content ? 'World saved' : 'World description removed');
		} catch (err) {
			toast(`Could not save world: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}

	refreshModels(values: SettingsFormValues): void {
		if (!this.settings || this.busy) return;
		this.refreshModelCatalog(values).catch((err) =>
			toast(`Could not refresh models: ${(err as Error).message}`, 'err')
		);
	}

	private async refreshModelCatalog(values: SettingsFormValues): Promise<void> {
		this.setBusy(true, 'Refreshing models…');
		try {
			await this.persistSettings(values, false, false);
			const data = await api<{ models?: ModelCatalogs; errors?: Record<string, string> }>(
				'/settings/models/refresh?provider=venice', { method: 'POST', body: {} }
			);
			this.modelCatalogs = data.models || {};
			const failed = Object.keys(data.errors || {});
			this.modelStatus = failed.length ? `Unavailable: ${failed.join(', ')}` : 'Lists refreshed';
		} finally {
			this.setBusy(false);
		}
	}

	openMedia(index: number): void {
		if (!this.busy) {
			this.mediaTargetIndex = index;
			this.mediaOpen = true;
		}
	}

	closeMedia(): void {
		this.mediaOpen = false;
		this.mediaTargetIndex = null;
	}

	async prepareMedia(instruction: string): Promise<void> {
		if (this.busy || this.mediaTargetIndex === null || !instruction.trim()) return;
		const controller = this.beginAbortable('Preparing prompt…');
		this.mediaPreparing = true;
		try {
			const data = await api<{ text: string }>(`/messages/${this.mediaTargetIndex}/media/prepare`, {
				method: 'POST',
				body: { kind: 'image', instruction, message_id: this.messages[this.mediaTargetIndex]?.id ?? null },
				signal: controller.signal,
				operationId: this.operationId
			});
			this.mediaPreparedText = data.text;
		} catch (err) {
			if (isAbortError(err)) toast('Preparation stopped', 'err');
			else toast(`Could not prepare prompt: ${(err as Error).message}`, 'err');
		} finally {
			this.mediaPreparing = false;
			this.endAbortable(controller);
		}
	}

	async generateMedia(text: string): Promise<void> {
		if (this.busy || this.mediaTargetIndex === null) return;
		const targetIndex = this.mediaTargetIndex;
		const controller = this.beginAbortable('Generating image…');
		try {
			this.applyState(await api<StatePayload>(`/messages/${targetIndex}/media`, {
				method: 'POST',
				body: { kind: 'image', text, message_id: this.messages[targetIndex]?.id ?? null },
				signal: controller.signal,
				operationId: this.operationId
			}));
			this.mediaOpen = false;
			toast('Image created');
		} catch (err) {
			if (isAbortError(err)) toast('Generation stopped', 'err');
			else toast(`Could not create image: ${(err as Error).message}`, 'err');
			await this.reconcileState();
		} finally {
			this.endAbortable(controller);
		}
	}

	async deleteMedia(mediaId: string): Promise<void> {
		if (this.busy) return;
		this.setBusy(true, 'Deleting attachment…');
		try {
			this.applyState(await api<StatePayload>(`/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' }));
		} catch (err) {
			toast(`Could not delete attachment: ${(err as Error).message}`, 'err');
		} finally {
			this.setBusy(false);
		}
	}
}
