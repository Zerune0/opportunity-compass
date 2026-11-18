/**
 * analyzeGaps(profile, opp, grants, options?) — 五类差距（GapAnalysis），第二阶段第 1 层完整实现。
 *
 * 只整理已有引擎的结论，不发明新规则：内部调用 analyzeReachability(profile, opp, grants, options)
 * （它内部调用 checkEligibility），eligibility_overall 与 reachable 直接取它的结果。
 *
 * 规则：
 * 1. 资格项（按 opp.requirements 顺序）：
 *    - not_satisfied 的 prerequisite_skill → knowledge_or_experience；not_satisfied 的 portfolio → materials
 *      （硬性与偏好都列，detail 写明是否影响资格）。行动：机会里有未覆盖的准备项能补上它时（技能：准备项 skill 相同；
 *      作品：evidence_kind 相同，或要求作品集而准备项 material_kind 为 portfolio；规定了技能时技能也要相同），
 *      指向第一个这样的准备项（小时 / 费用写在行动文字里）；没有就如实说需要相应技能 / 作品，并提示在 Skill Passport
 *      补充已有的。技能要求高于 beginner 时只提示更新技能等级（证据只对 beginner 要求有效，与 checkEligibility 一致）。
 *      这两类条目的 estimated_* 为 null（小时已算在对应准备项那一条里，避免重复计）。
 *    - 其余 hard 且 not_satisfied（grade / age / region / citizenship / status）→ unchangeable_eligibility：
 *      improvable: false、action: null。grade / age 低于下限时 detail 写明「现在不满足，可能随年级 / 年龄增长而满足，
 *      届时按官网当时的要求重新确认」；高于上限、region、citizenship、status 只给原因与官网原文。
 *      age 的「低于下限」按参考日（as_of ?? deadline）当天可能的年龄判断，与 checkEligibility 的算法一致。
 *    - 偏好（hard: false）且 not_satisfied 的 grade / age / region / citizenship / status：刻意不列——
 *      不影响资格，学生也无法通过行动改变，列出来只会制造焦虑。
 *    - status 为 unknown（硬性与偏好都列，含 manual）→ unknown_info，带官网原文，行动为 confirm_with_official。
 * 2. 准备差距 r.readiness_gaps（按 opp.preparation 顺序）：有 material_kind → materials，否则 → knowledge_or_experience。
 *    行动写出这个准备项要做什么、估计小时与费用、完成后记录哪种证据（evidence_kind）并关联到这个准备项；
 *    前置依赖也未覆盖时，点明先做哪几个。estimated_* 取准备项的估计（负数按 0，非有限数为 null）。
 * 3. 障碍：只列未被 approved grant 化解的（resolved: false），按 BARRIER_TYPES 顺序，同类保持原顺序；
 *    已化解的不列，只在 summary 里说有几条已被生效的支持化解。
 *    - time（有 shortfall）：estimated_hours = 每周缺口小时；cost：estimated_cost_usd = 缺口美元；其他为 null。
 *    - 有 pending grant 时：行动写明「待批准的支持获批后会化解（或只化解一部分）；目前尚未生效」；
 *      cost / time 按 pending 的金额 / 小时与缺口比较决定是「化解」还是「一部分」。
 *    - 没有 pending 时：建议可向主办方询问的支持类型（时间支持 / 费用减免 / 线上参与或交通支持 / 借用设备），
 *      明说不保证主办方提供。
 *    - 已过截止日期（time 且 shortfall 为 null）：improvable: false、action: null，detail 提示看替代机会。
 * 4. missing_info 每个字段一条 unknown_info（basis.field 保留内部字段名）：profile.* → 「在 Skill Passport 填写 <可读名称>」；
 *    opportunity.* → 「向主办方确认 <可读名称>」并说明影响哪一项判断；options.today → 说明页面没有传日期。
 *    可读名称与影响项见 FIELD_INFO，未知字段用最后一段字段名兜底；面向学生的文字不出现内部字段名。
 * 5. 引擎因数据不完整抛错时：逐字段诊断（机会的 requirements / cost / location / time_commitment，档案里类型不对的字段，
 *    以及单独读不了的某条官方要求），每个一条 unknown_info；诊断不出来时退回一条笼统的 `opportunity`。
 *    此时 eligibility_overall = 'unknown'、reachable = null。
 * 6. 排序与 id：items 按 GAP_CATEGORIES 分组，组内按上述原顺序；id = `<category>:<依据 id>`
 *    （设备障碍为 `time_and_cost:device:<设备>`），重复时依次加 `#2`、`#3`，结果内唯一且稳定。
 * 7. summary：一两句英文——总条数与各类条数、当前不可改变的限制（列出标签）、还需补填 / 确认的未知信息条数、
 *    已被生效支持化解的障碍条数、可达时注明「可达 ≠ 录取」。不出现分数，不暗示录取。
 *
 * 公平性：不读取学校名、显示名。纯函数：日期只来自 options.today，不读系统时钟、无随机、无 IO、不调 AI。
 * 任何输入都不抛异常；不修改输入。
 */
