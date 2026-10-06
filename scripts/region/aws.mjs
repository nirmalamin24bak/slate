// Pure placement of a Supabase project's database host in an AWS region
// (DPDP data residency, spec/08). No I/O here — check-region.mjs does the DNS
// lookup and fetches AWS's published ranges.

import { isIPv4, isIPv6 } from 'node:net';

/** Where Slate's data must live. Fixed at project creation; a project cannot move. */
export const EXPECTED_REGION = 'ap-south-1';

/** The project ref from `https://<ref>.supabase.co`, or null for any other URL. */
export function projectRef(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  const match = /^([a-z]{20})\.supabase\.co$/.exec(host);
  return match ? match[1] : null;
}

/** An IPv4 or IPv6 address as `{ bits, width }`, or null if it is not one. */
export function toBits(address) {
  if (isIPv4(address)) {
    const bits = address.split('.').reduce((n, octet) => (n << 8n) + BigInt(octet), 0n);
    return { bits, width: 32 };
  }
  // An IPv6 address with an embedded IPv4 tail never comes back from an AAAA
  // lookup of an AWS host; refusing it keeps the expansion below simple.
  if (!isIPv6(address) || address.includes('.')) return null;
  const [head, tail] = address.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const fill = tail === undefined ? [] : Array(8 - left.length - right.length).fill('0');
  const bits = [...left, ...fill, ...right].reduce(
    (n, group) => (n << 16n) + BigInt(parseInt(group, 16)),
    0n,
  );
  return { bits, width: 128 };
}

/**
 * The AWS region that owns `address`, by longest-prefix match over AWS's
 * published ranges (https://ip-ranges.amazonaws.com/ip-ranges.json), or null
 * when AWS does not list the address at all.
 */
export function regionFor(address, ranges) {
  const target = toBits(address);
  if (!target) return null;
  const entries =
    target.width === 32
      ? (ranges.prefixes ?? []).map((p) => [p.ip_prefix, p.region])
      : (ranges.ipv6_prefixes ?? []).map((p) => [p.ipv6_prefix, p.region]);
  let best = null;
  let bestLength = -1;
  for (const [cidr, region] of entries) {
    const [network, lengthText] = String(cidr).split('/');
    const length = Number(lengthText);
    if (!(length > bestLength && length <= target.width)) continue;
    const net = toBits(network);
    if (!net || net.width !== target.width) continue;
    const shift = BigInt(target.width - length);
    if (net.bits >> shift === target.bits >> shift) {
      best = region;
      bestLength = length;
    }
  }
  return best;
}

/**
 * 1 when any address is in another region — one foreign address is enough to
 * stop. 0 when at least one is in `expected` and none is elsewhere. 2 when
 * nothing could be placed, which is never a pass.
 */
export function verdict(placed, expected = EXPECTED_REGION) {
  if (placed.some((p) => p.region !== null && p.region !== expected)) return 1;
  if (placed.some((p) => p.region === expected)) return 0;
  return 2;
}
