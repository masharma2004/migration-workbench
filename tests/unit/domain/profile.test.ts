import { describe, expect, it } from 'vitest';
import { profileField } from '@/domain/engine';

const recs = (values: (string | null)[]) => values.map((v, i) => ({ seq: i + 1, raw: { signup_date: v } }));

describe('profileField', () => {
  it('counts nulls, distinct values and top values', () => {
    const p = profileField(recs(['a', 'a', 'b', null, '  ']), 'signup_date');
    expect(p).toMatchObject({ total: 5, nullCount: 2, nullRate: 0.4, distinctCount: 2 });
    expect(p.topValues[0]).toEqual({ value: 'a', count: 2 });
  });
  it('labels slash dates as ambiguous, day-first or month-first', () => {
    const p = profileField(recs(['04/05/2019', '14/03/2019', '03/14/2019', '2019-03-14']), 'signup_date');
    const labels = p.patterns.map((x) => x.pattern);
    expect(labels).toEqual(expect.arrayContaining([
      '99/99/9999 [ambiguous: both parts <= 12]',
      '99/99/9999 [day-first: first part > 12]',
      '99/99/9999 [month-first: second part > 12]',
      '9999-99-99',
    ]));
  });
});
