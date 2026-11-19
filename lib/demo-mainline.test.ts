/**
 * 演示主线的引擎级集成测试：把演示里由引擎负责的环节串成一条连续的故事。
 *
 * 学生端：选机会 → 看资格（三态 + 官网原文）→ 三层判断（资格 / 准备差距 / 现实障碍）→ 2–3 条路线
 *        → 补一条作品证据后重新规划（步骤被跳过，diff 说得出原因）→ 硬性不满足时不给绕过路线。
 * 主办方端：给学生分配资源后变为可达 → what-if 联合求解（G / L / N）→ 独立复核 → 篡改方案后复核不通过。
 *
 * 机会是测试文件内的明显虚构 fixture（example.com、is_sample: true），不是真实机会；
 * 学生来自 data/profiles.json 的示例档案。评估日统一为 2026-11-17。所有结果都是示例 / 模拟，可达 ≠ 录取。
 *
 * 第二组用例「演示最后一幕」（文件末尾的 describe）是演示收尾的保险：按演示顺序串起第二阶段的函数——
 * 差距与匹配理由 → 受阻时的替代 → pending 不算 → 主办方批准后可达 → 撤回后回到不可达 → 别人的 / 别的机会的
 * grant 不生效 → Quest Journal 与联合排期 → 公平性 → grants 存储往返（addGrants / removeGrants）。
 * 每条断言都是具体的值或引擎里的稳定文字片段。真实机会确定后，只需替换夹具里的机会（OPP / OPP2）与学生，
 * 再按引擎的实际输出更新断言。
 */
import { afterEach, describe, expect, it } from 'vitest';
import profilesJson from '../data/profiles.json';
import { checkEligibility } from './eligibility';
import { analyzeGaps } from './gap';
import { solveJoint, verifyPlan } from './joint';
import { applyJournalEvent } from './journal';
import { explainMatch, findAlternatives } from './match';
import { diffRoutes, planRoutes } from './path';
import { planAcrossOpportunities } from './planner';
import { analyzeReachability } from './reachability';
import { addGrants, createJournalEntry, grantsFor, loadGrants, removeGrants } from './store';
import { validateOpportunity, validateProfile } from './validation';
import type {
  EvidenceItem,
  Material,
  MatchExplanation,
  Opportunity,
  ResourceGrant,
  Route,
  Scenario,
  StudentProfile,
} from './types';

const OPTS = { today: '2026-11-17' } as const;

const PROFILES = profilesJson as unknown as StudentProfile[];
const byId = (id: string): StudentProfile => {
  const p = PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`示例档案 ${id} 不存在`);
  return structuredClone(p);
};

/** 示例高中生 Maya：11 年级、只有手机（缺笔记本）、交通可靠、每周 4 小时、预算 $20。 */
const maya = () => byId('sample-maya');
/** 示例高中生 Leo：10 年级、有笔记本、预算 $40，但没有交通工具。 */
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
    expect(item.confirm_with_official).toContain('Confirm with the organizer');
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

    // 交通同理：Leo 拿到 approved 的交通补助后，交通障碍被化解。
    // 第二阶段给 Leo 补了预算（$40，够付本机会的必需准备费），不再缺 profile.budget_usd，
    // 所以结论从原先的「无法判断（null）」变为可达（true）。可达 ≠ 录取。
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
    expect(lr.reachable).toBe(true);
    expect(lr.missing_info).toEqual([]);
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

// ═════════════════════════════ 演示最后一幕：第二阶段函数串成一条主线 ═════════════════════════════

/**
 * 第二个明显虚构的机会（example.com、is_sample: true）：线上、不需要设备、截止日期比 OPP 早，
 * 有一份标明可复用的个人陈述，用于「受阻时的替代」与「联合排期」。
 */
