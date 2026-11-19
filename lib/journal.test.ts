import { describe, expect, it } from 'vitest';
import { applyJournalEvent, isJournalEvent, journalHeadline, resolveRecordDate, sortJournalHistory } from './journal';
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
    // 更正事件在初始状态上没有可改的（本来就是未记录）
    expect(changed('eligibility_cleared')).toEqual([]);
    expect(changed('decision_cleared')).toEqual([]);
    expect(changed('participation_cleared')).toEqual([]);
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

describe('更正事件（第三阶段）', () => {
  const full = () =>
    entry({
      application: 'submitted',
      submitted_on: '2026-11-05',
      eligibility_confirmation: 'confirmed',
      decision: 'admitted',
      participated: true,
      history: [
        { event: 'added', on: '2026-11-01' },
        { event: 'submitted', on: '2026-11-05' },
        { event: 'eligibility_confirmed', on: '2026-11-08' },
        { event: 'admitted', on: '2026-11-10' },
        { event: 'participated', on: '2026-11-12' },
      ],
    });
  const fields = ['application', 'submitted_on', 'eligibility_confirmation', 'decision', 'participated'] as const;
  const initial = entry();

  const cases = [
    ['eligibility_cleared', 'eligibility_confirmation'],
    ['decision_cleared', 'decision'],
    ['participation_cleared', 'participated'],
  ] as const;

  for (const [ev, field] of cases) {
    it(`${ev}：恢复成初始值，只改 ${field}，history 追加，幂等`, () => {
      const base = full();
      const n = applyJournalEvent(base, ev, '2026-11-15');
      expect(n[field]).toBe(initial[field]);
      for (const k of fields) if (k !== field) expect(n[k]).toBe(base[k]);
      expect(n.history).toEqual([...base.history, { event: ev, on: '2026-11-15' }]);
      expect(base.history).toHaveLength(5); // 不修改输入
      expect(applyJournalEvent(n, ev, '2026-11-15')).toEqual(n);
      // 更正之后可以重新记录
      const again = applyJournalEvent(n, ev === 'eligibility_cleared' ? 'eligibility_rejected' : ev === 'decision_cleared' ? 'not_admitted' : 'did_not_participate', '2026-11-16');
      expect(again[field]).not.toBe(initial[field]);
    });
  }

  it('三项都清除后回到和新建条目一样的状态（申请进度不受影响）', () => {
    let n = full();
    for (const [ev] of cases) n = applyJournalEvent(n, ev, '2026-11-15');
    expect(n).toMatchObject({ application: 'submitted', submitted_on: '2026-11-05', eligibility_confirmation: 'unconfirmed', decision: 'pending', participated: null });
    n = applyJournalEvent(n, 'reopened', '2026-11-15');
    for (const k of fields) expect(n[k]).toBe(initial[k]);
    expect(n.history.map((h) => h.event).slice(-4)).toEqual(['eligibility_cleared', 'decision_cleared', 'participation_cleared', 'reopened']);
  });

  it('journalHeadline：清除后不再提到被清除的那一项', () => {
    const base = full();
    expect(journalHeadline(base)).toBe('Submitted on 2026-11-05 · eligibility confirmed by the organizer · admitted · took part');
    expect(journalHeadline(applyJournalEvent(base, 'eligibility_cleared', '2026-11-15'))).toBe('Submitted on 2026-11-05 · admitted · took part');
    expect(journalHeadline(applyJournalEvent(base, 'decision_cleared', '2026-11-15'))).toBe(
      'Submitted on 2026-11-05 · eligibility confirmed by the organizer · took part',
    );
    expect(journalHeadline(applyJournalEvent(base, 'participation_cleared', '2026-11-15'))).toBe(
      'Submitted on 2026-11-05 · eligibility confirmed by the organizer · admitted',
    );
  });

  it('isJournalEvent 认识新事件；旧数据（没有新事件的 history）照常应用', () => {
    for (const [ev] of cases) expect(isJournalEvent(ev)).toBe(true);
    const old = entry({ decision: 'not_admitted', history: [{ event: 'added', on: '2026-11-01' }, { event: 'not_admitted', on: '2026-11-02' }] });
    const n = applyJournalEvent(old, 'submitted', '2026-11-03');
    expect(n).toMatchObject({ application: 'submitted', decision: 'not_admitted' });
    expect(n.history).toHaveLength(3);
  });

  it('补记过去的日期：submitted_on 用所给日期', () => {
    const n = applyJournalEvent(entry(), 'submitted', '2026-10-28');
    expect(n.submitted_on).toBe('2026-10-28');
    expect(n.history.at(-1)).toEqual({ event: 'submitted', on: '2026-10-28' });
  });
});

describe('sortJournalHistory', () => {
  it('按日期排序，同一天保持记录先后，不修改输入', () => {
    const h = [
      { event: 'added', on: '2026-11-10' },
      { event: 'admitted', on: '2026-11-12' },
      { event: 'submitted', on: '2026-11-03' },
      { event: 'decision_cleared', on: '2026-11-12' },
      { event: 'not_admitted', on: '2026-11-12' },
    ] as const;
    const copy = structuredClone(h);
    expect(sortJournalHistory(h).map((x) => x.event)).toEqual(['submitted', 'added', 'admitted', 'decision_cleared', 'not_admitted']);
    expect(h).toEqual(copy);
    expect(sortJournalHistory([])).toEqual([]);
  });
});

describe('resolveRecordDate', () => {
  const today = '2026-11-18';
  it('合法且不晚于今天：原样', () => {
    expect(resolveRecordDate('2026-11-03', today)).toBe('2026-11-03');
    expect(resolveRecordDate('2026-11-18', today)).toBe('2026-11-18');
    expect(resolveRecordDate(' 2024-02-29 ', today)).toBe('2024-02-29');
  });
  it('空、非法、晚于今天：用今天', () => {
    expect(resolveRecordDate('', today)).toBe(today);
    expect(resolveRecordDate(null, today)).toBe(today);
    expect(resolveRecordDate(undefined, today)).toBe(today);
    expect(resolveRecordDate('2026-11-19', today)).toBe(today);
    expect(resolveRecordDate('2026-02-30', today)).toBe(today);
    expect(resolveRecordDate('2025-02-29', today)).toBe(today);
    expect(resolveRecordDate('2026-13-01', today)).toBe(today);
    expect(resolveRecordDate('11/03/2026', today)).toBe(today);
  });
});
