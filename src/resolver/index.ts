// Public surface of the resolver (spec/05). Pure pipeline + the Edge
// Function transport; the model lives server-side behind resolver-classify.

export { contextOf } from './context';
export { localRules } from './localRules';
export { normalize, splitEntries } from './normalize';
export { MAX_CACHE_KEY_LENGTH, resolve, TransportError } from './resolve';
export type {
  CachedResolution,
  CacheStore,
  ClassifyTransport,
  ResolveDeps,
  ResolvedSegment,
  TransportFailure,
} from './resolve';
export { backoffMs, RetryQueue } from './retryQueue';
export type { QueueEntry } from './retryQueue';
export { edgeTransport } from './transport';
export type { FunctionsInvoker } from './transport';
export * from './types';
export { CONFIDENCE_FLOOR, validateModelOutput, validateResolution } from './validate';
