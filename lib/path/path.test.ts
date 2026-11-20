import { describe, expect, it } from 'vitest';
import profilesJson from '../../data/profiles.json';
import { diffRoutes, planRoutes } from './index';
import type { Opportunity, PlanResult, PrepItem, Route, StudentProfile } from '../types';

// ───────────────────────── 虚构测试数据（不是真实机会） ─────────────────────────

function prep(p: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return {
    skill: null,
    evidence_kind: null,
    estimated_hours: 1,
    estimated_cost_usd: 0,
    depends_on: [],
    required_for_application: false,
    ...p,
  };
}

/**
 * 依赖关系：
 *   prep-python(学习) ← prep-data(学习)
 *   prep-python(学习) ← prep-project(实践, 必需)
 *   prep-portfolio(实践)
 *   prep-essay(材料, 必需) ← prep-letter(材料, 必需)
 */
const OPP: Opportunity = {
  id: 'fictional-climate-lab',
  title: '虚构气候数据营（非真实机会）',
  organizer: 'Example Org（虚构）',
  category: 'summer_program',
  fields: ['computer_science', 'climate'],
  summary: '仅用于单元测试的虚构机会。',
  official_url: 'https://example.com/fictional-climate-lab',
  verified_on: '2026-11-17',
  verified_by: 'test-fixture',
  deadline: '2027-03-01',
  recurring_annually: true,
  location: { format: 'online' },
  cost: { fee_usd: 25, requires_travel_expense: false },
  time_commitment: { hours_per_week: 5, total_weeks: 6 },
  required_devices: [],
  requirements: [
    { id: 'req-grade', type: 'grade', min: 9, max: 12, label: '9–12 年级', hard: true, source_text: 'Open to students in grades 9-12.' },
    { id: 'req-region', type: 'region', countries: ['US'], label: '美国居民', hard: true, source_text: 'Applicants must reside in the United States.' },
  ],
  preparation: [
    prep({ id: 'prep-python', title: '学会 Python 基础', skill: 'python', estimated_hours: 15 }),
    prep({ id: 'prep-data', title: '学数据分析入门', skill: 'data_analysis', estimated_hours: 10, depends_on: ['prep-python'] }),
    prep({ id: 'prep-project', title: '做一个气候数据小项目', skill: 'climate_data', evidence_kind: 'project', estimated_hours: 20, estimated_cost_usd: 10, depends_on: ['prep-python'], required_for_application: true }),
    prep({ id: 'prep-portfolio', title: '整理作品集页面', evidence_kind: 'portfolio', estimated_hours: 8 }),
    prep({ id: 'prep-essay', title: '写个人陈述', estimated_hours: 6, required_for_application: true }),
    prep({ id: 'prep-letter', title: '请老师写推荐信', evidence_kind: 'recommendation_letter', estimated_hours: 2, depends_on: ['prep-essay'], required_for_application: true }),
  ],
  is_sample: true,
};

const NO_PRACTICE_OPP: Opportunity = {
  ...OPP,
  id: 'fictional-reading-club',
  title: '虚构读书项目（非真实机会）',
  official_url: 'https://example.com/fictional-reading-club',
  preparation: [
    prep({ id: 'a', title: '读指定书目', estimated_hours: 5 }),
    prep({ id: 'b', title: '写读书笔记', estimated_hours: 3, depends_on: ['a'], required_for_application: true }),
  ],
};

const CHAIN_OPP: Opportunity = {
  ...OPP,
  id: 'fictional-chain',
  official_url: 'https://example.com/fictional-chain',
  preparation: [
    prep({ id: 'd', title: '实践 D', evidence_kind: 'project', estimated_hours: 4, depends_on: ['c', 'b'] }),
    prep({ id: 'c', title: '学习 C', estimated_hours: 3, depends_on: ['a'] }),
    prep({ id: 'b', title: '实践 B', evidence_kind: 'volunteer_experience', estimated_hours: 2, depends_on: ['a'], required_for_application: true }),
    prep({ id: 'a', title: '学习 A', estimated_hours: 1 }),
    prep({ id: 'e', title: '材料 E', estimated_hours: 1, depends_on: ['d'], required_for_application: true }),
  ],
};

const STUDENT: StudentProfile = {
  id: 'test-student',
  is_sample: true,
  display_name: '测试学生（虚构）',
  grade: 11,
  region: { country: 'US', state: 'CA' },
  hours_per_week_available: 5,
  budget_usd: 100,
  evidence: [],
};

const TODAY = '2026-11-17';

const PROJECT_EVIDENCE = {
  id: 'ev-project',
  title: '气候数据小项目（虚构）',
  kind: 'project' as const,
  skills: ['climate_data'],
  status: 'evidence_attached' as const,
  added_on: '2026-11-17',
};

function routesOf(r: PlanResult): Route[] {
  if (r.status !== 'routes') throw new Error('expected routes');
  return r.routes;
}

function route(r: PlanResult, type: Route['type']): Route {
  const found = routesOf(r).find((x) => x.type === type);
  if (!found) throw new Error(`no ${type}`);
  return found;
}

function ids(r: Route): string[] {
  return r.steps.map((s) => s.id);
}

function assertTopological(r: Route) {
  const pos = new Map(r.steps.map((s, i) => [s.id, i]));
  for (const s of r.steps) {
    for (const d of s.depends_on) {
      expect(pos.has(d), `${r.type}: ${s.id} 依赖的 ${d} 不在路线中`).toBe(true);
      expect(pos.get(d)!, `${r.type}: ${s.id} 应排在 ${d} 之后`).toBeLessThan(pos.get(s.id)!);
    }
  }
}

// ───────────────────────── blocked ─────────────────────────

