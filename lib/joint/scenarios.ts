/**
 * 联合求解的示例 / 模拟场景（全部 is_sample: true，不是真实学生、真实机会或真实影响）。
 *
 * - `deviceLoanScenario`：data/scenarios/device-loan.json —— 一场需要笔记本电脑的线下活动（占位机会，
 *   真实机会待队友 A 提供），10 名示例学生都缺笔记本，其中 3 人（dl-s03 / dl-s06 / dl-s09）还缺交通条件。
 *   学生自己声明的 statuses：全部含 high_school_student；dl-s07…dl-s10 含 low_income；dl-s03 / dl-s06 / dl-s08
 *   含 first_generation（用于演示公平底线）。
 * - `venueTradeoffScenario`：data/scenarios/venue-tradeoff.json —— 同一主办方的工作日场与周末场（占位机会），
 *   已在运行的「工作日接驳车」给 3 名学生发了 approved grant；新的「周末卫星会场」与它互斥（演示权衡分析模式）。
 * - `sharedSupportScenario`：data/scenarios/shared-support.json 是**场景模板**（./scenario-template）——
 *   机会按 `opportunity_ref` 先查已核实目录（lib/data 的 findCatalogOpportunity），查不到再用设备借用场景自己的
 *   示例 / 占位机会（同一个对象；目前就是 placeholder-inperson-event，sharedSupportOpportunitySource = 'sample'，
 *   此时页面照常标 Placeholder、不显示「真实机会」说明），
 *   演示学生用可载入的示例档案（`demo_student_ref`，经 sampleProfiles 解析），原对象直接拼进场景，
 *   其余学生、措施（借用笔记本、交通补助、一项待审批措施）与预算都是示例；支持方是模拟的社区伙伴，
 *   不是真实机会的主办方。两个 ref 任一为 null 时为 null（不进 SCENARIOS）；ref 已填但解析不到时在 import 时抛错。
 *   `sharedSupportReadinessProblems`：它的演示闭环数据检查结果（import 时算一次；场景为 null 时为空数组）。
 *   它的低收入底线（sharedSupportLowIncomeFloor）依据写的是模拟支持方，不是「the organizer」。
 * - `SCENARIOS`：场景清单（id、标题、一句说明、预设公平底线 suggestedFairnessFloors、
 *   示例主办方名 sampleOrganizer（「回到学生端的桥」写入 grants 的 provider），均为示例）。
 *   前两项固定是 device-loan、venue-tradeoff；sharedSupportScenario 非 null 时追加为第三项。
 * - `withEnabledInterventions(scenario, ids)`：只保留指定措施（What-if 页面「勾选措施」用）；
 *   前置依赖没有全部启用的措施一并移除（不放松依赖），并清理指向已移除措施的互斥引用。
 *   运行中的措施（有已有 grant 指向它）不能被移除：未勾选时保留在场景里、只是不接受新分配（opportunity_ids = []）。
 * - `resolveEnabledInterventions(scenario, ids)`：同一套规则，返回保留、被移除、运行中与「运行中但不接受新分配」的措施。
 * - `runningInterventionIds(scenario)`：运行中的措施 id。
 * - `withBudget(scenario, budget)`：改预算。
 * 以上纯函数实现在 ./scenario-utils（不含数据），这里只是转导出。
 * **只在服务器端使用，客户端组件不要 import 本文件**：顶层导入了场景 JSON（含示例学生姓名、学校）
 * 与 lib/data（目录与示例档案），会被打包进浏览器。
 * 页面应在 server component 里调用 anonymizeScenarioForClient 后把结果作为 prop 传下去。
 *
 * 纯函数：不修改输入，返回新对象；无 IO（JSON 在构建时导入）。
 */
import type { FairnessFloor, Scenario } from '../types';
import deviceLoanJson from '@/data/scenarios/device-loan.json';
import venueTradeoffJson from '@/data/scenarios/venue-tradeoff.json';
import sharedSupportJson from '@/data/scenarios/shared-support.json';
import { findCatalogOpportunity, sampleProfiles } from '../data';
import { findStudentInfoInInterventions } from './scenario-utils';
import { assertScenarioTemplateShape, buildScenarioFromTemplate, scenarioReadinessProblems } from './scenario-template';
import type { ScenarioTemplate } from './scenario-template';

