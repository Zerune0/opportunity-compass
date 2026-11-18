import { describe, expect, it } from 'vitest';
import { fmt, joinAnd, plural, pluralNoun } from './format';

describe('plural', () => {
  it('0 → plural form', () => {
    expect(plural(0, 'measure')).toBe('0 measures');
  });
  it('1 → singular form', () => {
    expect(plural(1, 'measure')).toBe('1 measure');
    expect(plural(1, 'hour')).toBe('1 hour');
  });
  it('2 → plural form', () => {
    expect(plural(2, 'measure')).toBe('2 measures');
  });
  it('irregular plural via third argument', () => {
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
    expect(plural(0, 'person', 'people')).toBe('0 people');
  });
  it('decimals follow fmt and are plural unless they display as 1', () => {
    expect(plural(1.5, 'hour')).toBe('1.5 hours');
    expect(plural(0.5, 'hour')).toBe('0.5 hours');
    expect(fmt(1.04)).toBe('1');
    expect(plural(1.04, 'hour')).toBe('1 hour');
  });
});

describe('pluralNoun', () => {
  it('returns only the word', () => {
    expect(pluralNoun(1, 'is', 'are')).toBe('is');
    expect(pluralNoun(2, 'is', 'are')).toBe('are');
    expect(pluralNoun(0, 'pair')).toBe('pairs');
  });
});

describe('joinAnd', () => {
  it('joins 0 / 1 / 2 / 3 items', () => {
    expect(joinAnd([])).toBe('');
    expect(joinAnd(['A'])).toBe('A');
    expect(joinAnd(['A', 'B'])).toBe('A and B');
    expect(joinAnd(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