describe('planRoutes：硬性资格不满足', () => {
  it('年级低于下限 → blocked、routes 为空、原因带官网原文、给 next_cycle 与 same_field', () => {
    const r = planRoutes({ ...STUDENT, grade: 8 }, OPP, { today: TODAY });
    expect(r.status).toBe('blocked');
    expect(r.routes).toEqual([]);
    if (r.status !== 'blocked') return;
    expect(r.blocking_requirements.map((b) => b.requirement_id)).toEqual(['req-grade']);
    expect(r.blocking_requirements[0].source_text).toBe('Open to students in grades 9-12.');
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0]).toContain('9–12 年级');
    expect(r.reasons[0]).toContain('Open to students in grades 9-12.');
    expect(r.alternatives.map((a) => a.kind)).toEqual(['next_cycle', 'same_field']);
    const sameField = r.alternatives.find((a) => a.kind === 'same_field')!;
    expect(sameField.text).toContain('computer_science');
    expect(sameField.text).toContain('climate');
    expect(sameField.opportunity_ids).toBeUndefined();
  });

  it('年级高于上限 → 不给 next_cycle', () => {
    const r = planRoutes({ ...STUDENT, grade: 13 }, OPP, { today: TODAY });
    expect(r.status).toBe('blocked');
    if (r.status !== 'blocked') return;
    expect(r.alternatives.map((a) => a.kind)).toEqual(['same_field']);
  });

  it('地区不符 → 不给 next_cycle', () => {
    const r = planRoutes({ ...STUDENT, region: { country: 'CA' } }, OPP, { today: TODAY });
    expect(r.status).toBe('blocked');
    if (r.status !== 'blocked') return;
    expect(r.blocking_requirements.map((b) => b.requirement_id)).toEqual(['req-region']);
    expect(r.reasons[0]).toContain('Applicants must reside in the United States.');
    expect(r.alternatives.some((a) => a.kind === 'next_cycle')).toBe(false);
  });

  it('年级低于下限但地区也不符 → 不给 next_cycle（下一届也解决不了）', () => {
    const r = planRoutes({ ...STUDENT, grade: 8, region: { country: 'CA' } }, OPP, { today: TODAY });
    expect(r.status).toBe('blocked');
    if (r.status !== 'blocked') return;
    expect(r.reasons).toHaveLength(2);
    expect(r.alternatives.some((a) => a.kind === 'next_cycle')).toBe(false);
  });

  it('recurring_annually 未知 → next_cycle 提示向官方确认；明确不每年举办 → 不给', () => {
    const unknownOpp = { ...OPP, recurring_annually: null };
    const r1 = planRoutes({ ...STUDENT, grade: 8 }, unknownOpp);
    if (r1.status !== 'blocked') throw new Error('expected blocked');
    expect(r1.alternatives.find((a) => a.kind === 'next_cycle')?.text).toContain('Confirm with the organizer whether it runs every year');

    const r2 = planRoutes({ ...STUDENT, grade: 8 }, { ...OPP, recurring_annually: false });
    if (r2.status !== 'blocked') throw new Error('expected blocked');
    expect(r2.alternatives.some((a) => a.kind === 'next_cycle')).toBe(false);
  });

  it('fields 为空 → 不给 same_field', () => {
    const r = planRoutes({ ...STUDENT, grade: 13 }, { ...OPP, fields: [] });
    if (r.status !== 'blocked') throw new Error('expected blocked');
    expect(r.alternatives).toEqual([]);
  });

  it('缺作品被硬性阻断 → 仍 blocked、不生成路线，原因提示补上后可重新规划', () => {
    const opp: Opportunity = {
      ...OPP,
      requirements: [
        ...OPP.requirements,
        { id: 'req-portfolio', type: 'portfolio', evidence_kind: 'project', label: '需提交一个项目', hard: true, source_text: 'A project sample is required.' },
      ],
    };
    const r = planRoutes(STUDENT, opp, { today: TODAY });
    expect(r.status).toBe('blocked');
    expect(r.routes).toEqual([]);
    if (r.status !== 'blocked') return;
    expect(r.reasons[0]).toContain('A project sample is required.');
    expect(r.reasons[0]).toContain('you can plan again');
  });
});

// ───────────────────────── routes ─────────────────────────

