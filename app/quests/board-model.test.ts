import { describe, it, expect } from 'vitest';
import data from '../../data/opportunities.json';
import profiles from '../../data/profiles.json';
import { validateOpportunities, opportunityWarnings } from '../../lib/validation';
import type { Opportunity, StudentProfile } from '../../lib/types';
import { emptyFilters, filterCatalog, orderedCatalog } from './board-model';
const catalog = data as Opportunity[];
const base = catalog[0];
describe('Quest Board discovery safeguards', () => {
    it('does not represent unknown hours as a match for an hours cap', () => {
        const unknown = { ...base, id: 'unknown', time_commitment: { hours_per_week: null, total_weeks: null } };
        const known = { ...base, id: 'known', time_commitment: { hours_per_week: 2, total_weeks: 1 } };
        expect(filterCatalog([unknown, known], { ...emptyFilters, hours: '3' }, []).map(o => o.id)).toEqual(['known']);
    });
    it('does not represent an unknown fee or travel cost as fully free', () => {
        const unknown = { ...base, id: 'unknown', cost: { fee_usd: null, requires_travel_expense: false } };
        const travelUnknown = { ...base, id: 'travel-unknown', cost: { fee_usd: 0, requires_travel_expense: null } };
        expect(filterCatalog([unknown, travelUnknown, base], { ...emptyFilters, free: true }, []).map(o => o.id)).toEqual([base.id]);
    });
    it('keeps user posts after verified sources, even when their deadline is earlier', () => {
        const posted: Opportunity = { ...base, id: 'local-sample', source_tier: 'user_posted', is_sample: true, deadline: '2026-11-19' };
        for (const sort of ['deadline', 'match'])
            expect(orderedCatalog([posted, base], sort, profiles[0] as StudentProfile, [], '2026-11-18').items.map(o => o.id)).toEqual([base.id, posted.id]);
    });
    it('filters saved entries and combines country, state and fields', () => {
        const rutgers = catalog.find(o => o.id === 'rutgers-newark-summer-research-2027')!;
        expect(filterCatalog(catalog, { ...emptyFilters, savedOnly: true, country: 'US', state: 'NJ', field: 'biomedical_research' }, [rutgers.id])).toEqual([rutgers]);
    });
    it('uses the shared grade check without claiming other eligibility is satisfied', () => {
        const rutgers = catalog.find(o => o.id === 'rutgers-newark-summer-research-2027')!;
        expect(filterCatalog([rutgers], { ...emptyFilters, grade: '10' }, [])).toEqual([]);
        expect(filterCatalog([rutgers], { ...emptyFilters, grade: '13' }, [])).toEqual([rutgers]);
    });
    it('places unknown deadlines after known deadlines', () => {
        const unknown = { ...base, id: 'unknown', deadline: null };
        const known = { ...base, id: 'known', deadline: '2027-01-01' };
        expect(orderedCatalog([unknown, known], 'deadline', null, [], '2026-11-18').items.map(o => o.id)).toEqual(['known', 'unknown']);
    });
    it('matching order and reasons do not depend on school name', () => {
        const noor = profiles.find(p => p.id === 'sample-noor') as StudentProfile;
        const a = orderedCatalog(catalog, 'match', noor, [], '2026-11-18');
        const b = orderedCatalog(catalog, 'match', { ...noor, school_name: 'A different school' }, [], '2026-11-18');
        expect(a).toEqual(b);
    });
});
describe('phase 2 catalog contract', () => {
    it('contains 12-15 structurally valid official opportunities with preparation', () => {
        expect(catalog.length).toBeGreaterThanOrEqual(12);
        expect(catalog.length).toBeLessThanOrEqual(15);
        expect(validateOpportunities(catalog)).toEqual([]);
        for (const o of catalog) {
            expect(o.source_tier).toBe('official');
            expect(o.preparation.length).toBeGreaterThan(0);
            expect(o).toHaveProperty('recurring_annually');
            expect(o.fields.every(t => !t.includes('-'))).toBe(true);
            expect(opportunityWarnings(o).some(w => w.includes('连字符'))).toBe(false);
        }
    });
    it('has at least three remote and three confirmed free opportunities', () => {
        expect(catalog.filter(o => o.location.format === 'online').length).toBeGreaterThanOrEqual(3);
        expect(filterCatalog(catalog, { ...emptyFilters, free: true }, []).length).toBeGreaterThanOrEqual(3);
    });
    it('does not convert unconfirmed Rutgers participation costs or hours into zero', () => {
        const o = catalog.find(o => o.id === 'rutgers-newark-summer-research-2027')!;
        expect(o.cost.fee_usd).toBeNull();
        expect(o.cost.requires_travel_expense).toBeNull();
        expect(o.time_commitment.hours_per_week).toBeNull();
        expect(o.preparation.length).toBeGreaterThanOrEqual(3);
    });
});