/**
 * 最小的运行时形状校验：只查顶层字段与数组，详细校验由 solveJoint 的 UNSUPPORTED_INPUT 负责。
 * 另外检查措施 id / 标题不含任何学生的 id、显示名、学校名（姓名 / 学校名短于 3 个字符时不查）。
 */
export function assertScenarioShape(value: unknown, label = 'scenario'): Scenario {
  const v = value as Partial<Scenario> | null;
  const problems: string[] = [];
  if (v == null || typeof v !== 'object') problems.push('not an object');
  else {
    if (typeof v.id !== 'string') problems.push('id is not a string');
    if (typeof v.title !== 'string') problems.push('title is not a string');
    if (v.is_sample !== true) problems.push('is_sample must be true');
    if (typeof v.evaluation_date !== 'string') problems.push('evaluation_date is not a string');
    if (typeof v.budget_usd !== 'number') problems.push('budget_usd is not a number');
    for (const key of ['students', 'opportunities', 'interventions'] as const) {
      if (!Array.isArray(v[key])) problems.push(`${key} is not an array`);
    }
    if (v.existing_grants !== undefined && !Array.isArray(v.existing_grants)) problems.push('existing_grants is not an array');
    // 措施 id / 标题里不得写进学生的 id、显示名、学校名（否则页面脱敏挡不住，示例数据写错时尽早暴露）。
    if (Array.isArray(v.students) && Array.isArray(v.interventions)) {
      problems.push(...findStudentInfoInInterventions(v as Scenario));
    }
  }
  if (problems.length > 0) throw new Error(`${label} has the wrong shape: ${problems.join('; ')}`);
  return value as Scenario;
}

export const deviceLoanScenario: Scenario = assertScenarioShape(deviceLoanJson as unknown, 'device-loan');

/** 演示场景里各措施的 id（方便页面与测试引用）。 */
export const DEVICE_LOAN_IDS = {
  laptopLoan: 'iv-laptop-loan',
  transportSubsidy: 'iv-transport-subsidy',
  onlineEntry: 'iv-online-entry',
  satelliteVenue: 'iv-satellite-venue',
  opportunity: 'placeholder-inperson-event',
  /** 还缺交通条件的 3 名示例学生。 */
  transportLackingStudents: ['dl-s03', 'dl-s06', 'dl-s09'],
} as const;

export const venueTradeoffScenario: Scenario = assertScenarioShape(venueTradeoffJson as unknown, 'venue-tradeoff');

/** 权衡场景里各措施、机会与已有 grant 的 id。 */
export const VENUE_TRADEOFF_IDS = {
  weekdayShuttle: 'iv-weekday-shuttle',
  weekdayCarpool: 'iv-weekday-carpool',
  weekendSatellite: 'iv-weekend-satellite',
  weekdayOpportunity: 'placeholder-weekday-session',
  weekendOpportunity: 'placeholder-weekend-session',
  /** 工作日接驳车已发出的 3 条 approved grant。 */
  shuttleGrants: ['shuttle-grant-1', 'shuttle-grant-2', 'shuttle-grant-3'],
  /** 持有接驳车座位的 3 名示例学生。 */
  shuttleStudents: ['vt-s01', 'vt-s02', 'vt-s03'],
} as const;

/**
 * 共享支持场景的模板（data/scenarios/shared-support.json）。
 * 两个 ref 已填好：`opportunity_ref` 目前是 device-loan 场景里的示例机会 placeholder-inperson-event（不是目录里的真实机会），
 * `demo_student_ref` 是 data/profiles.json 的一份示例档案。模板支持以后把 `opportunity_ref` 换成已核实目录
 * （data/opportunities.json）里的真实机会 id，届时再按那个机会调整示例学生的资格字段与预算 / 名额。
 */
export const sharedSupportTemplate: ScenarioTemplate = assertScenarioTemplateShape(sharedSupportJson as unknown, 'shared-support');

/**
 * 解析模板的两个 ref。ref 已填但在目录 / 示例档案里找不到（拼错、或没通过 lib/data 的校验）时抛错，
 * 让构建与测试尽早失败；任一 ref 为 null 时返回 null。构建结果再过一遍 assertScenarioShape。
 */