import { analyzeReachability } from '../reachability';
import { checkEligibility, EVIDENCE_KIND_ZH } from '../eligibility';
import { compareYMD, parseISODate, wholeYearsBetween } from '../eligibility/dates';
import { fmt, joinAnd, plural, pluralNoun } from '../format';
import {
  BARRIER_TYPES,
  GAP_CATEGORIES,
  type Barrier,
  type BarrierType,
  type EligibilityItem,
  type EvalOptions,
  type EvidenceKind,
  type GapAnalysis,
  type GapBasis,
  type GapCategory,
  type GapItem,
  type MaterialKind,
  type Opportunity,
  type PrepItem,
  type ReachabilityResult,
  type Requirement,
  type ResourceGrant,
  type SkillLevel,
  type StudentProfile,
} from '../types';
import { asArray, safeOpportunity, safeProfile } from './inputs';

// ───────────────────────────── 字段 → 可读名称 ─────────────────────────────

interface FieldInfo {
  /** 面向学生的名称（用在句子中间）。 */
  label: string;
  /** 缺了它会影响哪一项判断。 */
  affects: string;
}

/** missing_info / 诊断字段 → 可读名称与影响项。未列出的字段由 fieldInfo() 兜底。 */
const FIELD_INFO: Record<string, FieldInfo> = {
  'profile.devices': { label: 'which devices you have', affects: 'the device check' },
  'profile.budget_usd': { label: 'how much you can pay yourself', affects: 'the cost check' },
  'profile.transport': { label: 'your transportation', affects: 'the transportation check' },
  'profile.hours_per_week_available': { label: 'how many hours you have each week', affects: 'the time check' },
  'profile.skills': { label: 'your skills', affects: 'the skill requirements check' },
  'profile.statuses': { label: 'your status (for example high school student)', affects: 'the status requirements check' },
  'profile.citizenships': { label: 'your citizenship / legal residency', affects: 'the citizenship requirements check' },
  'profile.region': { label: 'where you live', affects: 'the location requirements check' },
  'opportunity.cost.fee_usd': { label: 'the official fee', affects: 'the cost check (whether it fits your budget)' },
  'opportunity.cost.requires_travel_expense': {
    label: 'whether participants must pay for their own travel',
    affects: 'the transportation check',
  },
  'opportunity.time_commitment.hours_per_week': {
    label: 'how many hours per week the program needs',
    affects: 'the weekly time check',
  },
  'opportunity.deadline': { label: 'the deadline (the date given cannot be read)', affects: 'the deadline and prep-time check' },
  'opportunity.requirements': { label: 'the list of official requirements', affects: 'the eligibility check' },
  'opportunity.cost': { label: 'the cost details', affects: 'the cost check' },
  'opportunity.location': { label: 'where it takes place (in person or online)', affects: 'the transportation check' },
  'opportunity.time_commitment': { label: 'the time commitment', affects: 'the time check' },
  'options.today': { label: "today's date", affects: 'the deadline and prep-time check' },
};

/** 兜底：取最后一段字段名，下划线换成空格（不露出 `profile.` 之类的前缀）。 */
function fieldInfo(field: string): FieldInfo {
  const known = FIELD_INFO[field];
  if (known) return known;
  const last = field.split('.').filter((s) => s !== '').pop() ?? '';
  const readable = last.replace(/_/g, ' ').trim();
  return {
    label: readable === '' ? 'some details' : `the "${readable}" information`,
    affects: 'whether this is realistic for you',
  };
}

