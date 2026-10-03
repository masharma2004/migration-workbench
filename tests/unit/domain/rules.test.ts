import { describe, expect, it } from 'vitest';
import { describeRules, getRule, RULE_NAMES } from '@/domain/rules';
import type { Scalar } from '@/domain/types';

function run(rule: string, value: Scalar, params: Record<string, unknown> = {}) {
  const def = getRule(rule);
  if (!def) throw new Error(`no rule ${rule}`);
  return def.apply(value, def.params.parse(params));
}

describe('catalog', () => {
  it('has 11 rules, each with description and JSON-schema params', () => {
    expect(RULE_NAMES).toHaveLength(11);
    for (const r of describeRules()) {
      expect(r.description.length).toBeGreaterThan(10);
      expect(r.params).toHaveProperty('type', 'object');
      expect(r.params).not.toHaveProperty('$schema');
    }
  });
  it('passes null through for every rule except required and default_value', () => {
    const params: Record<string, Record<string, unknown>> = {
      split_name: { part: 'first' },
      parse_date: { formats: ['YYYY-MM-DD'] },
      phone_to_e164: { defaultCountry: 'US' },
      map_values: { mapping: { a: 'b' } },
      to_boolean: { truthy: ['y'], falsy: ['n'] },
      default_value: { value: 'x' },
    };
    for (const name of RULE_NAMES) {
      if (name === 'required' || name === 'default_value') continue;
      expect(run(name, null, params[name] ?? {})).toEqual({ ok: true, value: null });
    }
  });
});

describe('text rules', () => {
  it('trim strips, collapses inner whitespace, and turns empty into null', () => {
    expect(run('trim', '  John   Smith ')).toEqual({ ok: true, value: 'John Smith' });
    expect(run('trim', '   ')).toEqual({ ok: true, value: null });
  });
  it('lowercase', () => {
    expect(run('lowercase', 'A+B@X.IO')).toEqual({ ok: true, value: 'a+b@x.io' });
  });
  it('split_name handles "First Last", "Last, First", and single names', () => {
    expect(run('split_name', 'John Smith', { part: 'first' })).toEqual({ ok: true, value: 'John' });
    expect(run('split_name', 'Mary Ann Lee', { part: 'last' })).toEqual({ ok: true, value: 'Ann Lee' });
    expect(run('split_name', 'Smith, John Q', { part: 'first' })).toEqual({ ok: true, value: 'John Q' });
    expect(run('split_name', 'Smith, John Q', { part: 'last' })).toEqual({ ok: true, value: 'Smith' });
    expect(run('split_name', 'Madonna', { part: 'first' })).toEqual({ ok: true, value: 'Madonna' });
    expect(run('split_name', 'Madonna', { part: 'last' })).toEqual({ ok: true, value: null });
  });
  it('split_name keeps unicode and apostrophes intact (review focus 1)', () => {
    expect(run('split_name', 'José Núñez', { part: 'last' })).toEqual({ ok: true, value: 'Núñez' });
    expect(run('split_name', "Sinéad O'Brien", { part: 'last' })).toEqual({ ok: true, value: "O'Brien" });
  });
  it('required fails on null only', () => {
    expect(run('required', null)).toMatchObject({ ok: false, code: 'REQUIRED_MISSING' });
    expect(run('required', 'x')).toEqual({ ok: true, value: 'x' });
  });
  it('default_value fills null only', () => {
    expect(run('default_value', null, { value: false })).toEqual({ ok: true, value: false });
    expect(run('default_value', true, { value: false })).toEqual({ ok: true, value: true });
  });
});

describe('parse_date', () => {
  const all = { formats: ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'DD-MMM-YYYY'] };
  it('parses each supported format to ISO', () => {
    expect(run('parse_date', '2019-03-14', all)).toEqual({ ok: true, value: '2019-03-14' });
    expect(run('parse_date', '03/14/2019', all)).toEqual({ ok: true, value: '2019-03-14' });
    expect(run('parse_date', '14/03/2019', all)).toEqual({ ok: true, value: '2019-03-14' });
    expect(run('parse_date', '14-Mar-2019', all)).toEqual({ ok: true, value: '2019-03-14' });
    expect(run('parse_date', '2019/3/4', { formats: ['YYYY/MM/DD'] })).toEqual({ ok: true, value: '2019-03-04' });
  });
  it('resolves ambiguous dates by format order', () => {
    expect(run('parse_date', '04/05/2019', all)).toEqual({ ok: true, value: '2019-04-05' });
    expect(run('parse_date', '04/05/2019', { formats: ['DD/MM/YYYY', 'MM/DD/YYYY'] })).toEqual({
      ok: true,
      value: '2019-05-04',
    });
  });
  it('rejects impossible calendar dates', () => {
    expect(run('parse_date', '2019-02-30', all)).toMatchObject({ ok: false, code: 'INVALID_DATE' });
    expect(run('parse_date', '2020-02-29', all)).toEqual({ ok: true, value: '2020-02-29' });
    expect(run('parse_date', '31/31/2020', all)).toMatchObject({ ok: false, code: 'INVALID_DATE' });
  });
  it('rejects two-digit years, serial numbers and words (review focus 2)', () => {
    for (const v of ['3/4/19', '43567', 'unknown', '2019-3', '1850-01-01']) {
      expect(run('parse_date', v, all)).toMatchObject({ ok: false, code: 'INVALID_DATE' });
    }
  });
  it('rejects formats outside the catalog at param validation', () => {
    expect(getRule('parse_date')!.params.safeParse({ formats: ['YY-MM-DD'] }).success).toBe(false);
  });
});