const OPP2: Opportunity = {
  id: 'sample-demo-online-challenge',
  title: '[Sample] Online data challenge (fictional)',
  organizer: '示例主办方（虚构）',
  category: 'competition',
  fields: ['computer_science', 'data_science'],
  summary: '虚构机会：一场线上数据挑战，仅用于演示主线测试。',
  official_url: 'https://example.com/sample-demo-online-challenge',
  verified_on: '2026-11-17',
  verified_by: '示例（虚构，未核实）',
  deadline: '2026-12-15',
  recurring_annually: true,
  location: { format: 'online', country: 'US', state: null, city: null },
  cost: { fee_usd: 0, requires_travel_expense: false, financial_aid_available: false },
  time_commitment: { hours_per_week: 2, total_weeks: 2, start_date: '2027-01-05', end_date: '2027-01-19' },
  required_devices: [],
  requirements: [
    {
      id: 'req2-grade',
      type: 'grade',
      min: 9,
      max: 12,
      hard: true,
      label: '高中在读（9–12 年级）',
      source_text: '(Sample) Open to students in grades 9–12.',
    },
  ],
  preparation: [
    {
      id: 'prep2-statement',
      title: 'Write a personal statement',
      skill: null,
      evidence_kind: null,
      estimated_hours: 4,
      estimated_cost_usd: 0,
      depends_on: [],
      required_for_application: true,
      material_kind: 'personal_statement',
      reusable_across_opportunities: true,
    },
    {
      id: 'prep2-notebook',
      title: 'Build a data notebook',
      skill: 'data_analysis',
      evidence_kind: 'project',
      estimated_hours: 10,
      estimated_cost_usd: 0,
      depends_on: [],
      required_for_application: true,
    },
  ],
  is_sample: true,
};

/**
 * 联合排期专用：OPP 的个人陈述标成可复用的 personal_statement（3 小时）。
 * 只在第 7 步使用；前 8 幕与本组其他步骤用的仍是原样的 OPP。
 */
const OPP_WITH_STATEMENT: Opportunity = {
  ...OPP,
  preparation: OPP.preparation.map((p) =>
    p.id === 'prep-statement'
      ? { ...p, material_kind: 'personal_statement' as const, reusable_across_opportunities: true, estimated_hours: 3 }
      : p,
  ),
};

const CATALOG: Opportunity[] = [OPP, OPP2];

/** 第 1–4 步在同一名学生、同一组 grants 下的全部结论（第 5、6、8 步拿它做深度相等比较）。 */
function lastActSnapshot(student: StudentProfile, grants: ResourceGrant[]) {
  return {
    reach: analyzeReachability(student, OPP, grants, OPTS),
    gaps: analyzeGaps(student, OPP, grants, OPTS),
    match: explainMatch(student, OPP, { ...OPTS, grants }),
    alternatives: findAlternatives(student, OPP, CATALOG, { ...OPTS, grants }),
  };
}

const reasonOf = (m: MatchExplanation, kind: string) => {
  const r = m.reasons.find((x) => x.kind === kind);
  if (!r) throw new Error(`explainMatch 没有 ${kind} 理由`);
  return r;
};

/** 测试内的内存版 localStorage（同 lib/store.test.ts 的做法）。 */
function installFakeWindow(): void {
  const data = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
      clear: () => data.clear(),
      key: (i: number) => [...data.keys()][i] ?? null,
      get length() {
        return data.size;
      },
    },
  };
}