describe('planRoutes：生成路线', () => {
  it('资格 unknown → 仍给路线，plan warnings 列出待确认的要求', () => {
    const r = planRoutes({ ...STUDENT, grade: null }, OPP, { today: TODAY });
    expect(r.status).toBe('routes');
    if (r.status !== 'routes') return;
    expect(r.routes.length).toBeGreaterThanOrEqual(2);
    expect(r.warnings.some((w) => w.includes('9–12 年级') && w.includes('Confirm with the organizer'))).toBe(true);
  });

  it('资格 eligible → 无资格提醒；三条路线顺序固定、id 与标题正确', () => {
    const r = planRoutes(STUDENT, OPP, { today: TODAY });
    expect(r.status).toBe('routes');
    if (r.status !== 'routes') return;
    expect(r.warnings).toEqual([]);
    expect(r.routes.map((x) => x.type)).toEqual(['learning_first', 'practice_first', 'community']);
    expect(r.routes.map((x) => x.id)).toEqual([
      'fictional-climate-lab:learning_first',
      'fictional-climate-lab:practice_first',
      'fictional-climate-lab:community',
    ]);
    for (const x of r.routes) {
      expect(x.title).not.toMatch(/mock/i);
      expect(x.rationale.length).toBeGreaterThan(0);
      expect(x.rationale).not.toContain('admit');
    }
  });

  it('没有实践类准备项 → 只有学习优先和社区协作两条', () => {
    const r = planRoutes(STUDENT, NO_PRACTICE_OPP, { today: TODAY });
    expect(routesOf(r).map((x) => x.type)).toEqual(['learning_first', 'community']);
  });

  it('依赖顺序性质：每条路线、每个 fixture，步骤都排在依赖之后', () => {
    for (const opp of [OPP, NO_PRACTICE_OPP, CHAIN_OPP]) {
      for (const profile of [STUDENT, { ...STUDENT, evidence: [PROJECT_EVIDENCE] }]) {
        const routes = routesOf(planRoutes(profile, opp, { today: TODAY }));
        expect(routes.length === 2 || routes.length === 3).toBe(true);
        for (const x of routes) assertTopological(x);
      }
    }
  });

  it('具体顺序：学习优先先学，实践优先先做，社区协作先找同伴再做必需项', () => {
    const r = planRoutes(STUDENT, OPP, { today: TODAY });
    expect(ids(route(r, 'learning_first'))).toEqual([
      'prep-python', 'prep-data', 'prep-essay', 'prep-letter', 'prep-project', 'prep-portfolio', 'submit-application',
    ]);
    expect(ids(route(r, 'practice_first'))).toEqual([
      'prep-portfolio', 'prep-python', 'prep-project', 'prep-data', 'prep-essay', 'prep-letter', 'submit-application',
    ]);
    expect(ids(route(r, 'community'))).toEqual([
      'find-partner', 'prep-essay', 'prep-letter', 'prep-python', 'prep-project', 'prep-data', 'prep-portfolio', 'submit-application',
    ]);
    expect(ids(route(r, 'learning_first'))).not.toEqual(ids(route(r, 'practice_first')));
  });

  it('CHAIN_OPP：学习优先与实践优先顺序不同', () => {
    const r = planRoutes(STUDENT, CHAIN_OPP, { today: TODAY });
    expect(ids(route(r, 'learning_first'))).toEqual(['a', 'c', 'b', 'd', 'e', 'submit-application']);
    expect(ids(route(r, 'practice_first'))).toEqual(['a', 'b', 'c', 'd', 'e', 'submit-application']);
  });

  it('固定步骤：提交申请依赖所有其他步骤、费用 = 报名费；同伴步骤 2 小时', () => {
    const r = planRoutes(STUDENT, OPP, { today: TODAY });
    for (const x of routesOf(r)) {
      const submit = x.steps[x.steps.length - 1];
      expect(submit.id).toBe('submit-application');
      expect(submit.prep_item_id).toBeNull();
      expect(submit.hours).toBe(0);
      expect(submit.cost_usd).toBe(25);
      expect(submit.skipped).toBe(false);
      expect([...submit.depends_on].sort()).toEqual(x.steps.slice(0, -1).map((s) => s.id).sort());
    }
    const partner = route(r, 'community').steps[0];
    expect(partner).toMatchObject({ id: 'find-partner', prep_item_id: null, hours: 2, cost_usd: 0, depends_on: [] });
    expect(partner.description).toContain('estimate');
  });

  it('准备项步骤 id = prep_item_id = PrepItem.id，依赖取自 PrepItem', () => {
    const r = planRoutes(STUDENT, OPP, { today: TODAY });
    const step = route(r, 'learning_first').steps.find((s) => s.id === 'prep-project')!;
    expect(step).toMatchObject({ prep_item_id: 'prep-project', hours: 20, cost_usd: 10, depends_on: ['prep-python'], skipped: false });
  });

  it('合计小时 / 费用正确', () => {
    const r = planRoutes(STUDENT, OPP, { today: TODAY });
    expect(route(r, 'learning_first')).toMatchObject({ total_hours: 61, total_cost_usd: 35 });
    expect(route(r, 'practice_first')).toMatchObject({ total_hours: 61, total_cost_usd: 35 });
    expect(route(r, 'community')).toMatchObject({ total_hours: 63, total_cost_usd: 35 });
  });

  it('超出预算 → warning 写出超出金额', () => {
    const r = planRoutes({ ...STUDENT, budget_usd: 20 }, OPP, { today: TODAY });
    for (const x of routesOf(r)) expect(x.warnings).toContain('Over budget by $15 (this route needs about $35; your profile budget is $20).');
    const ok = planRoutes(STUDENT, OPP, { today: TODAY });
    for (const x of routesOf(ok)) expect(x.warnings.some((w) => w.startsWith('Over budget'))).toBe(false);
  });

  it('报名费未写清 → 不计入费用并提醒', () => {
    const r = planRoutes(STUDENT, { ...OPP, cost: { fee_usd: null, requires_travel_expense: false } }, { today: TODAY });
    for (const x of routesOf(r)) {
      expect(x.total_cost_usd).toBe(10);
      expect(x.warnings.some((w) => w.includes('The application fee is not clear on the official site'))).toBe(true);
    }
  });

  it('estimated_weeks：向上取整；可用小时没填或 ≤ 0 → null', () => {
    expect(route(planRoutes(STUDENT, OPP), 'learning_first').estimated_weeks).toBe(13); // 61 / 5
    expect(route(planRoutes({ ...STUDENT, hours_per_week_available: null }, OPP), 'learning_first').estimated_weeks).toBeNull();
    expect(route(planRoutes({ ...STUDENT, hours_per_week_available: 0 }, OPP), 'learning_first').estimated_weeks).toBeNull();
  });

  it('feasible_by_deadline：true / false / null', () => {
    // 2026-11-17 → 2027-03-01 共 104 天，每周 5 小时 ≈ 74.3 小时 ≥ 61
    expect(route(planRoutes(STUDENT, OPP, { today: TODAY }), 'learning_first').feasible_by_deadline).toBe(true);

    const tight = route(planRoutes({ ...STUDENT, hours_per_week_available: 2 }, OPP, { today: TODAY }), 'learning_first');
    expect(tight.feasible_by_deadline).toBe(false);
    // 只做必需项：项目 20 + 其前置 Python 15 + 陈述 6 + 推荐信 2 = 43
    expect(tight.warnings.some((w) => w.includes('may not make it') && w.includes('43 hours'))).toBe(true);

    const passed = route(planRoutes(STUDENT, OPP, { today: '2027-04-01' }), 'learning_first');
    expect(passed.feasible_by_deadline).toBe(false);
    expect(passed.warnings.some((w) => w.includes('has passed'))).toBe(true);

    const noToday = route(planRoutes(STUDENT, OPP), 'learning_first');
    expect(noToday.feasible_by_deadline).toBeNull();
    expect(noToday.warnings.some((w) => w.includes("today's date"))).toBe(true);

    const noDeadline = route(planRoutes(STUDENT, { ...OPP, deadline: null }, { today: TODAY }), 'learning_first');
    expect(noDeadline.feasible_by_deadline).toBeNull();
    expect(noDeadline.warnings.some((w) => w.includes('gives no deadline'))).toBe(true);

    const noHours = route(planRoutes({ ...STUDENT, hours_per_week_available: null }, OPP, { today: TODAY }), 'learning_first');
    expect(noHours.feasible_by_deadline).toBeNull();
    expect(noHours.warnings.some((w) => w.includes('weekly available hours'))).toBe(true);
  });

  it('加一条作品证据：对应步骤被跳过、保留在列表、合计减少', () => {
    const before = planRoutes(STUDENT, OPP, { today: TODAY });
    const after = planRoutes({ ...STUDENT, evidence: [PROJECT_EVIDENCE] }, OPP, { today: TODAY });
    for (const type of ['learning_first', 'practice_first', 'community'] as const) {
      const step = route(after, type).steps.find((s) => s.id === 'prep-project')!;
      expect(step.skipped).toBe(true);
      expect(step.skip_reason).toContain('"气候数据小项目（虚构）"');
      expect(step.satisfied_by_evidence_ids).toEqual(['ev-project']);
      expect(step.hours).toBe(20);
      expect(route(after, type).total_hours).toBe(route(before, type).total_hours - 20);
      expect(route(after, type).total_cost_usd).toBe(route(before, type).total_cost_usd - 10);
    }
  });

  it('所有实践类准备项都被覆盖 → 不再生成实践优先路线', () => {
    const profile: StudentProfile = {
      ...STUDENT,
      evidence: [
        PROJECT_EVIDENCE,
        { id: 'ev-port', title: '个人作品集（虚构）', kind: 'portfolio', skills: [], prep_item_ids: ['fictional-climate-lab:prep-portfolio'], status: 'self_reported', added_on: '2026-11-17' },
      ],
    };
    expect(routesOf(planRoutes(profile, OPP)).map((x) => x.type)).toEqual(['learning_first', 'community']);
  });
});