const MATERIAL_LABEL: Record<MaterialKind, string> = {
  resume: 'your resume',
  transcript: 'your transcript',
  personal_statement: 'your personal statement',
  recommendation_letter: 'a recommendation letter',
  portfolio: 'your portfolio',
  essay: 'an essay',
  other: 'an application material',
};

const DEVICE_LABEL: Record<string, string> = {
  laptop: 'a laptop',
  desktop: 'a desktop computer',
  smartphone: 'a smartphone',
  tablet: 'a tablet',
  webcam: 'a webcam',
  home_internet: 'reliable home internet',
};

const BARRIER_TITLE: Record<BarrierType, string> = {
  time: 'Time',
  cost: 'Cost',
  transport: 'Transportation',
  device: 'Device',
};

const CATEGORY_LABEL: Record<GapCategory, string> = {
  knowledge_or_experience: 'knowledge or experience',
  materials: 'materials',
  time_and_cost: 'time and cost',
  unchangeable_eligibility: 'current eligibility limits',
  unknown_info: 'unknown info',
};

const SKILL_LEVEL_LABEL: Record<SkillLevel, string> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
};

// ───────────────────────────── 小工具 ─────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function norm(s: unknown): string {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

/** 有限数 → max(0, n)；否则 null。 */
function estimate(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : null;
}

function evidenceKindLabel(kind: EvidenceKind | null | undefined): string | null {
  if (kind == null) return null;
  return EVIDENCE_KIND_ZH[kind] ?? String(kind);
}

function effortText(prep: PrepItem): string {
  const h = estimate(prep.estimated_hours);
  const c = estimate(prep.estimated_cost_usd);
  const hours = h == null ? 'time not estimated' : `about ${plural(h, 'hour')}`;
  const cost = c == null ? 'cost not estimated' : c > 0 ? `about $${fmt(c)}` : 'no cost';
  return `${hours}, ${cost}`;
}

function emptyGroups(): Record<GapCategory, GapItem[]> {
  return {
    knowledge_or_experience: [],
    materials: [],
    time_and_cost: [],
    unchangeable_eligibility: [],
    unknown_info: [],
  };
}

function emptyCounts(): Record<GapCategory, number> {
  return {
    knowledge_or_experience: 0,
    materials: 0,
    time_and_cost: 0,
    unchangeable_eligibility: 0,
    unknown_info: 0,
  };
}

function item(
  category: GapCategory,
  idPart: string,
  title: string,
  detail: string,
  basis: GapBasis,
  action: string | null,
  estimated_hours: number | null = null,
  estimated_cost_usd: number | null = null,
): GapItem {
  return {
    id: `${category}:${idPart}`,
    category,
    title,
    detail,
    basis,
    improvable: action !== null,
    action,
    estimated_hours,
    estimated_cost_usd,
  };
}

// ───────────────────────────── 资格项 ─────────────────────────────

function hardnessText(i: EligibilityItem): string {
  return i.hard
    ? "This is a hard requirement: you can't apply until it is met."
    : 'This is a bonus item; it does not affect eligibility.';
}

/** age 要求在参考日当天可能的年龄（与 checkEligibility 的 judgeAge 同一算法）。 */
function ageCandidates(age: number, rule: { as_of?: string }, opp: Opportunity, options?: EvalOptions): number[] {
  const ref = parseISODate(rule.as_of ?? opp.deadline ?? null);
  const today = parseISODate(options?.today);
  if (ref == null || today == null) return [age];
  const cmp = compareYMD(ref, today);
  if (cmp === 0) return [age];
  if (cmp < 0) {
    const { years, exact } = wholeYearsBetween(ref, today);
    return exact ? [age - years] : [age - years - 1, age - years];
  }
  const { years, exact } = wholeYearsBetween(today, ref);
  return exact ? [age + years] : [age + years, age + years + 1];
}

/** grade / age 不满足时，是否「低于下限」（以后可能满足）。 */
function belowMinimum(req: Requirement, p: StudentProfile, o: Opportunity, options?: EvalOptions): boolean {
  if (req.type === 'grade') {
    return typeof req.min === 'number' && typeof p.grade === 'number' && p.grade < req.min;
  }
  if (req.type === 'age') {
    if (typeof req.min !== 'number' || typeof p.age !== 'number') return false;
    const min = req.min;
    return ageCandidates(p.age, req, o, options).every((a) => a < min);
  }
  return false;
}

