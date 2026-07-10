import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import { TransportError } from './resolve';
import { edgeTransport } from './transport';

// The one place the app talks to the classify Edge Function. Maps supabase-js
// failure classes onto TransportError kinds so resolve() can decide what is
// retryable (spec/09) without knowing anything about HTTP.

function invokerReturning(result: { data: unknown; error: Error | null }) {
  const calls: unknown[] = [];
  return {
    calls,
    invoke: (name: string, opts: { body: unknown }) => {
      calls.push({ name, body: opts.body });
      return Promise.resolve(result);
    },
  };
}

async function kindOf(error: Error): Promise<string> {
  const transport = edgeTransport(invokerReturning({ data: null, error }));
  try {
    await transport.classify('2 roti');
    throw new Error('expected classify to throw');
  } catch (e) {
    expect(e).toBeInstanceOf(TransportError);
    return (e as TransportError).kind;
  }
}

describe('edgeTransport', () => {
  it('returns the reply string and posts the line', async () => {
    const invoker = invokerReturning({ data: { reply: '{"intent":"food"}' }, error: null });
    const transport = edgeTransport(invoker);
    await expect(transport.classify('2 roti')).resolves.toBe('{"intent":"food"}');
    expect(invoker.calls).toEqual([{ name: 'resolver-classify', body: { line: '2 roti' } }]);
  });

  it('HTTP 429 → rate_limit', async () => {
    await expect(kindOf(new FunctionsHttpError(new Response('', { status: 429 })))).resolves.toBe(
      'rate_limit',
    );
  });

  it('HTTP 5xx → server', async () => {
    await expect(kindOf(new FunctionsHttpError(new Response('', { status: 500 })))).resolves.toBe(
      'server',
    );
  });

  it('fetch/relay failures → network', async () => {
    await expect(kindOf(new FunctionsFetchError(null))).resolves.toBe('network');
    await expect(kindOf(new FunctionsRelayError(null))).resolves.toBe('network');
  });

  it('an unrecognized error class → network (treat the unknown as retryable)', async () => {
    await expect(kindOf(new Error('something the SDK never named'))).resolves.toBe('network');
  });

  it('malformed function response → server error, never a fake reply', async () => {
    const transport = edgeTransport(invokerReturning({ data: { nope: true }, error: null }));
    await expect(transport.classify('2 roti')).rejects.toMatchObject({ kind: 'server' });
  });
});