// ───────────────────────── 坏数据 ─────────────────────────

describe('planRoutes：坏数据不抛错', () => {
  it('依赖不存在的 id → 忽略并提醒', () => {
    const opp: Opportunity = {
      ...OPP,
      preparation: [prep({ id: 'x', title: '步骤 X', estimated_hours: 2, depends_on: ['ghost'] })],
    };
    const r = planRoutes(STUDENT, opp);
    if (r.status !== 'routes') throw new Error('expected routes');
    expect(r.warnings.some((w) => w.includes('ghost'))).toBe(true);
    for (const x of r.routes) {
      expect(x.steps.find((s) => s.id === 'x')!.depends_on).toEqual([]);
      assertTopological(x);
    }
  });

  it('依赖成环 → 不抛错，从环上原顺序最靠前的一项开始排并提醒', () => {
    const opp: Opportunity = {
      ...OPP,
      preparation: [
        prep({ id: 'free', title: '无依赖', estimated_hours: 1 }),
        prep({ id: 'p', title: '环 P', estimated_hours: 1, depends_on: ['q'] }),
        prep({ id: 'q', title: '环 Q', estimated_hours: 1, depends_on: ['p'] }),
      ],
    };
    const r = planRoutes(STUDENT, opp);
    if (r.status !== 'routes') throw new Error('expected routes');
    expect(r.warnings.some((w) => w.includes('in a loop'))).toBe(true);
    const lf = route(r, 'learning_first');
    expect(ids(lf)).toEqual(['free', 'p', 'q', 'submit-application']);
    expect(lf.warnings.some((w) => w.includes('in a loop'))).toBe(true);
    expect(lf.total_hours).toBe(3);
  });

  it('preparation 为空 → 学习优先只有提交申请，社区协作有同伴 + 提交', () => {
    const r = planRoutes(STUDENT, { ...OPP, preparation: [] }, { today: TODAY });
    if (r.status !== 'routes') throw new Error('expected routes');
    expect(r.routes.map((x) => x.type)).toEqual(['learning_first', 'community']);
    expect(ids(route(r, 'learning_first'))).toEqual(['submit-application']);
    expect(ids(route(r, 'community'))).toEqual(['find-partner', 'submit-application']);
    expect(r.warnings.some((w) => w.includes('lists no prep items'))).toBe(true);
  });
});

// ───────────────────────── 确定性 / 公平性 / 示例档案 ─────────────────────────

describe('planRoutes：确定性与公平性', () => {
  it('同输入两次结果相同', () => {
    expect(planRoutes(STUDENT, OPP, { today: TODAY })).toEqual(planRoutes(STUDENT, OPP, { today: TODAY }));
  });

  it('仅 school_name / display_name 不同，结果一致', () => {
    const a = { ...STUDENT, school_name: 'Example Elite Academy（虚构）', display_name: '示例 A' };
    const b = { ...STUDENT, school_name: 'Example Rural School（虚构）', display_name: '示例 B' };
    for (const opp of [OPP, CHAIN_OPP]) {
      expect(planRoutes(a, opp, { today: TODAY })).toEqual(planRoutes(b, opp, { today: TODAY }));
    }
    expect(planRoutes({ ...a, grade: 8 }, OPP, { today: TODAY })).toEqual(planRoutes({ ...b, grade: 8 }, OPP, { today: TODAY }));
  });

  it('data/profiles.json 四个示例档案跑一遍不抛错', () => {
    const profiles = profilesJson as unknown as StudentProfile[];
    expect(profiles).toHaveLength(4);
    for (const p of profiles) {
      for (const opp of [OPP, NO_PRACTICE_OPP, CHAIN_OPP]) {
        const r = planRoutes(p, opp, { today: TODAY });
        expect(['routes', 'blocked']).toContain(r.status);
        if (r.status === 'routes') for (const x of r.routes) assertTopological(x);
        expect(() => diffRoutes(r, planRoutes(p, opp))).not.toThrow();
      }
    }
  });
});

// ───────────────────────── diffRoutes ─────────────────────────

