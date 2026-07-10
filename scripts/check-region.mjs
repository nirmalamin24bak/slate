// Best-effort check that the Supabase project lives in ap-south-1 (Mumbai).
// DPDP data residency (spec/08). Region is fixed at project creation and
// cannot change; if this script ever reports a different region, stop work
// and tell Nirmal immediately.
//
// Usage: node scripts/check-region.mjs [supabase-url]
// Falls back to EXPO_PUBLIC_SUPABASE_URL, then the known project URL.

const EXPECTED = 'ap-south-1';
const url =
  process.argv[2] ??
  process.env.EXPO_PUBLIC_SUPABASE_URL ??
  'https://ruynujwntbcgznoiwugl.supabase.co';

const REGION_HEADERS = ['x-sb-region', 'sb-region', 'x-sb-edge-region', 'x-region', 'fly-region'];

const res = await fetch(`${url}/auth/v1/health`, {
  method: 'GET',
  headers: { connection: 'close' }, // avoid Node-on-Windows teardown assert
});

let found = null;
for (const h of REGION_HEADERS) {
  const v = res.headers.get(h);
  if (v) {
    found = { header: h, value: v };
    break;
  }
}

if (found) {
  if (found.value.toLowerCase().includes(EXPECTED)) {
    console.log(`OK: region ${found.value} (${found.header}) matches ${EXPECTED}.`);
    process.exit(0);
  } else {
    console.error(
      `REGION MISMATCH: ${found.header}=${found.value}, expected ${EXPECTED}.\n` +
        `DPDP residency violation. Stop and tell Nirmal.`,
    );
    process.exit(1);
  }
} else {
  console.warn(
    `Indeterminate: no region header exposed (status ${res.status}).\n` +
      `Headers seen: ${[...res.headers.keys()].join(', ')}\n` +
      `Confirm in the Supabase dashboard that the project region is ${EXPECTED}.`,
  );
  process.exit(0);
}
