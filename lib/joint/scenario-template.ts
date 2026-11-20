/**
 * 「场景模板」：机会与演示学生不写进 JSON，而是在构建时从已核实目录（data/opportunities.json）
 * 与示例档案（data/profiles.json）取出原对象拼进场景，保证场景与学生端看到的永远是同一份数据。
 * 第一个用到它的是 data/scenarios/shared-support.json（接线在 ./scenarios）。全部是示例 / 模拟。
 *
 * - `ScenarioTemplate` / `assertScenarioTemplateShape(value, label?)`：模板类型与最小形状校验（不合法时抛错）。
 *   模板里不写 `opportunities` / `opportunity_time_slots`，措施不写 `opportunity_ids`（机会 id 在模板里未知；
 *   缺省 = 对场景里唯一的机会有效）。场景只有一个机会，措施的容量按整个场景计（capacity_scope 'total'）。
 * - `templateInputProblems(template, inputs)`：拒绝构建的原因（英文，空数组 = 可以构建）。
 * - `buildScenarioFromTemplate(template, inputs)`：拼出 Scenario；有上面的原因时抛错。
 *   演示学生（原对象，不改动、不复制）插在 `demo_student_position`（越界时夹到两端）；目录机会（原对象）是场景唯一的机会。
 * - `approvedSupportGrants(scenario, studentId, opportunityId)`：场景里全部已批准且适用的措施各合成一条 approved grant
 *   （字段与求解器的合成 grant 一致）——「全部措施都用上」的上界，不看名额、预算、互斥。
 * - `helpableStudentIds(scenario, date?)`：不带支持不可达、但全部已批准措施都用上就可达的学生。
 * - `demoWindowDates(start, extraDays?)`：演示窗口（评估日及其后 7 天），纯字符串日期运算，不读时钟。
 * - `scenarioReadinessProblems(scenario, demoStudentId)`：演示闭环（主办方方案 → 桥 → 学生端可达）用这份数据
 *   走不通的原因（英文，空数组 = 数据层面没有问题）。只用 analyzeReachability 判断；默认方案是否真的分给演示学生、
 *   是否「不够分」由测试（求解器 + 桥）检查。
 *
 * 不 import 任何数据 JSON、lib/data 或 ./scenarios（纯函数，无 IO；不修改输入）。
 * 只给服务器端（./scenarios）与测试用，客户端组件不要 import 它。
 * 字符串比较按 UTF-16 码元（`<`），不用 localeCompare。
 */
import { parseISODate } from '../eligibility/dates';
import { analyzeReachability } from '../reachability';
import type {
  ISODate,
  Intervention,
  Opportunity,
  ReachabilityResult,
  ResourceGrant,
  Scenario,
  StudentProfile,
} from '../types';
import { anonymizeScenarioForClient, findStudentInfoInInterventions } from './scenario-utils';

/** 场景模板（机会与演示学生只写引用，构建时解析）。 */
export interface ScenarioTemplate {
  id: string;
  title: string;
  is_sample: true;
  evaluation_date: ISODate;
  budget_usd: number;
  /**
   * 机会 id；null = 还没定（此时不构建场景）。./scenarios 先查已核实目录（data/opportunities.json），
   * 查不到再用 device-loan 场景里的示例 / 占位机会。共享支持场景目前填的是示例机会 placeholder-inperson-event；
   * 以后可以换成目录里的真实机会。
   */
  opportunity_ref: string | null;
  /** data/profiles.json 里可载入的示例档案 id；null = 还没定（此时不构建场景）。 */
  demo_student_ref: string | null;
  /** 演示学生插在 students 的哪个位置（0 起，非负整数；超过人数时放在最后）。 */
  demo_student_position: number;
  /** 措施；不得写 opportunity_ids（缺省 = 对场景里唯一的机会有效）。 */
  interventions: Intervention[];
  /** 场景专用的示例学生（不含演示学生），全部 is_sample: true。 */
  students: StudentProfile[];
  /** 已有 grants；不得指向演示学生（桥不把有已有 grant 的学生放进 roster）。 */
  existing_grants?: ResourceGrant[];
}

/** 「资源不够分」至少要有这么多名学生能被已批准的措施帮到。 */
export const MIN_HELPABLE_STUDENTS = 4;

