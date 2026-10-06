// Checks that the Supabase project lives in ap-south-1 (Mumbai). DPDP data
// residency (spec/08). Region is fixed at project creation and cannot
// change; if this script ever reports a different region, stop work and
// tell Nirmal immediately.
//
// Usage: node scripts/check-region.mjs [supabase-url]
// Falls back to EXPO_PUBLIC_SUPABASE_URL, then the known project URL.
// Exit codes: 0 in ap-south-1 · 1 somewhere else · 2 could not tell.
//
// How: db.<ref>.supabase.co is an AWS address, and AWS publishes which region
// owns every prefix, so the answer needs no credentials. This script used to
// read a region response header. Supabase stopped sending one, and from then
// on every project came back "Indeterminate" with exit 0 — including one
// created in Tokyo on 6 Oct 2026, which this version reports as a mismatch.

import { promises as dns } from 'node:dns';

import { EXPECTED_REGION, projectRef, regionFor, verdict } from './region/aws.mjs';

const AWS_RANGES = 'https://ip-ranges.amazonaws.com/ip-ranges.json';
const url =
  process.argv[2] ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://rhnukmnazznlgvvcjibv.supabase.co';

/**
 * Every A and AAAA address of `host`. The system resolver goes first; public
 * resolvers are the fallback, because a machine's configured DNS can refuse
 * outright (the dev box this was written on points Node at 127.0.0.1, which
 * answers ECONNREFUSED) and the OS lookup drops AAAA answers on an IPv4-only
 * connection — and db.<ref>.supabase.co is AAAA-only. The record is public, so
 * any resolver gives the same answer.
 */
async function addressesOf(host) {
  const fallback = new dns.Resolver({ timeout: 5000, tries: 2 });
  fallback.setServers(['1.1.1.1', '8.8.8.8']);
  for (const resolver of [new dns.Resolver(), fallback]) {
    const lookups = await Promise.all(
      [resolver.resolve6(host), resolver.resolve4(host)].map((lookup) => lookup.catch(() => [])),
    );
    const found = lookups.flat();
    if (found.length > 0) return found;
  }
  return [];
}

async function check() {
  const ref = projectRef(url);
  if (!ref) {
    console.warn(`Indeterminate: ${url} is not a https://<ref>.supabase.co URL.`);
    return 2;
  }

  const host = `db.${ref}.supabase.co`;
  const addresses = await addressesOf(host);
  if (addresses.length === 0) {
    console.warn(`Indeterminate: ${host} does not resolve. The project may be paused or deleted.`);
    return 2;
  }

  let ranges;
  try {
    const res = await fetch(AWS_RANGES, {
      headers: { connection: 'close' }, // avoid Node-on-Windows teardown assert
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ranges = await res.json();
  } catch (error) {
    console.warn(`Indeterminate: could not read ${AWS_RANGES} (${error.message}).`);
    return 2;
  }

  const placed = addresses.map((address) => ({ address, region: regionFor(address, ranges) }));
  for (const { address, region } of placed) {
    console.log(`${host} ${address} -> ${region ?? 'not in AWS published ranges'}`);
  }

  const code = verdict(placed);
  if (code === 0) {
    console.log(`OK: ${ref} is in ${EXPECTED_REGION}.`);
  } else if (code === 1) {
    console.error(
      `REGION MISMATCH: expected ${EXPECTED_REGION}.\n` +
        `DPDP residency violation. Stop and tell Nirmal.`,
    );
  } else {
    console.warn(
      `Indeterminate: no address of ${host} is in AWS's published ranges.\n` +
        `Confirm in the Supabase dashboard that the project region is ${EXPECTED_REGION}.`,
    );
  }
  return code;
}

// exitCode, not exit(): exiting while fetch is still closing its socket trips
// a libuv assert on Windows, which turned every result into exit 127.
process.exitCode = await check();
