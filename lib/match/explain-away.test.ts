/**
 * Issue 70: a student with reliable *local* transportation must not get a positive "Format" reason for an
 * in-person / hybrid opportunity in another state or country. Fixtures are fictional (example.com, is_sample).
 */
import { describe, expect, it } from 'vitest';
import { explainMatch } from '.';
import type { MatchReason, Opportunity, ResourceGrant, StudentProfile } from '../types';

const TODAY = { today: '2026-11-17' };

function opp(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'away-opp',
    title: 'Fictional hybrid program (sample, not real)',
    organizer: 'Example Org (fictional)',
    category: 'summer_program',
    fields: ['stem'],
    summary: 'Fictional opportunity for tests.',
    official_url: 'https://example.com/away',
    verified_on: '2026-11-17',
    verified_by: 'test-fixture',
    deadline: '2027-02-01',
    recurring_annually: true,
    location: { format: 'hybrid', country: 'US', state: 'TX', city: 'Houston' },
    cost: { fee_usd: 0, requires_travel_expense: null },
    time_commitment: { hours_per_week: 2, total_weeks: 4 },
    required_devices: [],
    requirements: [],
    preparation: [],
    is_sample: true,
    ...over,
  } as Opportunity;
}

const STUDENT = {
  id: 'away-student',
  is_sample: true,
  display_name: 'Sample student (away test)',
  grade: 11,
  age: 16,
  region: { country: 'US', state: 'CA' },
  citizenships: ['US'],
  statuses: ['high_school_student'],
  hours_per_week_available: 5,
  budget_usd: 200,
  devices: ['laptop', 'home_internet'],
  transport: { level: 'reliable', max_one_way_minutes: 45 },
  interests: ['stem'],
  skills: [],
  evidence: [],
} as unknown as StudentProfile;

const format = (p: StudentProfile, o: Opportunity, grants: ResourceGrant[] = []): MatchReason =>
  explainMatch(p, o, { ...TODAY, grants }).reasons.find((r) => r.kind === 'format')!;

describe('format reason when the opportunity is outside the student’s home area (issue 70)', () => {
  it('CA student, reliable local transport, hybrid program in TX, travel not stated → not positive (null)', () => {
    const r = format(STUDENT, opp());
    expect(r.positive).toBeNull();
    expect(r.text).toContain('outside your state');
    expect(r.text).not.toContain('reliably get to places nearby');
  });

  it('in-person in another state and the organizer says travel is self-paid → false', () => {
    const r = format(STUDENT, opp({ location: { format: 'in_person', country: 'US', state: 'MA', city: 'Cambridge' }, cost: { fee_usd: 0, requires_travel_expense: true } }));
    expect(r.positive).toBe(false);
    expect(r.text).toContain('outside your state');
  });

  it('another state, but the organizer says participants do not pay for travel → positive, with a note to confirm', () => {
    const r = format(STUDENT, opp({ cost: { fee_usd: 0, requires_travel_expense: false } }));
    expect(r.positive).toBe(true);
    expect(r.text).toContain('do not pay for their own travel');
  });

  it('another country → not positive', () => {
    const r = format(STUDENT, opp({ location: { format: 'in_person', country: 'CA', state: 'ON', city: 'Toronto' } }));
    expect(r.positive).toBeNull();
    expect(r.text).toContain('outside your country');
  });

  it('same state → unchanged (positive, "nearby")', () => {
    const r = format(STUDENT, opp({ location: { format: 'in_person', country: 'US', state: 'CA', city: 'Los Angeles' } }));
    expect(r.positive).toBe(true);
    expect(r.text).toContain('reliably get to places nearby');
  });

  it('state codes are compared case-insensitively', () => {
    const r = format(STUDENT, opp({ location: { format: 'in_person', country: 'us', state: 'ca', city: 'Los Angeles' } }));
    expect(r.positive).toBe(true);
  });

  it('student state unknown → unchanged behavior (cannot tell it is far)', () => {
    const p = { ...STUDENT, region: { country: 'US' } } as unknown as StudentProfile;
    const r = format(p, opp());
    expect(r.positive).toBe(true);
  });

  it('online is unaffected', () => {
    const r = format(STUDENT, opp({ location: { format: 'online' } }));
    expect(r.positive).toBe(true);
  });

  it('the school name and display name do not change the result', () => {
    const a = format(STUDENT, opp());
    const b = format({ ...STUDENT, display_name: 'Someone else', school_name: 'Another school' } as StudentProfile, opp());
    expect(b).toEqual(a);
  });
});
