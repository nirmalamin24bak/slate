// The model, behind one interface. Swapping providers means editing THIS
// file and the two env vars — nothing else in the system knows a vendor name
// (spec/05: "the model is swappable in one file").
//
// FLAG(nirmal): provider choice + DPDP processor terms (spec/08: zero
// retention, no training on our data, named in the privacy notice) are still
// his call. Anthropic claude-haiku-4-5 is implemented as the first candidate
// because spec/05 asks for a hosted small model inside a 1200ms p95 budget —
// the eval harness exists to prove or reject it.

import Anthropic from 'npm:@anthropic-ai/sdk@0.39.0';

export interface ModelProvider {
  /** One classification call. Returns the raw reply text. */
  complete(system: string, line: string, signal: AbortSignal): Promise<string>;
}

function anthropicProvider(apiKey: string, model: string): ModelProvider {
  const client = new Anthropic({ apiKey });
  return {
    async complete(system, line, signal) {
      const response = await client.messages.create(
        {
          model,
          max_tokens: 500,
          temperature: 0, // classification, not prose; Haiku still accepts it
          system,
          messages: [{ role: 'user', content: line }],
        },
        { signal },
      );
      const text = response.content.find((block) => block.type === 'text');
      return text && 'text' in text ? text.text : '';
    },
  };
}

export function providerFromEnv(): ModelProvider {
  const name = Deno.env.get('RESOLVER_PROVIDER') ?? 'anthropic';
  const apiKey = Deno.env.get('RESOLVER_PROVIDER_API_KEY');
  if (!apiKey) throw new Error('RESOLVER_PROVIDER_API_KEY is not set');

  switch (name) {
    case 'anthropic':
      return anthropicProvider(apiKey, Deno.env.get('RESOLVER_MODEL') ?? 'claude-haiku-4-5');
    default:
      throw new Error(`unknown RESOLVER_PROVIDER: ${name}`);
  }
}
