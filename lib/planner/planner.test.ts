/**
 * planAcrossOpportunities（第二阶段示例版本）测试。机会 fixture 全部虚构（example.com、is_sample: true）。
 */
import { describe, expect, it } from 'vitest';
import { DEADLINE_TODAY_WARNING } from '../path/shared';
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
    expect(plan.items.find((i) => i.opportunity_id === 'fictional-early')!.hours_saved_by_reuse).toBe(0);
    expect(plan.items.find((i) => i.opportunity_id === 'fictional-late')!.hours_saved_by_reuse).toBe(4);
  });

  it('不可复用的同类材料：reusable false、hours_saved 0', () => {
    const st = plan.reuse.find((r) => r.material_kind === 'personal_statement')!;
    expect(st).toMatchObject({ reusable: false, hours_saved: 0, hours_each: 3, opportunity_ids: ['fictional-early', 'fictional-late'] });
  });

  it('weekly_load：从 today 所在周的周一起、按周升序；可用小时按该周实际天数折算；超出的周 over 且有冲突说明', () => {
    expect(plan.weekly_load[0].week_start).toBe('2026-11-16');
    expect(plan.weekly_load[0].days).toBe(5); // 周三 11-18 到周日 11-22
    const starts = plan.weekly_load.map((w) => w.week_start);
    expect(starts).toEqual([...starts].sort());
    for (const w of plan.weekly_load) {
      expect(w.hours_available).toBe(Math.round(((3 * w.days) / 7) * 100) / 100);
      expect(w.over).toBe(w.hours_needed > (w.hours_available as number));
    }
    // 最后一周只算到最晚截止日 12-14（周一）
    expect(plan.weekly_load[plan.weekly_load.length - 1]).toMatchObject({ week_start: '2026-12-14', days: 1 });
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
    expect(bad.items.map((i) => [i.opportunity_id, i.status])).toEqual([['broken', 'insufficient_data']]);
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

/** 一个机会、无证据、单个准备项。 */
function single(id: string, deadline: string, hours: number): Opportunity {
  return opp(id, deadline, [prep({ id: 'prep-work', title: 'Do the work', estimated_hours: hours })]);
}

describe('planAcrossOpportunities — 复用：承担者与 hours_saved_by_reuse', () => {
  // reviewer 的例子：A 截止 11-30、简历 3h + 其他 2h；B 截止 12-14、简历 5h，均可复用。
  const A = opp('fictional-a', '2026-11-30', [RESUME(3), prep({ id: 'prep-other', title: 'Other task', estimated_hours: 2 })]);
  const B = opp('fictional-b', '2026-12-14', [RESUME(5)]);
  const plan = planAcrossOpportunities({ ...STUDENT, hours_per_week_available: 10 }, [B, A], { today: TODAY });
  const a = plan.items.find((i) => i.opportunity_id === 'fictional-a')!;
  const b = plan.items.find((i) => i.opportunity_id === 'fictional-b')!;

  it('hours_each 5、hours_saved 3、总计 7 对 10', () => {
    const resume = plan.reuse.find((r) => r.material_kind === 'resume' && r.reusable)!;
    expect(resume).toMatchObject({ hours_each: 5, hours_saved: 3, opportunity_ids: ['fictional-a', 'fictional-b'] });
    expect(plan.total_hours).toBe(7);
    expect(plan.total_hours_without_reuse).toBe(10);
  });

  it('承担者 A 按最大小时计，required_hours 可大于 hours_before_reuse；B 少算自己那份', () => {
    expect(a).toMatchObject({ hours_before_reuse: 5, required_hours: 7, hours_saved_by_reuse: 0 });
    expect(b).toMatchObject({ hours_before_reuse: 5, required_hours: 0, hours_saved_by_reuse: 5 });
  });

  it('hours_saved_by_reuse 永不为负；非 planned 为 0', () => {
    const full = planAcrossOpportunities(STUDENT, [LATE, EARLY, ROLLING, BLOCKED, PAST, { id: 'broken' } as unknown as Opportunity], { today: TODAY });
    for (const it of full.items) {
      expect(it.hours_saved_by_reuse).toBeGreaterThanOrEqual(0);
      if (it.status !== 'planned') expect(it).toMatchObject({ hours_saved_by_reuse: 0, required_hours: 0, hours_before_reuse: 0 });
    }
  });
});

describe('planAcrossOpportunities — insufficient_data', () => {
  it('规划出错的机会仍出现在 items 里：小时 0、note 说明缺什么；warnings 与 missing_info 保留', () => {
    const broken = { id: 'fictional-broken', title: 'Broken sample', deadline: '2026-12-01', preparation: [] } as unknown as Opportunity;
    const plan = planAcrossOpportunities(STUDENT, [EARLY, broken], { today: TODAY });
    const it = plan.items.find((i) => i.opportunity_id === 'fictional-broken')!;
    expect(it).toMatchObject({ status: 'insufficient_data', required_hours: 0, hours_before_reuse: 0, hours_saved_by_reuse: 0, route_type: null, feasible_alone: null, deadline: '2026-12-01' });
    expect(it.note).toMatch(/incomplete/);
    expect(it.note).toMatch(/requirements/);
    expect(plan.warnings.some((w) => w.includes('Broken sample'))).toBe(true);
    expect(plan.missing_info).toContain('opportunity.fictional-broken');
    expect(plan.weekly_load.every((w) => !w.opportunity_ids.includes('fictional-broken'))).toBe(true);
    // 按截止日期参与排序
    expect(plan.items.map((i) => i.opportunity_id)).toEqual(['fictional-early', 'fictional-broken']);
  });
});

describe('planAcrossOpportunities — weekly_load 按天分摊', () => {
  it('复现：today 周日 11-22、截止周一 11-23、需 6h、每周 3h → 两周都 over，feasible_alone false', () => {
    const plan = planAcrossOpportunities(STUDENT, [single('fictional-short', '2026-11-23', 6)], { today: '2026-11-22' });
    expect(plan.weekly_load).toEqual([
      { week_start: '2026-11-16', days: 1, hours_needed: 3, hours_available: 0.43, over: true, opportunity_ids: ['fictional-short'] },
      { week_start: '2026-11-23', days: 1, hours_needed: 3, hours_available: 0.43, over: true, opportunity_ids: ['fictional-short'] },
    ]);
    expect(plan.items[0].feasible_alone).toBe(false);
    expect(plan.conflicts).toHaveLength(2);
    expect(plan.conflicts[0]).toContain('only 1 day of this week');
  });

  it('截止日就是今天：只有一天', () => {
    const ok = planAcrossOpportunities({ ...STUDENT, hours_per_week_available: 14 }, [single('fictional-today', TODAY, 2)], { today: TODAY });
    expect(ok.weekly_load).toEqual([
      { week_start: '2026-11-16', days: 1, hours_needed: 2, hours_available: 2, over: false, opportunity_ids: ['fictional-today'] },
    ]);
    // 截止当天：截止的具体时刻和时区不知道 → feasible_alone null（2026-11-19 起；原来是 true / false）
    expect(ok.items[0]).toMatchObject({ status: 'planned', feasible_alone: null });
    expect(ok.items[0].note).toContain(DEADLINE_TODAY_WARNING);
    expect(ok.warnings).toContain(`"${ok.items[0].title}": ${DEADLINE_TODAY_WARNING}`);
    const tight = planAcrossOpportunities({ ...STUDENT, hours_per_week_available: 14 }, [single('fictional-today', TODAY, 3)], { today: TODAY });
    expect(tight.weekly_load[0].over).toBe(true);
    expect(tight.items[0].feasible_alone).toBeNull();
    expect(tight.warnings.some((w) => w.includes('may not be finished before the deadline'))).toBe(false);
  });

  it('截止当天 → feasible_alone null；截止前一天与已过截止不受影响', () => {
    const s14 = { ...STUDENT, hours_per_week_available: 14 };
    const today = planAcrossOpportunities(s14, [single('fictional-today', '2026-11-30', 1)], { today: '2026-11-30' });
    expect(today.items[0]).toMatchObject({ status: 'planned', feasible_alone: null });
    expect(today.warnings.filter((w) => w.includes(DEADLINE_TODAY_WARNING))).toHaveLength(1);
    // 截止前一天（D = 2 天）：仍按公式判断
    const dayBefore = planAcrossOpportunities(s14, [single('fictional-today', '2026-12-01', 4)], { today: '2026-11-30' });
    expect(dayBefore.items[0].feasible_alone).toBe(true);
    expect(dayBefore.warnings.some((w) => w.includes(DEADLINE_TODAY_WARNING))).toBe(false);
    const dayBeforeTight = planAcrossOpportunities(s14, [single('fictional-today', '2026-12-01', 5)], { today: '2026-11-30' });
    expect(dayBeforeTight.items[0].feasible_alone).toBe(false);
    // 已过截止：past_deadline、false，不加截止当天提醒
    const past = planAcrossOpportunities(s14, [single('fictional-today', '2026-11-29', 1)], { today: '2026-11-30' });
    expect(past.items[0]).toMatchObject({ status: 'past_deadline', feasible_alone: false });
    expect(past.warnings.some((w) => w.includes(DEADLINE_TODAY_WARNING))).toBe(false);
  });

  it('跨年：today 2026-12-30（周三）、截止 2027-01-05（周二）', () => {
    const plan = planAcrossOpportunities({ ...STUDENT, hours_per_week_available: 7 }, [single('fictional-newyear', '2027-01-05', 7)], { today: '2026-12-30' });
    expect(plan.weekly_load).toEqual([
      { week_start: '2026-12-28', days: 5, hours_needed: 5, hours_available: 5, over: false, opportunity_ids: ['fictional-newyear'] },
      { week_start: '2027-01-04', days: 2, hours_needed: 2, hours_available: 2, over: false, opportunity_ids: ['fictional-newyear'] },
    ]);
    expect(plan.items[0].feasible_alone).toBe(true);
    const tight = planAcrossOpportunities({ ...STUDENT, hours_per_week_available: 6 }, [single('fictional-newyear', '2027-01-05', 7)], { today: '2026-12-30' });
    expect(tight.weekly_load.every((w) => w.over === true)).toBe(true);
    expect(tight.items[0].feasible_alone).toBe(false);
  });

  it('只有一个机会时：任一周 over ⇔ feasible_alone 为 false（多组参数）', () => {
    const todays = ['2026-11-16', '2026-11-18', '2026-11-22', '2026-12-30'];
    const deadlines = ['2026-11-22', '2026-11-23', '2026-12-01', '2027-01-05', '2027-02-14'];
    const hours = [1, 3, 6, 10, 25];
    const hpws = [1, 3, 5, 10];
    let checked = 0;
    for (const today of todays)
      for (const dl of deadlines)
        for (const h of hours)
          for (const hpw of hpws) {
            if (dl < today) continue;
            const plan = planAcrossOpportunities({ ...STUDENT, hours_per_week_available: hpw }, [single('fictional-one', dl, h)], { today });
            const item = plan.items[0];
            expect(item.status).toBe('planned');
            const anyOver = plan.weekly_load.some((w) => w.over === true);
            // 截止当天 feasible_alone 为 null（截止时刻未知），不参与这条对应关系
            if (dl === today) expect(item.feasible_alone).toBeNull();
            else expect(anyOver).toBe(item.feasible_alone === false);
            const sum = plan.weekly_load.reduce((acc, w) => acc + w.hours_needed, 0);
            expect(Math.abs(sum - h)).toBeLessThanOrEqual(0.005 * plan.weekly_load.length + 1e-9); // 每周四舍五入到 0.01
            checked++;
          }
    expect(checked).toBeGreaterThan(100);
  });

  it('feasible_alone 没有每周可用小时 / 没有 today / 没有截止日期时为 null', () => {
    expect(planAcrossOpportunities({ ...STUDENT, hours_per_week_available: null }, [single('fictional-x', '2026-12-01', 3)], { today: TODAY }).items[0].feasible_alone).toBeNull();
    expect(planAcrossOpportunities(STUDENT, [single('fictional-x', '2026-12-01', 3)]).items[0].feasible_alone).toBeNull();
    expect(planAcrossOpportunities(STUDENT, [ROLLING], { today: TODAY }).items[0].feasible_alone).toBeNull();
  });
});
