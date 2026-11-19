import { describe, expect, it } from 'vitest';
import {
  CALENDAR_FOOTER,
  CALENDAR_TIME_HINT,
  buildDeadlineCalendar,
  calendarUidPart,
  escapeCalendarText,
  foldCalendarLine,
  parseCalendarDate,
  type CalendarItem,
} from './calendar';

const OPTS = { generatedOn: '2026-11-18' };

function item(overrides: Partial<CalendarItem> = {}): CalendarItem {
  return {
    opportunity_id: 'opp-a',
    title: 'Fictional Science Fair',
    deadline: '2026-12-01',
    deadline_note: '5:00 PM Eastern Time',
    official_url: 'https://example.org/fair',
    ...overrides,
  };
}

/** RFC 5545 unfolding: remove CRLF followed by one space. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, '').split('\r\n');
}

function events(ics: string): string[][] {
  const lines = unfold(ics);
  const out: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') current = [];
    else if (line === 'END:VEVENT' && current) {
      out.push(current);
      current = null;
    } else if (current) current.push(line);
  }
  return out;
}

function prop(event: string[], name: string): string | undefined {
  const line = event.find((l) => l.startsWith(`${name}:`) || l.startsWith(`${name};`));
  return line?.slice(line.indexOf(':') + 1);
}

const utf8 = (s: string) => new TextEncoder().encode(s).length;

describe('buildDeadlineCalendar: structure', () => {
  it('produces a VCALENDAR with required properties and CRLF line endings', () => {
    const { ics, included, skipped } = buildDeadlineCalendar([item()], OPTS);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:')).toBe(true);
    expect(ics).toContain('\r\nCALSCALE:GREGORIAN\r\n');
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    expect(ics).not.toContain('VALARM');
    expect(included).toEqual(['opp-a']);
    expect(skipped).toEqual([]);
  });

  it('writes one all-day deadline event with summary, description, URL and DTSTAMP', () => {
    const [ev] = events(buildDeadlineCalendar([item()], OPTS).ics);
    expect(prop(ev, 'UID')).toBe('opp-a-deadline@opportunity-compass');
    expect(prop(ev, 'DTSTAMP')).toBe('20261118T000000Z');
    expect(ev).toContain('DTSTART;VALUE=DATE:20261201');
    expect(ev).toContain('DTEND;VALUE=DATE:20261202');
    expect(prop(ev, 'SUMMARY')).toBe('Deadline: Fictional Science Fair');
    expect(prop(ev, 'URL')).toBe('https://example.org/fair');
    const desc = prop(ev, 'DESCRIPTION')!;
    expect(desc).toContain('5:00 PM Eastern Time');
    expect(desc).toContain(CALENDAR_TIME_HINT);
    expect(desc).toContain('Official page: https://example.org/fair');
    expect(desc).toContain(escapeCalendarText(CALENDAR_FOOTER));
  });

  it('omits URL for non-http(s) links and still writes the event', () => {
    for (const official_url of ['javascript:alert(1)', 'ftp://example.org/x', 'not a url', null, undefined]) {
      const [ev] = events(buildDeadlineCalendar([item({ official_url })], OPTS).ics);
      expect(prop(ev, 'URL')).toBeUndefined();
      expect(prop(ev, 'DESCRIPTION')).not.toContain('Official page');
    }
  });

  it('adds a multi-day program event only when asked and both dates are valid', () => {
    const it1 = item({ program_start: '2027-06-28', program_end: '2027-07-31' });
    expect(events(buildDeadlineCalendar([it1], OPTS).ics)).toHaveLength(1);

    const res = buildDeadlineCalendar([it1], { ...OPTS, includeProgramDates: true });
    const evs = events(res.ics);
    expect(evs).toHaveLength(2);
    expect(prop(evs[1], 'SUMMARY')).toBe('Program: Fictional Science Fair');
    expect(evs[1]).toContain('DTSTART;VALUE=DATE:20270628');
    expect(evs[1]).toContain('DTEND;VALUE=DATE:20270801');
    expect(prop(evs[1], 'UID')).toBe('opp-a-program@opportunity-compass');
    expect(res.program_included).toEqual(['opp-a']);

    for (const bad of [
      { program_start: '2027-07-31', program_end: '2027-06-28' },
      { program_start: '2027-06-28', program_end: null },
      { program_start: '2027-02-30', program_end: '2027-03-02' },
    ]) {
      const r = buildDeadlineCalendar([item(bad)], { ...OPTS, includeProgramDates: true });
      expect(events(r.ics)).toHaveLength(1);
      expect(r.program_included).toEqual([]);
    }
  });

  it('adds program dates even when the deadline is missing (deadline still reported as skipped)', () => {
    const r = buildDeadlineCalendar(
      [item({ deadline: null, program_start: '2027-01-05', program_end: '2027-01-05' })],
      { ...OPTS, includeProgramDates: true },
    );
    expect(r.included).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual(['no_deadline']);
    const [ev] = events(r.ics);
    expect(ev).toContain('DTSTART;VALUE=DATE:20270105');
    expect(ev).toContain('DTEND;VALUE=DATE:20270106');
  });
});

describe('escaping and folding', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeCalendarText('a\\b;c,d\ne\r\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng');
    const [ev] = events(buildDeadlineCalendar([item({ title: 'Code, Build; Ship\\Now\nPart 2' })], OPTS).ics);
    expect(prop(ev, 'SUMMARY')).toBe('Deadline: Code\\, Build\\; Ship\\\\Now\\nPart 2');
  });

  it('strips control characters', () => {
    expect(escapeCalendarText('a\u0000b\u0007c\td')).toBe('abcd');
  });

  it('folds lines longer than 75 bytes and never splits a multi-byte character', () => {
    const titles = [
      'A'.repeat(200),
      '全国青少年科技创新大赛'.repeat(8),
      '🚀🌍 Climate Hackathon 🌱'.repeat(6),
      'é'.repeat(100),
    ];
    for (const title of titles) {
      const { ics } = buildDeadlineCalendar([item({ title })], OPTS);
      const physical = ics.split('\r\n').slice(0, -1);
      for (const line of physical) {
        expect(utf8(line)).toBeLessThanOrEqual(75);
        expect(line).not.toMatch(/[\uD800-\uDBFF]$/); // no dangling high surrogate
        expect(line).not.toMatch(/^ ?[\uDC00-\uDFFF]/); // no orphan low surrogate
      }
      const [ev] = events(ics);
      expect(prop(ev, 'SUMMARY')).toBe(escapeCalendarText(`Deadline: ${title}`));
    }
  });

  it('foldCalendarLine leaves short lines alone and uses CRLF + space for continuation', () => {
    expect(foldCalendarLine('SUMMARY:short')).toBe('SUMMARY:short');
    const folded = foldCalendarLine('X'.repeat(160));
    const parts = folded.split('\r\n');
    expect(parts[0]).toHaveLength(75);
    expect(parts.slice(1).every((p) => p.startsWith(' ') && utf8(p) <= 75)).toBe(true);
    expect(folded.replace(/\r\n /g, '')).toBe('X'.repeat(160));
  });
});

describe('dates', () => {
  const end = (deadline: string) =>
    events(buildDeadlineCalendar([item({ deadline })], OPTS).ics)[0].find((l) => l.startsWith('DTEND'));

  it('computes DTEND across months, years and leap days', () => {
    expect(end('2026-01-31')).toBe('DTEND;VALUE=DATE:20260201');
    expect(end('2026-04-30')).toBe('DTEND;VALUE=DATE:20260501');
    expect(end('2026-12-31')).toBe('DTEND;VALUE=DATE:20270101');
    expect(end('2028-02-28')).toBe('DTEND;VALUE=DATE:20280229');
    expect(end('2028-02-29')).toBe('DTEND;VALUE=DATE:20280301');
    expect(end('2027-02-28')).toBe('DTEND;VALUE=DATE:20270301');
    expect(end('2100-02-28')).toBe('DTEND;VALUE=DATE:21000301');
    expect(end('2000-02-28')).toBe('DTEND;VALUE=DATE:20000229');
  });

  it('parseCalendarDate rejects impossible or malformed dates', () => {
    for (const bad of ['2027-02-29', '2027-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2026-1-01', '20261201', '', null, 5]) {
      expect(parseCalendarDate(bad)).toBeNull();
    }
    expect(parseCalendarDate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 });
  });

  it('falls back to a fixed DTSTAMP when generatedOn is invalid (never reads the clock)', () => {
    const [ev] = events(buildDeadlineCalendar([item()], { generatedOn: 'today' }).ics);
    expect(prop(ev, 'DTSTAMP')).toBe('19700101T000000Z');
  });
});

describe('skip rules', () => {
  it('skips missing, invalid and withdrawn items and reports them', () => {
    const res = buildDeadlineCalendar(
      [
        item({ opportunity_id: 'a', title: 'A' }),
        item({ opportunity_id: 'b', title: 'B', deadline: null }),
        item({ opportunity_id: 'c', title: 'C', deadline: '2027-02-30' }),
        item({ opportunity_id: 'd', title: 'D', application: 'withdrawn' }),
        item({ opportunity_id: 'e', title: 'E', application: 'submitted' }),
        { opportunity_id: 'f', title: 'F' },
      ],
      OPTS,
    );
    expect(res.included).toEqual(['a', 'e']);
    expect(res.skipped).toEqual([
      { opportunity_id: 'b', title: 'B', reason: 'no_deadline' },
      { opportunity_id: 'c', title: 'C', reason: 'invalid_deadline' },
      { opportunity_id: 'd', title: 'D', reason: 'withdrawn' },
      { opportunity_id: 'f', title: 'F', reason: 'no_deadline' },
    ]);
    expect(events(res.ics)).toHaveLength(2);
  });

  it('produces an empty but valid calendar when nothing qualifies', () => {
    const res = buildDeadlineCalendar([item({ deadline: null })], OPTS);
    expect(res.ics).toBe(
      ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//Opportunity Compass//Quest Journal Deadlines//EN`,
        'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Opportunity Compass deadlines', 'END:VCALENDAR', ''].join('\r\n'),
    );
  });

  it('uses the id as title when the title is missing', () => {
    const res = buildDeadlineCalendar([{ opportunity_id: 'x1', deadline: '2026-12-01' }], OPTS);
    expect(prop(events(res.ics)[0], 'SUMMARY')).toBe('Deadline: x1');
  });
});

describe('UIDs', () => {
  it('are stable, unique and sanitized', () => {
    const ids = ['a b', 'a-b', 'a/b', '中文', 'ok.id_1'];
    const res = buildDeadlineCalendar(ids.map((opportunity_id) => item({ opportunity_id })), OPTS);
    const uids = events(res.ics).map((ev) => prop(ev, 'UID')!);
    expect(new Set(uids).size).toBe(ids.length);
    for (const uid of uids) expect(uid).toMatch(/^[A-Za-z0-9._-]+@opportunity-compass$/);
    expect(uids[1]).toBe('a-b-deadline@opportunity-compass');
    expect(uids[4]).toBe('ok.id_1-deadline@opportunity-compass');
    expect(calendarUidPart('a b')).toBe(calendarUidPart('a b'));
    expect(calendarUidPart('a b')).not.toBe(calendarUidPart('a-b'));
  });

  it('ignores duplicate opportunity ids after the first', () => {
    const res = buildDeadlineCalendar([item(), item({ title: 'Duplicate' })], OPTS);
    expect(res.included).toEqual(['opp-a']);
    expect(events(res.ics)).toHaveLength(1);
  });
});

describe('determinism and bad input', () => {
  it('returns identical output for identical input', () => {
    const input = [item(), item({ opportunity_id: 'b', deadline: '2027-03-15', program_start: '2027-06-01', program_end: '2027-06-30' })];
    const opts = { ...OPTS, includeProgramDates: true };
    expect(buildDeadlineCalendar(input, opts)).toEqual(buildDeadlineCalendar(input, opts));
  });

  it('never throws on bad input', () => {
    const bad: unknown[] = [undefined, null, 42, 'x', {}, [null, 1, 'x', [], { opportunity_id: 7 }, { opportunity_id: '' }]];
    for (const items of bad) {
      for (const options of [undefined, null, 'x', {}, { generatedOn: 5, includeProgramDates: 'yes' }]) {
        expect(() => buildDeadlineCalendar(items, options)).not.toThrow();
        const res = buildDeadlineCalendar(items, options);
        expect(res.included).toEqual([]);
        expect(res.ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
      }
    }
    expect(() =>
      buildDeadlineCalendar([{ opportunity_id: 'z', title: 12, deadline: {}, deadline_note: [], official_url: 3 }], OPTS),
    ).not.toThrow();
  });
});