describe('演示最后一幕（第二阶段函数串成主线，示例数据）', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it('夹具前提：第二个机会也是明显虚构的示例数据，并且通过校验', () => {
    expect(OPP2.is_sample).toBe(true);
    expect(new URL(OPP2.official_url).hostname).toBe('example.com');
    expect(OPP2.deadline! < OPP.deadline!).toBe(true);
    expect(validateOpportunity(OPP2)).toEqual([]);
    expect(validateOpportunity(OPP_WITH_STATEMENT)).toEqual([]);
  });

  it('第 1 步「差距与匹配」：Maya 缺笔记本 → 归在 time_and_cost、没有不可改变的资格限制；device 理由为不利、不可达；总结里没有分数', () => {
    const m = maya();
    const gaps = analyzeGaps(m, OPP, [], OPTS);
    expect(gaps.reachable).toBe(false);
    expect(gaps.eligibility_overall).toBe('eligible');
    expect(gaps.counts).toEqual({
      knowledge_or_experience: 4,
      materials: 0,
      time_and_cost: 1,
      unchangeable_eligibility: 0,
      unknown_info: 0,
    });
    expect(gaps.items.filter((i) => i.category === 'unchangeable_eligibility')).toEqual([]);
    const device = gaps.items.find((i) => i.id === 'time_and_cost:device:laptop');
    expect(device).toMatchObject({
      category: 'time_and_cost',
      basis: { kind: 'barrier', barrier_type: 'device' },
      improvable: true,
    });
    expect(device?.detail).toBe('Needs a laptop, which is not in your profile.');

    const match = explainMatch(m, OPP, OPTS);
    expect(match.reachable).toBe(false);
    expect(reasonOf(match, 'device')).toEqual({
      kind: 'device',
      positive: false,
      text: 'Needs a laptop, which is not in your profile.',
    });
    expect(reasonOf(match, 'reachability').positive).toBe(false);
    for (const text of [match.summary, ...match.reasons.map((r) => r.text)]) {
      expect(text).not.toContain('%');
      expect(text.toLowerCase()).not.toContain('score');
      expect(text.toLowerCase()).not.toContain('rank');
    }
  });

  it('第 2 步「受阻时的替代」：目录里同领域、可达的 OPP2 被建议为 same_field；没有 next_cycle（只差设备，截止没过、年级不低于下限、路线来得及）', () => {
    const alts = findAlternatives(maya(), OPP, CATALOG, OPTS);
    expect(alts).toHaveLength(1);
    expect(alts[0]).toMatchObject({
      kind: 'same_field',
      opportunity_id: OPP2.id,
      eligibility_overall: 'eligible',
      shared_fields: ['computer_science', 'data_science'],
    });
    expect(alts[0].reason).toContain('also in computer_science, data_science');
    expect(alts[0].reason).toContain('this says nothing about admission');
    expect(alts.some((a) => a.kind === 'next_cycle')).toBe(false);
    // 目标机会自己不会被当成替代
    expect(alts.some((a) => a.opportunity_id === OPP.id)).toBe(false);
  });

  it('第 3 步「待审批不算」：pending 的笔记本借用 → 仍不可达，device 理由仍为不利，差距说明写明尚未生效', () => {
    const m = maya();
    const pending = laptopGrant(m.id, 'pending');
    const s = lastActSnapshot(m, [pending]);
    expect(s.reach.reachable).toBe(false);
    expect(s.reach.barriers[0]).toMatchObject({ type: 'device', resolved: false, pending_grant_ids: [pending.id] });
    expect(reasonOf(s.match, 'device').positive).toBe(false);
    expect(reasonOf(s.match, 'device').text).toContain('it is not in effect yet (pending is not approved)');
    const device = s.gaps.items.find((i) => i.id === 'time_and_cost:device:laptop');
    expect(device?.action).toContain('once approved, this barrier would be resolved');
    expect(device?.action).toContain('It is not in effect yet (pending is not approved)');
    expect(s.gaps.counts.time_and_cost).toBe(1);
    // 受阻没变，替代建议不变
    expect(s.alternatives.map((a) => a.opportunity_id)).toEqual([OPP2.id]);
  });

  it('第 4 步「主办方批准后可达」：approved + is_sample 的借用 → 可达；device 理由翻转并说明是主办方批准；差距不再列设备；没有替代建议', () => {
    const m = maya();
    const approved = laptopGrant(m.id, 'approved');
    expect(approved.is_sample).toBe(true);
    const s = lastActSnapshot(m, [approved]);
    expect(s.reach.reachable).toBe(true);
    expect(s.reach.barriers).toEqual([
      {
        type: 'device',
        description: 'Needs a laptop, which is not in your profile.',
        shortfall: null,
        resolved: true,
        resolved_by_grant_ids: [approved.id],
        pending_grant_ids: [],
      },
    ]);
    expect(reasonOf(s.match, 'device')).toEqual({
      kind: 'device',
      positive: true,
      text: 'The laptop loan the organizer approved covers the laptop requirement.',
    });
    expect(reasonOf(s.match, 'reachability').text).toContain('1 barrier resolved by approved support');
    expect(reasonOf(s.match, 'reachability').text).toContain('Reachable does not mean admitted.');
    expect(s.gaps.reachable).toBe(true);
    expect(s.gaps.counts.time_and_cost).toBe(0);
    expect(s.gaps.items.some((i) => i.category === 'time_and_cost')).toBe(false);
    expect(s.gaps.summary).toContain('1 barrier is already resolved by approved support');
    expect(s.gaps.summary).toContain('which does not mean admitted');
    expect(s.alternatives).toEqual([]);
  });

  it('第 5 步「撤回后回到不可达」：去掉 grant，结果与第 1 步完全相同', () => {
    const m = maya();
    const before = lastActSnapshot(m, []);
    const withGrant = lastActSnapshot(m, [laptopGrant(m.id, 'approved')]);
    expect(withGrant.reach.reachable).toBe(true);
    const after = lastActSnapshot(m, []);
    expect(after).toEqual(before);
    expect(after.reach.reachable).toBe(false);
  });

  it('第 6 步「别的学生、别的机会的 grant 不生效」：结论与没有 grant 时完全相同', () => {
    const m = maya();
    const baseline = lastActSnapshot(m, []);
    const otherStudent: ResourceGrant = { ...laptopGrant('sample-leo', 'approved'), id: 'grant-laptop-other-student' };
    const otherOpp: ResourceGrant = { ...laptopGrant(m.id, 'approved'), id: 'grant-laptop-other-opp', opportunity_id: OPP2.id };
    expect(lastActSnapshot(m, [otherStudent])).toEqual(baseline);
    expect(lastActSnapshot(m, [otherOpp])).toEqual(baseline);
    expect(lastActSnapshot(m, [otherStudent, otherOpp])).toEqual(baseline);
    expect(analyzeReachability(m, OPP, [otherStudent, otherOpp], OPTS).applied_grant_ids).toEqual([]);
  });

  it('第 7 步「Journal 与联合排期」：四项状态互相独立；两条机会按截止排序、可复用材料只算一次、负荷超出时有冲突、就绪材料不计小时', () => {
    const m = maya();
    // Journal：createJournalEntry 只构造、不写存储；applyJournalEvent 是纯函数
    const e0 = createJournalEntry(m.id, OPP, '2026-11-17');
    expect(e0).toMatchObject({ application: 'preparing', eligibility_confirmation: 'unconfirmed', decision: 'pending', participated: null });
    const e1 = applyJournalEvent(e0, 'submitted', '2026-11-18');
    expect(e1).toMatchObject({ application: 'submitted', submitted_on: '2026-11-18', eligibility_confirmation: 'unconfirmed', decision: 'pending', participated: null });
    const e2 = applyJournalEvent(e1, 'eligibility_confirmed', '2026-11-19');
    expect(e2).toMatchObject({ application: 'submitted', eligibility_confirmation: 'confirmed', decision: 'pending', participated: null });
    const e3 = applyJournalEvent(e2, 'eligibility_cleared', '2026-11-19');
    expect(e3).toMatchObject({ application: 'submitted', submitted_on: '2026-11-18', eligibility_confirmation: 'unconfirmed', decision: 'pending', participated: null });
    expect(e3.history.map((h) => h.event)).toEqual(['added', 'submitted', 'eligibility_confirmed', 'eligibility_cleared']);

    // 联合排期：传入顺序与截止顺序相反，结果按截止日期排
    const plan = planAcrossOpportunities(m, [OPP_WITH_STATEMENT, OPP2], OPTS);
    expect(plan.items.map((i) => [i.opportunity_id, i.order, i.status])).toEqual([
      [OPP2.id, 1, 'planned'],
      [OPP.id, 2, 'planned'],
    ]);
    // 个人陈述只算一次（按最大的 4 小时记在截止更早的 OPP2 上），OPP 省下自己那 3 小时
    expect(plan.reuse).toHaveLength(1);
    expect(plan.reuse[0]).toMatchObject({ material_kind: 'personal_statement', hours_each: 4, hours_saved: 3 });
    const saved = plan.reuse.reduce((sum, r) => sum + r.hours_saved, 0);
    expect(plan.total_hours_without_reuse - plan.total_hours).toBe(saved);
    expect([plan.total_hours, plan.total_hours_without_reuse]).toEqual([27, 30]);
    expect(plan.items[1]).toMatchObject({ hours_before_reuse: 16, hours_saved_by_reuse: 3, required_hours: 13 });
    // 每周 4 小时不够 → 有冲突（截止前几周）
    expect(plan.conflicts.length).toBeGreaterThan(0);
    expect(plan.conflicts[0]).toContain('Week of 2026-11-16');
    expect(plan.weekly_load.some((w) => w.over)).toBe(true);

    // 一份已就绪的通用个人陈述 → 两边的个人陈述都不计小时，也就没有可复用的那份
    const ready: Material = {
      id: 'mat-sample-statement',
      profile_id: m.id,
      kind: 'personal_statement',
      title: 'Personal statement (sample)',
      reusable: true,
      opportunity_id: null,
      estimated_hours: 4,
      status: 'ready',
    };
    const withReady = planAcrossOpportunities(m, [OPP_WITH_STATEMENT, OPP2], { ...OPTS, materials: [ready] });
    expect(withReady.items.map((i) => i.hours_before_reuse)).toEqual([14 - 4, 16 - 3]);
    expect(withReady.reuse).toEqual([]);
    expect([withReady.total_hours, withReady.total_hours_without_reuse]).toEqual([23, 23]);
    expect(withReady.items[0].note).toContain('already prepared (marked ready)');
    expect(withReady.conflicts).toEqual([]);
  });

  it('第 8 步「公平性」：只改学校名与显示名，第 1–4 步的全部结论完全相同', () => {
    const m = maya();
    const renamed: StudentProfile = { ...maya(), school_name: 'A very different school (fictional)', display_name: 'Renamed sample student' };
    for (const grants of [[], [laptopGrant(m.id, 'pending')], [laptopGrant(m.id, 'approved')]]) {
      expect(lastActSnapshot(renamed, grants)).toEqual(lastActSnapshot(m, grants));
    }
  });

  it('第 9 步「store 往返」：addGrants 写入 → grantsFor 取到（is_sample 被强制为 true）→ 可达 → removeGrants 撤回 → 取不到 → 不可达', () => {
    installFakeWindow();
    const m = maya();
    const unmarked = { ...laptopGrant(m.id, 'approved'), is_sample: false };
    const written = addGrants([unmarked]);
    expect(written.map((g) => g.id)).toEqual([unmarked.id]);

    const effective = grantsFor(m.id, OPP.id);
    expect(effective).toHaveLength(1);
    expect(effective[0]).toMatchObject({ id: unmarked.id, status: 'approved', is_sample: true });
    expect(grantsFor(m.id, OPP2.id)).toEqual([]);
    expect(analyzeReachability(m, OPP, effective, OPTS).reachable).toBe(true);

    expect(removeGrants([unmarked.id])).toEqual([]);
    expect(loadGrants()).toEqual([]);
    expect(grantsFor(m.id, OPP.id)).toEqual([]);
    expect(analyzeReachability(m, OPP, grantsFor(m.id, OPP.id), OPTS).reachable).toBe(false);
  });
});