describe('phone_to_e164', () => {
  it('formats national numbers with the default country and keeps international ones', () => {
    expect(run('phone_to_e164', '(212) 555-0187', { defaultCountry: 'US' })).toMatchObject({ ok: true });
    expect(run('phone_to_e164', '+44 20 7946 0018', { defaultCountry: 'US' })).toEqual({
      ok: true,
      value: '+442079460018',
    });
  });
  it('rejects garbage', () => {
    expect(run('phone_to_e164', 'call me', { defaultCountry: 'US' })).toMatchObject({
      ok: false,
      code: 'INVALID_PHONE',
    });
    expect(run('phone_to_e164', '12', { defaultCountry: 'US' })).toMatchObject({ ok: false });
  });
  it('rejects unsupported default countries at param validation', () => {
    expect(getRule('phone_to_e164')!.params.safeParse({ defaultCountry: 'XX' }).success).toBe(false);
  });
});

describe('lookup rules', () => {
  it('map_values is case-insensitive by default and errors on unmapped', () => {
    const p = { mapping: { A: 'active', Closed: 'closed' } };
    expect(run('map_values', 'a', p)).toEqual({ ok: true, value: 'active' });
    expect(run('map_values', 'CLOSED', p)).toEqual({ ok: true, value: 'closed' });
    expect(run('map_values', 'S', p)).toMatchObject({ ok: false, code: 'UNMAPPED_VALUE' });
  });
  it('map_values honours onUnmapped and caseInsensitive=false', () => {
    const base = { mapping: { A: 'active' } };
    expect(run('map_values', 'S', { ...base, onUnmapped: 'null' })).toEqual({ ok: true, value: null });
    expect(run('map_values', 'S', { ...base, onUnmapped: 'passthrough' })).toEqual({ ok: true, value: 'S' });
    expect(run('map_values', 'a', { ...base, caseInsensitive: false })).toMatchObject({ ok: false });
  });
  it('to_boolean maps listed values and rejects others', () => {
    const p = { truthy: ['y', 'yes', '1'], falsy: ['n', 'no', '0'] };
    expect(run('to_boolean', 'YES', p)).toEqual({ ok: true, value: true });
    expect(run('to_boolean', '0', p)).toEqual({ ok: true, value: false });
    expect(run('to_boolean', true, p)).toEqual({ ok: true, value: true });
    expect(run('to_boolean', 'maybe', p)).toMatchObject({ ok: false, code: 'INVALID_BOOLEAN' });
  });
  it('country_to_iso2 handles codes, names, dots and accents', () => {
    for (const [input, out] of [
      ['USA', 'US'], ['U.S.', 'US'], ['United States', 'US'], ['in', 'IN'],
      ['India', 'IN'], ['Deutschland', 'DE'], ['España', 'ES'], ['gb', 'GB'],
    ] as const) {
      expect(run('country_to_iso2', input)).toEqual({ ok: true, value: out });
    }
    expect(run('country_to_iso2', 'Atlantis')).toMatchObject({ ok: false, code: 'UNKNOWN_COUNTRY' });
  });
});

describe('currency_to_cents', () => {
  it('parses dollar amounts without floating-point drift', () => {
    expect(run('currency_to_cents', '$1,234.50')).toEqual({ ok: true, value: 123450 });
    expect(run('currency_to_cents', '1234.5')).toEqual({ ok: true, value: 123450 });
    expect(run('currency_to_cents', '0.29')).toEqual({ ok: true, value: 29 });
    expect(run('currency_to_cents', 'USD 10')).toEqual({ ok: true, value: 1000 });
  });
  it('handles negatives according to allowNegative', () => {
    expect(run('currency_to_cents', '-50.00')).toMatchObject({ ok: false, code: 'NEGATIVE_AMOUNT' });
    expect(run('currency_to_cents', '-$50.00', { allowNegative: true })).toEqual({ ok: true, value: -5000 });
  });
  it('rejects other currencies and non-numbers', () => {
    expect(run('currency_to_cents', '€300')).toMatchObject({ ok: false, code: 'UNSUPPORTED_CURRENCY' });
    expect(run('currency_to_cents', 'EUR 300')).toMatchObject({ ok: false, code: 'UNSUPPORTED_CURRENCY' });
    expect(run('currency_to_cents', 'N/A')).toMatchObject({ ok: false, code: 'INVALID_NUMBER' });
  });
  it('never silently rounds or overflows (review focus 3)', () => {
    expect(run('currency_to_cents', '1,234.567')).toMatchObject({ ok: false, code: 'INVALID_NUMBER' });
    expect(run('currency_to_cents', '12,34.00')).toMatchObject({ ok: false, code: 'INVALID_NUMBER' });
    expect(run('currency_to_cents', '99999999999999.99')).toMatchObject({
      ok: false,
      code: 'AMOUNT_OUT_OF_RANGE',
    });
  });
});