/** 演示窗口：评估日之后再看这么多天（学生端 Quest Details 用浏览器的真实日期）。 */
export const DEMO_WINDOW_EXTRA_DAYS = 7;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNonEmptyString = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';
const has = (o: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/**
 * 最小的运行时形状校验（不合法时抛错，错误信息列出全部问题）。详细的场景校验仍由构建后的
 * assertScenarioShape 与 solveJoint 的 UNSUPPORTED_INPUT 负责。
 */
export function assertScenarioTemplateShape(value: unknown, label = 'scenario template'): ScenarioTemplate {
  const problems: string[] = [];
  if (!isObject(value)) {
    problems.push('not an object');
  } else {
    const v = value;
    if (!isNonEmptyString(v.id)) problems.push('id is not a non-empty string');
    if (typeof v.title !== 'string') problems.push('title is not a string');
    if (v.is_sample !== true) problems.push('is_sample must be true');
    if (typeof v.evaluation_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.evaluation_date) || parseISODate(v.evaluation_date) === null) {
      problems.push('evaluation_date is not a valid YYYY-MM-DD date');
    }
    if (typeof v.budget_usd !== 'number' || !Number.isFinite(v.budget_usd) || v.budget_usd < 0) {
      problems.push('budget_usd is not a finite number of 0 or more');
    }
    for (const key of ['opportunity_ref', 'demo_student_ref'] as const) {
      if (!has(v, key)) problems.push(`${key} is missing (use null until it is known)`);
      else if (v[key] !== null && !isNonEmptyString(v[key])) problems.push(`${key} must be null or a non-empty string`);
    }
    if (typeof v.demo_student_position !== 'number' || !Number.isInteger(v.demo_student_position) || v.demo_student_position < 0) {
      problems.push('demo_student_position is not a whole number of 0 or more');
    }
    // 这两项与机会 id 有关，模板里写了就会与目录对不上。
    for (const key of ['opportunities', 'opportunity_time_slots'] as const) {
      if (has(v, key)) problems.push(`${key} must not be in the template (the builder fills the scenario from the resolved opportunity)`);
    }
    if (!Array.isArray(v.interventions)) {
      problems.push('interventions is not an array');
    } else {
      v.interventions.forEach((iv: unknown, k: number) => {
        if (!isObject(iv) || !isNonEmptyString(iv.id)) {
          problems.push(`interventions[${k}] is not an object with a string id`);
          return;
        }
        if (iv.opportunity_ids !== undefined && iv.opportunity_ids !== null) {
          problems.push(`support measure "${iv.id}" has opportunity_ids; leave it out (it then applies to the resolved opportunity)`);
        }
      });
    }
    if (!Array.isArray(v.students)) {
      problems.push('students is not an array');
    } else {
      const seen = new Set<string>();
      v.students.forEach((s: unknown, k: number) => {
        if (!isObject(s) || !isNonEmptyString(s.id)) {
          problems.push(`students[${k}] is not an object with a string id`);
          return;
        }
        if (s.is_sample !== true) problems.push(`student "${s.id}" must be is_sample: true`);
        if (seen.has(s.id)) problems.push(`student id "${s.id}" appears more than once`);
        seen.add(s.id);
      });
    }
    if (v.existing_grants !== undefined) {
      if (!Array.isArray(v.existing_grants)) problems.push('existing_grants is not an array');
      else if (v.existing_grants.some((g: unknown) => !isObject(g))) problems.push('existing_grants has an entry that is not an object');
    }
  }
  if (problems.length > 0) throw new Error(`${label} has the wrong shape: ${problems.join('; ')}`);
  return value as ScenarioTemplate;
}

/** 构建器的输入：两个解析结果，以及（可选）全部可载入示例档案的 id。 */
export interface ScenarioTemplateInputs {
  /** 机会（原对象）：已核实目录里的，或 device-loan 场景里的示例机会（共享支持场景目前用后者）。 */
  opportunity: Opportunity;
  /** 可载入的示例档案（原对象）。 */
  demoStudent: StudentProfile;
  /** data/profiles.json 里全部可载入示例档案的 id（由 ./scenarios 传入）；给出时场景专用学生不得用其中的 id。 */
  loadableProfileIds?: readonly string[];
}

