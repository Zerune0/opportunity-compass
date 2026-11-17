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
    expect(r1.alternatives.find((a) => a.kind === 'next_cycle')?.text).toContain('是否每年举办请向官方确认');

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
    expect(r.reasons[0]).toContain('重新规划');
  });
});

// ───────────────────────── routes ─────────────────────────

describe('planRoutes：生成路线', () => {
  it('资格 unknown → 仍给路线，plan warnings 列出待确认的要求', () => {
    const r = planRoutes({ ...STUDENT, grade: null }, OPP, { today: TODAY });
    expect(r.status).toBe('routes');
    if (r.status !== 'routes') return;
    expect(r.routes.length).toBeGreaterThanOrEqual(2);
    expect(r.warnings.some((w) => w.includes('9–12 年级') && w.includes('向官方确认'))).toBe(true);
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
      expect(x.rationale).not.toContain('录取');
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
    expect(partner.description).toContain('估算');
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
    for (const x of routesOf(r)) expect(x.warnings).toContain('超出预算 $15（这条路线约需 $35，档案预算 $20）。');
    const ok = planRoutes(STUDENT, OPP, { today: TODAY });
    for (const x of routesOf(ok)) expect(x.warnings.some((w) => w.startsWith('超出预算'))).toBe(false);
  });

  it('报名费未写清 → 不计入费用并提醒', () => {
    const r = planRoutes(STUDENT, { ...OPP, cost: { fee_usd: null, requires_travel_expense: false } }, { today: TODAY });
    for (const x of routesOf(r)) {
      expect(x.total_cost_usd).toBe(10);
      expect(x.warnings.some((w) => w.includes('报名费官网未写清'))).toBe(true);
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
    expect(tight.warnings.some((w) => w.includes('来不及') && w.includes('43 小时'))).toBe(true);

    const passed = route(planRoutes(STUDENT, OPP, { today: '2027-04-01' }), 'learning_first');
    expect(passed.feasible_by_deadline).toBe(false);
    expect(passed.warnings.some((w) => w.includes('已过'))).toBe(true);

    const noToday = route(planRoutes(STUDENT, OPP), 'learning_first');
    expect(noToday.feasible_by_deadline).toBeNull();
    expect(noToday.warnings.some((w) => w.includes('今天的日期'))).toBe(true);

    const noDeadline = route(planRoutes(STUDENT, { ...OPP, deadline: null }, { today: TODAY }), 'learning_first');
    expect(noDeadline.feasible_by_deadline).toBeNull();
    expect(noDeadline.warnings.some((w) => w.includes('截止日期'))).toBe(true);

    const noHours = route(planRoutes({ ...STUDENT, hours_per_week_available: null }, OPP, { today: TODAY }), 'learning_first');
    expect(noHours.feasible_by_deadline).toBeNull();
    expect(noHours.warnings.some((w) => w.includes('每周可用小时'))).toBe(true);
  });

  it('加一条作品证据：对应步骤被跳过、保留在列表、合计减少', () => {
    const before = planRoutes(STUDENT, OPP, { today: TODAY });
    const after = planRoutes({ ...STUDENT, evidence: [PROJECT_EVIDENCE] }, OPP, { today: TODAY });
    for (const type of ['learning_first', 'practice_first', 'community'] as const) {
      const step = route(after, type).steps.find((s) => s.id === 'prep-project')!;
      expect(step.skipped).toBe(true);
      expect(step.skip_reason).toContain('《气候数据小项目（虚构）》');
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

  it('依赖成环 → 不抛错，剩余步骤按原顺序接在后面并提醒', () => {
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
    expect(r.warnings.some((w) => w.includes('成环'))).toBe(true);
    const lf = route(r, 'learning_first');
    expect(ids(lf)).toEqual(['free', 'p', 'q', 'submit-application']);
    expect(lf.warnings.some((w) => w.includes('成环'))).toBe(true);
    expect(lf.total_hours).toBe(3);
  });

  it('preparation 为空 → 学习优先只有提交申请，社区协作有同伴 + 提交', () => {
    const r = planRoutes(STUDENT, { ...OPP, preparation: [] }, { today: TODAY });
    if (r.status !== 'routes') throw new Error('expected routes');
    expect(r.routes.map((x) => x.type)).toEqual(['learning_first', 'community']);
    expect(ids(route(r, 'learning_first'))).toEqual(['submit-application']);
    expect(ids(route(r, 'community'))).toEqual(['find-partner', 'submit-application']);
    expect(r.warnings.some((w) => w.includes('没有列出准备项'))).toBe(true);
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

  it('data/profiles.json 三个示例档案跑一遍不抛错', () => {
    const profiles = profilesJson as unknown as StudentProfile[];
    expect(profiles).toHaveLength(3);
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
    expect(skipReason).toContain('《气候数据小项目（虚构）》');
    expect(skipReason).toContain('20 小时');
    // 三条路线的同一变化合并成一句
    expect(d.reasons.filter((r) => r.includes('做一个气候数据小项目'))).toHaveLength(1);
  });

  it('删除证据 → 步骤不再跳过，说明原因', () => {
    const withEv = planRoutes({ ...STUDENT, evidence: [PROJECT_EVIDENCE] }, OPP, { today: TODAY });
    const without = planRoutes(STUDENT, OPP, { today: TODAY });
    const d = diffRoutes(withEv, without);
    expect(d.route_changes[0].unskipped_steps.map((s) => s.step_id)).toEqual(['prep-project']);
    expect(d.route_changes[0].hours_delta).toBe(20);
    expect(d.reasons.some((r) => r.includes('不再被跳过'))).toBe(true);
  });

  it('无变化 → 全部 unchanged，只有一条「没有变化」', () => {
    const p = planRoutes(STUDENT, OPP, { today: TODAY });
    const d = diffRoutes(p, planRoutes(STUDENT, OPP, { today: TODAY }));
    expect(d.status_change).toBeNull();
    expect(d.route_changes.every((c) => c.change === 'unchanged')).toBe(true);
    expect(d.reasons).toEqual(['两次规划没有变化。']);
  });

  it('blocked → routes：状态变化并引用之前的阻断原因', () => {
    const before = planRoutes({ ...STUDENT, grade: 8 }, OPP, { today: TODAY });
    const after = planRoutes({ ...STUDENT, grade: 9 }, OPP, { today: TODAY });
    const d = diffRoutes(before, after);
    expect(d.status_change).toEqual({ from: 'blocked', to: 'routes' });
    expect(d.route_changes.every((c) => c.change === 'added')).toBe(true);
    expect(d.route_changes.every((c) => c.hours_delta === null && c.hours_before === null)).toBe(true);
    expect(d.reasons[0]).toContain('9–12 年级');
    expect(d.reasons[0]).toContain('3 条路线');
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
    expect(d.reasons.some((r) => r.includes('实践优先路线不再出现'))).toBe(true);
    expect(d.reasons.some((r) => r.includes('个人作品集（虚构）'))).toBe(true);

    const back = diffRoutes(after, before);
    expect(back.route_changes.find((c) => c.route_type === 'practice_first')?.change).toBe('added');
    expect(back.reasons.some((r) => r.includes('新出现实践优先路线'))).toBe(true);
  });

  it('可用小时变化 → 是否来得及的变化有原因', () => {
    const before = planRoutes({ ...STUDENT, hours_per_week_available: 2 }, OPP, { today: TODAY });
    const after = planRoutes(STUDENT, OPP, { today: TODAY });
    const d = diffRoutes(before, after);
    const lf = d.route_changes[0];
    expect(lf).toMatchObject({ change: 'changed', feasible_before: false, feasible_after: true, hours_delta: 0 });
    expect(d.reasons.some((r) => r.includes('能否在截止日期前完成') && r.includes('每周可用小时'))).toBe(true);
  });

  it('比较对象不一致 → 不抛错并注明', () => {
    const a = planRoutes(STUDENT, OPP, { today: TODAY });
    const b = planRoutes({ ...STUDENT, id: 'other-student' }, NO_PRACTICE_OPP, { today: TODAY });
    const d = diffRoutes(a, b);
    expect(d.reasons[0]).toContain('不是同一个');
    expect(d.route_changes.find((c) => c.route_type === 'practice_first')?.change).toBe('removed');
  });

  it('blocked → blocked 且原因相同 → 没有变化', () => {
    const p = planRoutes({ ...STUDENT, grade: 8 }, OPP, { today: TODAY });
    const d = diffRoutes(p, p);
    expect(d.status_change).toBeNull();
    expect(d.route_changes).toEqual([]);
    expect(d.reasons).toEqual(['两次规划没有变化。']);
  });
});
