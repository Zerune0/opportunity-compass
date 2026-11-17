import { describe, expect, it } from 'vitest';
import { checkEligibility } from './index';
import { ELIGIBILITY_STATUSES, type Opportunity, type StudentProfile } from '../types';

// 虚构测试数据（不是真实机会），链接用 example.com。
const FICTIONAL_OPP: Opportunity = {
  id: 'fictional-test-program',
  title: '虚构测试项目（非真实机会）',
  organizer: 'Example Org（虚构）',
  category: 'summer_program',
  fields: ['computer_science'],
  summary: '仅用于单元测试的虚构机会。',
  official_url: 'https://example.com/fictional-program',
  verified_on: '2026-11-17',
  verified_by: 'test-fixture',
  deadline: '2027-03-01',
  location: { format: 'online' },
  cost: { fee_usd: 0, requires_travel_expense: false },
  time_commitment: { hours_per_week: 5, total_weeks: 6 },
  required_devices: ['laptop'],
  requirements: [
    { id: 'req-grade', type: 'grade', min: 9, max: 12, label: '9–12 年级', hard: true, source_text: 'Open to students in grades 9-12.' },
    { id: 'req-python', type: 'prerequisite_skill', skill: 'python', label: '会 Python 更好', hard: false, source_text: 'Familiarity with Python is a plus.' },
  ],
  preparation: [],
  is_sample: true,
};

const PROFILE: StudentProfile = { id: 'p1', is_sample: true, display_name: '测试学生', evidence: [] };

describe('checkEligibility (mock)', () => {
  it('每条要求一项，带来源原文，状态合法', () => {
    const r = checkEligibility(PROFILE, FICTIONAL_OPP);
    expect(r.profile_id).toBe('p1');
    expect(r.opportunity_id).toBe(FICTIONAL_OPP.id);
    expect(r.items).toHaveLength(2);
    for (const [i, item] of r.items.entries()) {
      expect(ELIGIBILITY_STATUSES).toContain(item.status);
      expect(item.requirement_id).toBe(FICTIONAL_OPP.requirements[i].id);
      expect(item.source_text).toBe(FICTIONAL_OPP.requirements[i].source_text);
    }
    expect(['eligible', 'not_eligible', 'unknown']).toContain(r.overall);
  });

  it('mock 一律返回 unknown 且带「向官方确认」提示', () => {
    const r = checkEligibility(PROFILE, FICTIONAL_OPP);
    expect(r.items.every((i) => i.status === 'unknown')).toBe(true);
    expect(r.items.every((i) => typeof i.confirm_with_official === 'string')).toBe(true);
    expect(r.overall).toBe('unknown');
  });

  it('同输入同输出', () => {
    expect(checkEligibility(PROFILE, FICTIONAL_OPP)).toEqual(checkEligibility(PROFILE, FICTIONAL_OPP));
  });
});
