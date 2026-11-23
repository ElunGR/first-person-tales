<script lang="ts">
	import ModalFrame from './ModalFrame.svelte';
	import type { ModelCatalogs, NarratorParameters, SettingsPayload } from '$lib/frontend/types';
	import { DEFAULT_IMAGE_STYLE, IMAGE_STYLES, IMAGE_STYLE_LABELS, type ImageStyle } from '$lib/imageStyles';
	import {
		DEFAULT_TRANSLATION_LANGUAGE,
		TRANSLATION_LANGUAGES,
		type TranslationLanguage
	} from '$lib/translationLanguages';
	import {
		describeParameterProblem,
		parameterValueToText,
		parseParameterValueText
	} from '$lib/narratorParameters';
	import {
		imageModelNote,
		modelDetails,
		modelInfoFromRow,
		narratorModelNote
	} from '$lib/modelInfo';

	export interface SettingsFormValues {
		narrator_parameters: NarratorParameters;
		translation_language: TranslationLanguage;
		text_model: string;
		image_model: string;
		image_style: ImageStyle;
		api_key: string;
	}

	let {
		open,
		settings,
		draft,
		catalogs,
		modelStatus,
		busy,
		onClose,
		onSave,
		onRefreshModels
	}: {
		open: boolean;
		settings: SettingsPayload | null;
		/** Last saved or edited form values; preferred over the cached payload. */
		draft: SettingsFormValues | null;
		catalogs: ModelCatalogs;
		modelStatus: string;
		busy: boolean;
		onClose: () => void;
		onSave: (payload: SettingsFormValues) => void;
		onRefreshModels: (payload: SettingsFormValues) => void;
	} = $props();

	interface ParameterRow {
		key: string;
		/** Edited freely; only lower-case letters, digits and underscore can be saved. */
		name: string;
		value: string;
	}

	let apiKey = $state('');
	let textModel = $state('');
	let imageModel = $state('');
	let imageStyle = $state<ImageStyle>(DEFAULT_IMAGE_STYLE);
	let translationLanguage = $state<TranslationLanguage>(DEFAULT_TRANSLATION_LANGUAGE);
	let parameterRows = $state<ParameterRow[]>([]);
	let rowSequence = 0;

	function nextKey(): string {
		rowSequence += 1;
		return `parameter-${rowSequence}`;
	}

	function rowsFromParameters(parameters: NarratorParameters | undefined): ParameterRow[] {
		return Object.entries(parameters ?? {}).map(([name, value]) => ({
			key: nextKey(),
			name,
			value: parameterValueToText(value)
		}));
	}

	// Sync form fields whenever the dialog opens or the edited values change.
	// A saved-in-place draft wins over the cached payload: saving no longer
	// closes the dialog, so reopening it must show what was last accepted.
	$effect(() => {
		if (!settings || !open) return;
		if (draft) {
			parameterRows = rowsFromParameters(draft.narrator_parameters);
			translationLanguage = draft.translation_language;
			textModel = draft.text_model;
			imageModel = draft.image_model;
			imageStyle = draft.image_style;
			apiKey = '';
			return;
		}
		const cfg = settings.providers['venice'] || {};
		parameterRows = rowsFromParameters(settings.narrator_parameters);
		translationLanguage = settings.translation_language;
		textModel = cfg.text_model || '';
		imageModel = cfg.image_model || '';
		imageStyle = settings.image_style ?? DEFAULT_IMAGE_STYLE;
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
	const selectedTextRow = $derived((catalogs.text || []).find((row) => row.id === textModel));
	const selectedTextInfo = $derived(selectedTextRow ? modelInfoFromRow(selectedTextRow) : null);
	const selectedImageInfo = $derived(selectedImageRow ? modelInfoFromRow(selectedImageRow) : null);
	const textModelNote = $derived(narratorModelNote(selectedTextInfo));
	const textModelTitle = $derived(modelDetails(selectedTextInfo));
	const imageModelNoteText = $derived(imageModelNote(selectedImageInfo));
	const imageModelTitle = $derived(modelDetails(selectedImageInfo));
	const imageGeometry = $derived(
		selectedImageRow
			? [
					selectedImageRow.resolutions?.join(' / '),
					countLabel(selectedImageRow.aspect_ratios, 'aspect ratio', 'aspect ratios')
				]
					.filter(Boolean)
					.join(' · ') || 'Parameters determined by provider'
			: 'Refresh the catalog to check capabilities'
	);
	/** Geometry is a separate fact; it is only appended when the note has content. */
	const imageNoteSuffix = $derived(imageModelNoteText.endsWith('privacy') ? '' : ` · ${imageGeometry}`);

	/** One message per filled row: what is wrong with the name or the value. */
	const rowProblems = $derived.by(() => {
		const problems = new Map<string, string>();
		const seen = new Set<string>();
		for (const row of parameterRows) {
			const value = parseParameterValueText(row.value);
			const problem =
				describeParameterProblem(row.name, 'error' in value ? undefined : value.value) ??
				('error' in value ? value.error : null);
			if (problem) {
				problems.set(row.key, problem);
				continue;
			}
			const normalized = row.name.trim().toLowerCase();
			if (seen.has(normalized)) {
				problems.set(row.key, `duplicate parameter "${normalized}"`);
				continue;
			}
			seen.add(normalized);
		}
		return problems;
	});

	const hasProblems = $derived(rowProblems.size > 0);

	/** Sent to the server; only complete, correctly typed rows are included. */
	const parsedParameters = $derived.by(() => {
		const parameters: NarratorParameters = {};
		for (const row of parameterRows) {
			if (rowProblems.has(row.key)) continue;
			const parsed = parseParameterValueText(row.value);
			if ('error' in parsed) continue;
			parameters[row.name.trim().toLowerCase()] = parsed.value;
		}
		return parameters;
	});

	function addParameter(): void {
		parameterRows = [...parameterRows, { key: nextKey(), name: '', value: '' }];
	}

	function removeParameter(key: string): void {
		parameterRows = parameterRows.filter((row) => row.key !== key);
	}

	function save(): void {
		onSave(formValues());
	}

	function formValues(): SettingsFormValues {
		return {
			narrator_parameters: parsedParameters,
			translation_language: translationLanguage,
			text_model: textModel,
			image_model: imageModel,
			image_style: imageStyle,
			api_key: apiKey.trim()
		};
	}
</script>

<ModalFrame
	{open}
	id="settingsModal"
	label="Model settings"
	title="Settings"
	subtitle="Venice.ai: narrator parameters and models"
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
						</select><span class="capability-note" title={textModelTitle}>{textModelNote}</span></label>
					<label>Translation language<select bind:value={translationLanguage}>
							{#each TRANSLATION_LANGUAGES as language}
								<option value={language}>{language}</option>
							{/each}
						</select><span class="capability-note">Used by the Translate button</span></label>
				</div>
			</section>
			<section class="settings-section">
				<h3>Narrator parameters</h3>
				<div class="parameter-table" role="group" aria-label="Narrator parameters">
					<div class="parameter-head" aria-hidden="true">
						<span>Name</span><span>Value</span><span></span>
					</div>
					{#each parameterRows as row (row.key)}
						{@const problem = rowProblems.get(row.key)}
						<div class="parameter-row" class:invalid={problem}>
							<label class="parameter-field">
								<span class="visually-hidden">Parameter name</span>
								<input
									class="parameter-name"
									type="text"
									spellcheck="false"
									autocomplete="off"
									placeholder="temperature"
									aria-invalid={problem ? 'true' : undefined}
									bind:value={row.name}
								/>
							</label>
							<label class="parameter-field">
								<span class="visually-hidden">Parameter value</span>
								<input
									class="parameter-value"
									type="text"
									spellcheck="false"
									autocomplete="off"
									placeholder="1"
									aria-invalid={problem ? 'true' : undefined}
									bind:value={row.value}
								/>
							</label>
							<div class="parameter-actions">
								<button
									class="ghost parameter-icon"
									type="button"
									disabled={busy}
									title="Delete this parameter"
									aria-label={`Delete ${row.name.trim() || 'this parameter'}`}
									onclick={() => removeParameter(row.key)}
								>
									<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
										<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
									</svg>
								</button>
							</div>
							{#if problem}<span class="field-note warning parameter-problem" role="alert">{problem}</span>{/if}
						</div>
					{/each}
				</div>
				<button class="ghost parameter-add" type="button" disabled={busy} onclick={addParameter}
					>Add parameter</button
				>
				{#if hasProblems}
					<p class="field-note warning" role="alert">Fix the highlighted parameters before saving.</p>
				{/if}
			</section>
			<section class="settings-section">
				<h3>Media</h3>
				<div class="settings-grid">
					<label>Images<select bind:value={imageModel}>
							<option value="">{imageOptions.length ? 'Not selected' : 'Refresh the list first'}</option>
							{#each imageOptions as row (row.id)}
								<option value={row.id}>{row.name === row.id ? row.id : `${row.name} — ${row.id}`}</option>
							{/each}
						</select><span
							class="capability-note"
							title={`${imageGeometry}. ${imageModelTitle}`}
							>{imageModelNoteText}{imageNoteSuffix}</span
						></label>
					<label>Image style<select bind:value={imageStyle}>
							{#each IMAGE_STYLES as style}
								<option value={style}>{IMAGE_STYLE_LABELS[style]}</option>
							{/each}
						</select><span class="capability-note">{imageStyle === 'none'
								? 'Use the image prompt as written'
								: `Appends "Style: ${imageStyle}" to the image prompt`}</span></label>
				</div>
			</section>
		{/if}
	{/snippet}
	{#snippet footer()}
		{#if settings}<button type="button" disabled={busy || hasProblems} onclick={save}>Save</button>{/if}
	{/snippet}
</ModalFrame>
