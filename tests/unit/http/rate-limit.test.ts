import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@/server/http/rate-limit';

describe('RateLimiter', () => {
  it('limits per key within a sliding window', () => {
    let now = 0;
    const rl = new RateLimiter(2, 1000, 100, () => now);
    expect(rl.check('a').ok).toBe(true);
    expect(rl.check('a').ok).toBe(true);
    const third = rl.check('a');
    expect(third.ok).toBe(false);
    expect(rl.check('b').ok).toBe(true);
    now = 1001;
    expect(rl.check('a').ok).toBe(true);
  });
  it('caps a single key per day so one client cannot exhaust the global cap (review #2)', () => {
    let now = Date.UTC(2026, 9, 2, 1, 0);
    const rl = new RateLimiter(100, 1000, 1000, () => now, 3);
    for (let i = 0; i < 3; i++) { expect(rl.check('a').ok).toBe(true); now += 2000; }
    expect(rl.check('a')).toMatchObject({ ok: false, reason: expect.stringMatching(/per day/) });
    expect(rl.check('b').ok).toBe(true);
  });
  it('enforces a global daily cap that resets each UTC day', () => {
    let now = Date.UTC(2026, 9, 2, 23, 0);
    const rl = new RateLimiter(100, 1000, 2, () => now);
    rl.check('a'); rl.check('b');
    expect(rl.check('c')).toMatchObject({ ok: false, reason: expect.stringMatching(/daily/) });
    now = Date.UTC(2026, 9, 3, 0, 1);
    expect(rl.check('c').ok).toBe(true);
  });
});
