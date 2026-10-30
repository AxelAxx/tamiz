/**
 * Explicit provider settings (spec 002 FR-014, data-model section 5). Adapters never
 * read the environment: `T-002-05` parses these from it and `main.ts` passes them in.
 */

/** A provider reached with a credential; `baseUrl` overrides the provider default (proxies). */
export interface KeyedProviderSettings {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

/** Ollama needs no credential, only the URL of its OpenAI-compatible `/v1` endpoint. */
export interface OllamaSettings {
  readonly baseUrl: string;
}

/** A provider left out is not configured; the registry answers for it with a typed error. */
export interface ProviderSettings {
  readonly ollama?: OllamaSettings;
  readonly mistral?: KeyedProviderSettings;
  readonly anthropic?: KeyedProviderSettings;
  readonly openai?: KeyedProviderSettings;
}

/** The SDK factories' common options, without `baseURL` when no override is set. */
export function sdkOptions(settings: KeyedProviderSettings): {
  apiKey: string;
  baseURL?: string;
} {
  return {
    apiKey: settings.apiKey,
    ...(settings.baseUrl !== undefined && { baseURL: settings.baseUrl }),
  };
}
