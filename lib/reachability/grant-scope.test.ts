import { describe, expect, it } from 'vitest';
import { analyzeReachability } from './index';
import type { Opportunity, ResourceGrant, StudentProfile } from '../types';

// grant 的适用范围：opportunity_id 为 null = 对该学生的所有机会都有效。
// 虚构测试数据（不是真实机会），链接用 example.com。

const TODAY = { today: '2026-11-17' };

function makeOpp(id: string): Opportunity {
  return {
    id,
    title: `虚构测试项目 ${id}（非真实机会）`,
    organizer: 'Example Org（虚构）',
    category: 'summer_program',
    fields: ['computer_science'],
    summary: '仅用于单元测试的虚构机会。',
    official_url: `https://example.com/${id}`,
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
    preparation: [],
    is_sample: true,
  };
}

const OPP_A = makeOpp('fictional-a');
const OPP_B = makeOpp('fictional-b');

/** 条件良好但没有笔记本的学生。 */
const STUDENT: StudentProfile = {
  id: 'p1',
  is_sample: true,
  display_name: '测试学生',
  grade: 10,
  hours_per_week_available: 10,
  budget_usd: 100,
  transport: { level: 'reliable' },
  devices: ['smartphone', 'home_internet'],
  skills: [],
  evidence: [],
};

function laptopGrant(extra: Partial<ResourceGrant> & Pick<ResourceGrant, 'id'>): ResourceGrant {
  return {
    student_id: 'p1',
    opportunity_id: null,
    type: 'device',
    device: 'laptop',
    status: 'approved',
    provider: 'Example Org（虚构）',
    is_sample: true,
    ...extra,
  };
}

describe('analyzeReachability — grant 的 opportunity_id 适用范围', () => {
  it('没有 grant 时两个机会都因缺笔记本不可达（对照）', () => {
    for (const opp of [OPP_A, OPP_B]) {
      const r = analyzeReachability(STUDENT, opp, [], TODAY);
      expect(r.barriers.map((b) => b.type)).toEqual(['device']);
      expect(r.reachable).toBe(false);
    }
  });

  it('opportunity_id: null 的 approved 设备 grant 对两个不同机会都化解设备障碍', () => {
    const grants = [laptopGrant({ id: 'g-all', intervention_id: 'iv-laptop-loan' })];
    for (const opp of [OPP_A, OPP_B]) {
      const r = analyzeReachability(STUDENT, opp, grants, TODAY);
      expect(r.barriers[0].resolved).toBe(true);
      expect(r.barriers[0].resolved_by_grant_ids).toEqual(['g-all']);
      expect(r.applied_grant_ids).toEqual(['g-all']);
      expect(r.reachable).toBe(true);
    }
  });

  it('opportunity_id: null 的 pending grant 不化解，只出现在 pending_grant_ids', () => {
    const grants = [laptopGrant({ id: 'g-pending', status: 'pending' })];
    for (const opp of [OPP_A, OPP_B]) {
      const r = analyzeReachability(STUDENT, opp, grants, TODAY);
      expect(r.barriers[0].resolved).toBe(false);
      expect(r.barriers[0].pending_grant_ids).toEqual(['g-pending']);
      expect(r.applied_grant_ids).toEqual([]);
      expect(r.reachable).toBe(false);
    }
  });

  it('缺少 opportunity_id 字段（undefined）的 approved grant 不生效（信息不足不猜）', () => {
    const { opportunity_id: _omit, ...rest } = laptopGrant({ id: 'g-missing-opp' });
    void _omit;
    const grant = rest as unknown as ResourceGrant;
    expect('opportunity_id' in grant).toBe(false);
    for (const opp of [OPP_A, OPP_B]) {
      const r = analyzeReachability(STUDENT, opp, [grant], TODAY);
      expect(r.barriers[0].resolved).toBe(false);
      expect(r.barriers[0].resolved_by_grant_ids).toEqual([]);
      expect(r.applied_grant_ids).toEqual([]);
      expect(r.reachable).toBe(false);
    }
  });

  it('别的学生的 opportunity_id: null grant 不生效', () => {
    const grants = [laptopGrant({ id: 'g-other-student', student_id: 'p2' })];
    const r = analyzeReachability(STUDENT, OPP_A, grants, TODAY);
    expect(r.barriers[0].resolved).toBe(false);
    expect(r.applied_grant_ids).toEqual([]);
    expect(r.reachable).toBe(false);
  });

  it('opportunity_id 为另一个机会的 grant 仍不生效；为本机会的 grant 生效', () => {
    const grants = [laptopGrant({ id: 'g-for-b', opportunity_id: OPP_B.id })];
    const a = analyzeReachability(STUDENT, OPP_A, grants, TODAY);
    expect(a.barriers[0].resolved).toBe(false);
    expect(a.applied_grant_ids).toEqual([]);
    expect(a.reachable).toBe(false);

    const b = analyzeReachability(STUDENT, OPP_B, grants, TODAY);
    expect(b.barriers[0].resolved_by_grant_ids).toEqual(['g-for-b']);
    expect(b.reachable).toBe(true);
  });
});