/**
 * 拒绝构建的原因（英文；空数组 = 可以构建）。纯函数，不抛错。
 * - 机会不能是用户发布的（source_tier = 'user_posted'）。已核实目录里的机会与示例场景的示例 / 占位机会都可以
 *   （后者在页面上照常标 Placeholder，./scenarios 只在机会来自目录时才显示「真实机会」说明）；
 * - 演示学生必须是示例档案（is_sample === true）——桥只对示例档案写入；
 * - 演示学生的 id 不能与场景专用学生重复；场景专用学生的 id 不能是可载入示例档案的 id
 *   （否则载入那份档案时，桥会把这名场景专用学生的分配写给它）；
 * - existing_grants 不能指向演示学生（桥把这样的学生排除在 roster 外，演示闭环就断了）；
 * - 模板的 ref 已填时，必须与传入对象的 id 一致。
 */
export function templateInputProblems(template: ScenarioTemplate, inputs: ScenarioTemplateInputs): string[] {
  const problems: string[] = [];
  const { opportunity, demoStudent } = inputs;
  if (!isObject(opportunity) || !isNonEmptyString(opportunity.id)) {
    problems.push('The opportunity is not an object with a string id.');
  } else {
    // 示例 / 占位机会可以用（页面会照常标 Placeholder）；用户发布的机会不行。
    if ((opportunity.source_tier ?? 'official') === 'user_posted') {
      problems.push(
        `Opportunity "${opportunity.id}" is user-posted; this template needs a verified catalog opportunity or a sample scenario's opportunity.`,
      );
    }
    if (template.opportunity_ref !== null && opportunity.id !== template.opportunity_ref) {
      problems.push(`Opportunity "${opportunity.id}" does not match opportunity_ref "${template.opportunity_ref}".`);
    }
  }
  if (!isObject(demoStudent) || !isNonEmptyString(demoStudent.id)) {
    problems.push('The demo student is not an object with a string id.');
  } else {
    if (demoStudent.is_sample !== true) {
      problems.push(`Demo student "${demoStudent.id}" is not a sample profile (is_sample must be true); the bridge only writes for sample profiles.`);
    }
    if (template.demo_student_ref !== null && demoStudent.id !== template.demo_student_ref) {
      problems.push(`Demo student "${demoStudent.id}" does not match demo_student_ref "${template.demo_student_ref}".`);
    }
    if (template.students.some((s) => s.id === demoStudent.id)) {
      problems.push(`Demo student id "${demoStudent.id}" is also used by a scenario-only student.`);
    }
    if ((template.existing_grants ?? []).some((g) => g?.student_id === demoStudent.id)) {
      problems.push(
        `existing_grants reference demo student "${demoStudent.id}"; the bridge leaves students with existing grants out of the roster, so the demo would not work.`,
      );
    }
  }
  const loadable = new Set(inputs.loadableProfileIds ?? []);
  for (const s of template.students) {
    if (loadable.has(s.id)) {
      problems.push(
        `Scenario-only student id "${s.id}" is also a loadable sample profile id; loading that profile would let the bridge write this student's support to it.`,
      );
    }
  }
  return problems;
}

/** 复制措施（数组字段也复制），不与模板共用数组。 */
function copyIntervention(iv: Intervention): Intervention {
  const out: Intervention = { ...iv, resolves: [...iv.resolves] };
  if (Array.isArray(iv.mutually_exclusive_with)) out.mutually_exclusive_with = [...iv.mutually_exclusive_with];
  if (Array.isArray(iv.requires)) out.requires = [...iv.requires];
  return out;
}

/** 演示学生的位置：非有限数 → 0；取整后夹到 [0, 人数]。 */
function clampPosition(position: number, length: number): number {
  if (typeof position !== 'number' || !Number.isFinite(position)) return 0;
  return Math.min(Math.max(Math.trunc(position), 0), length);
}

/**
 * 用模板、目录机会与演示学生拼出 Scenario（纯函数，不修改输入）。
 * - students = 场景专用学生，演示学生（同一个对象）插在 demo_student_position（夹到两端）；
 * - opportunities = [opportunity]（同一个对象）；措施不带 opportunity_ids（对这个机会有效）；
 * - existing_grants 复制一份（缺省为 []）；不写 opportunity_time_slots（只有一个机会，容量按整个场景计）。
 * templateInputProblems 非空，或措施 id / 标题里写进了学生信息时抛错（信息里列出全部原因）。
 */
