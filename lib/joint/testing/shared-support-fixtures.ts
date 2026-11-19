/**
 * 共享支持场景（场景模板 + 真实目录机会 + 演示学生）的测试 fixture。全部虚构：
 * - `FIXTURE_OPPORTUNITY`：**模仿目录里的真实机会**的虚构线下活动（is_sample: false、source_tier: 'official'，
 *   但链接是 example.org、主办方名写明是 fixture）。引擎能完整判断：fee_usd、hours_per_week 是数字，
 *   requires_travel_expense 是布尔值，required_devices = ['laptop']，硬性要求只有机器可判定的年级与地区，
 *   截止日期 2027-01-15（晚于 2026-11-28）。
 * - `FIXTURE_DEMO_STUDENT`：虚构的可载入示例档案（is_sample: true）：满足全部硬性要求，设备 / 预算 / 交通 / 时间都填了，
 *   只缺笔记本（交通可靠、免费活动、每周时间够）。
 * - `FIXTURE_TEMPLATE`：与 data/scenarios/shared-support.json **当前**的数字相同、但独立维护的模板
 *   （真实机会到了以后 JSON 会按真实机会调整资格字段与预算，这里不跟着变，保证下面的手算数字稳定）：
 *   预算 $150；借用笔记本 3 台（固定 $40 + 每人 $20，容量按整个场景计）；交通补助每人 $30（不限名额）；
 *   第二批借用笔记本 2 台（待审批，每人 $20）。7 名场景专用学生 + 演示学生（位置 0）：
 *     演示学生   只缺笔记本               high_school_student, low_income
 *     A fx-s01   只缺笔记本               high_school_student
 *     B fx-s02   只缺笔记本               high_school_student
 *     C fx-s03   缺笔记本 + 交通（none）   high_school_student, low_income
 *     D fx-s04   只缺笔记本               high_school_student, low_income, first_generation
 *     E fx-s05   缺笔记本 + 交通（limited）high_school_student, low_income
 *     F fx-s06   有笔记本、只缺交通（none）high_school_student
 *     G fx-s07   有笔记本、只缺交通（limited）high_school_student, low_income, first_generation
 *   匿名化后：演示学生 = s1，A…G = s2…s8。手算（默认 What-if 输入，保护模式，不设底线）：
 *   8 人都需要支持（R0 = 0）；6 人缺笔记本但只有 3 台；预算扣掉 3 台笔记本（$100）后只够 1 份交通补助。
 *   G = 4（笔记本给只缺笔记本的 s1 s2 s3，交通补助给只缺交通的 s7），L = 0，N = 4，成本 $130（固定 $40 + 每人 $90）。
 *   G = 5 需要 $160 > $150。同条件按编号决定（不代表谁更需要），所以位置 0 的演示学生 s1 分到笔记本。
 *   低收入覆盖 ≥ 50% 的底线：低收入 5 人（演示学生、C、D、E、G），默认只覆盖 1 人；开启后仍是 G = 4、$130，
 *   改为笔记本给 s1 s2 s5、交通补助给 s8（3 / 5），演示学生仍分到。
 *   条件性结果（第二批笔记本获批）：G = 5、$150。
 * 评估日 2026-11-20。所有结果都是模拟；可达 ≠ 录取。
 */
import type { Opportunity, StudentProfile, StudentStatus, TransportAccess } from '../../types';
import type { ScenarioTemplate } from '../scenario-template';

export const FIXTURE_EVAL_DATE = '2026-11-20';

export const FIXTURE_OPPORTUNITY: Opportunity = {
  id: 'fixture-inperson-build-day',
  title: 'Fictional in-person build day (test fixture shaped like a catalog entry)',
  organizer: 'Fictional Organizer (test fixture)',
  category: 'project',
  fields: ['computer_science'],
  summary: 'Fictional test fixture: an in-person build day where participants bring their own laptop. Not a real opportunity.',
  official_url: 'https://example.org/fixture-inperson-build-day',
  verified_on: '2026-11-17',
  verified_by: 'test-fixture',
  deadline: '2027-01-15',
  deadline_note: null,
  recurring_annually: true,
  location: { format: 'in_person', country: 'US', state: 'CA', city: 'Example City' },
  cost: { fee_usd: 0, requires_travel_expense: false, financial_aid_available: null },
  time_commitment: { hours_per_week: 5, total_weeks: 1, start_date: '2027-02-06', end_date: '2027-02-06' },
  required_devices: ['laptop'],
  requirements: [
    {
      id: 'req-grade',
      type: 'grade',
      min: 9,
      max: 12,
      hard: true,
      label: 'High school student (grades 9–12)',
      source_text: '(Fictional fixture text) Open to high school students in grades 9-12.',
    },
    {
      id: 'req-region',
      type: 'region',
      countries: ['US'],
      states: ['CA'],
      hard: true,
      label: 'California resident',
      source_text: '(Fictional fixture text) Participants must live in California.',
    },
  ],
  preparation: [
    {
      id: 'prep-bring-project-idea',
      title: 'Sketch a project idea',
      skill: null,
      evidence_kind: null,
      estimated_hours: 1,
      estimated_cost_usd: 0,
      depends_on: [],
      required_for_application: false,
      source_text: 'Team suggestion (fixture)',
    },
  ],
  is_sample: false,
  source_tier: 'official',
  posted_by: null,
};

