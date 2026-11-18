/**
 * 演示主线的引擎级集成测试：把演示里由引擎负责的环节串成一条连续的故事。
 *
 * 学生端：选机会 → 看资格（三态 + 官网原文）→ 三层判断（资格 / 准备差距 / 现实障碍）→ 2–3 条路线
 *        → 补一条作品证据后重新规划（步骤被跳过，diff 说得出原因）→ 硬性不满足时不给绕过路线。
 * 主办方端：给学生分配资源后变为可达 → what-if 联合求解（G / L / N）→ 独立复核 → 篡改方案后复核不通过。
 *
 * 机会是测试文件内的明显虚构 fixture（example.com、is_sample: true），不是真实机会；
 * 学生来自 data/profiles.json 的示例档案。评估日统一为 2026-11-17。所有结果都是示例 / 模拟，可达 ≠ 录取。
 */
import { describe, expect, it } from 'vitest';
import profilesJson from '../data/profiles.json';
import { checkEligibility } from './eligibility';
import { solveJoint, verifyPlan } from './joint';
import { diffRoutes, planRoutes } from './path';
import { analyzeReachability } from './reachability';
import { validateOpportunity, validateProfile } from './validation';
import type { EvidenceItem, Opportunity, ResourceGrant, Route, Scenario, StudentProfile } from './types';

const OPTS = { today: '2026-11-17' } as const;

const PROFILES = profilesJson as unknown as StudentProfile[];
const byId = (id: string): StudentProfile => {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`示例档案 ${id} 不存在`);
  return structuredClone(p);
};

/** 示例高中生 Maya：11 年级、只有手机（缺笔记本）、交通可靠、每周 4 小时、预算 $20。 */
const maya = () => byId('sample-maya');
/** 示例高中生 Leo：10 年级、有笔记本，但没有交通工具。 */
const leo = () => byId('sample-leo');

/** 明显虚构的线下活动（example.com、is_sample: true）。 */
const OPP: Opportunity = {
  id: 'sample-demo-data-workshop',
  title: '【示例】周末线下数据分析工作坊（虚构）',
  organizer: '示例主办方（虚构）',
  category: 'project',
  fields: ['computer_science', 'data_science'],
  summary: '虚构机会：一场需要自带笔记本电脑的线下数据分析工作坊，仅用于演示主线测试。',
  official_url: 'https://example.com/sample-demo-data-workshop',
  verified_on: '2026-11-17',
  verified_by: '示例（虚构，未核实）',
  deadline: '2027-01-15',
  recurring_annually: true,
  location: { format: 'in_person', country: 'US', state: 'CA', city: 'Example City' },
  cost: { fee_usd: 0, requires_travel_expense: false, financial_aid_available: false },
  time_commitment: { hours_per_week: 3, total_weeks: 1, start_date: '2027-02-06', end_date: '2027-02-06' },
  required_devices: ['laptop'],
  requirements: [
    {
      id: 'req-grade',
      type: 'grade',
      min: 9,
      max: 12,
      hard: true,
      label: '高中在读（9–12 年级）',
      source_text: '(Sample) Open to high school students in grades 9–12.',
    },
  ],
  preparation: [
    {
      id: 'prep-python-basics',
      title: 'Python 入门',
      skill: 'python',
      evidence_kind: 'course',
      estimated_hours: 6,
      estimated_cost_usd: 0,
      depends_on: [],
      required_for_application: false,
    },
    {
      id: 'prep-data-analysis',
      title: '数据分析入门课',
      skill: 'data_analysis',
      evidence_kind: 'course',
      estimated_hours: 5,
      estimated_cost_usd: 10,
      depends_on: ['prep-python-basics'],
      required_for_application: false,
    },
    {
      id: 'prep-mini-project',
      title: '完成一个数据分析小项目',
      skill: 'data_analysis',
      evidence_kind: 'project',
      estimated_hours: 8,
      estimated_cost_usd: 0,
      depends_on: ['prep-data-analysis'],
      required_for_application: true,
    },
    {
      id: 'prep-portfolio-page',
      title: '做一个作品展示页',
      skill: null,
      evidence_kind: 'portfolio',
      estimated_hours: 3,
      estimated_cost_usd: 5,
      depends_on: ['prep-mini-project'],
      required_for_application: false,
    },
    {
      id: 'prep-statement',
      title: '写个人陈述',
      skill: null,
      evidence_kind: null,
      estimated_hours: 2,
      estimated_cost_usd: 0,
      depends_on: [],
      required_for_application: true,
    },
  ],
  is_sample: true,
};

