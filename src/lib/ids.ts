// Client-generated UUIDs (spec/04): an offline entry has its real id the
// moment it exists. Hermes has no crypto.randomUUID; expo-crypto provides it.

import * as Crypto from 'expo-crypto';

export function newId(): string {
  return Crypto.randomUUID();
}
