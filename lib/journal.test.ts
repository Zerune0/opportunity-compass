import { describe, expect, it } from 'vitest';
import { applyJournalEvent, isJournalEvent, journalHeadline } from './journal';
import { JOURNAL_EVENTS, type JournalEntry } from './types';

function entry(over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: 'j1',
    profile_id: 'p1',
    opportunity_id: 'o1',
    added_on: '2026-11-01',
    application: 'preparing',
    submitted_on: null,
    eligibility_confirmation: 'unconfirmed',
    decision: 'pending',
    participated: null,
    history: [{ event: 'added', on: '2026-11-01' }],
    tasks: [],
    material_ids: [],
    official_url: 'https://example.org/o1',
    ...over,
  };
}

describe('applyJournalEvent', () => {
  it('纯函数：不修改输入', () => {
    const e = entry();
    const copy = structuredClone(e);
    applyJournalEvent(e, 'submitted', '2026-11-10');
    expect(e).toEqual(copy);
  });

  it('每个事件只改自己对应的那一项', () => {
    const base = entry();
    const changed = (ev: (typeof JOURNAL_EVENTS)[number]) => {
      const n = applyJournalEvent(base, ev, '2026-11-10');
      return (['application', 'submitted_on', 'eligibility_confirmation', 'decision', 'participated'] as const).filter((k) => n[k] !== base[k]);
    };
    expect(changed('added')).toEqual([]);
    expect(changed('submitted')).toEqual(['application', 'submitted_on']);
    expect(changed('withdrawn')).toEqual(['application']);
    expect(changed('eligibility_confirmed')).toEqual(['eligibility_confirmation']);
    expect(changed('eligibility_rejected')).toEqual(['eligibility_confirmation']);
    expect(changed('admitted')).toEqual(['decision']);
    expect(changed('not_admitted')).toEqual(['decision']);
    expect(changed('participated')).toEqual(['participated']);
    expect(changed('did_not_participate')).toEqual(['participated']);
  });

  it('同一事件同一天不重复追加 history', () => {
    const once = applyJournalEvent(entry(), 'submitted', '2026-11-10');
    const twice = applyJournalEvent(once, 'submitted', '2026-11-10');
    expect(twice).toEqual(once);
    expect(applyJournalEvent(entry(), 'added', '2026-11-01').history).toHaveLength(1);
  });

  it('isJournalEvent', () => {
    for (const e of JOURNAL_EVENTS) expect(isJournalEvent(e)).toBe(true);
    expect(isJournalEvent('status')).toBe(false);
    expect(isJournalEvent(null)).toBe(false);
  });
});

describe('journalHeadline', () => {
  it('四项分别出现，不由一项推断另一项', () => {
    expect(journalHeadline(entry())).toBe('Preparing');
    const submitted = entry({ application: 'submitted', submitted_on: '2026-11-10' });
    expect(journalHeadline(submitted)).toBe('Submitted on 2026-11-10');
    expect(journalHeadline(submitted)).not.toMatch(/eligib|admitted/i);
    expect(journalHeadline(entry({ application: 'submitted', submitted_on: '2026-11-10', eligibility_confirmation: 'confirmed', decision: 'admitted', participated: true }))).toBe(
      'Submitted on 2026-11-10 · eligibility confirmed by the organizer · admitted · took part',
    );
    expect(journalHeadline(entry({ application: 'withdrawn', eligibility_confirmation: 'rejected', decision: 'not_admitted', participated: false }))).toBe(
      'Withdrawn · organizer said not eligible · not admitted · did not take part',
    );
  });
});