export function buildScenarioFromTemplate(template: ScenarioTemplate, inputs: ScenarioTemplateInputs): Scenario {
  const problems = templateInputProblems(template, inputs);
  if (problems.length > 0) throw new Error(`${template.id}: cannot build the scenario: ${problems.join(' ')}`);
  const { opportunity, demoStudent } = inputs;
  const students = [...template.students];
  students.splice(clampPosition(template.demo_student_position, students.length), 0, demoStudent);
  const scenario: Scenario = {
    id: template.id,
    title: template.title,
    is_sample: true,
    evaluation_date: template.evaluation_date,
    budget_usd: template.budget_usd,
    students,
    opportunities: [opportunity],
    interventions: template.interventions.map(copyIntervention),
    existing_grants: (template.existing_grants ?? []).map((g) => ({ ...g })),
  };
  const leaks = findStudentInfoInInterventions(scenario);
  if (leaks.length > 0) throw new Error(`${template.id}: cannot build the scenario: ${leaks.join('; ')}`);
  return scenario;
}

// ───────────────────────────── 演示闭环的数据检查 ─────────────────────────────

/**
 * 该学生在该机会上，场景里全部已批准（status 不是 pending）且适用（opportunity_ids 缺省或包含该机会）的措施
 * 各合成一条 approved grant，字段与求解器的合成 grant 一致（CONTRACT「联合求解模型」第 2 条）。
 * 这是「全部措施都用上」的上界：不看名额、预算、互斥。纯函数。
 */
export function approvedSupportGrants(scenario: Scenario, studentId: string, opportunityId: string): ResourceGrant[] {
  return scenario.interventions
    .filter((iv) => iv.status !== 'pending' && (iv.opportunity_ids == null || iv.opportunity_ids.includes(opportunityId)))
    .map((iv) => ({
      id: `readiness:${iv.id}:${studentId}:${opportunityId}`,
      student_id: studentId,
      opportunity_id: opportunityId,
      intervention_id: iv.id,
      type: iv.type,
      amount_usd: iv.amount_usd ?? null,
      device: iv.device ?? null,
      hours_per_week: iv.hours_per_week ?? null,
      status: 'approved' as const,
      provider: scenario.title,
      is_sample: true,
    }));
}

/**
 * 能被帮到的学生：对场景里至少一个机会，只带已有 grants 时不可达，但再加上全部已批准措施的合成 grant 就可达。
 * 以 `{ today: date }`（缺省为评估日）评估；按场景顺序返回学生 id。纯函数。
 */
export function helpableStudentIds(scenario: Scenario, date: string = scenario.evaluation_date): string[] {
  const existing = scenario.existing_grants ?? [];
  const options = { today: date };
  return scenario.students
    .filter((s) =>
      scenario.opportunities.some(
        (o) =>
          analyzeReachability(s, o, existing, options).reachable !== true &&
          analyzeReachability(s, o, [...existing, ...approvedSupportGrants(scenario, s.id, o.id)], options).reachable === true,
      ),
    )
    .map((s) => s.id);
}

/**
 * 演示窗口：`start` 及其后 `extraDays` 天（YYYY-MM-DD，升序）。只做日期运算（Date.UTC），不读系统时钟。
 * `start` 不是合法的 YYYY-MM-DD 时只返回 [start]（由调用方报告日期读不出来）。
 */
export function demoWindowDates(start: string, extraDays: number = DEMO_WINDOW_EXTRA_DAYS): string[] {
  const ymd = parseISODate(start);
  if (ymd === null || start !== start.trim()) return [start];
  const out: string[] = [];
  for (let i = 0; i <= extraDays; i += 1) out.push(new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + i)).toISOString().slice(0, 10));
  return out;
}