/** 能补上该技能要求的、尚未覆盖的第一个准备项。 */
function prepForSkill(skill: string, preps: PrepItem[], uncovered: Set<string>): PrepItem | null {
  return preps.find((x) => uncovered.has(x.id) && norm(x.skill) !== '' && norm(x.skill) === norm(skill)) ?? null;
}

/** 能产出该作品要求所需证据的、尚未覆盖的第一个准备项。 */
function prepForPortfolio(
  rule: { evidence_kind?: EvidenceKind; skill?: string },
  preps: PrepItem[],
  uncovered: Set<string>,
): PrepItem | null {
  return (
    preps.find((x) => {
      if (!uncovered.has(x.id)) return false;
      if (rule.skill && norm(x.skill) !== norm(rule.skill)) return false;
      if (rule.evidence_kind) {
        return x.evidence_kind === rule.evidence_kind || (rule.evidence_kind === 'portfolio' && x.material_kind === 'portfolio');
      }
      return x.evidence_kind != null || x.material_kind === 'portfolio';
    }) ?? null
  );
}

function skillAction(rule: { skill: string; min_level?: SkillLevel }, target: PrepItem | null): string {
  const level = rule.min_level ?? 'beginner';
  const levelText = SKILL_LEVEL_LABEL[level] ?? String(level);
  const record =
    level === 'beginner'
      ? `update "${rule.skill}" in the skills section of your Skill Passport, or add evidence that shows it`
      : `update "${rule.skill}" to ${levelText} in the skills section of your Skill Passport (for this level, evidence alone does not count)`;
  if (target) {
    return `Start with the prep item "${target.title}" (${effortText(target)}); it builds "${rule.skill}". When you reach ${levelText} level, ${record}.`;
  }
  return `This opportunity's prep list has no item for "${rule.skill}". You need to show "${rule.skill}" at ${levelText} level or above: if you already have it, ${record}; if not, you would need to build this skill first.`;
}

function portfolioAction(rule: { evidence_kind?: EvidenceKind; skill?: string }, target: PrepItem | null): string {
  const kind = evidenceKindLabel(rule.evidence_kind ?? null);
  const entry = kind ? `a "${kind}" evidence entry` : 'an evidence entry';
  const showing = rule.skill ? ` that shows "${rule.skill}"` : '';
  if (target) {
    return `Work on the prep item "${target.title}" (${effortText(target)}); it can produce this kind of work. When it is done, add it in your Skill Passport as ${entry}${showing}.`;
  }
  const what = [kind ? `type: ${kind}` : null, rule.skill ? `showing "${rule.skill}"` : null].filter(Boolean).join(', ');
  return `This opportunity's prep list has no item that produces this. You need work that matches it${what ? ` (${what})` : ''}. If you already have such work, add it in your Skill Passport as ${entry}${showing}.`;
}

function requirementItems(
  r: ReachabilityResult,
  p: StudentProfile,
  o: Opportunity,
  uncovered: Set<string>,
  groups: Record<GapCategory, GapItem[]>,
  options?: EvalOptions,
): void {
  const reqs = asArray<Requirement>(o.requirements);
  r.eligibility.items.forEach((ei, index) => {
    const req = reqs[index];
    const basis: GapBasis = { kind: 'requirement', requirement_id: ei.requirement_id, source_text: ei.source_text };
    const official = `Official text: "${ei.source_text}".`;
    if (ei.status === 'not_satisfied') {
      if (req?.type === 'prerequisite_skill') {
        groups.knowledge_or_experience.push(
          item(
            'knowledge_or_experience',
            ei.requirement_id,
            `Skill not shown yet: ${ei.label}`,
            `${ei.explanation} ${hardnessText(ei)} ${official}`,
            basis,
            skillAction(req, prepForSkill(req.skill, o.preparation, uncovered)),
          ),
        );
      } else if (req?.type === 'portfolio') {
        groups.materials.push(
          item(
            'materials',
            ei.requirement_id,
            `Missing work sample: ${ei.label}`,
            `${ei.explanation} ${hardnessText(ei)} ${official}`,
            basis,
            portfolioAction(req, prepForPortfolio(req, o.preparation, uncovered)),
          ),
        );
      } else if (ei.hard) {
        let detail = `${ei.explanation} ${official}`;
        if (req && belowMinimum(req, p, o, options)) {
          const grows = req.type === 'grade' ? 'as you move up a grade' : 'as you get older';
          detail = `${ei.explanation} This one is not met right now. It may be met later ${grows}; if so, check the official requirements again at that time, since they can change. ${official}`;
        }
        groups.unchangeable_eligibility.push(
          item('unchangeable_eligibility', ei.requirement_id, `Does not meet: ${ei.label}`, detail, basis, null),
        );
      }
      // 偏好（非硬性）的 grade / age / region / citizenship / status 不满足：不影响资格，也无法靠行动改变 → 不列。
    } else if (ei.status === 'unknown') {
      groups.unknown_info.push(
        item(
          'unknown_info',
          ei.requirement_id,
          `Not sure yet: ${ei.label}`,
          `${ei.explanation} ${ei.hard ? 'This is a hard requirement, so it matters for eligibility.' : 'This is a bonus item; it does not affect eligibility.'} ${official}`,
          basis,
          ei.confirm_with_official ?? `Confirm with the organizer, using the official text: "${ei.source_text}".`,
        ),
      );
    }
  });
}

