import { describe, expect, it } from 'vitest';
import { analyzeReachability } from './index';
import { requiredPrepClosure } from './coverage';
import { planRoutes } from '../path';
import { fmt } from '../format';
import { fmt as pathFmt } from '../path/shared';
import type { Opportunity, PrepItem, StudentProfile } from '../types';

const TODAY = { today: '2026-11-17' };
const DEADLINE_5W = '2026-12-22'; // 35 天 = 5 周

// 虚构测试数据（不是真实机会）。
function makeOpp(preparation: PrepItem[], extra: Partial<Opportunity> = {}): Opportunity {
  return {
    id: 'fictional-closure-program',
    title: '虚构测试项目（非真实机会）',
    organizer: 'Example Org（虚构）',
    category: 'summer_program',
    fields: ['computer_science'],
    summary: '仅用于单元测试的虚构机会。',
    official_url: 'https://example.com/fictional-program',
    verified_on: '2026-11-17',
    verified_by: 'test-fixture',
    deadline: DEADLINE_5W,
    location: { format: 'online' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 5, total_weeks: 6 },
    required_devices: [],
    requirements: [],
    preparation,
    is_sample: true,
    ...extra,
  };
}

const PYTHON: PrepItem = { id: 'python', title: '学 Python', skill: 'python', estimated_hours: 15, estimated_cost_usd: 0, depends_on: [], required_for_application: false };
const PROJECT: PrepItem = { id: 'project', title: '做项目', evidence_kind: 'project', estimated_hours: 20, estimated_cost_usd: 0, depends_on: ['python'], required_for_application: true };

const STUDENT: StudentProfile = {
  id: 'p1',
  is_sample: true,
  display_name: '测试学生',
  grade: 10,
  hours_per_week_available: 5,
  budget_usd: 100,
  transport: { level: 'reliable' },
  devices: ['laptop', 'home_internet'],
  skills: [],
  evidence: [],
};

const PY_EVIDENCE = { id: 'ev-py', title: 'Python 证书（虚构）', kind: 'certificate' as const, skills: ['python'], prep_item_ids: [], status: 'self_reported' as const, added_on: '2026-11-01' };

const sumHours = (ps: PrepItem[]) => ps.reduce((s, p) => s + Math.max(0, Number.isFinite(p.estimated_hours) ? p.estimated_hours : 0), 0);

describe('requiredPrepClosure / 必需准备口径一致', () => {
  it('必需项依赖未覆盖的非必需前置 → 计入前置；5h/周 × 5 周不够 → 未化解的 time 障碍', () => {
    const opp = makeOpp([PYTHON, PROJECT]);
    expect(requiredPrepClosure(STUDENT, opp).map((p) => p.id)).toEqual(['python', 'project']);
    const r = analyzeReachability(STUDENT, opp, [], TODAY);
    const time = r.barriers.filter((b) => b.type === 'time');
    expect(time).toHaveLength(1);
    expect(time[0].resolved).toBe(false);
    expect(time[0].description).toContain('35');
    expect(r.reachable).toBe(false);
  });

  it('planRoutes 的「只做申请必需项需要 N 小时」与 analyzeReachability 的 H 相等', () => {
    const opp = makeOpp([PYTHON, PROJECT]);
    const H = sumHours(requiredPrepClosure(STUDENT, opp));
    expect(H).toBe(35);
    const plan = planRoutes(STUDENT, opp, TODAY);
    expect(plan.status).toBe('routes');
    if (plan.status !== 'routes') return;
    const texts = plan.routes.flatMap((r) => r.warnings).filter((w) => w.includes('Doing only the required items'));
    expect(texts.length).toBeGreaterThan(0);
    for (const w of texts) expect(w).toContain(`needs ${fmt(H)} hours`);
    const r = analyzeReachability(STUDENT, opp, [], TODAY);
    expect(r.barriers.find((b) => b.type === 'time')?.description).toContain(`about ${fmt(H)} hours`);
  });

  it('前置项已有证据覆盖 → 不计入，也不再往前追', () => {
    const base: PrepItem = { id: 'basics', title: '基础', estimated_hours: 100, estimated_cost_usd: 0, depends_on: [], required_for_application: false };
    const py = { ...PYTHON, depends_on: ['basics'] };
    const opp = makeOpp([base, py, PROJECT]);
    const p = { ...STUDENT, evidence: [PY_EVIDENCE] };
    expect(requiredPrepClosure(p, opp).map((x) => x.id)).toEqual(['project']);
    const r = analyzeReachability(p, opp, [], TODAY);
    expect(r.barriers.filter((b) => b.type === 'time')).toEqual([]); // 20h ≤ 25h
    expect(r.reachable).toBe(true);
  });

  it('费用同理：必需项的未覆盖前置的费用计入必需准备费', () => {
    const opp = makeOpp([{ ...PYTHON, estimated_cost_usd: 80 }, { ...PROJECT, estimated_cost_usd: 30 }], { deadline: null });
    const r = analyzeReachability(STUDENT, opp, [], TODAY);
    const cost = r.barriers.find((b) => b.type === 'cost');
    expect(cost?.shortfall).toBe(10);
    expect(cost?.resolved).toBe(false);
    // 前置已覆盖 → 只剩 30，在预算内
    const r2 = analyzeReachability({ ...STUDENT, evidence: [PY_EVIDENCE] }, opp, [], TODAY);
    expect(r2.barriers.find((b) => b.type === 'cost')).toBeUndefined();
  });

  it('负数 / 非有限的小时和费用按 0', () => {
    const opp = makeOpp(
      [
        { ...PYTHON, estimated_hours: -50, estimated_cost_usd: Number.NaN },
        { ...PROJECT, estimated_hours: Number.POSITIVE_INFINITY, estimated_cost_usd: -5 },
      ],
      {},
    );
    const r = analyzeReachability({ ...STUDENT, budget_usd: 0 }, opp, [], TODAY);
    expect(r.barriers).toEqual([]);
  });

  it('坏数据：依赖不存在、自依赖、成环、重复 id → 不死循环、不抛错', () => {
    const opp = makeOpp([
      { ...PYTHON, depends_on: ['project', 'python', 'ghost'] },
      { ...PROJECT, depends_on: ['python', 'ghost'] },
      { ...PROJECT, estimated_hours: 999 },
    ]);
    const got = requiredPrepClosure(STUDENT, opp);
    expect(got.map((p) => p.id)).toEqual(['python', 'project']);
    expect(sumHours(got)).toBe(35);
    expect(() => analyzeReachability(STUDENT, opp, [], TODAY)).not.toThrow();
  });

  it('fmt 只有一份实现', () => {
    expect(pathFmt).toBe(fmt);
  });
});
