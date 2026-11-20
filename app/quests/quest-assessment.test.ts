import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import profiles from '../../data/profiles.json';
import { QuestAssessment } from './[id]/quest-assessment';
import type { QuestContext } from './use-quest-context';
import * as matchEngines from '../../lib/match';
import type { AlternativeSuggestion,Opportunity,ResourceGrant,StudentProfile } from '../../lib/types';
/**
 * Snapshots of real opportunities as of 2026-11-19, kept in the test so data edits do not change it.
 * (Copied verbatim from data/opportunities.json; data validity itself is checked in lib/data.test.ts and lib/validation.test.ts.)
 */
const SNAPSHOT: Record<string, Opportunity> = {
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
  'nasa-texas-aerospace-scholars-senior-2026': {
    "verified_by": "Jiale Li",
    "verified_on": "2026-11-18",
    "required_devices": [],
    "preparation": [
      {
        "id": "outline-stem-interests",
        "title": "Draft a summary of STEM interests and goals",
        "estimated_hours": 1,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion. This is optional preparation, not an official application requirement. Time and cost are team estimates for this task only; they do not describe program fees or weekly participation hours.",
        "material_kind": "personal_statement",
        "reusable_across_opportunities": false,
        "skill": null,
        "evidence_kind": null
      }
    ],
    "time_commitment": {
      "hours_per_week": null,
      "total_weeks": null
    },
    "cost": {
      "fee_usd": 0,
      "requires_travel_expense": null,
      "note": "No program cost for selected students. Personal travel expenses were not confirmed and must be checked separately. Human verification: Jiale Li, 2026-11-18. Source: https://www.nasa.gov/learning-resources/texas-aerospace-scholars/tas-senior-experience/"
    },
    "id": "nasa-texas-aerospace-scholars-senior-2026",
    "title": "NASA Texas Aerospace Scholars · Senior Experience",
    "organizer": "NASA Johnson Space Center",
    "category": "summer_program",
    "fields": [
      "aerospace",
      "stem"
    ],
    "summary": "A STEM experience for U.S. citizens who are Texas residents enrolled as seniors in a Texas high school. Internet access, STEM interest and commitment to the online course are required.",
    "official_url": "https://www.nasa.gov/learning-resources/texas-aerospace-scholars/tas-senior-experience/",
    "deadline": "2026-12-04",
    "location": {
      "format": "hybrid",
      "country": "US",
      "state": "TX",
      "note": "Virtual activities and Johnson Space Center, Houston. Confirm the senior cohort schedule.",
      "city": null
    },
    "requirements": [
      {
        "id": "senior-cohort",
        "type": "grade",
        "min": 12,
        "max": 12,
        "hard": true,
        "label": "High school senior",
        "source_text": "Enrolled as a senior"
      },
      {
        "id": "texas",
        "type": "region",
        "countries": [
          "US"
        ],
        "states": [
          "TX"
        ],
        "hard": true,
        "label": "Texas resident",
        "source_text": "Texas resident"
      },
      {
        "id": "us-citizen",
        "type": "citizenship",
        "countries": [
          "US"
        ],
        "hard": true,
        "label": "U.S. citizen",
        "source_text": "U.S. Citizen"
      },
      {
        "id": "texas-school-enrollment",
        "type": "manual",
        "hard": true,
        "label": "Enrolled as a senior in a Texas high school; confirm school enrollment",
        "source_text": "Texas high school"
      },
      {
        "id": "internet-access",
        "type": "manual",
        "hard": true,
        "label": "Able to access the internet; home internet is not specifically required",
        "source_text": "access the internet"
      },
      {
        "id": "stem-interest",
        "type": "manual",
        "hard": true,
        "label": "Interested in science, technology, engineering or mathematics",
        "source_text": "Interested in science"
      },
      {
        "id": "online-course-commitment",
        "type": "manual",
        "hard": true,
        "label": "Committed to completing the online course",
        "source_text": "Committed to completing"
      }
    ],
    "source_tier": "official",
    "recurring_annually": null,
    "is_sample": false,
    "posted_by": null,
    "deadline_note": "Application window: November 9–December 4, 2026. Check the official page for current application availability."
  } as unknown as Opportunity,
  'doe-cci-summer-2027': {
    "verified_by": "Jiale Li",
    "verified_on": "2026-11-19",
    "required_devices": [],
    "preparation": [
      {
        "id": "draft-community-college-resume",
        "title": "Draft a resume highlighting laboratory and STEM coursework",
        "estimated_hours": 2,
        "estimated_cost_usd": 0,
        "depends_on": [],
        "required_for_application": false,
        "source_text": "Team suggestion. This is optional preparation, not an official application requirement. Time and cost are team estimates for this task only; they do not describe program fees or weekly participation hours.",
        "material_kind": "resume",
        "reusable_across_opportunities": true,
        "skill": null,
        "evidence_kind": null
      }
    ],
    "id": "doe-cci-summer-2027",
    "title": "DOE Community College Internships · Summer 2027",
    "organizer": "U.S. Department of Energy Office of Science",
    "category": "internship",
    "fields": [
      "stem",
      "laboratory_research"
    ],
    "summary": "An on-site internship for eligible community college students at participating DOE laboratories.",
    "official_url": "https://science.osti.gov/wdts/cci",
    "deadline": "2027-01-06",
    "deadline_note": "5:00 PM Eastern Time",
    "location": {
      "format": "in_person",
      "country": "US",
      "note": "All internships are conducted on site at a host DOE laboratory; remote participation is not available. Placement depends on the host laboratory. Source: https://science.osti.gov/wdts/cci/Benefits",
      "state": null,
      "city": null
    },
    "cost": {
      "fee_usd": null,
      "requires_travel_expense": null,
      "note": "The application fee and candidate-specific travel expense were not confirmed."
    },
    "time_commitment": {
      "hours_per_week": 40,
      "total_weeks": 10,
      "note": "Approximately 40 hours per week, typically 10 consecutive weeks for the summer term. On-site participation only; remote internships are not available. Confirm the appointment schedule with the host laboratory. Sources: https://science.osti.gov/wdts/cci/Participant-Obligations ; https://science.osti.gov/wdts/cci/Benefits . Human verification: Jiale Li, 2026-11-18. Recurrence: offered three times annually in Fall, Spring, and Summer. Source: https://www.energy.gov/science/articles/discover-science-applications-open-summer-2027-undergraduate-internships. Recurrence verified by Jiale Li on 2026-11-19; future cycle dates and requirements must be checked separately."
    },
    "requirements": [
      {
        "id": "community-college-eligibility",
        "label": "Check the current enrollment and additional eligibility requirements for community college applicants.",
        "source_text": "DOE Community College Internships eligibility",
        "type": "manual",
        "hard": true
      }
    ],
    "source_tier": "official",
    "recurring_annually": true,
    "is_sample": false,
    "posted_by": null
  } as unknown as Opportunity,
};
// The page context uses this fixed catalog, so catalog edits do not change what these tests render.
const catalog:Opportunity[]=Object.values(SNAPSHOT);
const noor=profiles.find(p=>p.id==='sample-noor') as StudentProfile;
const rutgers=SNAPSHOT['rutgers-newark-summer-research-2027'];
// Fictional test-only participation values; never written to the real catalog.
const fixture:Opportunity={...rutgers,id:'sample-support-fixture',is_sample:true,cost:{fee_usd:0,requires_travel_expense:false},time_commitment:{hours_per_week:2,total_weeks:1}};
const grant:ResourceGrant={id:'sample-transport',student_id:noor.id,opportunity_id:fixture.id,type:'transport_subsidy',status:'approved',provider:'Sample support provider',is_sample:true};
function html(grants:ResourceGrant[],opportunity=fixture,profile=noor){const context:QuestContext={catalog,profile,grants,saved:[],today:'2026-11-18',loaded:true};return renderToStaticMarkup(React.createElement(QuestAssessment,{opportunity,context}));}
beforeAll(()=>vi.stubGlobal('React',React));
afterAll(()=>vi.unstubAllGlobals());
describe('Quest Details support and recovery',()=>{
 it('labels approved simulated support and names the barrier it resolves',()=>{const page=html([grant]);expect(page).toContain('Simulated');expect(page).toContain('Resolves: Transportation.');});
 it('does not apply pending support or another student support',()=>{for(const g of [{...grant,status:'pending' as const},{...grant,student_id:'another-student'}]){const page=html([g]);expect(page).not.toContain('Resolves: Transportation.');expect(page).toContain('No approved support recorded');}});
 it('lists individual missing official facts and does not infer zero cost',()=>{const page=html([],rutgers);expect(page).toContain('the official fee');expect(page).toContain('how many hours per week the program needs');expect(page).toContain('Unknown information');expect(page).not.toContain('opportunity.cost.fee_usd');expect(page).not.toContain('opportunity.time_commitment.hours_per_week');});
 it('links missing profile fields to Passport',()=>{const page=html([],{...fixture,cost:{fee_usd:10,requires_travel_expense:false}},{...noor,budget_usd:null});expect(page).toContain('how much you can pay yourself');expect(page).not.toContain('profile.budget_usd');expect(page).toContain('Update this field in Skill Passport');expect(page).toContain('href="/passport"');});
 it('shows concrete alternative links when a hard requirement is not met',()=>{const target=SNAPSHOT['nasa-texas-aerospace-scholars-senior-2026'];const page=html([],target);expect(page).toContain('Other opportunities and future cycles');expect(page).toContain('href="/quests/doe-cci-summer-2027"');expect(page).not.toContain('View growth routes');});
});


