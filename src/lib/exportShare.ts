// The share half of Export your data — writes the built file to the cache
// directory and hands it to the iOS share sheet. Kept apart from export.ts so
// the builders stay pure and testable in Node.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

import { listAllEntries } from '../db/entriesRepo';
import { getKitchen, getProfile, listWeights } from '../db/profileRepo';
import { track } from './analytics';
import { buildBundle, entriesCsv, weightsCsv } from './export';
import { services } from './services';

export type ExportKind = 'json' | 'entries-csv' | 'weights-csv';

const FILE_NAMES: Record<ExportKind, string> = {
  json: 'slate-export.json',
  'entries-csv': 'slate-entries.csv',
  'weights-csv': 'slate-weights.csv',
};

const MIME_TYPES: Record<ExportKind, string> = {
  json: 'application/json',
  'entries-csv': 'text/csv',
  'weights-csv': 'text/csv',
};

export async function shareExport(kind: ExportKind): Promise<void> {
  const svc = await services();
  const [profile, kitchen, entries, weights] = await Promise.all([
    getProfile(svc.adapter, svc.userId),
    getKitchen(svc.adapter, svc.userId),
    listAllEntries(svc.adapter, svc.userId),
    listWeights(svc.adapter, svc.userId),
  ]);

  const content =
    kind === 'json'
      ? JSON.stringify(
          buildBundle(profile, kitchen, entries, weights, new Date().toISOString()),
          null,
          2,
        )
      : kind === 'entries-csv'
        ? entriesCsv(entries)
        : weightsCsv(weights);

  const uri = `${FileSystem.cacheDirectory}${FILE_NAMES[kind]}`;
  await FileSystem.writeAsStringAsync(uri, content);
  await Sharing.shareAsync(uri, { mimeType: MIME_TYPES[kind] });
  // No `kind` property. Which format someone exports is not worth knowing, and
  // the export itself is the DPDP portability right — counting exercises of a
  // right in more detail than "it happened" is not a metric we need.
  track({ name: 'export_run' });
}