export const FIXTURE_DEMO_STUDENT: StudentProfile = {
  id: 'sample-fixture-demo',
  is_sample: true,
  display_name: 'Sample student Quinn (fixture)',
  grade: 11,
  age: 16,
  region: { country: 'US', state: 'CA', city: 'Example City', locality: 'urban' },
  citizenships: ['US'],
  statuses: ['high_school_student', 'low_income'],
  school_name: 'Example Fixture High School (fictional)',
  hours_per_week_available: 6,
  budget_usd: 20,
  transport: { level: 'reliable', max_one_way_minutes: 45, note: 'Fixture note: rides the bus with a friend' },
  devices: ['smartphone'],
  skills: [{ name: 'python', level: 'beginner' }],
  evidence: [
    {
      id: 'ev-fixture-1',
      title: 'Fixture evidence title (private)',
      kind: 'course',
      skills: ['python'],
      status: 'self_reported',
      url: null,
      description: 'Fixture evidence description (private).',
      added_on: '2026-11-01',
    },
  ],
  interests: ['computer_science'],
};

export const FIXTURE_IDS = {
  laptopLoan: 'iv-fx-laptop-loan',
  transportStipend: 'iv-fx-transport-stipend',
  extraLaptops: 'iv-fx-extra-laptops',
} as const;

const TRANSPORT: Record<TransportAccess['level'], TransportAccess> = {
  reliable: { level: 'reliable', max_one_way_minutes: 40, note: 'Fixture note: takes the bus' },
  limited: { level: 'limited', max_one_way_minutes: null, note: 'Fixture note: the bus runs twice a day' },
  none: { level: 'none', max_one_way_minutes: null, note: 'Fixture note: no bus line nearby' },
};

function fixtureStudent(
  n: number,
  letter: string,
  p: { grade: number; age: number; laptop: boolean; transport: TransportAccess['level']; statuses: StudentStatus[] },
): StudentProfile {
  return {
    id: `fx-s0${n}`,
    is_sample: true,
    display_name: `Sample student ${letter} (fixture scenario)`,
    grade: p.grade,
    age: p.age,
    region: { country: 'US', state: 'CA', city: 'Example City', locality: p.transport === 'reliable' ? 'urban' : 'rural' },
    citizenships: ['US'],
    statuses: ['high_school_student', ...p.statuses],
    school_name: `Example Fixture School ${letter} (fictional)`,
    hours_per_week_available: 6,
    budget_usd: 20,
    transport: { ...TRANSPORT[p.transport] },
    devices: p.laptop ? ['laptop', 'smartphone'] : ['smartphone'],
    skills: [{ name: 'python', level: 'beginner' }],
    evidence: [],
    interests: ['computer_science'],
  };
}

/** 7 名场景专用学生（顺序即编号顺序，见文件头的表）。 */
export const FIXTURE_SCENARIO_STUDENTS: readonly StudentProfile[] = [
  fixtureStudent(1, 'A', { grade: 10, age: 15, laptop: false, transport: 'reliable', statuses: [] }),
  fixtureStudent(2, 'B', { grade: 11, age: 16, laptop: false, transport: 'reliable', statuses: [] }),
  fixtureStudent(3, 'C', { grade: 9, age: 14, laptop: false, transport: 'none', statuses: ['low_income'] }),
  fixtureStudent(4, 'D', { grade: 12, age: 17, laptop: false, transport: 'reliable', statuses: ['low_income', 'first_generation'] }),
  fixtureStudent(5, 'E', { grade: 10, age: 16, laptop: false, transport: 'limited', statuses: ['low_income'] }),
  fixtureStudent(6, 'F', { grade: 11, age: 17, laptop: true, transport: 'none', statuses: [] }),
  fixtureStudent(7, 'G', { grade: 12, age: 18, laptop: true, transport: 'limited', statuses: ['low_income', 'first_generation'] }),
];

/** 模板 fixture；refs 指向上面的虚构机会与演示学生。每次返回新对象（测试可以放心改）。 */
export function fixtureTemplate(): ScenarioTemplate {
  return {
    id: 'fixture-shared-support',
    title: 'Sample / simulated scenario (test fixture): laptop loans and transport support for an in-person opportunity',
    is_sample: true,
    evaluation_date: FIXTURE_EVAL_DATE,
    budget_usd: 150,
    opportunity_ref: FIXTURE_OPPORTUNITY.id,
    demo_student_ref: FIXTURE_DEMO_STUDENT.id,
    demo_student_position: 0,
    interventions: [
      {
        id: FIXTURE_IDS.laptopLoan,
        title: 'Loaner laptops (sample)',
        type: 'device',
        resolves: ['device'],
        unit_cost_usd: 20,
        fixed_cost_usd: 40,
        capacity: 3,
        capacity_scope: 'total',
        device: 'laptop',
        status: 'approved',
      },
      {
        id: FIXTURE_IDS.transportStipend,
        title: 'Transport stipend (sample)',
        type: 'transport_subsidy',
        resolves: ['transport'],
        unit_cost_usd: 30,
        fixed_cost_usd: 0,
        capacity: null,
        amount_usd: 30,
        status: 'approved',
      },
      {
        id: FIXTURE_IDS.extraLaptops,
        title: 'Extra loaner laptops from a second partner (sample, pending approval)',
        type: 'device',
        resolves: ['device'],
        unit_cost_usd: 20,
        fixed_cost_usd: 0,
        capacity: 2,
        capacity_scope: 'total',
        device: 'laptop',
        status: 'pending',
      },
    ],
    students: [...FIXTURE_SCENARIO_STUDENTS],
    existing_grants: [],
  };
}
