import { describe, it, expect } from 'vitest';
import data from '../../data/opportunities.json';
import profiles from '../../data/profiles.json';
import { validateOpportunities, opportunityWarnings } from '../../lib/validation';
import type { Opportunity, StudentProfile } from '../../lib/types';
import { emptyFilters, filterCatalog, orderedCatalog } from './board-model';
import { catalogOpportunities } from '../../lib/data';
const catalog = data as Opportunity[];
/**
 * Snapshots of real opportunities as of 2026-11-19, kept in the test so data edits do not change it.
 * (Copied verbatim from data/opportunities.json; data validity itself is checked in lib/data.test.ts and lib/validation.test.ts.)
 */
const SNAPSHOT: Record<string, Opportunity> = {
  'mlh-open-source-week-2026': {
    "verified_by": "Jiale Li",
    "verified_on": "2026-11-17",
    "required_devices": [],
    "preparation": [
      {
        "id": "practice-open-source-pr",
        "title": "Practice opening a pull request",
        "skill": "git",
        "evidence_kind": "project",
        "estimated_hours": 1,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion — not an official requirement",
        "material_kind": null,
        "reusable_across_opportunities": null
      }
    ],
    "id": "mlh-open-source-week-2026",
    "title": "Global Hack Week: Open Source Week",
    "organizer": "Major League Hacking",
    "category": "hackathon",
    "fields": [
      "software_development",
      "open_source"
    ],
    "summary": "A free online week of open-source projects, challenges, and live workshops.",
    "official_url": "https://events.mlh.com/events/15199-global-hack-week-open-source-week",
    "deadline": null,
    "deadline_note": "See the organizer for registration availability.",
    "location": {
      "format": "online",
      "country": null,
      "state": null,
      "city": null
    },
    "cost": {
      "fee_usd": 0,
      "requires_travel_expense": false,
      "note": "Free participation confirmed at https://ghw.mlh.com/ (Global Hack Week umbrella page)."
    },
    "time_commitment": {
      "hours_per_week": null,
      "total_weeks": 1,
      "note": "Check the event schedule for individual sessions.",
      "start_date": "2026-12-04",
      "end_date": "2026-12-10"
    },
    "requirements": [],
    "source_tier": "official",
    "recurring_annually": null,
    "is_sample": false,
    "posted_by": null
  } as unknown as Opportunity,
  'rutgers-newark-summer-research-2027': {
    "verified_by": "Jiale Li",
    "verified_on": "2026-11-17",
    "required_devices": [],
    "preparation": [
      {
        "id": "review-research-interests",
        "title": "Draft a short summary of biomedical research interests",
        "estimated_hours": 2,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion. This is optional preparation, not an official application requirement. Time and cost are team estimates for this task only; they do not describe program fees or weekly participation hours.",
        "material_kind": "personal_statement",
        "reusable_across_opportunities": false,
        "skill": null,
        "evidence_kind": null
      },
      {
        "id": "practice-lab-data-cleanup",
        "title": "Practice cleaning a small public biomedical dataset",
        "skill": "python",
        "evidence_kind": "project",
        "estimated_hours": 2,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion, not an official application requirement. Time and cost are estimates for preparation only.",
        "material_kind": null,
        "reusable_across_opportunities": null
      },
      {
        "id": "write-research-project-note",
        "title": "Write a short project note explaining methods and limitations",
        "skill": "scientific_writing",
        "evidence_kind": "project",
        "estimated_hours": 1,
        "estimated_cost_usd": 0,
        "depends_on": [
          "practice-lab-data-cleanup"
        ],
        "required_for_application": false,
        "source_text": "Team suggestion, not an official application requirement. Time and cost are estimates for preparation only.",
        "material_kind": "portfolio",
        "reusable_across_opportunities": true
      },
      {
        "id": "review-lab-safety-basics",
        "title": "Review introductory laboratory safety guidance",
        "skill": "laboratory_safety",
        "evidence_kind": null,
        "estimated_hours": 1,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion, not an official application requirement. Time and cost are estimates for preparation only.",
        "material_kind": null,
        "reusable_across_opportunities": null
      }
    ],
    "id": "rutgers-newark-summer-research-2027",
    "title": "Rutgers Newark Undergraduate Summer Research Program",
    "organizer": "Rutgers School of Graduate Studies",
    "category": "research",
    "fields": [
      "biomedical_research",
      "life_sciences"
    ],
    "summary": "A 10-week supervised undergraduate biomedical research program in Newark, New Jersey.",
    "official_url": "https://njms.rutgers.edu/sgs/prospective_students/info/summer_undergrad_research.php",
    "deadline": "2027-03-05",
    "location": {
      "format": "in_person",
      "country": "US",
      "state": "NJ",
      "city": "Newark"
    },
    "cost": {
      "fee_usd": null,
      "requires_travel_expense": null,
      "note": "The organizer lists stipends based on housing arrangements."
    },
    "time_commitment": {
      "hours_per_week": null,
      "total_weeks": 10,
      "note": "See the organizer for the weekly schedule.",
      "start_date": "2027-06-07",
      "end_date": "2027-08-13"
    },
    "requirements": [
      {
        "id": "undergraduate",
        "type": "grade",
        "min": 13,
        "max": 16,
        "hard": true,
        "label": "Undergraduate student",
        "source_text": "This program provides the opportunity for undergraduates"
      },
      {
        "id": "us-citizen-or-permanent-resident",
        "type": "citizenship",
        "countries": [
          "US"
        ],
        "hard": true,
        "label": "U.S. citizen or lawful permanent resident",
        "source_text": "you must be a U.S. citizen or Permanent resident."
      }
    ],
    "source_tier": "official",
    "recurring_annually": null,
    "is_sample": false,
    "posted_by": null
  } as unknown as Opportunity,
};
// Fictional variants are built from a fixed snapshot (was catalog[0]), so edits to the real record do not change them.
const base = SNAPSHOT['mlh-open-source-week-2026'];
const RUTGERS = SNAPSHOT['rutgers-newark-summer-research-2027'];
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
        const list = [RUTGERS, ...catalog.filter(o => o.id !== RUTGERS.id)];
        expect(filterCatalog(list, { ...emptyFilters, savedOnly: true, country: 'US', state: 'NJ', field: 'biomedical_research' }, [RUTGERS.id])).toEqual([RUTGERS]);
    });
    it('uses the shared grade check without claiming other eligibility is satisfied', () => {
        expect(filterCatalog([RUTGERS], { ...emptyFilters, grade: '10' }, [])).toEqual([]);
        expect(filterCatalog([RUTGERS], { ...emptyFilters, grade: '13' }, [])).toEqual([RUTGERS]);
    });
    it('the "Online or hybrid" filter excludes an unknown format; without the filter it stays listed', () => {
        const at = (id: string, format: Opportunity['location']['format']): Opportunity => ({ ...base, id, location: { format, country: null, state: null, city: null } });
        const list = [at('on', 'online'), at('hy', 'hybrid'), at('ip', 'in_person'), at('unk', 'unknown')];
        expect(filterCatalog(list, { ...emptyFilters, remote: true }, []).map(o => o.id)).toEqual(['on', 'hy']);
        expect(filterCatalog(list, emptyFilters, []).map(o => o.id)).toEqual(['on', 'hy', 'ip', 'unk']);
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
    it('does not convert unconfirmed participation costs or hours into zero', () => {
        // Was pinned to the live Rutgers record (fee / travel / hours all null). Now: whatever the catalog says,
        // the loader keeps unknown values as null (never 0), and the fixed Rutgers snapshot still has them unknown.
        const loaded = new Map(catalogOpportunities().map(o => [o.id, o]));
        for (const raw of catalog) {
            const o = loaded.get(raw.id);
            if (!o) continue;
            if (raw.cost.fee_usd === null) expect(o.cost.fee_usd).toBeNull();
            if (raw.cost.requires_travel_expense === null) expect(o.cost.requires_travel_expense).toBeNull();
            if (raw.time_commitment.hours_per_week === null) expect(o.time_commitment.hours_per_week).toBeNull();
        }
        expect(RUTGERS.cost.fee_usd).toBeNull();
        expect(RUTGERS.cost.requires_travel_expense).toBeNull();
        expect(RUTGERS.time_commitment.hours_per_week).toBeNull();
        expect(RUTGERS.preparation.length).toBeGreaterThanOrEqual(3);
    });
});