/** 学生在 Skill Passport 里新增的一条作品证据（示例）。 */
const NEW_EVIDENCE: EvidenceItem = {
  id: 'ev-maya-weather-project',
  title: '天气数据分析小项目（示例）',
  kind: 'project',
  skills: ['data_analysis'],
  status: 'evidence_attached',
  url: 'https://example.com/sample-weather-project',
  description: '示例证据：用公开天气数据做的分析小项目。',
  added_on: '2026-11-17',
};

function laptopGrant(studentId: string, status: ResourceGrant['status']): ResourceGrant {
  return {
    id: `grant-laptop-${studentId}-${status}`,
    student_id: studentId,
    opportunity_id: OPP.id,
    type: 'device',
    device: 'laptop',
    status,
    provider: '示例主办方（虚构）',
    is_sample: true,
  };
}

/** 检查路线步骤按依赖排好序：每一步依赖的步骤都在它前面。 */
function assertTopological(route: Route): void {
  const seen = new Set<string>();
  for (const s of route.steps) {
    for (const d of s.depends_on) expect(seen.has(d), `${route.type}：「${s.title}」排在依赖 ${d} 之前`).toBe(true);
    seen.add(s.id);
  }
}

/** 小场景：6 名示例学生（都符合资格、都缺笔记本），3 个借用名额。 */
function laptopScenario(): Scenario {
  const students: StudentProfile[] = Array.from({ length: 6 }, (_, i) => ({
    ...maya(),
    id: `demo-s0${i + 1}`,
    display_name: `示例学生 ${i + 1}（借用场景）`,
    school_name: null,
  }));
  return {
    id: 'demo-laptop-loan',
    title: '示例 / 模拟场景：演示主线的笔记本借用',
    is_sample: true,
    evaluation_date: OPTS.today,
    students,
    opportunities: [OPP],
    interventions: [
      {
        id: 'iv-demo-laptop',
        title: '笔记本借用（示例，3 台）',
        type: 'device',
        resolves: ['device'],
        unit_cost_usd: 20,
        fixed_cost_usd: 0,
        capacity: 3,
        device: 'laptop',
        status: 'approved',
      },
    ],
    budget_usd: 200,
  };
}

/** 整条主线跑一遍，返回各环节的结果（供确定性检查）。 */
function runMainline() {
  const student = maya();
  const eligibility = checkEligibility(student, OPP, OPTS);
  const reach0 = analyzeReachability(student, OPP, [], OPTS);
  const plan0 = planRoutes(student, OPP, OPTS);
  const withEvidence = { ...student, evidence: [...student.evidence, NEW_EVIDENCE] };
  const plan1 = planRoutes(withEvidence, OPP, OPTS);
  const diff = diffRoutes(plan0, plan1);
  const reach1 = analyzeReachability(student, OPP, [laptopGrant(student.id, 'approved')], OPTS);
  const scenario = laptopScenario();
  const joint = solveJoint(scenario);
  const verified = verifyPlan(scenario, {
    selected_intervention_ids: joint.selected_intervention_ids,
    allocations: joint.allocations,
  });
  return { eligibility, reach0, plan0, plan1, diff, reach1, joint, verified };
}

