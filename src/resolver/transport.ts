// ClassifyTransport over the resolver-classify Edge Function. The model
// provider, its API key, and the global cache write all live server-side; the
// client sends one normalized line and gets back the raw model reply to
// validate locally. supabase-js failure classes map onto TransportError kinds
// so the pipeline can queue retryable lines (spec/09) without seeing HTTP.

import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';

import type { ClassifyTransport } from './resolve';
import { TransportError } from './resolve';

/** The slice of SupabaseClient.functions this module needs. */
export interface FunctionsInvoker {
  invoke(name: string, options: { body: unknown }): Promise<{ data: unknown; error: Error | null }>;
}

function toTransportError(error: Error): TransportError {
  if (error instanceof FunctionsHttpError) {
    const status = error.context.status;
    if (status === 429) return new TransportError('rate_limit');
    return new TransportError('server');
  }
  if (error instanceof FunctionsFetchError || error instanceof FunctionsRelayError) {
    return new TransportError('network');
  }
  return new TransportError('network');
}

export function edgeTransport(functions: FunctionsInvoker): ClassifyTransport {
  return {
    async classify(line: string): Promise<string> {
      const { data, error } = await functions.invoke('resolver-classify', { body: { line } });
      if (error) throw toTransportError(error);
      if (
        typeof data !== 'object' ||
        data === null ||
        typeof (data as Record<string, unknown>).reply !== 'string'
      ) {
        throw new TransportError('server');
      }
      return (data as { reply: string }).reply;
    },
  };
}
