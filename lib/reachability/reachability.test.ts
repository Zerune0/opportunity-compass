import { describe, expect, it } from 'vitest';
import { analyzeReachability } from './index';
import { BARRIER_TYPES, type Opportunity, type ResourceGrant, type StudentProfile } from '../types';

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
  ],
  preparation: [
    { id: 'prep-python', title: '学 Python 基础', skill: 'python', estimated_hours: 10, estimated_cost_usd: 0, depends_on: [], required_for_application: false },
  ],
  is_sample: true,
};

const PROFILE: StudentProfile = {
  id: 'p1',
  is_sample: true,
  display_name: '测试学生',
  devices: ['smartphone'],
  evidence: [],
};

const DEVICE_GRANT: ResourceGrant = {
  id: 'g1',
  student_id: 'p1',
  opportunity_id: FICTIONAL_OPP.id,
  type: 'device',
  status: 'approved',
  device: 'laptop',
  provider: 'Example Org（虚构）',
  is_sample: true,
};

describe('analyzeReachability (mock)', () => {
  it('返回形状正确，障碍类型合法', () => {
    const r = analyzeReachability(PROFILE, FICTIONAL_OPP, []);
    expect(r.profile_id).toBe('p1');
    expect(r.eligibility.items).toHaveLength(1);
    expect(r.readiness_gaps.map((g) => g.prep_item_id)).toEqual(['prep-python']);
    expect(r.barriers.length).toBeGreaterThan(0);
    for (const b of r.barriers) expect(BARRIER_TYPES).toContain(b.type);
    expect([true, false, null]).toContain(r.reachable);
  });

  it('reachable 语义：有未化解障碍 → false；化解后资格仍 unknown → null', () => {
    expect(analyzeReachability(PROFILE, FICTIONAL_OPP, []).reachable).toBe(false);
    expect(analyzeReachability(PROFILE, FICTIONAL_OPP, [DEVICE_GRANT]).reachable).toBeNull();
  });

  it('approved 的设备 grant 化解设备障碍', () => {
    const r = analyzeReachability(PROFILE, FICTIONAL_OPP, [DEVICE_GRANT]);
    const device = r.barriers.find((b) => b.type === 'device');
    expect(device?.resolved).toBe(true);
    expect(device?.resolved_by_grant_ids).toEqual(['g1']);
    expect(r.applied_grant_ids).toEqual(['g1']);
  });

  it('同输入同输出', () => {
    expect(analyzeReachability(PROFILE, FICTIONAL_OPP, [DEVICE_GRANT])).toEqual(
      analyzeReachability(PROFILE, FICTIONAL_OPP, [DEVICE_GRANT]),
    );
  });

  it('接受可选 options.today；mock 阶段结果与不传时相同', () => {
    expect(analyzeReachability(PROFILE, FICTIONAL_OPP, [DEVICE_GRANT], { today: '2026-11-17' })).toEqual(
      analyzeReachability(PROFILE, FICTIONAL_OPP, [DEVICE_GRANT]),
    );
  });
});