describe('diffRoutes', () => {
  it('加作品证据后：步骤被跳过，reasons 提到证据标题和步骤名，小时 / 费用 delta 正确', () => {
    const before = planRoutes(STUDENT, OPP, { today: TODAY });
    const after = planRoutes({ ...STUDENT, evidence: [PROJECT_EVIDENCE] }, OPP, { today: TODAY });
    const d = diffRoutes(before, after);
    expect(d.status_change).toBeNull();
    expect(d.route_changes.map((c) => c.route_type)).toEqual(['learning_first', 'practice_first', 'community']);
    for (const c of d.route_changes) {
      expect(c.change).toBe('changed');
      expect(c.newly_skipped_steps.map((s) => s.step_id)).toEqual(['prep-project']);
      expect(c.newly_skipped_steps[0].reason).toContain('气候数据小项目（虚构）');
      expect(c.hours_delta).toBe(-20);
      expect(c.cost_delta_usd).toBe(-10);
    }
    const skipReason = d.reasons.find((r) => r.includes('做一个气候数据小项目'));
    expect(skipReason).toBeDefined();
    expect(skipReason).toContain('"气候数据小项目（虚构）"');
    expect(skipReason).toContain('20 hours');
    expect(skipReason).toContain('The Learning first, Practice first and Community routes are each 20 hours shorter and cost $10 less.');
    expect(skipReason).not.toContain('(s)');
    // 三条路线的同一变化合并成一句
    expect(d.reasons.filter((r) => r.includes('做一个气候数据小项目'))).toHaveLength(1);
  });

  it('只有一条路线跳过步骤时，原因用单数句式', () => {
    const before = planRoutes(STUDENT, OPP, { today: TODAY });
    const full = planRoutes({ ...STUDENT, evidence: [PROJECT_EVIDENCE] }, OPP, { today: TODAY });
    if (before.status !== 'routes' || full.status !== 'routes') throw new Error('expected routes');
    const after: PlanResult = { ...full, routes: full.routes.map((r) => (r.type === 'learning_first' ? r : before.routes.find((x) => x.type === r.type)!)) };
    const d = diffRoutes(before, after);
    const skipReason = d.reasons.find((r) => r.includes('做一个气候数据小项目'));
    expect(skipReason).toContain('The Learning first route is 20 hours shorter and costs $10 less.');
  });

  it('删除证据 → 步骤不再跳过，说明原因', () => {
    const withEv = planRoutes({ ...STUDENT, evidence: [PROJECT_EVIDENCE] }, OPP, { today: TODAY });
    const without = planRoutes(STUDENT, OPP, { today: TODAY });
    const d = diffRoutes(withEv, without);
    expect(d.route_changes[0].unskipped_steps.map((s) => s.step_id)).toEqual(['prep-project']);
    expect(d.route_changes[0].hours_delta).toBe(20);
    expect(d.reasons.some((r) => r.includes('is no longer skipped'))).toBe(true);
    const unskip = d.reasons.find((r) => r.includes('is no longer skipped'));
    expect(unskip).toContain('before, it was already covered by "气候数据小项目（虚构）";');
    expect(unskip).toContain('The Learning first, Practice first and Community routes are each 20 hours longer and cost $10 more.');
  });

  it('无变化 → 全部 unchanged，只有一条「没有变化」', () => {
    const p = planRoutes(STUDENT, OPP, { today: TODAY });
    const d = diffRoutes(p, planRoutes(STUDENT, OPP, { today: TODAY }));
    expect(d.status_change).toBeNull();
    expect(d.route_changes.every((c) => c.change === 'unchanged')).toBe(true);
    expect(d.reasons).toEqual(['Nothing changed between the two plans.']);
  });

  it('blocked → routes：状态变化并引用之前的阻断原因', () => {
    const before = planRoutes({ ...STUDENT, grade: 8 }, OPP, { today: TODAY });
    const after = planRoutes({ ...STUDENT, grade: 9 }, OPP, { today: TODAY });
    const d = diffRoutes(before, after);
    expect(d.status_change).toEqual({ from: 'blocked', to: 'routes' });
    expect(d.route_changes.every((c) => c.change === 'added')).toBe(true);
    expect(d.route_changes.every((c) => c.hours_delta === null && c.hours_before === null)).toBe(true);
    expect(d.reasons[0]).toContain('9–12 年级');
    expect(d.reasons[0]).toContain('so here are 3 routes.');
  });

  it('routes → blocked：状态变化并引用现在的阻断原因', () => {
    const before = planRoutes(STUDENT, OPP, { today: TODAY });
    const after = planRoutes({ ...STUDENT, region: { country: 'CA' } }, OPP, { today: TODAY });
    const d = diffRoutes(before, after);
    expect(d.status_change).toEqual({ from: 'routes', to: 'blocked' });
    expect(d.route_changes.every((c) => c.change === 'removed' && c.hours_after === null && c.cost_delta_usd === null)).toBe(true);
    expect(d.reasons[0]).toContain('Applicants must reside in the United States.');
  });

  it('实践优先路线消失 / 出现', () => {
    const covered: StudentProfile = {
      ...STUDENT,
      evidence: [
        PROJECT_EVIDENCE,
        { id: 'ev-port', title: '个人作品集（虚构）', kind: 'portfolio', skills: [], prep_item_ids: ['prep-portfolio'], status: 'self_reported', added_on: '2026-11-17' },
      ],
    };
    const before = planRoutes(STUDENT, OPP, { today: TODAY });
    const after = planRoutes(covered, OPP, { today: TODAY });
    const d = diffRoutes(before, after);
    expect(d.route_changes.find((c) => c.route_type === 'practice_first')?.change).toBe('removed');
    expect(d.reasons.some((r) => r.includes('The Practice first route is gone'))).toBe(true);
    expect(d.reasons.some((r) => r.includes('个人作品集（虚构）'))).toBe(true);

    const back = diffRoutes(after, before);
    expect(back.route_changes.find((c) => c.route_type === 'practice_first')?.change).toBe('added');
    expect(back.reasons.some((r) => r.includes('New Practice first route'))).toBe(true);
  });

  it('可用小时变化 → 是否来得及的变化有原因', () => {
    const before = planRoutes({ ...STUDENT, hours_per_week_available: 2 }, OPP, { today: TODAY });
    const after = planRoutes(STUDENT, OPP, { today: TODAY });
    const d = diffRoutes(before, after);
    const lf = d.route_changes[0];
    expect(lf).toMatchObject({ change: 'changed', feasible_before: false, feasible_after: true, hours_delta: 0 });
    expect(d.reasons.some((r) => r.includes('finishing before the deadline changed') && r.includes('weekly hours'))).toBe(true);
  });

  it('比较对象不一致 → 不抛错并注明', () => {
    const a = planRoutes(STUDENT, OPP, { today: TODAY });
    const b = planRoutes({ ...STUDENT, id: 'other-student' }, NO_PRACTICE_OPP, { today: TODAY });
    const d = diffRoutes(a, b);
    expect(d.reasons[0]).toContain('the two plans are for a different');
    expect(d.route_changes.find((c) => c.route_type === 'practice_first')?.change).toBe('removed');
  });

  it('blocked → blocked 且原因相同 → 没有变化', () => {
    const p = planRoutes({ ...STUDENT, grade: 8 }, OPP, { today: TODAY });
    const d = diffRoutes(p, p);
    expect(d.status_change).toBeNull();
    expect(d.route_changes).toEqual([]);
    expect(d.reasons).toEqual(['Nothing changed between the two plans.']);
  });
});

