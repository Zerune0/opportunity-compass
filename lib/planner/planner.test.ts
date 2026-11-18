/**
 * planAcrossOpportunities（第二阶段示例版本）测试。机会 fixture 全部虚构（example.com、is_sample: true）。
 */
import { describe, expect, it } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import { planAcrossOpportunities } from '.';
import type { Opportunity, PrepItem, StudentProfile } from '../types';

const TODAY = '2026-11-18'; // 周三，所在周的周一是 2026-11-16

function prep(p: Partial<PrepItem> & Pick<PrepItem, 'id' | 'title'>): PrepItem {
  return { skill: null, evidence_kind: null, estimated_hours: 2, estimated_cost_usd: 0, depends_on: [], required_for_application: true, ...p };
}

function opp(id: string, deadline: string | null, preparation: PrepItem[], over: Partial<Opportunity> = {}): Opportunity {
  return {
    id,
    title: `Fictional ${id} (sample, not real)`,
    organizer: 'Example Org (fictional)',
    category: 'project',
    fields: ['climate'],
    summary: 'Fictional opportunity for tests.',
    official_url: `https://example.com/${id}`,
    verified_on: '2026-11-17',
    verified_by: 'test-fixture',
    deadline,
    location: { format: 'online' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 2, total_weeks: 4 },
    required_devices: [],
    requirements: [{ id: 'req-grade', type: 'grade', min: 9, max: 12, label: 'Grades 9–12', hard: true, source_text: 'Grades 9-12.' }],
    preparation,
    is_sample: true,
    ...over,
  };
}

const RESUME = (h: number) => prep({ id: 'prep-resume', title: 'Write a resume', estimated_hours: h, material_kind: 'resume', reusable_across_opportunities: true });
const STATEMENT = (h: number) => prep({ id: 'prep-statement', title: 'Write a personal statement', estimated_hours: h, material_kind: 'personal_statement', reusable_across_opportunities: false });

// 截止日期：LATE 晚于 EARLY；输入顺序故意把 LATE 放前面。
const LATE = opp('fictional-late', '2026-12-14', [RESUME(4), STATEMENT(3), prep({ id: 'prep-learn', title: 'Learn basics', estimated_hours: 5 })]);
const EARLY = opp('fictional-early', '2026-11-30', [RESUME(4), STATEMENT(2)]);
const ROLLING = opp('fictional-rolling', null, [prep({ id: 'prep-x', title: 'Small task', estimated_hours: 1 })]);
const BLOCKED = opp('fictional-blocked', '2026-12-01', [RESUME(4)], {
  requirements: [{ id: 'req-grade', type: 'grade', min: 13, label: 'Undergraduates', hard: true, source_text: 'Undergraduates only.' }],
});
const PAST = opp('fictional-past', '2026-11-01', [RESUME(4)]);

const STUDENT: StudentProfile = {
  id: 'planner-student',
  is_sample: true,
  display_name: 'Sample student (planner test)',
  grade: 11,
  age: 16,
  region: { country: 'US', state: 'CA' },
  citizenships: ['US'],
  statuses: ['high_school_student'],
  school_name: 'Example High (fictional)',
  hours_per_week_available: 3,
  budget_usd: 50,
  transport: { level: 'reliable' },
  devices: ['laptop'],
  skills: [],
  evidence: [],
  interests: ['climate'],
};

