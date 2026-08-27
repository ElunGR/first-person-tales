<script lang="ts">
	import ModalFrame from './ModalFrame.svelte';
	import type { ModelCatalogs, SettingsPayload } from '$lib/frontend/types';
	import {
		DEFAULT_TRANSLATION_LANGUAGE,
		TRANSLATION_LANGUAGES,
		type TranslationLanguage
	} from '$lib/translationLanguages';

	export interface SettingsFormValues {
		narrator_temperature: number;
		narrator_top_p: number;
		narrator_frequency_penalty: number;
		narrator_presence_penalty: number;
		narrator_max_tokens: number;
		translation_language: TranslationLanguage;
		text_model: string;
		image_model: string;
		api_key: string;
	}

	let {
		open,
		settings,
		catalogs,
		modelStatus,
		busy,
		onClose,
		onSave,
		onRefreshModels
	}: {
		open: boolean;
		settings: SettingsPayload | null;
		catalogs: ModelCatalogs;
		modelStatus: string;
		busy: boolean;
		onClose: () => void;
		onSave: (payload: SettingsFormValues) => void;
		onRefreshModels: (payload: SettingsFormValues) => void;
	} = $props();

	let apiKey = $state('');
	let textModel = $state('');
	let imageModel = $state('');
	let temperature = $state(0.75);
	let topP = $state(0.95);
	let frequencyPenalty = $state(0.35);
	let presencePenalty = $state(0);
	let maxTokens = $state(1500);
	let translationLanguage = $state<TranslationLanguage>(DEFAULT_TRANSLATION_LANGUAGE);

	// Sync form fields whenever settings/catalogs change or the modal opens.
	$effect(() => {
		if (!settings || !open) return;
		const cfg = settings.providers['venice'] || {};
		temperature = settings.narrator_temperature;
		topP = settings.narrator_top_p;
		frequencyPenalty = settings.narrator_frequency_penalty;
		presencePenalty = settings.narrator_presence_penalty;
		maxTokens = settings.narrator_max_tokens;
		translationLanguage = settings.translation_language;
		textModel = cfg.text_model || '';
		imageModel = cfg.image_model || '';
		apiKey = '';
	});

	interface OptionRow {
		id: string;
		name: string;
	}

	function modelOptions(rows: OptionRow[] | undefined, selected: string): OptionRow[] {
		const normalized = Array.isArray(rows) ? [...rows] : [];
		if (selected && !normalized.some((row) => row.id === selected)) {
			normalized.unshift({ id: selected, name: `${selected} (saved)` });
		}
		return normalized;
	}

	const textOptions = $derived(modelOptions(catalogs.text, textModel));
	const imageOptions = $derived(modelOptions(catalogs.image, imageModel));

	const keySource = $derived(settings?.key_source?.['venice'] || 'absent');
	const keyFromEnvironment = $derived(keySource === 'environment');
	const keyMessage = $derived(
		{
			environment: 'Using read-only VENICE_API_KEY from the environment',
			keychain: 'Key saved in the system credential manager',
			absent: 'Key not saved',
			legacy_encrypted: 'Older encrypted key detected — enter the API key again',
			storage_unavailable: 'System credential manager is unavailable',
			settings_corrupt: 'settings.json is corrupt and was moved to quarantine'
		}[keySource] || 'Key status unknown'
	);

	function countLabel(values: string[] | undefined, one: string, many: string): string {
		if (!values?.length) return '';
		return `${values.length} ${values.length === 1 ? one : many}`;
	}

	const selectedImageRow = $derived((catalogs.image || []).find((row) => row.id === imageModel));
	const imageCapability = $derived(
		selectedImageRow
			? [
					selectedImageRow.resolutions?.join(' / '),
					countLabel(selectedImageRow.aspect_ratios, 'aspect ratio', 'aspect ratios')
				]
					.filter(Boolean)
					.join(' · ') || 'Parameters determined by provider'
			: 'Refresh the catalog to check capabilities'
	);

	function save(): void {
		onSave(formValues());
	}

	function formValues() {
		return {
			narrator_temperature: Number(temperature),
			narrator_top_p: Number(topP),
			narrator_frequency_penalty: Number(frequencyPenalty),
			narrator_presence_penalty: Number(presencePenalty),
			narrator_max_tokens: Number(maxTokens),
			translation_language: translationLanguage,
			text_model: textModel,
			image_model: imageModel,
			api_key: apiKey.trim()
		};
	}
</script>

<ModalFrame
	{open}
	id="settingsModal"
	label="Model settings"
	title="Settings"
	subtitle="Venice.ai: separate narrator and image models"
	cardClass="settings-card"
	{onClose}
>
	{#snippet children()}
		{#if settings}
			<section class="settings-section">
				<h3>Connection</h3>
				<div class="settings-grid">
					<label>Provider<input value="Venice.ai" readonly /></label>
					<label>API key<input
							id="settingsApiKey"
							data-modal-autofocus
							type="password"
							autocomplete="off"
							readonly={keyFromEnvironment}
							placeholder={keyFromEnvironment ? 'Managed by VENICE_API_KEY' : 'Leave blank to keep unchanged'}
							bind:value={apiKey}
						/><span
							class="field-note field-note-below"
							class:ok={keySource === 'environment' || keySource === 'keychain'}
							class:warning={keySource !== 'environment' && keySource !== 'keychain'}
							role="status">{keyMessage}</span></label>
				</div>
				<div class="row">
					<button class="ghost" type="button" disabled={busy} onclick={() => onRefreshModels(formValues())}
						>Refresh models</button
					><span id="modelStatus" class="field-note">{modelStatus}</span>
				</div>
			</section>
			<section class="settings-section">
				<h3>Story</h3>
				<div class="settings-grid">
					<label>Narrator model<select bind:value={textModel}>
							<option value="">{textOptions.length ? 'Not selected' : 'Refresh the list first'}</option>
							{#each textOptions as row (row.id)}
								<option value={row.id}>{row.name === row.id ? row.id : `${row.name} — ${row.id}`}</option>
							{/each}
						</select><span class="capability-note">The model continues the visible story</span></label>
					<label>Translation language<select bind:value={translationLanguage}>
							{#each TRANSLATION_LANGUAGES as language}
								<option value={language}>{language}</option>
							{/each}
						</select><span class="capability-note">Used by the Translate button</span></label>
					<label>Temperature<input type="number" min="0" max="2" step="0.05" bind:value={temperature} /></label>
					<label>Top P<input type="number" min="0.01" max="1" step="0.01" bind:value={topP} /></label>
					<label>Frequency penalty<input type="number" min="-2" max="2" step="0.05" bind:value={frequencyPenalty} /></label>
					<label>Presence penalty<input type="number" min="-2" max="2" step="0.05" bind:value={presencePenalty} /></label>
					<label>Max completion tokens (total)<input type="number" min="16" max="8192" step="1" bind:value={maxTokens} /></label>
				</div>
			</section>
			<section class="settings-section">
				<h3>Media</h3>
				<div class="settings-grid">
					<label>Images<select bind:value={imageModel}>
							<option value="">{imageOptions.length ? 'Not selected' : 'Refresh the list first'}</option>
							{#each imageOptions as row (row.id)}
								<option value={row.id}>{row.name === row.id ? row.id : `${row.name} — ${row.id}`}</option>
							{/each}
						</select><span class="capability-note">{imageCapability}</span></label>
				</div>
			</section>
		{/if}
	{/snippet}
	{#snippet footer()}
		{#if settings}<button type="button" disabled={busy} onclick={save}>Save</button>{/if}
	{/snippet}
</ModalFrame>