// ───────────────────────── 第 2 层评审修复 ─────────────────────────

/** 递归反转对象键顺序（数组顺序不变），用于验证 diff 不受键顺序影响。 */
function reverseKeys<T>(v: T): T {
  if (Array.isArray(v)) return v.map(reverseKeys) as unknown as T;
  if (v !== null && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).reverse()) out[k] = reverseKeys((v as Record<string, unknown>)[k]);
    return out as T;
  }
  return v;
}

const DEADLINE_TODAY =
  "The deadline is today. We can't tell whether there is still time: check the exact closing time and time zone on the official page.";

describe('截止日就是今天：feasible_by_deadline 为 null', () => {
  // 只有 0.5 小时的准备：按旧写法（max(天数, 1)）在截止当天容量 5 / 7 ≈ 0.71 小时，会报 true。
  const TINY_OPP: Opportunity = { ...OPP, preparation: [prep({ id: 'prep-tiny', title: 'Tiny step', estimated_hours: 0.5 })] };

  it('today = 截止日、工作量很小 → 每条路线都是 null，并有截止当天的提醒', () => {
    for (const x of routesOf(planRoutes(STUDENT, TINY_OPP, { today: '2027-03-01' }))) {
      expect(x.feasible_by_deadline).toBeNull();
      expect(x.warnings).toContain(DEADLINE_TODAY);
      expect(x.warnings.some((w) => w.includes("We can't tell yet"))).toBe(false);
    }
  });

  it('today = 截止日前一天 → 与改动前相同（按 1 天算：0.5 小时 → true；社区协作多 2 小时 → false；61 小时 → false）', () => {
    const tiny = planRoutes(STUDENT, TINY_OPP, { today: '2027-02-28' });
    expect(route(tiny, 'learning_first').feasible_by_deadline).toBe(true);
    expect(route(tiny, 'community').feasible_by_deadline).toBe(false);
    for (const x of routesOf(tiny)) expect(x.warnings).not.toContain(DEADLINE_TODAY);
    const lf = route(planRoutes(STUDENT, OPP, { today: '2027-02-28' }), 'learning_first');
    expect(lf.feasible_by_deadline).toBe(false);
    expect(lf.warnings.some((w) => w.includes('1 day left'))).toBe(true);
  });

  it('截止已过（today = 截止日后一天）→ false，不出截止当天的提醒', () => {
    for (const x of routesOf(planRoutes(STUDENT, TINY_OPP, { today: '2027-03-02' }))) {
      expect(x.feasible_by_deadline).toBe(false);
      expect(x.warnings.some((w) => w.includes('has passed'))).toBe(true);
      expect(x.warnings).not.toContain(DEADLINE_TODAY);
    }
  });

  it('diffRoutes：前一天 true → 截止当天 null，原因说明截止就是今天', () => {
    const before = planRoutes(STUDENT, TINY_OPP, { today: '2027-02-28' });
    const after = planRoutes(STUDENT, TINY_OPP, { today: '2027-03-01' });
    const d = diffRoutes(before, after);
    expect(d.route_changes[0]).toMatchObject({ change: 'changed', feasible_before: true, feasible_after: null });
    expect(
      d.reasons.some((r) => r.includes('finishing before the deadline changed from "on time" to "can\'t tell"') && r.includes('the deadline is now today')),
    ).toBe(true);
  });
});

describe('M-a：截止日已过时与每周可用小时无关', () => {
  it.each([null, 0])('hours_per_week_available = %s、截止日已过 → false 并提示已过', (hpw) => {
    const r = planRoutes({ ...STUDENT, hours_per_week_available: hpw }, OPP, { today: '2027-04-01' });
    for (const x of routesOf(r)) {
      expect(x.feasible_by_deadline).toBe(false);
      expect(x.warnings.some((w) => w.includes('The deadline 2027-03-01 has passed'))).toBe(true);
      expect(x.warnings.some((w) => w.includes("We can't tell yet"))).toBe(false);
    }
  });

  it('截止日当天（还剩 0 天）：截止时刻和时区未知 → null 并提醒，不算「已过」（61 小时也一样）', () => {
    const lf = route(planRoutes(STUDENT, OPP, { today: '2027-03-01' }), 'learning_first');
    expect(lf.feasible_by_deadline).toBeNull();
    expect(lf.warnings).toContain(DEADLINE_TODAY);
    expect(lf.warnings.some((w) => w.includes('has passed'))).toBe(false);
    expect(lf.warnings.some((w) => w.includes('may not make it'))).toBe(false);
  });

  it('deadline 或 today 格式无法识别 → null 并说明原因', () => {
    const badDeadline = route(planRoutes(STUDENT, { ...OPP, deadline: '2027/03/01' }, { today: TODAY }), 'learning_first');
    expect(badDeadline.feasible_by_deadline).toBeNull();
    expect(badDeadline.warnings.some((w) => w.includes("the deadline date format can't be read"))).toBe(true);

    const badToday = route(planRoutes(STUDENT, OPP, { today: '17-11-2026' }), 'learning_first');
    expect(badToday.feasible_by_deadline).toBeNull();
    expect(badToday.warnings.some((w) => w.includes("today's date format can't be read"))).toBe(true);
  });
});