describe('演示主线（引擎级集成测试，示例数据）', () => {
  it('fixture 前提：机会是明显虚构的示例数据', () => {
    expect(OPP.is_sample).toBe(true);
    expect(new URL(OPP.official_url).hostname).toBe('example.com');
    expect(OPP.deadline! > OPTS.today).toBe(true);
    expect(PROFILES.every((p) => p.is_sample)).toBe(true);
    expect(validateOpportunity(OPP)).toEqual([]);
    expect(validateProfile({ ...maya(), evidence: [...maya().evidence, NEW_EVIDENCE] })).toEqual([]);
  });

  it('第 1 幕「看懂资格」：示例高中生的硬性年级要求 satisfied；没填年级 → unknown 并提示向官方确认；不符合年级 → not_eligible', () => {
    const ok = checkEligibility(maya(), OPP, OPTS);
    expect(ok.overall).toBe('eligible');
    expect(ok.items[0]).toMatchObject({ requirement_id: 'req-grade', hard: true, status: 'satisfied', confirm_with_official: null });
    expect(ok.items[0].source_text).toBe(OPP.requirements[0].source_text);

    const noGrade = maya();
    delete noGrade.grade;
    const unknown = checkEligibility(noGrade, OPP, OPTS);
    expect(unknown.overall).toBe('unknown');
    const item = unknown.items[0];
    expect(item.status).toBe('unknown');
    expect(item.source_text).toBe(OPP.requirements[0].source_text);
    expect(item.confirm_with_official).toContain('向官方确认');
    expect(item.confirm_with_official).toContain(OPP.requirements[0].source_text);
    expect(item.used_profile_fields).toContain('grade');

    // 三个示例档案都是 10–12 年级，这里在示例档案上改出一个 8 年级（初中）的版本。
    const middleSchooler = { ...maya(), id: 'sample-maya-grade8', grade: 8 };
    const no = checkEligibility(middleSchooler, OPP, OPTS);
    expect(no.overall).toBe('not_eligible');
    expect(no.items[0].status).toBe('not_satisfied');
  });

  it('第 2 幕「三层判断」：不带资源时，Maya 缺笔记本、Leo 没有交通 → 不可达；资格、准备差距、现实障碍各自有内容', () => {
    const r = analyzeReachability(maya(), OPP, [], OPTS);
    expect(r.reachable).toBe(false);
    // 第一层：资格
    expect(r.eligibility.overall).toBe('eligible');
    expect(r.eligibility.items.length).toBeGreaterThan(0);
    // 第二层：准备差距（Python 入门已被 Maya 的已有证据覆盖，不算差距）
    expect(r.readiness_gaps.map((g) => g.prep_item_id)).toEqual([
      'prep-data-analysis',
      'prep-mini-project',
      'prep-portfolio-page',
      'prep-statement',
    ]);
    // 第三层：现实障碍——只有设备一条，且未化解
    expect(r.barriers).toHaveLength(1);
    expect(r.barriers[0]).toMatchObject({ type: 'device', resolved: false, resolved_by_grant_ids: [] });
    expect(r.missing_info).toEqual([]);

    const l = analyzeReachability(leo(), OPP, [], OPTS);
    expect(l.reachable).toBe(false);
    expect(l.barriers.some((b) => b.type === 'transport' && !b.resolved)).toBe(true);
  });

  it('第 3 幕「选一条路线」：给出 2–3 条路线，步骤按依赖排序，有小时与费用合计、是否来得及', () => {
    const plan = planRoutes(maya(), OPP, OPTS);
    expect(plan.status).toBe('routes');
    if (plan.status !== 'routes') return;
    expect(plan.routes.length).toBeGreaterThanOrEqual(2);
    expect(plan.routes.length).toBeLessThanOrEqual(3);
    expect(plan.routes.map((r) => r.type)).toEqual(['learning_first', 'practice_first', 'community']);
    for (const route of plan.routes) {
      assertTopological(route);
      const active = route.steps.filter((s) => !s.skipped);
      expect(route.total_hours).toBe(active.reduce((s, x) => s + x.hours, 0));
      expect(route.total_cost_usd).toBe(active.reduce((s, x) => s + x.cost_usd, 0));
      expect(typeof route.feasible_by_deadline).toBe('boolean');
      expect(route.estimated_weeks).not.toBeNull();
      // 已有证据《用手机完成的 Python 入门练习》→ Python 入门被跳过
      const py = route.steps.find((s) => s.id === 'prep-python-basics');
      expect(py?.skipped).toBe(true);
    }
    const learning = plan.routes[0];
    expect(learning.total_hours).toBe(5 + 8 + 3 + 2);
    expect(learning.total_cost_usd).toBe(15);
    expect(learning.feasible_by_deadline).toBe(true);
  });

  it('第 4 幕「补证据、重新规划」：加一条作品证据 → 对应步骤被跳过、合计变少 → diffRoutes 说出证据标题和被跳过的步骤', () => {
    const before = planRoutes(maya(), OPP, OPTS);
    const student = maya();
    const after = planRoutes({ ...student, evidence: [...student.evidence, NEW_EVIDENCE] }, OPP, OPTS);
    expect(before.status).toBe('routes');
    expect(after.status).toBe('routes');
    if (before.status !== 'routes' || after.status !== 'routes') return;

    for (const route of after.routes) {
      const step = route.steps.find((s) => s.id === 'prep-mini-project');
      expect(step).toMatchObject({ skipped: true, satisfied_by_evidence_ids: [NEW_EVIDENCE.id] });
      expect(step?.skip_reason).toContain(NEW_EVIDENCE.title);
      const prev = before.routes.find((r) => r.type === route.type)!;
      expect(route.total_hours).toBe(prev.total_hours - 8);
    }

    const diff = diffRoutes(before, after);
    expect(diff.status_change).toBeNull();
    expect(diff.route_changes.every((c) => c.change === 'changed' && c.hours_delta === -8)).toBe(true);
    expect(diff.route_changes.every((c) => c.newly_skipped_steps.some((s) => s.step_id === 'prep-mini-project'))).toBe(true);
    const text = diff.reasons.join('\n');
    expect(text).toContain(NEW_EVIDENCE.title);
    expect(text).toContain('完成一个数据分析小项目');
  });

  it('第 5 幕「不绕过硬性资格」：年级不符合的档案 → planRoutes 返回 blocked，没有任何路线', () => {
    const plan = planRoutes({ ...maya(), id: 'sample-maya-grade8', grade: 8 }, OPP, OPTS);
    expect(plan.status).toBe('blocked');
    expect(plan.routes).toEqual([]);
    if (plan.status !== 'blocked') return;
    expect(plan.blocking_requirements.map((b) => b.requirement_id)).toEqual(['req-grade']);
    expect(plan.blocking_requirements[0].source_text).toBe(OPP.requirements[0].source_text);
    expect(plan.reasons.length).toBeGreaterThan(0);
    // 年级会随时间变好、机会每年举办 → 给「下一届」提示；fields 非空 → 给「同领域替代」提示
    expect(plan.alternatives.map((a) => a.kind).sort()).toEqual(['next_cycle', 'same_field']);
  });

  it('第 6 幕「主办方分配资源」：给 Maya 一台 approved 的借用笔记本 → 从不可达变为可达；pending 的不算', () => {
    const student = maya();
    expect(analyzeReachability(student, OPP, [], OPTS).reachable).toBe(false);

    const pending = analyzeReachability(student, OPP, [laptopGrant(student.id, 'pending')], OPTS);
    expect(pending.reachable).toBe(false);
    expect(pending.barriers[0]).toMatchObject({ type: 'device', resolved: false });
    expect(pending.barriers[0].pending_grant_ids).toEqual([laptopGrant(student.id, 'pending').id]);
    expect(pending.applied_grant_ids).toEqual([]);

    const approved = analyzeReachability(student, OPP, [laptopGrant(student.id, 'approved')], OPTS);
    expect(approved.reachable).toBe(true);
    expect(approved.barriers[0]).toMatchObject({ type: 'device', resolved: true });
    expect(approved.applied_grant_ids).toEqual([laptopGrant(student.id, 'approved').id]);

    // 交通同理：Leo 拿到 approved 的交通补助后，交通障碍被化解（Leo 档案没填预算，所以整体是「无法判断」而不是可达）。
    const l = leo();
    const transport: ResourceGrant = {
      id: 'grant-transport-leo',
      student_id: l.id,
      opportunity_id: OPP.id,
      type: 'transport_subsidy',
      amount_usd: 30,
      status: 'approved',
      provider: '示例主办方（虚构）',
      is_sample: true,
    };
    const lr = analyzeReachability(l, OPP, [transport], OPTS);
    expect(lr.barriers.find((b) => b.type === 'transport')).toMatchObject({ resolved: true });
    expect(lr.reachable).toBeNull();
    expect(lr.missing_info).toEqual(['profile.budget_usd']);
  });

  it('第 7 幕「主办方 what-if」：6 名示例学生都缺笔记本、3 个借用名额 → OPTIMAL，G = 3、L = 0、N = 3 → 复核通过；多分给第 4 人 → 容量检查不通过', () => {
    const scenario = laptopScenario();
    // 前提：6 人都符合资格、都只缺笔记本
    for (const s of scenario.students) {
      const r = analyzeReachability(s, OPP, [], OPTS);
      expect(r.eligibility.overall).toBe('eligible');
      expect(r.barriers.map((b) => b.type)).toEqual(['device']);
    }

    const result = solveJoint(scenario);
    expect(result.status).toBe('OPTIMAL');
    expect(result.R0).toEqual([]);
    expect(result).toMatchObject({ G: 3, L: 0, N: 3 });
    expect(result.R1).toHaveLength(3);
    expect(result.selected_intervention_ids).toEqual(['iv-demo-laptop']);
    expect(result.allocations).toHaveLength(3);
    expect(result.cost.total_usd).toBe(60);
    expect(result.verification?.passed).toBe(true);

    const plan = { selected_intervention_ids: result.selected_intervention_ids, allocations: result.allocations };
    const verified = verifyPlan(scenario, plan);
    expect(verified.passed).toBe(true);
    expect(verified.checks.find((c) => c.name === 'capacity')?.passed).toBe(true);

    // 手工把同一措施多分给第 4 个人（预算仍够：$80 ≤ $200），只有容量不够。
    const allocated = new Set(result.allocations.map((a) => a.student_id));
    const fourth = scenario.students.find((s) => !allocated.has(s.id))!;
    const tampered = {
      ...plan,
      allocations: [
        ...plan.allocations,
        { intervention_id: 'iv-demo-laptop', student_id: fourth.id, opportunity_id: OPP.id, cost_usd: 20 },
      ],
    };
    const bad = verifyPlan(scenario, tampered);
    expect(bad.passed).toBe(false);
    const capacity = bad.checks.find((c) => c.name === 'capacity');
    expect(capacity?.passed).toBe(false);
    expect(bad.checks.find((c) => c.name === 'budget')?.passed).toBe(true);
  });

  it('第 8 幕「可复现」：整条主线不抛错，同输入跑两次结果完全相同', () => {
    expect(() => runMainline()).not.toThrow();
    const a = runMainline();
    const b = runMainline();
    expect(b).toEqual(a);
    // 串起来的关键结论
    expect(a.eligibility.overall).toBe('eligible');
    expect(a.reach0.reachable).toBe(false);
    expect(a.reach1.reachable).toBe(true);
    expect(a.plan0.status).toBe('routes');
    expect(a.diff.reasons.join('')).toContain(NEW_EVIDENCE.title);
    expect(a.joint.status).toBe('OPTIMAL');
    expect(a.verified.passed).toBe(true);
  });
});