describe('Quest Details alternative destinations', () => {
 const userPosted: Opportunity = { ...fixture, id: 'sample-unpublished', source_tier: 'user_posted', is_sample: true, posted_by: 'sample-publisher' };
 it.each([
  { name: 'self remote hint', kind: 'remote_option' as const, id: rutgers.id, href: null },
  { name: 'self future cycle', kind: 'next_cycle' as const, id: rutgers.id, href: null },
  { name: 'missing catalog record', kind: 'stepping_stone' as const, id: 'not-in-catalog', href: null },
  { name: 'no target id', kind: 'remote_option' as const, id: null, href: null },
  { name: 'user-posted record without a catalog detail', kind: 'remote_option' as const, id: userPosted.id, href: null },
  { name: 'another verified catalog record', kind: 'stepping_stone' as const, id: 'doe-cci-summer-2027', href: '/quests/doe-cci-summer-2027' },
 ])('renders $name with a valid destination or plain text', ({ kind, id, href }) => {
  const suggestion: AlternativeSuggestion = { kind, opportunity_id: id, title: 'Alternative destination fixture', reason: 'Check official participation terms.', eligibility_overall: 'unknown', shared_fields: [] };
  const spy = vi.spyOn(matchEngines, 'findAlternatives').mockReturnValueOnce([suggestion]);
  try {
   const context: QuestContext = { catalog: [...catalog, userPosted], profile: noor, grants: [], saved: [], today: '2026-11-19', loaded: true };
   const page = renderToStaticMarkup(React.createElement(QuestAssessment, { opportunity: rutgers, context }));
   expect(page).toContain(suggestion.title);
   expect(page.split(suggestion.reason)).toHaveLength(2);
   if (href) expect(page).toContain('href="' + href + '"');
   else expect(page).not.toMatch(/href="\/quests\//);
  } finally { spy.mockRestore(); }
 });
});

describe('Quest Details for user-posted opportunities', () => {
 // Fictional test-only records: one verified-catalog shape and one user-posted copy of it.
 const official: Opportunity = { ...fixture, id: 'fixture-official-listing', source_tier: 'official', is_sample: false, posted_by: null, requirements: [], deadline: '2027-03-01' };
 const postedRule: Opportunity['requirements'][number] = { id: 'posted-grade', label: 'Grade 9 or above', hard: true, source_text: 'Fictional poster-entered rule.', type: 'grade', min: 9 };
 const posted: Opportunity = { ...official, id: 'fixture-user-posted', source_tier: 'user_posted', is_sample: true, posted_by: 'sample-publisher', official_url: 'https://example.com/fixture' };
 const render = (opportunity: Opportunity) => renderToStaticMarkup(React.createElement(QuestAssessment, { opportunity, context: { catalog: [], profile: noor, grants: [], saved: [], today: '2026-11-19', loaded: true } }));
 it('keeps official wording and the growth routes link for catalog opportunities', () => {
  const page = render(official);
  expect(page).toContain('<h2>Official eligibility</h2>');
  expect(page).toContain('No official requirements have been entered.');
  expect(page).toContain('href="/map?opp=fixture-official-listing"');
  expect(page).toContain('View growth routes');
  expect(page).not.toContain('Eligibility stated by the poster');
 });
 it.each([
  { name: 'without requirements', opp: posted },
  { name: 'with a poster-entered requirement', opp: { ...posted, requirements: [postedRule] } },
 ])('labels poster-entered eligibility and hides the map link ($name)', ({ opp }) => {
  const page = render(opp);
  expect(page).not.toContain('Official eligibility');
  expect(page).toContain('<h2>Eligibility stated by the poster</h2>');
  expect(page).toContain('These requirements were entered by a sample publisher in this browser. They are not from an official site.');
  expect(page).not.toContain('No official requirements');
  expect(page).not.toContain('no official requirements recorded');
  expect(page).not.toContain('/map?opp=');
  expect(page).not.toContain('View growth routes');
  expect(page).toContain('Growth routes are available for verified catalog opportunities only.');
  if (!opp.requirements.length) expect(page).toContain('No requirements were entered.');
 });
});