function resolveSharedSupport(template: ScenarioTemplate): { scenario: Scenario; source: 'catalog' | 'sample' } | null {
  const oppRef = template.opportunity_ref;
  const studentRef = template.demo_student_ref;
  // 先查已核实目录；查不到再用设备借用场景自己的示例 / 占位机会（同一个对象，不复制，不会与那个场景走样）。
  const fromCatalog = oppRef === null ? null : findCatalogOpportunity(oppRef);
  const fromSample = oppRef === null || fromCatalog !== null ? null : (deviceLoanScenario.opportunities.find((o) => o.id === oppRef) ?? null);
  const opportunity = fromCatalog ?? fromSample;
  if (oppRef !== null && opportunity === null) {
    throw new Error(
      `${template.id}: opportunity_ref "${oppRef}" is neither in the verified catalog (data/opportunities.json, or it failed validation) nor an opportunity of the device-loan sample scenario.`,
    );
  }
  const demoStudent = studentRef === null ? null : (sampleProfiles().find((p) => p.id === studentRef) ?? null);
  if (studentRef !== null && demoStudent === null) {
    throw new Error(
      `${template.id}: demo_student_ref "${studentRef}" is not a loadable sample profile (data/profiles.json), or it failed validation.`,
    );
  }
  if (opportunity === null || demoStudent === null) return null;
  const loadableProfileIds = sampleProfiles().map((p) => p.id);
  return {
    scenario: assertScenarioShape(buildScenarioFromTemplate(template, { opportunity, demoStudent, loadableProfileIds }), template.id),
    source: fromCatalog !== null ? 'catalog' : 'sample',
  };
}

const sharedSupportResolved = resolveSharedSupport(sharedSupportTemplate);

/** 共享支持场景；两个 ref 任一还没填时为 null（此时不出现在 SCENARIOS 里）。 */
export const sharedSupportScenario: Scenario | null = sharedSupportResolved?.scenario ?? null;

/**
 * 共享支持场景的机会来自哪里：'catalog' = 已核实目录里的真实机会（页面显示 REAL_OPPORTUNITY_NOTE）；
 * 'sample' = 设备借用场景的示例 / 占位机会（与那个场景同一个对象，页面照常标 Placeholder，不说「真实」）；场景为 null 时为 null。
 */
export const sharedSupportOpportunitySource: 'catalog' | 'sample' | null = sharedSupportResolved?.source ?? null;

/**
 * 共享支持场景的演示闭环在数据层面走不通的原因（scenarioReadinessProblems，英文），在 import 时算一次。
 * 场景为 null（ref 没填齐）时为空数组。不输出到控制台：由测试断言它为空并打印原因。
 */
export const sharedSupportReadinessProblems: string[] =
  sharedSupportScenario === null || sharedSupportTemplate.demo_student_ref === null
    ? []
    : scenarioReadinessProblems(sharedSupportScenario, sharedSupportTemplate.demo_student_ref);

/** 共享支持场景里各措施的 id。 */
export const SHARED_SUPPORT_IDS = {
  laptopLoan: 'iv-ss-laptop-loan',
  transportStipend: 'iv-ss-transport-stipend',
  /** 待审批：只出现在条件性结果里，桥永不写入。 */
  extraLaptops: 'iv-ss-extra-laptops',
} as const;

/**
 * 用真实机会的场景在页面上必须显示的说明（原文不得改动）。最后一句说明页面上的「organizer」指模拟支持方，
 * 避免把模拟的支持读成真实主办方提供的。
 */
export const REAL_OPPORTUNITY_NOTE =
  'This scenario uses a real opportunity listing with sample students and a simulated support provider. The real organizer is not involved and offers none of these measures. Results are simulated. On this page, "organizer" means the simulated support provider.';

/** 演示场景清单中的一项（全部是示例 / 模拟）。 */
export interface ScenarioEntry {
  id: string;
  title: string;
  /** 一句说明。 */
  description: string;
  scenario: Scenario;
  /** 预设公平底线（示例，basis 写明依据；主办方可以不用）。 */
  suggestedFairnessFloors: FairnessFloor[];
  /** 示例主办方名字，写入 grants 的 provider；不得使用真实机构名（也不得是真实机会的主办方名）。 */
  sampleOrganizer: string;
  /**
   * 场景里的机会是已核实目录里的真实机会（学生、措施、支持方仍是示例 / 模拟）时给出：页面在机会列表旁显示这句说明。
   * 缺省 = 机会是占位机会。
   */
  realOpportunityNote?: string;
}

