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
 *      「低于下限」用 lib/requirement-timing.ts 的 belowMinimumLater（与 findAlternatives 共用）：在参考日确定低于 min，
 *      且 max 缺省或 max ≥ min；age 按参考日（as_of ?? deadline）当天可能的年龄判断（与 checkEligibility 同一算法）。
 *    - 偏好（hard: false）且 not_satisfied 的 grade / age / region / citizenship / status：刻意不列——
 *      不影响资格，学生也无法通过行动改变，列出来只会制造焦虑。
 *    - status 为 unknown（硬性与偏好都列，含 manual）→ unknown_info，带官网原文，行动为 confirm_with_official。
 * 2. 准备差距 r.readiness_gaps（按 opp.preparation 顺序）：有 material_kind → materials，否则 → knowledge_or_experience。
 *    行动写出这个准备项要做什么、估计小时与费用、完成后记录哪种证据（evidence_kind）并关联到这个准备项；
 *    前置依赖也未覆盖时，点明先做哪几个；与本项成环的依赖（对方也直接或间接依赖本项）不提示先后，
 *    改为一句中性说明（机会数据里互相依赖，顺序请按官网或向主办方确认）。estimated_* 取准备项的估计（负数按 0，非有限数为 null）。
 * 3. 障碍：只列未被 approved grant 化解的（resolved: false），按 BARRIER_TYPES 顺序，同类保持原顺序；
 *    已化解的不列，只在 summary 里说有几条已被生效的支持化解。
 *    - time（有 shortfall）：estimated_hours = 每周缺口小时；cost：estimated_cost_usd = 缺口美元；其他为 null。
 *      官方费用未知（fee_usd 为 null）时 cost 的数字 = 缺口 − 已批准且有金额的减免（与引擎 description 的「至少还差」
 *      同一口径），标题、行动、estimated_cost_usd 都用这个数并写成 at least $X。
 *    - 有 pending grant 时：把该障碍 pending_grant_ids 里的 pending grant 当作 approved 再调用一次 analyzeReachability，
 *      按「同类型 + 同设备 + 同类内序号」找到同一条障碍：变为 resolved → 「获批后会化解」；
 *      仍未化解但剩余缺口（缺口 − 已生效支持可抵的量，算法同引擎）变小 → 「只能化解一部分」并写出剩余数值；
 *      剩余缺口不变 → 「获批也不会减少这个缺口」并说明原因、给出无 pending 时的建议；
 *      官方费用未知且获批后那条 cost 障碍不再出现 → 「能抵掉可算出的缺口，但官方费用不清楚，总额可能仍超出」。
 *      任何情况下都注明 pending 的支持目前尚未生效。
 *    - 没有 pending 时：建议可向主办方询问的支持类型（时间支持 / 费用减免 / 线上参与或交通支持 / 借用设备），
 *      明说不保证主办方提供。
 *    - 已过截止日期（time 且 shortfall 为 null）：improvable: false、action: null，detail = 引擎描述 + 一句指向替代机会
 *      （不重复「下一届」；recurring_annually === false 时说明不是每年举办、看同领域机会）。
 * 4. missing_info 每个字段一条 unknown_info（basis.field 保留内部字段名）：profile.* → 「在 Skill Passport 填写 <可读名称>」；
 *    opportunity.* → 「向主办方确认 <可读名称>」并说明影响哪一项判断（opportunity.deadline.closing_time：截止当天，
 *    行动是到官网 / 向主办方确认截止的具体时刻和时区）；options.today → 没传时说明页面没有传日期，
 *    传了但读不了时说「缺失或无法读取」。
 *    可读名称与影响项见 FIELD_INFO，未知字段用最后一段字段名兜底；面向学生的文字不出现内部字段名。
 * 5. 档案数据损坏（有值但类型不对，见 profileFieldIssues）时不调用引擎，直接列出这些档案字段（行动：在 Skill Passport 更正），
 *    同时列出机会结构问题，不逐条重试官方要求（不归咎于机会数据）。
 *    档案没问题但引擎因数据不完整抛错时：逐字段诊断（机会的 requirements / cost / location / time_commitment，
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
import { fmt, joinAnd, plural, pluralNoun } from '../format';
import { belowMinimumLater } from '../requirement-timing';
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
  'profile.grade': { label: 'your grade', affects: 'the grade requirements check' },
  'profile.age': { label: 'your age', affects: 'the age requirements check' },
  'profile.evidence': { label: 'your evidence entries', affects: 'the prep and skill checks' },
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
  'opportunity.location': { label: 'where exactly it takes place', affects: 'the transportation check' },
  'opportunity.location.format': { label: 'whether it takes place online or in person', affects: 'the transportation check' },
  'opportunity.time_commitment': { label: 'the time commitment', affects: 'the time check' },
  'options.today': { label: "today's date", affects: 'the deadline and prep-time check' },
  'opportunity.deadline.closing_time': {
    label: 'the exact closing time and time zone on the deadline day',
    affects: 'whether there is still time to apply today',
  },
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
        if (req && belowMinimumLater(req, p, o, options)) {
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

/** 准备项依赖图里，从 from 沿 depends_on 能否走到 target（重复 id 取第一项；有环也不会死循环）。 */
function dependsTransitively(from: string, target: string, deps: Map<string, string[]>): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const d of deps.get(cur) ?? []) {
      if (d === target) return true;
      if (!seen.has(d)) stack.push(d);
    }
  }
  return false;
}