describe('M-b：只做必需项的小时数不计已跳过必需项的前置', () => {
  it('project 被证据覆盖、每周 2 小时 → 只做必需项 = 陈述 6 + 推荐信 2 = 8（不再算 Python 15）', () => {
    const r = planRoutes({ ...STUDENT, evidence: [PROJECT_EVIDENCE], hours_per_week_available: 2 }, OPP, { today: TODAY });
    for (const x of routesOf(r)) {
      // 学习优先 / 实践优先 41 小时、社区协作 43 小时 > 2 × 104 / 7 ≈ 29.7
      expect(x.feasible_by_deadline).toBe(false);
      expect(x.warnings.some((w) => w.includes('Doing only the required items (and the steps they depend on) needs 8 hours'))).toBe(true);
    }
  });
});

describe('建议 3 / 4：自依赖与成环', () => {
  it('依赖自身 → 丢弃这条依赖并给专门提醒，不当成环', () => {
    const opp: Opportunity = {
      ...OPP,
      preparation: [
        prep({ id: 'x', title: '步骤 X', estimated_hours: 2, depends_on: ['x'] }),
        prep({ id: 'y', title: '步骤 Y', estimated_hours: 1, depends_on: ['x'] }),
      ],
    };
    const r = planRoutes(STUDENT, opp);
    if (r.status !== 'routes') throw new Error('expected routes');
    expect(r.warnings.some((w) => w.includes('步骤 X') && w.includes('lists itself as a dependency'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('in a loop'))).toBe(false);
    for (const x of r.routes) {
      expect(x.steps.find((s) => s.id === 'x')!.depends_on).toEqual([]);
      expect(x.warnings.some((w) => w.includes('in a loop'))).toBe(false);
      assertTopological(x);
    }
  });

  it.each([
    ['下游在前', ['t', 'u', 'p', 'q']],
    ['环在前', ['p', 'q', 'u', 't']],
  ])('t→u→p、p↔q 成环（%s）：不在环上的依赖仍被遵守', (_, order) => {
    const defs: Record<string, PrepItem> = {
      t: prep({ id: 't', title: '步骤 T', depends_on: ['u'] }),
      u: prep({ id: 'u', title: '步骤 U', depends_on: ['p'] }),
      p: prep({ id: 'p', title: '环 P', depends_on: ['q'] }),
      q: prep({ id: 'q', title: '环 Q', depends_on: ['p'] }),
    };
    const opp: Opportunity = { ...OPP, preparation: order.map((id) => defs[id]) };
    const r = planRoutes(STUDENT, opp);
    if (r.status !== 'routes') throw new Error('expected routes');
    expect(r.warnings.some((w) => w.includes('in a loop'))).toBe(true);
    for (const x of r.routes) {
      const pos = new Map(x.steps.map((s, i) => [s.id, i]));
      expect(pos.get('u')!).toBeLessThan(pos.get('t')!);
      expect(pos.get('p')!).toBeLessThan(pos.get('u')!);
      expect(x.steps[x.steps.length - 1].id).toBe('submit-application');
    }
    // 卡住时强行放入的是环上的 p（而不是原顺序最前的 t）
    expect(ids(route(r, 'learning_first'))[0]).toBe('p');
  });
});

describe('建议 5：每周可用小时 / 预算数值无效', () => {
  it('每周可用小时没填 vs 填了 0 / 负数：文案不同', () => {
    const missing = route(planRoutes({ ...STUDENT, hours_per_week_available: null }, OPP, { today: TODAY }), 'learning_first');
    expect(missing.warnings.some((w) => w.includes('your profile has no weekly available hours yet'))).toBe(true);

    for (const bad of [0, -3]) {
      const r = planRoutes({ ...STUDENT, hours_per_week_available: bad }, OPP, { today: TODAY });
      if (r.status !== 'routes') throw new Error('expected routes');
      expect(r.warnings.some((w) => w.includes('weekly available hours in your profile are invalid (must be more than 0)'))).toBe(true);
      const lf = route(r, 'learning_first');
      expect(lf.feasible_by_deadline).toBeNull();
      expect(lf.estimated_weeks).toBeNull();
      expect(lf.warnings.some((w) => w.includes('weekly available hours in your profile are invalid (must be more than 0)'))).toBe(true);
      expect(lf.warnings.some((w) => w.includes('has no weekly available hours yet'))).toBe(false);
    }
  });

  it('预算为负数 → 不显示负预算、不产生超预算提醒，改为提醒预算无效', () => {
    const r = planRoutes({ ...STUDENT, budget_usd: -5 }, OPP, { today: TODAY });
    if (r.status !== 'routes') throw new Error('expected routes');
    expect(r.warnings.some((w) => w.includes('The budget in your profile is invalid'))).toBe(true);
    for (const x of r.routes) {
      expect(x.warnings.some((w) => w.startsWith('Over budget'))).toBe(false);
      expect(x.warnings.join('')).not.toContain('$-5');
    }
    // 没填预算 → 不提醒
    const none = planRoutes({ ...STUDENT, budget_usd: null }, OPP, { today: TODAY });
    if (none.status !== 'routes') throw new Error('expected routes');
    expect(none.warnings.some((w) => w.toLowerCase().includes('budget'))).toBe(false);
    // 预算 0 是有效值 → 正常比较
    for (const x of routesOf(planRoutes({ ...STUDENT, budget_usd: 0 }, OPP, { today: TODAY }))) {
      expect(x.warnings.some((w) => w.startsWith('Over budget by $35'))).toBe(true);
    }
  });
});

describe('建议 7：资格分支', () => {
  it('硬性 not_satisfied 与 unknown 混合 → blocked，只列 not_satisfied 的阻断', () => {
    const r = planRoutes({ ...STUDENT, grade: 8, region: null }, OPP, { today: TODAY });
    expect(r.status).toBe('blocked');
    expect(r.routes).toEqual([]);
    if (r.status !== 'blocked') return;
    expect(r.blocking_requirements.map((b) => b.requirement_id)).toEqual(['req-grade']);
  });

  it('只有非硬性要求不满足 → 仍给路线，并带加分项提醒', () => {
    const opp: Opportunity = {
      ...OPP,
      requirements: [
        ...OPP.requirements,
        { id: 'req-pref', type: 'grade', min: 12, label: '优先 12 年级', hard: false, source_text: 'Preference for grade 12.' },
      ],
    };
    const r = planRoutes(STUDENT, opp, { today: TODAY });
    expect(r.status).toBe('routes');
    if (r.status !== 'routes') return;
    expect(r.routes.length).toBeGreaterThanOrEqual(2);
    expect(r.warnings.some((w) => w.includes('Bonus item "优先 12 年级"'))).toBe(true);
  });
});

describe('diffRoutes：评审修复', () => {
  it('报名费从未写清变为有数字 → 不说「从 $0 变为」；反向同理', () => {
    const unknownFee = planRoutes(STUDENT, { ...OPP, cost: { fee_usd: null, requires_travel_expense: false } }, { today: TODAY });
    const known = planRoutes(STUDENT, OPP, { today: TODAY });
    const d = diffRoutes(unknownFee, known);
    expect(d.reasons.some((r) => r.includes('application fee changed from not clear on the official site to $25'))).toBe(true);
    expect(d.reasons.join('')).not.toContain('from $0 to');
    expect(d.reasons.filter((r) => r.includes('application fee'))).toHaveLength(1);

    const back = diffRoutes(known, unknownFee);
    expect(back.reasons.some((r) => r.includes('application fee changed from $25 to not clear on the official site'))).toBe(true);
    expect(back.reasons.join('')).not.toContain('to $0');

    // 有数字 → 有数字：仍按金额说明
    const d2 = diffRoutes(known, planRoutes(STUDENT, { ...OPP, cost: { fee_usd: 40, requires_travel_expense: false } }, { today: TODAY }));
    expect(d2.reasons.some((r) => r.includes('application fee changed from $25 to $40'))).toBe(true);
  });

  it('报名费从未写清变为 $0 也能说明', () => {
    const unknownFee = planRoutes(STUDENT, { ...OPP, cost: { fee_usd: null, requires_travel_expense: false } }, { today: TODAY });
    const free = planRoutes(STUDENT, { ...OPP, cost: { fee_usd: 0, requires_travel_expense: false } }, { today: TODAY });
    const d = diffRoutes(unknownFee, free);
    expect(d.reasons.some((r) => r.includes('application fee changed from not clear on the official site to $0'))).toBe(true);
  });

  it('blocked → blocked 只有替代提示变化 → 不说没有变化，说明 next_cycle 消失', () => {
    const before = planRoutes({ ...STUDENT, grade: 8 }, OPP, { today: TODAY });
    const after = planRoutes({ ...STUDENT, grade: 8 }, { ...OPP, recurring_annually: false }, { today: TODAY });
    const d = diffRoutes(before, after);
    expect(d.status_change).toBeNull();
    expect(d.reasons).not.toContain('Nothing changed between the two plans.');
    expect(d.reasons.some((r) => r.includes('Watch for the next round') && r.includes('is gone'))).toBe(true);

    const back = diffRoutes(after, before);
    expect(back.reasons.some((r) => r.includes('New alternative "Watch for the next round"'))).toBe(true);

    const unknownRecurring = planRoutes({ ...STUDENT, grade: 8 }, { ...OPP, recurring_annually: null }, { today: TODAY });
    expect(diffRoutes(before, unknownRecurring).reasons.some((r) => r.includes('Alternative "Watch for the next round" was updated'))).toBe(true);
  });

  it('blocked → blocked：新增 / 解除一条阻断', () => {
    const one = planRoutes({ ...STUDENT, grade: 8 }, OPP, { today: TODAY });
    const two = planRoutes({ ...STUDENT, grade: 8, region: { country: 'CA' } }, OPP, { today: TODAY });
    const d = diffRoutes(one, two);
    expect(d.status_change).toBeNull();
    expect(d.reasons.some((r) => r.startsWith('New blocker') && r.includes('Applicants must reside in the United States.'))).toBe(true);

    const back = diffRoutes(two, one);
    expect(back.reasons.some((r) => r.includes('"美国居民" no longer blocks you'))).toBe(true);
  });

  it('对象键顺序不同 → unchanged、没有变化', () => {
    const p = planRoutes(STUDENT, OPP, { today: TODAY });
    const shuffled = reverseKeys(planRoutes(STUDENT, OPP, { today: TODAY }));
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(p));
    const d = diffRoutes(p, shuffled);
    expect(d.route_changes.every((c) => c.change === 'unchanged')).toBe(true);
    expect(d.reasons).toEqual(['Nothing changed between the two plans.']);
  });

  it('只有说明文字变化（截止日期改了但可行性不变）→ 中性原因，不说「档案信息有变化」', () => {
    const before = planRoutes(STUDENT, OPP, { today: TODAY });
    const after = planRoutes(STUDENT, { ...OPP, deadline: '2027-03-02' }, { today: TODAY });
    const d = diffRoutes(before, after);
    expect(d.route_changes.every((c) => c.change === 'changed')).toBe(true);
    expect(d.reasons.some((r) => r.includes('the explanation or notes were updated'))).toBe(true);
    expect(d.reasons.join('')).not.toContain('profile info changed');
  });

  it('只有提醒文字变化 → 列出具体的提醒变化', () => {
    const before = planRoutes({ ...STUDENT, hours_per_week_available: null }, OPP, { today: TODAY });
    const after = planRoutes({ ...STUDENT, hours_per_week_available: 0 }, OPP, { today: TODAY });
    const d = diffRoutes(before, after);
    expect(d.reasons.some((r) => r.includes('Learning first') && r.includes('new note') && r.includes('invalid (must be more than 0)'))).toBe(true);
    expect(d.reasons.some((r) => r.includes('is gone') && r.includes('has no weekly available hours yet'))).toBe(true);
  });
});
