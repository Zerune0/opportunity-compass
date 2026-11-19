import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import data from '../../data/opportunities.json';
import profiles from '../../data/profiles.json';
import { QuestAssessment } from './[id]/quest-assessment';
import type { QuestContext } from './use-quest-context';
import type { Opportunity,ResourceGrant,StudentProfile } from '../../lib/types';
const catalog=data as Opportunity[];
const noor=profiles.find(p=>p.id==='sample-noor') as StudentProfile;
const rutgers=catalog.find(o=>o.id==='rutgers-newark-summer-research-2027')!;
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
 it('shows concrete alternative links when a hard requirement is not met',()=>{const target=catalog.find(o=>o.id==='nasa-texas-aerospace-scholars-senior-2026')!;const page=html([],target);expect(page).toContain('Other opportunities and future cycles');expect(page).toContain('href="/quests/doe-cci-summer-2027"');expect(page).not.toContain('View growth routes');});
});