/** 两个演示场景共用的示例主办方名字（与占位机会的 organizer 一致）。 */
const SAMPLE_ORGANIZER = 'Sample organizer (placeholder)';

/** 低收入学生覆盖 ≥ 50% 的示例底线（两个场景共用同一写法，依据为虚构的示例章程）。 */
const lowIncomeFloor = (): FairnessFloor => ({
  id: 'floor-low-income',
  label: 'Low-income students',
  basis: 'Sample: the organizer\'s funding charter prioritizes low-income students (fictional basis, for demo only; groups follow each student\'s self-reported status).',
  statuses_any_of: ['low_income'],
  min_ratio: 0.5,
});

/**
 * 共享支持场景的模拟支持方（写入 grants 的 provider）。模拟的支持永远不能记在真实机构名下，
 * 所以这里不用、也不得改成真实机会的主办方名。
 */
const SHARED_SUPPORT_ORGANIZER = 'Sample community partner (simulated)';

/**
 * 共享支持场景的低收入底线：id、标签、群体、比例与另外两个场景相同，但依据写的是模拟支持方的章程
 * （这个场景里的机会是真实的，「the organizer」会被读成真实主办方）。
 */
export const sharedSupportLowIncomeFloor = (): FairnessFloor => ({
  ...lowIncomeFloor(),
  basis:
    'Sample: the simulated support provider\'s charter prioritizes low-income students (fictional basis, for demo only; groups follow each student\'s self-reported status).',
});

export const SCENARIOS: readonly ScenarioEntry[] = [
  {
    id: deviceLoanScenario.id,
    title: deviceLoanScenario.title,
    description: 'Sample: 10 students without laptops share 5 loaner devices. See how capacity, budget, mutual exclusions and pending-approval measures affect coverage.',
    scenario: deviceLoanScenario,
    suggestedFairnessFloors: [lowIncomeFloor()],
    sampleOrganizer: SAMPLE_ORGANIZER,
  },
  {
    id: venueTradeoffScenario.id,
    title: venueTradeoffScenario.title,
    description: 'Sample: opening a weekend satellite venue means stopping the weekday shuttle that is already running. See gains, losses and revocations in trade-off mode.',
    scenario: venueTradeoffScenario,
    suggestedFairnessFloors: [lowIncomeFloor()],
    sampleOrganizer: SAMPLE_ORGANIZER,
  },
  ...(sharedSupportScenario === null ? [] : [sharedSupportEntry(sharedSupportScenario, sharedSupportOpportunitySource === 'catalog')]),
];

/**
 * 共享支持场景的清单项。只有机会来自已核实目录时才说「real」并带 REAL_OPPORTUNITY_NOTE；
 * 用示例 / 占位机会时不带说明，页面照常标 Placeholder，假设说明也是「机会是占位的」那一句。
 */
function sharedSupportEntry(scenario: Scenario, realOpportunity: boolean): ScenarioEntry {
  const entry: ScenarioEntry = {
    id: scenario.id,
    title: scenario.title,
    description: realOpportunity
      ? 'Sample: a simulated community partner has a few loaner laptops and a small transport budget for sample students interested in a real in-person opportunity. Not enough for everyone.'
      : 'Sample: a simulated community partner has a few loaner laptops and a small transport budget for sample students interested in an in-person sample opportunity. Not enough for everyone.',
    scenario,
    suggestedFairnessFloors: [sharedSupportLowIncomeFloor()],
    sampleOrganizer: SHARED_SUPPORT_ORGANIZER,
  };
  if (realOpportunity) entry.realOpportunityNote = REAL_OPPORTUNITY_NOTE;
  return entry;
}

export {
  anonymizeScenarioForClient,
  findStudentInfoInInterventions,
  missingPrerequisites,
  resolveEnabledInterventions,
  runningInterventionIds,
  withBudget,
  withEnabledInterventions,
} from './scenario-utils';
export type { FrozenIntervention, RemovedIntervention } from './scenario-utils';
