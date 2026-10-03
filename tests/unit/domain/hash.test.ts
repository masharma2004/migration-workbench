import { describe, expect, it } from 'vitest';
import { canonicalJson, hashOf, sha256 } from '@/domain/hash';

describe('canonicalJson', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
  it('keeps array order and drops undefined object values', () => {
    expect(canonicalJson({ x: [3, 1, 2], y: undefined })).toBe('{"x":[3,1,2]}');
  });
  it('serialises undefined array items as null', () => {
    expect(canonicalJson([1, undefined])).toBe('[1,null]');
  });
  it('rejects non-finite numbers', () => {
    expect(() => canonicalJson({ n: Number.NaN })).toThrow(/Non-finite/);
  });
});

describe('hashOf', () => {
  it('is independent of key order', () => {
    expect(hashOf({ a: 1, b: 2 })).toBe(hashOf({ b: 2, a: 1 }));
  });
  it('produces 64-char hex sha256', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
