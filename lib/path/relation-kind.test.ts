import { describe, expect, it } from 'vitest';
import { catalogOpportunities, sampleProfiles } from '@/lib/data';
import { planRoutes } from './plan';
import { TEAM_RELATION, UNCLEAR_REQUIRED_RELATION } from './plan';
import { relationKind } from './relation-kind';

describe('relationKind', () => {
  it('maps each sentence planRoutes writes to one kind', () => {
    expect(relationKind('Works toward "Python", which the organizer lists as a requirement.')).toBe('meets_requirement');
    expect(relationKind('Works toward "Portfolio", which the organizer lists as a plus (not required).')).toBe('adds_plus');
    expect(relationKind('Prepares "Essay", which the organizer lists as needed to apply.')).toBe('needed_to_apply');
    expect(relationKind(UNCLEAR_REQUIRED_RELATION)).toBe('unclear');
    expect(relationKind(`Builds project evidence in place of the prep item "Build a demo". ${TEAM_RELATION}`)).toBe('builds_evidence');
    expect(relationKind(TEAM_RELATION)).toBe('team_suggestion');
    expect(relationKind('The application itself for NASA TAS.')).toBe('application');
  });

  it('falls back to other for empty or unknown text, never guessing', () => {
    expect(relationKind(undefined)).toBe('other');
    expect(relationKind('')).toBe('other');
    expect(relationKind('Something new the engine might say later.')).toBe('other');
  });

  it('classifies every step the engine produces for the sample students and catalog (no "other")', () => {
    const catalog = catalogOpportunities();
    const unknown: string[] = [];
    for (const p of sampleProfiles()) for (const o of catalog) {
      const plan = planRoutes(p, o, { today: '2026-11-20', catalog });
      if (plan.status !== 'routes') continue;
      for (const r of plan.routes) for (const s of r.steps) if (relationKind(s.relation) === 'other') unknown.push(s.relation ?? '(none)');
    }
    expect(unknown).toEqual([]);
  });
});