// ───────────────────────────── 准备差距 ─────────────────────────────

function prepItems(r: ReachabilityResult, o: Opportunity, uncovered: Set<string>, groups: Record<GapCategory, GapItem[]>): void {
  for (const gap of r.readiness_gaps) {
    const prep = o.preparation.find((x) => x.id === gap.prep_item_id);
    if (!prep) continue;
    const material = prep.material_kind ?? null;
    const category: GapCategory = material != null ? 'materials' : 'knowledge_or_experience';
    const need = gap.required_for_application ? 'Required to apply.' : 'Recommended, not required.';

    const titles = new Map(o.preparation.map((x) => [x.id, x.title] as const));
    const firstDeps = prep.depends_on
      .filter((d, i, arr) => d !== prep.id && arr.indexOf(d) === i && uncovered.has(d) && titles.has(d))
      .map((d) => `"${titles.get(d)}"`);
    const depText =
      firstDeps.length > 0
        ? `Do ${joinAnd(firstDeps)} first: this item depends on ${pluralNoun(firstDeps.length, 'it', 'them')}, and ${pluralNoun(firstDeps.length, 'it is', 'they are')} not done yet. `
        : '';
    const what = material != null ? ` This produces ${MATERIAL_LABEL[material] ?? 'an application material'}.` : prep.skill ? ` It builds "${prep.skill}".` : '';
    const kind = evidenceKindLabel(prep.evidence_kind ?? null);
    const record = kind
      ? `add a "${kind}" evidence entry in your Skill Passport and link it to "${prep.title}"`
      : `add an evidence entry in your Skill Passport and link it to "${prep.title}"`;

    groups[category].push(
      item(
        category,
        gap.prep_item_id,
        `Not done yet: ${gap.title}`,
        `${gap.reason} ${need}`,
        { kind: 'prep_item', prep_item_id: gap.prep_item_id, source_text: prep.source_text ?? null },
        `${depText}Do "${prep.title}" (${effortText(prep)}).${what} When it is done, ${record}.`,
        estimate(prep.estimated_hours),
        estimate(prep.estimated_cost_usd),
      ),
    );
  }
}

// ───────────────────────────── 障碍 ─────────────────────────────

/** 已过截止日期的 time 障碍：analyzeReachability 只在这种情况下给 shortfall 为 null 的 time 障碍。 */
function isDeadlinePassed(b: Barrier): boolean {
  return b.type === 'time' && b.shortfall == null;
}

function finiteShortfall(b: Barrier): number | null {
  return typeof b.shortfall === 'number' && Number.isFinite(b.shortfall) ? b.shortfall : null;
}

/** pending 的支持是否足以完全化解该障碍（cost / time 按金额 / 小时比较，其余类型一条就够）。 */
function pendingFullyResolves(b: Barrier, pending: ResourceGrant[], o: Opportunity): boolean {
  const gap = finiteShortfall(b);
  if (b.type === 'cost' && gap != null) {
    const fee = typeof o.cost?.fee_usd === 'number' ? o.cost.fee_usd : 0;
    const amount =
      pending.reduce((s, g) => s + (typeof g.amount_usd === 'number' ? g.amount_usd : 0), 0) +
      (pending.some((g) => g.amount_usd == null) ? fee : 0);
    return amount >= gap;
  }
  if (b.type === 'time' && gap != null) {
    return pending.reduce((s, g) => s + (typeof g.hours_per_week === 'number' ? g.hours_per_week : 0), 0) >= gap;
  }
  return true;
}