function prepItems(r: ReachabilityResult, o: Opportunity, uncovered: Set<string>, groups: Record<GapCategory, GapItem[]>): void {
  const titles = new Map<string, string>();
  const deps = new Map<string, string[]>();
  for (const x of o.preparation) {
    if (!titles.has(x.id)) titles.set(x.id, x.title);
    if (!deps.has(x.id)) deps.set(x.id, x.depends_on);
  }
  for (const gap of r.readiness_gaps) {
    const prep = o.preparation.find((x) => x.id === gap.prep_item_id);
    if (!prep) continue;
    const material = prep.material_kind ?? null;
    const category: GapCategory = material != null ? 'materials' : 'knowledge_or_experience';
    const need = gap.required_for_application ? 'Required to apply.' : 'Recommended, not required.';

    // 未完成的前置依赖：与本项成环的（对方也直接或间接依赖本项）不提示先后，只给一句中性说明。
    const pending = prep.depends_on.filter(
      (d, i, arr) => d !== prep.id && arr.indexOf(d) === i && uncovered.has(d) && titles.has(d),
    );
    const cyclic = pending.filter((d) => dependsTransitively(d, prep.id, deps));
    const firstDeps = pending.filter((d) => !cyclic.includes(d)).map((d) => `"${titles.get(d)}"`);
    const cycleNames = cyclic.map((d) => `"${titles.get(d)}"`);
    let depText =
      firstDeps.length > 0
        ? `Do ${joinAnd(firstDeps)} first: this item depends on ${pluralNoun(firstDeps.length, 'it', 'them')}, and ${pluralNoun(firstDeps.length, 'it is', 'they are')} not done yet. `
        : '';
    if (cycleNames.length > 0) {
      depText += `In the opportunity data, this item and ${joinAnd(cycleNames)} depend on each other, so the order is not clear; follow the official page or ask the organizer which to do first. `;
    }
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

/** 与 analyzeReachability 第 3 条相同的「对本学生、本机会生效」规则（opportunity_id 必须 === null 或等于机会 id）。 */
function appliesTo(g: ResourceGrant, p: StudentProfile, o: Opportunity): boolean {
  return g.student_id === p.id && (g.opportunity_id === null || g.opportunity_id === o.id);
}

function feeUnknown(o: Opportunity): boolean {
  return o.cost?.fee_usd == null;
}

/**
 * 一组 grants 中已生效（approved 且对本学生本机会生效）的支持，对 cost / time 障碍可抵的量——与 analyzeReachability 同一算法：
 * cost：有金额的 fee_waiver 之和 + （存在金额为 null 的 waiver ? fee_usd : 0）；官方费用未知时只算有金额的之和。
 * time：time_support 的 hours_per_week 之和。其他类型返回 null（不按数量计）。
 */
function coverage(type: BarrierType, grants: ResourceGrant[], p: StudentProfile, o: Opportunity): number | null {
  const approved = grants.filter((g) => g.status === 'approved' && appliesTo(g, p, o));
  if (type === 'cost') {
    const waivers = approved.filter((g) => g.type === 'fee_waiver');
    const known = waivers.reduce((s, g) => s + (typeof g.amount_usd === 'number' ? g.amount_usd : 0), 0);
    const fee = o.cost?.fee_usd;
    if (typeof fee !== 'number') return known;
    return known + (waivers.some((g) => g.amount_usd == null) ? fee : 0);
  }
  if (type === 'time') {
    return approved
      .filter((g) => g.type === 'time_support')
      .reduce((s, g) => s + (typeof g.hours_per_week === 'number' ? g.hours_per_week : 0), 0);
  }
  return null;
}

/**
 * 给每条障碍一个稳定的对应键：同类型 + 同设备（device）+ 同类内序号。
 * 障碍的结构（有哪几条、什么顺序）与 grants 无关——grants 只改变 resolved 等字段；唯一例外是官方费用未知时的 cost 障碍，
 * 有金额的已批准减免足够时那条障碍不出现（见 pendingOutcome）。
 */
function barrierKeys(barriers: Barrier[], devices: (string | null)[]): string[] {
  const seen = new Map<string, number>();
  let deviceIdx = 0;
  return barriers.map((b) => {
    const device = b.type === 'device' ? (devices[deviceIdx++] ?? null) : null;
    const base = `${b.type}:${device ?? ''}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

/**
 * 学生缺的必需设备，与 analyzeReachability 生成设备障碍的方式一致：按 required_devices 顺序，
 * 档案 devices（调用前已确认是字符串数组）里没有的每一项一条。devices 没填（null）时引擎不生成设备障碍。
 */
function missingDevices(p: StudentProfile, o: Opportunity): string[] {
  if (!Array.isArray(p.devices)) return [];
  const have = p.devices;
  return o.required_devices.filter((d) => !have.includes(d)).map((d) => String(d));
}

type PendingOutcome =
  | { kind: 'resolves' }
  /** 官方费用未知：获批后「已能算出的缺口」被抵掉，但总费用仍不清楚。 */
  | { kind: 'resolves_known_part' }
  | { kind: 'partial'; remaining: number }
  | { kind: 'no_change' };

/**
 * pending 的支持获批后会怎样：把该障碍 pending_grant_ids 里的 pending grant 当作 approved，再调用一次
 * analyzeReachability（引擎口径），按 barrierKeys 找到同一条障碍：
 * - 变为 resolved → resolves；
 * - 找不到（只可能是官方费用未知时的 cost 障碍消失）→ resolves_known_part；
 * - 仍未化解：cost / time 的剩余缺口（缺口 − 已生效支持可抵的量）变小 → partial（附剩余数值），否则 → no_change。
 */
function pendingOutcome(
  b: Barrier,
  key: string,
  p: StudentProfile,
  o: Opportunity,
  grants: ResourceGrant[],
  devices: (string | null)[],
  options?: EvalOptions,
): PendingOutcome {
  const ids = new Set(b.pending_grant_ids ?? []);
  const flipped = grants.map((g) => (ids.has(g.id) && g.status === 'pending' ? { ...g, status: 'approved' as const } : g));
  let after: ReachabilityResult;
  try {
    after = analyzeReachability(p, o, flipped, options);
  } catch {
    return { kind: 'no_change' };
  }
  const afterKeys = barrierKeys(after.barriers, devices);
  const idx = afterKeys.indexOf(key);
  if (idx < 0) return b.type === 'cost' ? { kind: 'resolves_known_part' } : { kind: 'resolves' };
  if (after.barriers[idx].resolved) return { kind: 'resolves' };

  const gap = finiteShortfall(b);
  const before = coverage(b.type, grants, p, o);
  const later = coverage(b.type, flipped, p, o);
  if (gap == null || before == null || later == null) return { kind: 'no_change' };
  const remBefore = Math.max(0, gap - before);
  const remAfter = Math.max(0, gap - later);
  return remAfter < remBefore - 1e-9 ? { kind: 'partial', remaining: remAfter } : { kind: 'no_change' };
}

function amountText(type: BarrierType, n: number, atLeast: boolean): string {
  if (type === 'cost') return `${atLeast ? 'at least ' : ''}$${fmt(n)}`;
  return `about ${plural(n, 'hour')} per week`;
}

/**
 * 没有（有效的）pending 时的建议。approvedCover：已生效支持对 cost 已可抵的量（只在官方费用已知时传入；
 * 官方费用未知时 gap 已经扣掉了它）——大于 0 时注明，避免把已被抵掉的部分也说成要去争取。
 */
function askText(b: Barrier, device: string | null, gap: number | null, costAtLeast: boolean, approvedCover = 0): string {
  switch (b.type) {
    case 'time':
      return `You could free up about ${fmt(gap ?? 0)} more ${pluralNoun(gap ?? 0, 'hour')} per week, or ask the organizer whether any time support exists (for example a lighter schedule or paid prep time). They may not offer it.`;
    case 'cost':
      return costAtLeast
        ? `You could ask the organizer whether a fee waiver or financial aid is available to cover the at least $${fmt(gap ?? 0)} you are short (the official fee is not clear, so it may be more). They may not offer it.`
        : approvedCover > 0 && gap != null && approvedCover < gap
          ? `You could ask the organizer whether a fee waiver or financial aid is available for the rest of the $${fmt(gap)} you are short (approved support already covers $${fmt(approvedCover)} of it, so about $${fmt(gap - approvedCover)} is still uncovered). They may not offer it.`
          : `You could ask the organizer whether a fee waiver or financial aid is available to cover the $${fmt(gap ?? 0)} you are short. They may not offer it.`;
    case 'transport':
      return 'You could ask the organizer whether there is an online option, a nearer site or travel support. They may not offer it.';
    case 'device':
      return `You could ask the organizer, your school or a local library whether you can borrow ${device ? (DEVICE_LABEL[device] ?? device) : 'the device'}. They may not have one to lend.`;
  }
}

/** pending 获批也不改变缺口时的原因说明（尽量具体；说不出具体原因时用通用说法）。 */
function noChangeReason(b: Barrier, pending: ResourceGrant[], o: Opportunity): string {
  if (b.type === 'cost' && pending.length > 0 && pending.every((g) => g.type === 'fee_waiver' && g.amount_usd == null)) {
    return feeUnknown(o)
      ? 'a fee waiver with no set amount only covers the official fee, and the official fee is not clear here'
      : 'a fee waiver with no set amount only covers the official fee once, and approved support already counts it';
  }
  return 'based on how support is counted for this barrier';
}

function barrierItems(
  r: ReachabilityResult,
  p: StudentProfile,
  o: Opportunity,
  grants: ResourceGrant[],
  groups: Record<GapCategory, GapItem[]>,
  options?: EvalOptions,
): void {
  // 设备障碍与「档案里没有的必需设备」按引擎同样的方式对应；数量对不上时（不应发生）不写设备名。
  const missing = missingDevices(p, o);
  const deviceCount = r.barriers.filter((b) => b.type === 'device').length;
  const devices: (string | null)[] = missing.length === deviceCount ? missing : missing.map(() => null);
  const keys = barrierKeys(r.barriers, devices);
  const deviceOf = new Map<Barrier, string | null>();
  let di = 0;
  for (const b of r.barriers) if (b.type === 'device') deviceOf.set(b, devices[di++] ?? null);

  for (const type of BARRIER_TYPES) {
    r.barriers.forEach((b, index) => {
      if (b.type !== type || b.resolved) return;
      const device = type === 'device' ? (deviceOf.get(b) ?? null) : null;
      const idPart = device ? `device:${device}` : type;
      const basis: GapBasis = { kind: 'barrier', barrier_type: type };

      if (isDeadlinePassed(b)) {
        // 引擎的 description 已提到下一届与同领域机会；这里只补一句指向替代机会，不重复。
        const extra =
          o.recurring_annually === false
            ? 'The organizer does not run it every year; see the alternatives for this opportunity for similar opportunities in the same field.'
            : 'See the alternatives for this opportunity.';
        groups.time_and_cost.push(item('time_and_cost', idPart, 'Deadline has passed', `${b.description} ${extra}`, basis, null));
        return;
      }

      const shortfall = finiteShortfall(b);
      // 官方费用未知时 cost 障碍的数字 = 缺口 − 已批准且有金额的减免（与引擎 description 的「至少还差」一致）。
      const costAtLeast = type === 'cost' && feeUnknown(o);
      const approvedCover = type === 'cost' ? (coverage('cost', grants, p, o) ?? 0) : 0;
      let gap = shortfall;
      if (costAtLeast && shortfall != null) gap = Math.max(0, shortfall - approvedCover);
      const ask = askText(b, device, gap, costAtLeast, costAtLeast ? 0 : approvedCover);

      let title = `${BARRIER_TITLE[type]} barrier`;
      if (type === 'time' && gap != null) title = `Time: short ${plural(gap, 'hour')} per week`;
      if (type === 'cost' && gap != null) title = `Cost: short ${costAtLeast ? 'at least ' : ''}$${fmt(gap)}`;
      if (type === 'device' && device) title = `Device: needs ${DEVICE_LABEL[device] ?? device}`;

      const pendingIds = b.pending_grant_ids ?? [];
      let action: string;
      if (pendingIds.length > 0) {
        const n = pendingIds.length;
        const pending = grants.filter((g) => pendingIds.includes(g.id) && g.status === 'pending');
        const lead = n === 1 ? 'There is a pending support request' : `There are ${n} pending support requests`;
        const it = pluralNoun(n, 'it', 'they');
        const outcome = pendingOutcome(b, keys[index], p, o, grants, devices, options);
        let effect: string;
        switch (outcome.kind) {
          case 'resolves':
            effect = `${lead}; once approved, this barrier would be resolved.`;
            break;
          case 'resolves_known_part':
            effect = `${lead}; once approved, ${it} would cover the shortfall we can count, but the official fee is not clear, so the total may still be more than you can pay.`;
            break;
          case 'partial':
            effect = `${lead}; once approved, ${it} would cover only part of the gap: you would still be short ${amountText(type, outcome.remaining, costAtLeast)}.`;
            break;
          case 'no_change':
            effect = `${lead}, but even if approved ${it} would not reduce this gap (${noChangeReason(b, pending, o)}). ${ask}`;
            break;
        }
        action = `${effect} ${pluralNoun(n, 'It is', 'They are')} not in effect yet (pending is not approved). You can check ${pluralNoun(n, 'its', 'their')} status with the organizer.`;
      } else {
        action = ask;
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

/** todayGiven：options.today 有值（但读不了）时为 true，文案不说「页面没有传」。 */
function missingFieldItem(field: string, todayGiven = false): GapItem {
  const basis: GapBasis = { kind: 'missing_field', field };
  const { label, affects } = fieldInfo(field);
  if (field === 'options.today') {
    return item(
      'unknown_info',
      field,
      todayGiven ? "Today's date was missing or could not be read" : "Today's date was not provided",
      todayGiven
        ? "Today's date was missing or could not be read, so we could not check whether the deadline has passed or how much prep time is left. We did not guess."
        : "The page did not pass today's date, so we could not check whether the deadline has passed or how much prep time is left. We did not guess.",
      basis,
      'Reload the page so it can pass today\'s date. If this stays, check the deadline on the official page yourself.',
    );
  }
  if (field === 'opportunity.deadline.closing_time') {
    // 截止当天：截止的具体时刻和时区不知道，是否还来得及属于未知（不说「没问题」）。
    return item(
      'unknown_info',
      field,
      'The deadline is today: closing time not known',
      "The deadline is today, and we don't know the exact closing time or time zone, so we can't tell whether there is still time to apply. We did not guess.",
      basis,
      'Check the exact closing time and time zone on the official page, or confirm them with the organizer, before you put in time today.',
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

/** 档案里某字段有值但类型不对（数据损坏）：一条 unknown_info，行动是在 Skill Passport 更正。 */
function corruptProfileItem(field: string): GapItem {
  const { label, affects } = fieldInfo(field);
  return item(
    'unknown_info',
    field,
    `Unclear in your profile: ${label}`,
    `Your profile has ${label} in a form we can't read, so we could not finish ${affects}. We did not guess.`,
    { kind: 'missing_field', field },
    `Correct ${label} in your Skill Passport.`,
  );
}

// ───────────────────────────── 档案数据类型检查 ─────────────────────────────

const SKILL_LEVELS: readonly string[] = ['beginner', 'intermediate', 'advanced'];
const TRANSPORT_LEVELS: readonly string[] = ['reliable', 'limited', 'none'];

function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function optionalString(v: unknown): boolean {
  return v == null || typeof v === 'string';
}

function optionalStringArray(v: unknown): boolean {
  return v == null || isStringArray(v);
}

function validEvidence(e: unknown): boolean {
  return (
    isObject(e) &&
    typeof e.id === 'string' &&
    typeof e.title === 'string' &&
    typeof e.kind === 'string' &&
    typeof e.status === 'string' &&
    optionalStringArray(e.skills) &&
    optionalStringArray(e.prep_item_ids)
  );
}

/**
 * 档案里「有值但类型不对」的字段（没填 = null / 缺省不算）。按固定顺序返回字段名（`profile.<字段>`）。
 * 检查引擎会读到的字段：数字字段为有限数；skills 为对象数组且 name 为字符串、level 合法；
 * citizenships / statuses / devices 为字符串数组；region 为对象且 country / state 为字符串（或没填）；
 * transport 为对象且 level 合法；evidence 为数组且每条的 id / title / kind / status 为字符串、
 * skills / prep_item_ids 为字符串数组（或没填）。
 */
function profileFieldIssues(raw: unknown): string[] {
  if (!isObject(raw)) return [];
  const out: string[] = [];
  const bad = (key: string) => out.push(`profile.${key}`);
  for (const key of ['grade', 'age']) {
    const v = raw[key];
    if (v != null && !(typeof v === 'number' && Number.isFinite(v))) bad(key);
  }
  const skills = raw.skills;
  if (
    skills != null &&
    !(Array.isArray(skills) && skills.every((s) => isObject(s) && typeof s.name === 'string' && SKILL_LEVELS.includes(s.level as string)))
  ) {
    bad('skills');
  }
  for (const key of ['statuses', 'citizenships']) {
    if (!optionalStringArray(raw[key])) bad(key);
  }
  const region = raw.region;
  if (region != null && !(isObject(region) && optionalString(region.country) && optionalString(region.state))) bad('region');
  if (!optionalStringArray(raw.devices)) bad('devices');
  for (const key of ['budget_usd', 'hours_per_week_available']) {
    const v = raw[key];
    if (v != null && !(typeof v === 'number' && Number.isFinite(v))) bad(key);
  }
  const transport = raw.transport;
  if (transport != null && !(isObject(transport) && TRANSPORT_LEVELS.includes(transport.level as string))) bad('transport');
  const evidence = raw.evidence;
  if (evidence != null && !(Array.isArray(evidence) && evidence.every(validEvidence))) bad('evidence');
  return out;
}

// ───────────────────────────── 数据不完整时的逐字段诊断 ─────────────────────────────

/** profileIssues：profileFieldIssues 的结果；非空时不再逐条重试官方要求（问题在档案，不归咎于机会数据）。 */
function diagnose(p: StudentProfile, o: Opportunity, profileIssues: string[], options?: EvalOptions): GapItem[] {
  const out: GapItem[] = [];
  const raw = o as unknown as Record<string, unknown>;

  for (const key of ['requirements'] as const) {
    if (!Array.isArray(raw[key])) out.push(missingFieldItem(`opportunity.${key}`));
  }
  for (const key of ['cost', 'location', 'time_commitment'] as const) {
    if (!isObject(raw[key])) out.push(missingFieldItem(`opportunity.${key}`));
  }
  for (const f of profileIssues) out.push(corruptProfileItem(f));

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

// ───────────────────────────── 组队要求（第四阶段）─────────────────────────────

function sizeInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

/** 人数范围的英文说明；都没写明时为 null。 */
function teamSizeText(min: number | null, max: number | null): string | null {
  if (min != null && max != null) return min === max ? `exactly ${plural(min, 'person', 'people')}` : `${min}–${max} people`;
  if (min != null) return `at least ${plural(min, 'person', 'people')}`;
  if (max != null) return `at most ${plural(max, 'person', 'people')}`;
  return null;
}

/**
 * opp.team_requirement（第四阶段）：
 * - 是对象且 required === true → materials 类一条（id `materials:team_requirement`，basis 为 requirement、
 *   requirement_id `team_requirement`、source_text 为官网原文；没有原文时 basis 改为 missing_field
 *   `opportunity.team_requirement`，不造空字符串），写明人数范围（有就写）与官网原文；
 *   行动：组队并按官网要求确认人数。放在 materials 组末尾（准备差距之后）。
 * - 是对象且 required === null → unknown_info 类一条（id `unknown_info:team_requirement`，basis 为 missing_field
 *   `opportunity.team_requirement`）：官网没写清是否要组队，向主办方确认。放在 missing_info 各条之前。
 * - required === false、字段缺失、team_requirement 为 null 或不是对象 → 不加（结果与以前逐字相同）。
 * 不新增障碍类型，不影响 eligibility_overall / reachable。
 */
function teamRequirementItems(o: Opportunity, groups: Record<GapCategory, GapItem[]>): void {
  const raw = (o as unknown as Record<string, unknown>).team_requirement;
  if (!isObject(raw)) return;
  const src = typeof raw.source_text === 'string' && raw.source_text.trim() !== '' ? raw.source_text : null;
  const official = src ? ` Official text: "${src}".` : '';
  if (raw.required === true) {
    const size = teamSizeText(sizeInt(raw.min_size), sizeInt(raw.max_size));
    groups.materials.push(
      item(
        'materials',
        'team_requirement',
        size ? `Team needed (${size})` : 'Team needed',
        (size
          ? `The organizer requires you to take part as a team of ${size}.`
          : 'The organizer requires you to take part as a team; the team size is not recorded.') + official,
        // GapBasis 的 requirement 种类要求有原文字符串；没有原文时不造空字符串（页面会把它当原文渲染），
        // 改用 missing_field，与本文件其他「没有原文」的处理一致（不编原文）。
        src != null
          ? { kind: 'requirement', requirement_id: 'team_requirement', source_text: src }
          : { kind: 'missing_field', field: 'opportunity.team_requirement' },
        `Find teammates${size ? ` (${size})` : ''} before you apply, and check the team rules on the official page.`,
      ),
    );
    return;
  }
  if (raw.required === null) {
    groups.unknown_info.push(
      item(
        'unknown_info',
        'team_requirement',
        'Unclear whether a team is required',
        `The official information does not make clear whether you must take part as a team. We did not guess.${official}`,
        { kind: 'missing_field', field: 'opportunity.team_requirement' },
        'Confirm with the organizer whether you need a team, and if so how many people.',
      ),
    );
  }
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

/** 信息不足时的 summary：问题只在档案里时请学生更正档案，否则请查看官网。 */
function incompleteSummary(items: GapItem[]): string {
  const profileOnly = items.every((i) => i.basis.kind === 'missing_field' && i.basis.field.startsWith('profile.'));
  const lead = `We couldn't fully analyze this opportunity because some information is incomplete (${plural(items.length, 'item')} listed).`;
  return profileOnly ? `${lead} Correct the listed details in your Skill Passport.` : `${lead} Check the official page.`;
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

  // 档案里有值但类型不对的字段：先查出来，有就直接走「信息不足」分支（不让引擎带着坏数据算出看似正常的结论，
  // 也不把引擎因此抛的错归咎于机会数据）。
  let profileIssues: string[];
  try {
    profileIssues = profileFieldIssues(profile);
  } catch {
    profileIssues = [];
  }

  let r: ReachabilityResult | null = null;
  if (profileIssues.length === 0) {
    try {
      r = analyzeReachability(p, o, g, opts);
    } catch {
      r = null;
    }
  }
  if (r == null) {
    // 机会 / 档案数据不完整：不猜，逐字段列出缺什么。
    let items: GapItem[];
    try {
      items = uniqueIds(diagnose(p, o, profileIssues, opts));
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
      summary: incompleteSummary(items),
    };
  }

  const uncovered = new Set(r.readiness_gaps.map((x) => x.prep_item_id));
  const groups = emptyGroups();
  requirementItems(r, p, o, uncovered, groups, opts);
  prepItems(r, o, uncovered, groups);
  barrierItems(r, p, o, g, groups, opts);
  teamRequirementItems(o, groups);
  const todayGiven = opts?.today != null;
  for (const field of r.missing_info) groups.unknown_info.push(missingFieldItem(field, todayGiven));

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