/** 引擎 missing_info 里的字段 → 面向组织者 / 开发者的英文说明（演示学生在全部已批准措施下的评估）。 */
function missingInfoText(field: string, opp: Opportunity, evaluationDate: string): string {
  switch (field) {
    case 'opportunity.cost.fee_usd':
      return 'The opportunity fee (cost.fee_usd) is null. The engine treats it as missing information, so no student can be judged reachable.';
    case 'opportunity.time_commitment.hours_per_week':
      return 'The weekly hours (time_commitment.hours_per_week) are null. The engine treats them as missing information, so no student can be judged reachable.';
    case 'opportunity.cost.requires_travel_expense':
      return 'Whether participants must pay for their own travel (cost.requires_travel_expense) is null. The demo student has no transport barrier, so the engine treats it as missing information and cannot judge the demo student reachable.';
    case 'opportunity.deadline':
      return `The deadline "${String(opp.deadline)}" cannot be read as a YYYY-MM-DD date, so no student can be judged reachable.`;
    case 'opportunity.deadline.closing_time':
      return `The deadline (${String(opp.deadline)}) is the evaluation date. The exact closing time is unknown, so the engine cannot judge anyone reachable on the deadline day.`;
    case 'options.today':
      return `The evaluation date "${evaluationDate}" cannot be read as a YYYY-MM-DD date.`;
    default:
      return field.startsWith('profile.')
        ? `The demo student's profile is missing ${field.slice('profile.'.length)}, so the engine cannot decide reachability.`
        : `Information the engine needs is missing: ${field}.`;
  }
}

/**
 * 演示闭环用这份数据走不通的原因（英文，按固定顺序；空数组 = 数据层面没有问题）。纯函数。
 * 先看场景：演示学生不在场景里（直接返回）、出现多次、不是示例档案、在 existing_grants 里已有 grant、没有机会、
 * 能被已批准措施帮到的学生少于 MIN_HELPABLE_STUDENTS（显不出「不够分」）。
 * 再对每个机会（演示学生，全部已批准措施都用上 = 上界，不看名额、预算、互斥）：
 * 1. 机会是线上的（场景讲的是线下机会的交通与设备）；
 * 2. 评估日：不满足 / manual / 判不了的硬性要求；引擎 missing_info 里的每个字段（机会信息与演示学生档案）；
 *    化解不了的障碍；不带支持就已经可达；
 * 3. 演示窗口（评估日及其后 7 天，学生端用浏览器的真实日期）：带支持在某天不可达（截止日期落在窗口里时专门说明）、
 *    不带支持在某天就可达；
 * 4. 主办方页面看到的是匿名化副本（anonymizeScenarioForClient，例如没有出生日期）：窗口内任一天，
 *    副本与原始档案的结论（带 / 不带支持）不同。
 * 最后：演示学生的档案有出生日期时提醒（主办方页面忽略它）。
 */