function askText(b: Barrier, device: string | null): string {
  const gap = finiteShortfall(b);
  switch (b.type) {
    case 'time':
      return `You could free up about ${fmt(gap ?? 0)} more ${pluralNoun(gap ?? 0, 'hour')} per week, or ask the organizer whether any time support exists (for example a lighter schedule or paid prep time). They may not offer it.`;
    case 'cost':
      return `You could ask the organizer whether a fee waiver or financial aid is available to cover the $${fmt(gap ?? 0)} you are short. They may not offer it.`;
    case 'transport':
      return 'You could ask the organizer whether there is an online option, a nearer site or travel support. They may not offer it.';
    case 'device':
      return `You could ask the organizer, your school or a local library whether you can borrow ${device ? (DEVICE_LABEL[device] ?? device) : 'the device'}. They may not have one to lend.`;
  }
}

function barrierItems(
  r: ReachabilityResult,
  p: StudentProfile,
  o: Opportunity,
  grants: ResourceGrant[],
  groups: Record<GapCategory, GapItem[]>,
): void {
  // 设备障碍与「档案里没有的必需设备」一一对应（analyzeReachability 按 required_devices 顺序生成）。
  const have = Array.isArray(p.devices) ? p.devices : [];
  const missingDevices = o.required_devices.filter((d) => !have.includes(d));
  const deviceBarriers = r.barriers.filter((b) => b.type === 'device');

  for (const type of BARRIER_TYPES) {
    r.barriers.forEach((b) => {
      if (b.type !== type || b.resolved) return;
      const device = type === 'device' ? (missingDevices[deviceBarriers.indexOf(b)] ?? null) : null;
      const idPart = device ? `device:${device}` : type;
      const basis: GapBasis = { kind: 'barrier', barrier_type: type };

      if (isDeadlinePassed(b)) {
        groups.time_and_cost.push(
          item(
            'time_and_cost',
            idPart,
            'Deadline has passed',
            `${b.description} You can look at the alternatives for this opportunity: its next round (if it repeats) or similar opportunities in the same field.`,
            basis,
            null,
          ),
        );
        return;
      }

      const gap = finiteShortfall(b);
      let title = `${BARRIER_TITLE[type]} barrier`;
      if (type === 'time' && gap != null) title = `Time: short ${plural(gap, 'hour')} per week`;
      if (type === 'cost' && gap != null) title = `Cost: short $${fmt(gap)}`;
      if (type === 'device' && device) title = `Device: needs ${DEVICE_LABEL[device] ?? device}`;

      const pendingIds = b.pending_grant_ids ?? [];
      const pending = grants.filter((g) => pendingIds.includes(g.id));
      let action: string;
      if (pendingIds.length > 0) {
        const n = pendingIds.length;
        const what = n === 1 ? 'There is a pending support request' : `There are ${n} pending support requests`;
        const effect = pendingFullyResolves(b, pending, o)
          ? `once approved, this barrier would be resolved`
          : `once approved, ${pluralNoun(n, 'it', 'they')} would cover only part of the gap`;
        action = `${what}; ${effect}. ${pluralNoun(n, 'It is', 'They are')} not in effect yet (pending is not approved). You can check its status with the organizer.`;
      } else {
        action = askText(b, device);
      }

      groups.time_and_cost.push(
        item(
          'time_and_cost',
          idPart,
          title,
          b.description,
          basis,
          action,
          type === 'time' ? gap : null,
          type === 'cost' ? gap : null,
        ),
      );
    });
  }
}

// ───────────────────────────── 缺失字段 ─────────────────────────────

