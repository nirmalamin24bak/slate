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
          // The system prompt is the whole catalogue (prompt.ts) — hundreds of
          // dishes, exercises and packaged foods, identical for every caller and
          // rebuilt only every CATALOGUE_TTL_MS. Sent as a plain string it was
          // re-billed as fresh input tokens on EVERY classification, which is the
          // single largest cost in the system and the reason the calls/day ceiling
          // in migration ...0004 did not bound spend.
          //
          // One cache breakpoint at the end of the block makes it a cache read on
          // every subsequent call. Anthropic's cache TTL is 5 minutes, which is
          // exactly CATALOGUE_TTL_MS in index.ts — a refreshed catalogue writes a
          // new cache entry rather than serving a stale one. Keep the two equal.
          system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
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