describe('planAcrossOpportunities — 形状、排序与状态', () => {
  const plan = planAcrossOpportunities(STUDENT, [LATE, EARLY, ROLLING, BLOCKED, PAST], { today: TODAY });

  it('evaluated_on、每个机会一项、按截止日期排 order（无截止日期最后）', () => {
    expect(plan.profile_id).toBe(STUDENT.id);
    expect(plan.evaluated_on).toBe(TODAY);
    expect(plan.items.map((i) => i.opportunity_id)).toEqual(['fictional-past', 'fictional-early', 'fictional-blocked', 'fictional-late', 'fictional-rolling']);
    expect(plan.items.map((i) => i.order)).toEqual([1, 2, 3, 4, 5]);
  });

  it('blocked / past_deadline：小时为 0、route_type 为 null，不计入总数', () => {
    const blocked = plan.items.find((i) => i.opportunity_id === 'fictional-blocked')!;
    expect(blocked).toMatchObject({ status: 'blocked', required_hours: 0, hours_before_reuse: 0, route_type: null });
    const past = plan.items.find((i) => i.opportunity_id === 'fictional-past')!;
    expect(past).toMatchObject({ status: 'past_deadline', required_hours: 0, route_type: null, feasible_alone: false });
    const planned = plan.items.filter((i) => i.status === 'planned');
    expect(plan.total_hours).toBe(planned.reduce((s, i) => s + i.required_hours, 0));
    expect(plan.total_hours_without_reuse).toBe(planned.reduce((s, i) => s + i.hours_before_reuse, 0));
  });

  it('planned 的小时 = 第一条路线未跳过步骤的合计', () => {
    const early = plan.items.find((i) => i.opportunity_id === 'fictional-early')!;
    expect(early).toMatchObject({ status: 'planned', route_type: 'learning_first', hours_before_reuse: 6 });
    expect(plan.items.find((i) => i.opportunity_id === 'fictional-late')!.hours_before_reuse).toBe(12);
  });

  it('如实：两个机会共用一份可复用简历 → hours_saved > 0，total_hours < total_hours_without_reuse；只算在 order 靠前的机会上', () => {
    const resume = plan.reuse.find((r) => r.material_kind === 'resume' && r.reusable)!;
    expect(resume.opportunity_ids).toEqual(['fictional-early', 'fictional-late']);
    expect(resume.hours_each).toBe(4);
    expect(resume.hours_saved).toBe(4);
    expect(plan.total_hours).toBeLessThan(plan.total_hours_without_reuse);
    expect(plan.total_hours_without_reuse - plan.total_hours).toBe(4);
    expect(plan.items.find((i) => i.opportunity_id === 'fictional-early')!.required_hours).toBe(6);
    expect(plan.items.find((i) => i.opportunity_id === 'fictional-late')!.required_hours).toBe(8);
  });

  it('不可复用的同类材料：reusable false、hours_saved 0', () => {
    const st = plan.reuse.find((r) => r.material_kind === 'personal_statement')!;
    expect(st).toMatchObject({ reusable: false, hours_saved: 0, hours_each: 3, opportunity_ids: ['fictional-early', 'fictional-late'] });
  });

  it('weekly_load：从 today 所在周的周一起、按周升序；超出可用小时的周 over 且有冲突说明', () => {
    expect(plan.weekly_load[0].week_start).toBe('2026-11-16');
    const starts = plan.weekly_load.map((w) => w.week_start);
    expect(starts).toEqual([...starts].sort());
    for (const w of plan.weekly_load) {
      expect(w.hours_available).toBe(3);
      expect(w.over).toBe(w.hours_needed > 3);
    }
    expect(plan.weekly_load.some((w) => w.over)).toBe(true);
    expect(plan.conflicts.length).toBe(plan.weekly_load.filter((w) => w.over).length);
    // 无截止日期的机会不进 weekly_load，并写进 missing_info
    expect(plan.weekly_load.every((w) => !w.opportunity_ids.includes('fictional-rolling'))).toBe(true);
    expect(plan.missing_info).toContain('opportunity.fictional-rolling.deadline');
  });

  it('每周负荷之和 = 计入 weekly_load 的机会的 required_hours 之和', () => {
    const sum = plan.weekly_load.reduce((s, w) => s + w.hours_needed, 0);
    expect(sum).toBeCloseTo(6 + 8, 1);
  });

  it('priorities 只用于冲突说明，不改变 order', () => {
    const withP = planAcrossOpportunities(STUDENT, [LATE, EARLY, ROLLING, BLOCKED, PAST], { today: TODAY, priorities: ['fictional-late'] });
    expect(withP.items.map((i) => i.order)).toEqual(plan.items.map((i) => i.order));
    expect(withP.items).toEqual(plan.items);
    expect(withP.conflicts.join(' ')).toContain('you decide');
  });
});

