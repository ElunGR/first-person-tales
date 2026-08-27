/** Per-request LLM client factory (main.make_llm_client in the original). */
import { getApiKey } from './keyring';
import { LLMClient } from './llm';
import { cachedModelCapabilities } from './providerApi';
import { loadSettings, providerSettings, providerUrl } from './settings';

export async function makeLlmClient(): Promise<LLMClient> {
	const settings = loadSettings();
	const provider = settings.active_provider;
	const apiKey = await getApiKey(provider);
	const model = providerSettings(settings).text_model;
	const capabilities = cachedModelCapabilities(settings, 'text');
	const options = Array.isArray(capabilities['reasoning_effort_options'])
		? (capabilities['reasoning_effort_options'] as string[])
		: [];
	return new LLMClient({
		apiServer: providerUrl(provider),
		apiKey,
		model,
		supportsReasoningEffort: capabilities['supports_reasoning_effort'] === true,
		reasoningEffortOptions: options
	});
}