function missingFieldItem(field: string): GapItem {
  const basis: GapBasis = { kind: 'missing_field', field };
  const { label, affects } = fieldInfo(field);
  if (field === 'options.today') {
    return item(
      'unknown_info',
      field,
      "Today's date was not provided",
      "The page did not pass today's date, so we could not check whether the deadline has passed or how much prep time is left. We did not guess.",
      basis,
      'Reload the page so it can pass today\'s date. If this stays, check the deadline on the official page yourself.',
    );
  }
  if (field.startsWith('profile.')) {
    return item(
      'unknown_info',
      field,
      `Missing in your profile: ${label}`,
      `Your profile does not say ${label}, so we could not finish ${affects}. We did not guess.`,
      basis,
      `Fill in ${label} in your Skill Passport.`,
    );
  }
  return item(
    'unknown_info',
    field,
    `Not clear from the organizer: ${label}`,
    `The opportunity information does not say ${label}, so we could not finish ${affects}. We did not guess.`,
    basis,
    `Confirm ${label} with the organizer or on the official page; it affects ${affects}.`,
  );
}

// ───────────────────────────── 数据不完整时的逐字段诊断 ─────────────────────────────

function diagnose(p: StudentProfile, o: Opportunity, options?: EvalOptions): GapItem[] {
  const out: GapItem[] = [];
  const raw = o as unknown as Record<string, unknown>;
  const rawP = p as unknown as Record<string, unknown>;

  for (const key of ['requirements'] as const) {
    if (!Array.isArray(raw[key])) out.push(missingFieldItem(`opportunity.${key}`));
  }
  for (const key of ['cost', 'location', 'time_commitment'] as const) {
    if (!isObject(raw[key])) out.push(missingFieldItem(`opportunity.${key}`));
  }

  const profileIssues: string[] = [];
  for (const key of ['skills', 'devices', 'statuses', 'citizenships']) {
    if (rawP[key] != null && !Array.isArray(rawP[key])) profileIssues.push(`profile.${key}`);
  }
  for (const key of ['region', 'transport']) {
    if (rawP[key] != null && !isObject(rawP[key])) profileIssues.push(`profile.${key}`);
  }
  for (const f of profileIssues) {
    const it = missingFieldItem(f);
    out.push({ ...it, title: `Unclear in your profile: ${fieldInfo(f).label}`, detail: `Your profile has ${fieldInfo(f).label} in a form we can't read, so we could not finish ${fieldInfo(f).affects}. We did not guess.`, action: `Check and fill in ${fieldInfo(f).label} again in your Skill Passport.` });
  }

  // 单独读不了的官方要求（只在档案本身没问题时逐条试，否则无法区分是谁的问题）。
  if (Array.isArray(raw.requirements) && profileIssues.length === 0) {
    (raw.requirements as unknown[]).forEach((req, index) => {
      let ok = isObject(req);
      if (ok) {
        try {
          checkEligibility(p, { ...o, requirements: [req as unknown as Requirement] }, options);
        } catch {
          ok = false;
        }
      }
      if (ok) return;
      const rec = isObject(req) ? req : {};
      const id = typeof rec.id === 'string' && rec.id !== '' ? rec.id : `#${index + 1}`;
      const name = typeof rec.label === 'string' && rec.label !== '' ? `"${rec.label}"` : `number ${index + 1}`;
      const source = typeof rec.source_text === 'string' && rec.source_text !== '' ? ` Official text: "${rec.source_text}".` : '';
      out.push(
        item(
          'unknown_info',
          `opportunity.requirements.${id}`,
          `Official requirement could not be read: ${name}`,
          `The data for official requirement ${name} is incomplete, so we could not check it and did not guess.${source}`,
          { kind: 'missing_field', field: `opportunity.requirements.${id}` },
          `Check this requirement on the official page or confirm it with the organizer.`,
        ),
      );
    });
  }

  if (out.length === 0) {
    out.push(
      item(
        'unknown_info',
        'opportunity',
        'Opportunity data is incomplete',
        'Some details this check needs are missing from the opportunity data, so we could not analyze gaps and did not guess.',
        { kind: 'missing_field', field: 'opportunity' },
        'Check the official page or ask the organizer for the full requirements.',
      ),
    );
  }
  return out;
}

// ───────────────────────────── 汇总 ─────────────────────────────

/** 保证 id 在结果内唯一且稳定：重复时依次加 `#2`、`#3`。 */
function uniqueIds(items: GapItem[]): GapItem[] {
  const seen = new Map<string, number>();
  return items.map((it) => {
    const n = (seen.get(it.id) ?? 0) + 1;
    seen.set(it.id, n);
    return n === 1 ? it : { ...it, id: `${it.id}#${n}` };
  });
}

