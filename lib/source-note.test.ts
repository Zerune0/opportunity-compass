import { describe, expect, it } from 'vitest';
import { catalogOpportunities } from '@/lib/data';
import { parseSourceText, splitSourceNote } from './source-text';

describe('splitSourceNote', () => {
  it('separates the note from the link, the verification line and the estimate disclaimer', () => {
    const note = 'Human-verified application instructions: Submit one transcript per institution; unofficial transcripts are accepted. Source: https://www.noaa.gov/office-education/hollings-scholarship/prospective/faq Verified by Jiale Li on 2026-11-19. Preparation hours and cost are team estimates for this task, not official program commitments or fees.';
    expect(splitSourceNote(note)).toEqual({
      body: 'Submit one transcript per institution; unofficial transcripts are accepted.',
      url: 'https://www.noaa.gov/office-education/hollings-scholarship/prospective/faq',
      verified: 'Verified by Jiale Li on 2026-11-19.',
      estimate_note: 'Preparation hours and cost are team estimates for this task, not official program commitments or fees.',
      human_verified: true,
    });
  });

  it('handles team suggestions with only an estimate sentence', () => {
    expect(splitSourceNote('Team suggestion, not an official application requirement. Time and cost are estimates for preparation only.')).toEqual({
      body: 'Team suggestion, not an official application requirement.',
      url: null, verified: null, estimate_note: 'Time and cost are estimates for preparation only.', human_verified: false,
    });
  });

  it('keeps plain text as the body and returns nulls for nothing', () => {
    expect(splitSourceNote('Texas resident').body).toBe('Texas resident');
    expect(splitSourceNote(null).body).toBeNull();
    expect(splitSourceNote('   ').body).toBeNull();
  });

  it('never leaves a link, verification line or estimate sentence in the body for any catalog item', () => {
    const leftovers: string[] = [];
    for (const o of catalogOpportunities()) {
      for (const item of [...o.preparation, ...o.requirements]) {
        const parsed = parseSourceText(item.source_text);
        const parts = splitSourceNote(parsed.notes);
        if (parts.body && /https?:\/\/|Verified by|are (team )?estimates/i.test(parts.body)) leftovers.push(`${o.id}/${item.id}: ${parts.body}`);
      }
    }
    expect(leftovers).toEqual([]);
  });
});
