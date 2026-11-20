/**
 * The competition demo case: Sample student Maya × the labelled sample opportunity "Climate Code Club (sample)".
 * Every check must reach a clear answer here (no unknowns), while the record stays labelled as a fictional sample.
 */
import { describe, expect, it } from 'vitest';
import { catalogOpportunities, sampleProfiles } from '@/lib/data';
import { checkEligibility } from '@/lib/eligibility';
import { analyzeReachability } from '@/lib/reachability';
import { analyzeGaps } from '@/lib/gap';
import { planRoutes } from '@/lib/path';
import { explainMatch } from '@/lib/match';

const today = '2026-11-20';
const catalog = catalogOpportunities();
const opp = catalog.find((o) => o.id === 'sample-climate-code-club-2027')!;
const maya = sampleProfiles().find((p) => p.id === 'sample-maya')!;

describe('demo case: Maya × Climate Code Club (sample)', () => {
  it('is a labelled sample with no official link shown and no source wording that claims to be official', () => {
    expect(opp.is_sample).toBe(true);
    expect(opp.organizer).toContain('fictional');
    expect(opp.official_url).toMatch(/^https:\/\/example\.com\//);
    for (const r of opp.requirements) expect(r.source_text.startsWith('Sample record')).toBe(true);
  });

  it('eligibility is decided for every requirement', () => {
    const e = checkEligibility(maya, opp);
    expect(e.overall).toBe('eligible');
    expect(e.items.every((i) => i.status === 'satisfied')).toBe(true);
  });

  it('reachability is decided with nothing missing', () => {
    const r = analyzeReachability(maya, opp, [], { today });
    expect(r.reachable).toBe(true);
    expect(r.missing_info).toEqual([]);
  });

  it('every match reason has a clear answer', () => {
    const m = explainMatch(maya, opp, { today });
    expect(m.reasons.length).toBeGreaterThan(0);
    expect(m.reasons.filter((x) => x.positive === null).map((x) => x.kind)).toEqual([]);
  });

  it('no gap is unknown information', () => {
    const g = analyzeGaps(maya, opp, [], { today });
    expect(g.counts.unknown_info).toBe(0);
  });

  it('routes all fit the deadline and the evidence Maya already has skips a step', () => {
    const plan = planRoutes(maya, opp, { today, catalog });
    expect(plan.status).toBe('routes');
    if (plan.status !== 'routes') return;
    expect(plan.routes.length).toBeGreaterThanOrEqual(2);
    expect(plan.routes.every((r) => r.feasible_by_deadline === true)).toBe(true);
    expect(plan.routes.some((r) => r.steps.some((s) => s.skipped))).toBe(true);
    expect(plan.warnings).toEqual([]);
  });
});