function countOf(items: GapItem[]): Record<GapCategory, number> {
  const counts = emptyCounts();
  for (const i of items) counts[i.category] += 1;
  return counts;
}

function summarize(
  counts: Record<GapCategory, number>,
  items: GapItem[],
  reachable: boolean | null,
  resolvedBarriers: number,
): string {
  const total = items.length;
  const first =
    total === 0
      ? 'No gaps found from the info we have.'
      : `${plural(total, 'gap')} found: ${GAP_CATEGORIES.filter((c) => counts[c] > 0)
          .map((c) => `${counts[c]} in ${CATEGORY_LABEL[c]}`)
          .join(', ')}.`;

  const clauses: string[] = [];
  const blockers = items.filter((i) => i.category === 'unchangeable_eligibility');
  if (blockers.length > 0) {
    const names = blockers.map((b) => `"${b.title.replace(/^Does not meet: /, '')}"`);
    clauses.push(`you don't meet ${joinAnd(names)} right now, so you can't apply this round`);
  }
  if (counts.unknown_info > 0) {
    clauses.push(`${plural(counts.unknown_info, 'item')} still ${pluralNoun(counts.unknown_info, 'needs', 'need')} info filled in or confirmed`);
  }
  if (resolvedBarriers > 0) {
    clauses.push(`${plural(resolvedBarriers, 'barrier')} ${pluralNoun(resolvedBarriers, 'is', 'are')} already resolved by approved support`);
  }
  if (reachable === true) clauses.push('based on current info this is reachable, which does not mean admitted');
  else if (reachable === false && blockers.length === 0) clauses.push('right now this is not reachable');
  else if (reachable === null) clauses.push("we can't tell yet whether this is reachable");

  if (clauses.length === 0) return first;
  const second = clauses.join('; ');
  return `${first} ${second.charAt(0).toUpperCase()}${second.slice(1)}.`;
}

export function analyzeGaps(
  profile: StudentProfile,
  opp: Opportunity,
  grants: ResourceGrant[],
  options?: EvalOptions,
): GapAnalysis {
  const p = safeProfile(profile);
  const o = safeOpportunity(opp);
  const g = asArray<unknown>(grants).filter(isObject) as unknown as ResourceGrant[];
  const opts: EvalOptions | undefined = isObject(options) ? (options as EvalOptions) : undefined;

  let r: ReachabilityResult;
  try {
    r = analyzeReachability(p, o, g, opts);
  } catch {
    // 机会 / 档案数据不完整：不猜，逐字段列出缺什么。
    let items: GapItem[];
    try {
      items = uniqueIds(diagnose(p, o, opts));
    } catch {
      items = [];
    }
    if (items.length === 0) {
      items = [
        item(
          'unknown_info',
          'opportunity',
          'Opportunity data is incomplete',
          'Some details this check needs are missing, so we could not analyze gaps and did not guess.',
          { kind: 'missing_field', field: 'opportunity' },
          'Check the official page or ask the organizer for the full requirements.',
        ),
      ];
    }
    return {
      profile_id: p.id,
      opportunity_id: o.id,
      items,
      counts: countOf(items),
      eligibility_overall: 'unknown',
      reachable: null,
      summary: `We couldn't fully analyze this opportunity because some information is incomplete (${plural(items.length, 'item')} listed). Check the official page.`,
    };
  }

  const uncovered = new Set(r.readiness_gaps.map((x) => x.prep_item_id));
  const groups = emptyGroups();
  requirementItems(r, p, o, uncovered, groups, opts);
  prepItems(r, o, uncovered, groups);
  barrierItems(r, p, o, g, groups);
  for (const field of r.missing_info) groups.unknown_info.push(missingFieldItem(field));

  const items = uniqueIds(GAP_CATEGORIES.flatMap((c) => groups[c]));
  const counts = countOf(items);
  const resolvedBarriers = r.barriers.filter((b) => b.resolved).length;
  return {
    profile_id: p.id,
    opportunity_id: o.id,
    items,
    counts,
    eligibility_overall: r.eligibility.overall,
    reachable: r.reachable,
    summary: summarize(counts, items, r.reachable, resolvedBarriers),
  };
}