export function scenarioReadinessProblems(scenario: Scenario, demoStudentId: string): string[] {
  const index = scenario.students.findIndex((s) => s?.id === demoStudentId);
  if (index < 0) return [`The demo student "${demoStudentId}" is not in this scenario.`];
  const problems: string[] = [];
  const copies = scenario.students.filter((s) => s?.id === demoStudentId).length;
  if (copies > 1) problems.push(`The demo student "${demoStudentId}" appears ${copies} times in this scenario.`);
  const student = scenario.students[index];
  if (student.is_sample !== true) {
    problems.push('The demo student is not a sample profile (is_sample must be true); the bridge only writes for sample profiles.');
  }
  if ((scenario.existing_grants ?? []).some((g) => g?.student_id === demoStudentId)) {
    problems.push('The demo student already has existing grants in this scenario; the bridge leaves such students out of the roster.');
  }
  if (scenario.opportunities.length === 0) {
    problems.push('The scenario has no opportunity.');
    return problems;
  }
  const helpable = helpableStudentIds(scenario).length;
  if (helpable < MIN_HELPABLE_STUDENTS) {
    problems.push(
      `Fewer than ${MIN_HELPABLE_STUDENTS} scenario students can be helped by the approved measures (${helpable}), so the scenario would not show scarce support.`,
    );
  }

  const dates = demoWindowDates(scenario.evaluation_date);
  const first = dates[0];
  const last = dates[dates.length - 1];
  const windowText = `the demo window (${first} to ${last})`;
  const anonymized = anonymizeScenarioForClient(scenario);
  const anonStudent = anonymized.students[index];
  const multi = scenario.opportunities.length > 1;

  for (const opp of scenario.opportunities) {
    const where = multi ? ` (opportunity "${opp.id}")` : '';
    const add = (text: string) => problems.push(`${text}${where}`);
    const evaluate = (sc: Scenario, s: StudentProfile, date: string, withSupport: boolean): ReachabilityResult => {
      const existing = sc.existing_grants ?? [];
      const grants = withSupport ? [...existing, ...approvedSupportGrants(sc, s.id, opp.id)] : existing;
      return analyzeReachability(s, opp, grants, { today: date });
    };

    // 1. 线上机会
    if (opp.location?.format === 'online') add('The opportunity is online, but the scenario is about an in-person opportunity.');

    const days = dates.map((date) => ({ date, with: evaluate(scenario, student, date, true), without: evaluate(scenario, student, date, false) }));
    const day0 = days[0];

    // 2a. 硬性要求
    for (const item of day0.with.eligibility.items) {
      if (!item.hard) continue;
      if (item.status === 'not_satisfied') {
        add(`The demo student does not meet the hard requirement "${item.label}". Support measures cannot change eligibility.`);
      } else if (item.status === 'unknown') {
        if (item.requirement_type === 'manual') {
          add(`The hard requirement "${item.label}" is manual, so the engine cannot check it and eligibility stays unknown.`);
        } else {
          const fields = item.used_profile_fields.length > 0 ? ` (profile fields: ${item.used_profile_fields.join(', ')})` : '';
          add(`The hard requirement "${item.label}" is unknown for the demo student${fields}.`);
        }
      }
    }
    // 2b. 引擎认为缺的信息（机会与档案都从引擎自己的 missing_info 推出，不另做判断）
    for (const field of day0.with.missing_info) add(missingInfoText(field, opp, scenario.evaluation_date));
    // 2c. 已批准措施化解不了的障碍
    for (const b of day0.with.barriers) {
      if (!b.resolved) add(`No approved support measure in this scenario resolves the demo student's ${b.type} barrier: ${b.description}`);
    }
    // 2d. 本来就可达
    if (day0.without.reachable === true) {
      add('The demo student is already reachable without any support, so there is nothing to demonstrate.');
    }

    // 3. 演示窗口（评估日当天的问题上面已经报过，这里只看之后几天新出现的）
    const later = days.slice(1);
    if (day0.with.reachable === true) {
      const failing = later.filter((d) => d.with.reachable !== true).map((d) => d.date);
      if (failing.length > 0) {
        const deadline = opp.deadline ?? null;
        // 截止当天学生端已不是「可达」（截止时刻未知 → null），所以截止日落在窗口最后一天也算在窗口里。
        const inWindow = deadline !== null && parseISODate(deadline) !== null && first <= deadline && deadline <= last;
        add(
          inWindow
            ? `The deadline (${deadline}) falls inside ${windowText}, so from ${failing[0]} the student side would no longer show it as reachable (on the deadline day the exact closing time is unknown; after it, the deadline has passed).`
            : `With every approved measure the demo student is reachable on ${first} but not on ${failing.join(', ')}, inside ${windowText}.`,
        );
      }
    }
    if (day0.without.reachable !== true) {
      const early = later.filter((d) => d.without.reachable === true).map((d) => d.date);
      if (early.length > 0) {
        add(`Without any support the demo student becomes reachable on ${early.join(', ')}, inside ${windowText}, so there would be nothing to demonstrate on those days.`);
      }
    }

    // 4. 主办方页面看到的匿名化副本
    if (anonStudent !== undefined) {
      const differ = days
        .filter(
          (d) =>
            evaluate(anonymized, anonStudent, d.date, true).reachable !== d.with.reachable ||
            evaluate(anonymized, anonStudent, d.date, false).reachable !== d.without.reachable,
        )
        .map((d) => d.date);
      if (differ.length > 0) {
        add(
          `The organizer page (anonymized copy) and the student side (original profile) reach different conclusions about the demo student on ${differ.join(', ')}.`,
        );
      }
    }
  }
  if (student.birth_date != null) problems.push('The demo profile has a birth date, which the organizer view ignores.');
  return problems;
}
