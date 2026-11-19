import { describe, expect, it } from 'vitest';
import { hasOfficialPage, isPlaceholderUrl, journalOfficialUrl } from './official-link';

// Fictional fixtures: a catalog-style record and the two kinds of sample records.
const official = { official_url: 'https://programs.fixture-university.edu/summer', is_sample: false, source_tier: 'official' as const };
const posted = { official_url: 'https://example.com/sample-post-x', is_sample: true, source_tier: 'user_posted' as const };
const sample = { official_url: 'https://programs.fixture-university.edu/sample', is_sample: true };

describe('isPlaceholderUrl', () => {
  it('treats reserved example domains, their subdomains and non-http(s) or broken values as placeholders', () => {
    for (const url of ['https://example.com/x', 'http://EXAMPLE.org', 'https://www.example.net/a', 'https://example.com./x', 'javascript:alert(1)', 'mailto:a@b.c', 'not a url', '', '  ', null, undefined, 42]) {
      expect(isPlaceholderUrl(url)).toBe(true);
    }
  });
  it('does not treat look-alike real hosts as placeholders', () => {
    for (const url of ['https://notexample.com/x', 'https://example.com.fixture.edu/x', 'https://programs.fixture-university.edu/summer']) {
      expect(isPlaceholderUrl(url)).toBe(false);
    }
  });
});

describe('hasOfficialPage', () => {
  it('only catalog records with a real address have an official page', () => {
    expect(hasOfficialPage(official)).toBe(true);
    expect(hasOfficialPage({ official_url: official.official_url })).toBe(true);
    expect(hasOfficialPage(posted)).toBe(false);
    expect(hasOfficialPage({ ...posted, official_url: official.official_url })).toBe(false);
    expect(hasOfficialPage(sample)).toBe(false);
    expect(hasOfficialPage({ ...official, official_url: 'https://example.org/x' })).toBe(false);
  });
});

describe('journalOfficialUrl', () => {
  it('uses the opportunity when it is found, and falls back to a non-placeholder saved address otherwise', () => {
    expect(journalOfficialUrl(official, 'https://example.com/old')).toBe(official.official_url);
    expect(journalOfficialUrl(posted, official.official_url)).toBeNull();
    expect(journalOfficialUrl(sample, official.official_url)).toBeNull();
    expect(journalOfficialUrl(undefined, 'https://example.com/sample-post-withdrawn')).toBeNull();
    expect(journalOfficialUrl(undefined, '')).toBeNull();
    expect(journalOfficialUrl(undefined, undefined)).toBeNull();
    expect(journalOfficialUrl(undefined, official.official_url)).toBe(official.official_url);
  });
});