describe('planAcrossOpportunities — 信息不足、确定性、健壮性', () => {
  it('没有 today：evaluated_on null、weekly_load []、weeks_left null，missing_info 含 options.today', () => {
    const plan = planAcrossOpportunities(STUDENT, [LATE, EARLY]);
    expect(plan.evaluated_on).toBeNull();
    expect(plan.weekly_load).toEqual([]);
    expect(plan.items.every((i) => i.weeks_left === null)).toBe(true);
    expect(plan.missing_info).toContain('options.today');
  });

  it('没填每周可用小时：over 为 null（不猜），不生成冲突', () => {
    const plan = planAcrossOpportunities({ ...STUDENT, hours_per_week_available: null }, [LATE, EARLY], { today: TODAY });
    expect(plan.weekly_load.length).toBeGreaterThan(0);
    expect(plan.weekly_load.every((w) => w.over === null && w.hours_available === null)).toBe(true);
    expect(plan.conflicts).toEqual([]);
    expect(plan.missing_info).toContain('profile.hours_per_week_available');
  });

  it('已有证据覆盖的材料不计入', () => {
    const withEv: StudentProfile = {
      ...STUDENT,
      evidence: [{ id: 'ev-resume', title: 'My resume (sample)', kind: 'other', skills: [], prep_item_ids: ['prep-resume'], status: 'self_reported', added_on: '2026-11-10' }],
    };
    const plan = planAcrossOpportunities(withEv, [LATE, EARLY], { today: TODAY });
    expect(plan.reuse.some((r) => r.material_kind === 'resume')).toBe(false);
  });

  it('确定性、不修改输入', () => {
    const p = structuredClone(STUDENT);
    const list = structuredClone([LATE, EARLY, ROLLING, BLOCKED, PAST]);
    const opts = { today: TODAY, priorities: ['fictional-early'] };
    expect(planAcrossOpportunities(p, list, opts)).toEqual(planAcrossOpportunities(p, list, opts));
    expect(p).toEqual(STUDENT);
    expect(list).toEqual([LATE, EARLY, ROLLING, BLOCKED, PAST]);
    expect(opts).toEqual({ today: TODAY, priorities: ['fictional-early'] });
  });

  it('空列表、空 preparation、坏数据、缺字段档案都不抛错', () => {
    const empty = planAcrossOpportunities(STUDENT, [], { today: TODAY });
    expect(empty).toMatchObject({ items: [], weekly_load: [], reuse: [], total_hours: 0, total_hours_without_reuse: 0 });
    expect(() => planAcrossOpportunities(STUDENT, [opp('fictional-empty', '2026-12-01', [])], { today: TODAY })).not.toThrow();
    const bad = planAcrossOpportunities(STUDENT, [null, { id: 'broken' }, { title: 'no id' }] as unknown as Opportunity[], { today: TODAY });
    expect(bad.items).toEqual([]);
    expect(bad.missing_info).toContain('opportunity.broken');
    expect(() => planAcrossOpportunities({ id: 'x' } as unknown as StudentProfile, [LATE], { today: 'not-a-date' })).not.toThrow();
    expect(() => planAcrossOpportunities(null as unknown as StudentProfile, null as unknown as Opportunity[])).not.toThrow();
  });

  it('示例档案 × 真实机会不抛错', () => {
    const opps = opportunitiesJson as unknown as Opportunity[];
    for (const p of profilesJson as unknown as StudentProfile[]) {
      for (const opts of [{ today: '2026-11-17' }, undefined]) {
        const plan = planAcrossOpportunities(p, opps, opts);
        expect(plan.items).toHaveLength(opps.length);
        expect(plan.total_hours).toBeLessThanOrEqual(plan.total_hours_without_reuse);
      }
    }
  });
});
