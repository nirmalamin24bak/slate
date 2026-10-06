import { describe, expect, test } from 'vitest';

import { EXPECTED_REGION, projectRef, regionFor, toBits, verdict } from '../scripts/region/aws.mjs';

// DPDP data residency (spec/08). scripts/check-region.mjs places a project's
// database host in an AWS region from AWS's published ranges. The two real
// addresses below decided it on 6 Oct 2026: the Mumbai project that shipped,
// and the Tokyo project that was rejected.

const MUMBAI_DB = '2406:da1a:314:7102:3160:dfc5:c875:f15d';
const TOKYO_DB = '2406:da14:18fe:3101::e602';

// A slice of ip-ranges.json. The /24 and /8 rows are made up: they sit over the
// real /35 and /14 rows so that only a longest-prefix match gets these right.
const RANGES = {
  prefixes: [
    { ip_prefix: '3.0.0.0/8', region: 'GLOBAL' },
    { ip_prefix: '3.108.0.0/14', region: 'ap-south-1' },
    { ip_prefix: '54.64.0.0/15', region: 'ap-northeast-1' },
  ],
  ipv6_prefixes: [
    { ipv6_prefix: '2406:da00::/24', region: 'GLOBAL' },
    { ipv6_prefix: '2406:da1a::/35', region: 'ap-south-1' },
    { ipv6_prefix: '2406:da14::/35', region: 'ap-northeast-1' },
  ],
};

describe('projectRef', () => {
  test('reads the ref from a project URL', () => {
    expect(projectRef('https://rhnukmnazznlgvvcjibv.supabase.co')).toBe('rhnukmnazznlgvvcjibv');
    expect(projectRef('https://rhnukmnazznlgvvcjibv.supabase.co/')).toBe('rhnukmnazznlgvvcjibv');
  });

  test('refuses anything that is not <20 lowercase letters>.supabase.co', () => {
    expect(projectRef('https://api.example.com')).toBeNull();
    expect(projectRef('https://short.supabase.co')).toBeNull();
    expect(projectRef('https://db.rhnukmnazznlgvvcjibv.supabase.co')).toBeNull();
    expect(projectRef('not a url')).toBeNull();
  });
});

describe('toBits', () => {
  test('reads IPv4 and expands compressed IPv6', () => {
    expect(toBits('3.109.171.244')).toEqual({ bits: 0x036dabf4n, width: 32 });
    expect(toBits('::1')).toEqual({ bits: 1n, width: 128 });
    expect(toBits('2406:da1a::')).toEqual({ bits: 0x2406da1an << 96n, width: 128 });
    expect(toBits(TOKYO_DB)).toEqual({ bits: 0x2406da1418fe3101000000000000e602n, width: 128 });
  });

  test('refuses what is not an address', () => {
    expect(toBits('db.example.supabase.co')).toBeNull();
    expect(toBits('256.0.0.1')).toBeNull();
    expect(toBits('::ffff:3.109.171.244')).toBeNull();
  });
});

describe('regionFor', () => {
  test('places the real Mumbai and Tokyo database hosts', () => {
    expect(regionFor(MUMBAI_DB, RANGES)).toBe('ap-south-1');
    expect(regionFor(TOKYO_DB, RANGES)).toBe('ap-northeast-1');
  });

  test('the longest prefix wins over a broader row that also matches', () => {
    expect(regionFor('3.109.171.244', RANGES)).toBe('ap-south-1');
    expect(regionFor('3.1.2.3', RANGES)).toBe('GLOBAL');
    expect(regionFor('2406:da00::1', RANGES)).toBe('GLOBAL');
  });

  test('an address AWS does not list is unplaced, never guessed', () => {
    expect(regionFor('192.0.2.1', RANGES)).toBeNull();
    expect(regionFor('2001:db8::1', RANGES)).toBeNull();
    expect(regionFor('not an address', RANGES)).toBeNull();
    expect(regionFor(MUMBAI_DB, { prefixes: [] })).toBeNull();
  });
});

describe('verdict', () => {
  const at = (region: string | null) => ({ address: 'x', region });

  test('passes only when something is in ap-south-1 and nothing is elsewhere', () => {
    expect(EXPECTED_REGION).toBe('ap-south-1');
    expect(verdict([at('ap-south-1')])).toBe(0);
    expect(verdict([at('ap-south-1'), at(null)])).toBe(0);
  });

  test('one foreign address is a mismatch, whatever else resolved', () => {
    expect(verdict([at('ap-northeast-1')])).toBe(1);
    expect(verdict([at('ap-south-1'), at('ap-northeast-1')])).toBe(1);
  });

  test('nothing placed is indeterminate, and indeterminate is not a pass', () => {
    expect(verdict([])).toBe(2);
    expect(verdict([at(null)])).toBe(2);
  });
});
