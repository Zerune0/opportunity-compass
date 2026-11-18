/**
 * analyzeGaps(profile, opp, grants, options?) — 五类差距（GapAnalysis）。
 *
 * PHASE 2 SAMPLE VERSION — replaced in layer 1 / 2
 * 示例版本：签名与返回形状和最终版一致，内容简化但如实；只整理 analyzeReachability 已有的结论，不发明新规则。
 *
 * 示例版本实际做的：
 * 1. r = analyzeReachability(profile, opp, grants, options)（内部已调用 checkEligibility）。
 * 2. 资格项（按 opp.requirements 顺序）：
 *    - not_satisfied 的 portfolio 要求 → materials；not_satisfied 的 prerequisite_skill 要求 → knowledge_or_experience
 *      （硬性与偏好都列，detail 写明是否影响资格；这两类学生能补，按 lib/types.ts GapCategory 注释归类）；
 *    - 其余 hard 且 not_satisfied 的要求 → unchangeable_eligibility，improvable: false、action: null，只给原因与官网原文；
 *    - status 为 unknown 的资格项（硬性与偏好都列）→ unknown_info，action 为「向官方确认」。
 * 3. 准备差距 r.readiness_gaps（按 opp.preparation 顺序）：有 material_kind → materials，否则 → knowledge_or_experience；
 *    action 为「完成该准备项并在 Skill Passport 记录证据」。
 * 4. 未化解的障碍（resolved: false，按 BARRIER_TYPES 顺序）→ time_and_cost；「已过截止日期」不可改善（action: null），
 *    其余给一条通用但真实的行动（向主办方询问借用设备 / 费用减免 / 线上参与或交通支持 / 时间支持）。
 * 5. r.missing_info 的每个字段一条 unknown_info：profile.* → 去 Skill Passport 补填；opportunity.* → 看官网或问主办方。
 *
 * 与最终版相比省略了：
 * - 不区分「会随时间改善」的阻断（如年级低于下限，明年可能满足）——示例版本把它们一律归入 unchangeable_eligibility
 *   （「本届」不可改变，这一点是真的）；最终版会在 detail 里区分并与 findAlternatives 的 next_cycle 对齐。
 * - 行动建议是通用句子，最终版会结合 pending grant、具体缺口数值与路线步骤给出更具体的行动。
 * - 不估算补上非准备项差距所需的小时 / 费用（estimated_* 只来自准备项，其余为 null）。
 * - 机会数据缺关键字段导致引擎抛错时，只返回一条笼统的 unknown_info（最终版会逐字段列出）。
 *
 * 公平性：不读取学校名、显示名。纯函数：日期只来自 options.today，不读系统时钟、无随机、无 IO、不调 AI。永不抛异常。
 */
import { analyzeReachability } from '../reachability';
import { plural } from '../format';
import {
  BARRIER_TYPES,
  GAP_CATEGORIES,
  type Barrier,
  type BarrierType,
  type EligibilityItem,
  type EvalOptions,
  type GapAnalysis,
  type GapCategory,
  type GapItem,
  type Opportunity,
  type ReachabilityResult,
  type ResourceGrant,
  type StudentProfile,
} from '../types';
import { asArray, safeOpportunity, safeProfile } from './inputs';

/** missing_info 字段 → 面向学生的名称（与 analyzeReachability 的写法一致）。 */
const FIELD_LABEL: Record<string, string> = {
  'profile.devices': 'which devices you have',
  'profile.budget_usd': 'how much you can pay yourself',
  'profile.transport': 'your transportation',
  'profile.hours_per_week_available': 'hours you have each week',
  'opportunity.cost.fee_usd': 'the official fee',
  'opportunity.cost.requires_travel_expense': 'whether you must pay for travel',
  'opportunity.time_commitment.hours_per_week': 'weekly hours needed during the program',
  'opportunity.deadline': 'the deadline',
  'options.today': "today's date",
};

const BARRIER_TITLE: Record<BarrierType, string> = {
  time: 'Time',
  cost: 'Cost',
  transport: 'Transportation',
  device: 'Device',
};

const BARRIER_ACTION: Record<BarrierType, string> = {
  time: 'Ask the organizer whether time support is available, or free up more hours each week; optional prep items can be cut.',
  cost: 'Ask the organizer whether a fee waiver or financial aid is available.',
  transport: 'Ask the organizer whether there is an online option or travel support.',
  device: 'Ask the organizer or your school whether a device can be borrowed.',
};

const CATEGORY_LABEL: Record<GapCategory, string> = {
  knowledge_or_experience: 'knowledge or experience',
  materials: 'materials',
  time_and_cost: 'time and cost',
  unchangeable_eligibility: 'eligibility limits you cannot change this round',
  unknown_info: 'unknown info',
};

function fieldLabel(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

function missingFieldAction(field: string): string {
  if (field.startsWith('profile.')) return `Add ${fieldLabel(field)} in your Skill Passport.`;
  if (field === 'options.today') return "We need today's date to check the deadline. The app fills it in; reload the page if this stays.";
  return `Check the official page or ask the organizer about ${fieldLabel(field)}.`;
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

function requirementDetail(item: EligibilityItem): string {
  const effect = item.hard ? 'This is a hard requirement.' : 'This is a bonus item; it does not affect eligibility.';
  return `${item.explanation} ${effect} Official text: "${item.source_text}".`;
}

/** 已过截止日期的 time 障碍：analyzeReachability 只在这种情况下给 shortfall 为 null 的 time 障碍。 */
function isDeadlinePassed(b: Barrier): boolean {
  return b.type === 'time' && b.shortfall == null;
}

function buildItems(opp: Opportunity, r: ReachabilityResult): GapItem[] {
  const groups: Record<GapCategory, GapItem[]> = {
    knowledge_or_experience: [],
    materials: [],
    time_and_cost: [],
    unchangeable_eligibility: [],
    unknown_info: [],
  };

  // ── 资格项（opp.requirements 顺序）──
  for (const item of r.eligibility.items) {
    const basis = { kind: 'requirement' as const, requirement_id: item.requirement_id, source_text: item.source_text };
    if (item.status === 'not_satisfied') {
      if (item.requirement_type === 'portfolio') {
        groups.materials.push({
          id: `materials:${item.requirement_id}`,
          category: 'materials',
          title: `Missing work sample: ${item.label}`,
          detail: requirementDetail(item),
          basis,
          improvable: true,
          action: 'Make or collect a work sample that fits this requirement, then add it as evidence in your Skill Passport.',
          estimated_hours: null,
          estimated_cost_usd: null,
        });
      } else if (item.requirement_type === 'prerequisite_skill') {
        groups.knowledge_or_experience.push({
          id: `knowledge_or_experience:${item.requirement_id}`,
          category: 'knowledge_or_experience',
          title: `Skill not shown yet: ${item.label}`,
          detail: requirementDetail(item),
          basis,
          improvable: true,
          action: 'Build this skill, then update your skills or add evidence for it in your Skill Passport.',
          estimated_hours: null,
          estimated_cost_usd: null,
        });
      } else if (item.hard) {
        groups.unchangeable_eligibility.push({
          id: `unchangeable_eligibility:${item.requirement_id}`,
          category: 'unchangeable_eligibility',
          title: `Does not meet: ${item.label}`,
          detail: `${item.explanation} Official text: "${item.source_text}".`,
          basis,
          improvable: false,
          action: null,
          estimated_hours: null,
          estimated_cost_usd: null,
        });
      }
    } else if (item.status === 'unknown') {
      groups.unknown_info.push({
        id: `unknown_info:${item.requirement_id}`,
        category: 'unknown_info',
        title: `Not sure yet: ${item.label}`,
        detail: requirementDetail(item),
        basis,
        improvable: true,
        action: item.confirm_with_official ?? `Confirm with the organizer using the official text: "${item.source_text}".`,
        estimated_hours: null,
        estimated_cost_usd: null,
      });
    }
  }

  // ── 准备差距（opp.preparation 顺序）──
  for (const gap of r.readiness_gaps) {
    const prep = opp.preparation.find((p) => p.id === gap.prep_item_id);
    const isMaterial = prep?.material_kind != null;
    const category: GapCategory = isMaterial ? 'materials' : 'knowledge_or_experience';
    const need = gap.required_for_application ? 'Required to apply.' : 'Recommended, not required.';
    groups[category].push({
      id: `${category}:${gap.prep_item_id}`,
      category,
      title: `Not done yet: ${gap.title}`,
      detail: `${gap.reason} ${need}`,
      basis: { kind: 'prep_item', prep_item_id: gap.prep_item_id, source_text: prep?.source_text ?? null },
      improvable: true,
      action: `Complete "${gap.title}", then add evidence for it in your Skill Passport.`,
      estimated_hours: Number.isFinite(gap.estimated_hours) ? gap.estimated_hours : null,
      estimated_cost_usd: Number.isFinite(gap.estimated_cost_usd) ? gap.estimated_cost_usd : null,
    });
  }

  // ── 未化解的障碍（BARRIER_TYPES 顺序，同类保持原顺序）──
  for (const type of BARRIER_TYPES) {
    for (const b of r.barriers.filter((x) => x.type === type && !x.resolved)) {
      const passed = isDeadlinePassed(b);
      const pending = (b.pending_grant_ids ?? []).length;
      const pendingNote = pending > 0 ? ` ${plural(pending, 'pending support request')} could help if approved (pending is not the same as approved).` : '';
      groups.time_and_cost.push({
        id: `time_and_cost:${type}`,
        category: 'time_and_cost',
        title: passed ? 'Deadline has passed' : `${BARRIER_TITLE[type]} barrier`,
        detail: `${b.description}${pendingNote}`,
        basis: { kind: 'barrier', barrier_type: type },
        improvable: !passed,
        action: passed ? null : BARRIER_ACTION[type],
        estimated_hours: null,
        estimated_cost_usd: null,
      });
    }
  }

  // ── 缺失字段（missing_info 顺序）──
  for (const field of r.missing_info) {
    groups.unknown_info.push({
      id: `unknown_info:${field}`,
      category: 'unknown_info',
      title: `Missing: ${fieldLabel(field)}`,
      detail: `We need to know ${fieldLabel(field)} to check whether this is realistic, so we did not guess.`,
      basis: { kind: 'missing_field', field },
      improvable: true,
      action: missingFieldAction(field),
      estimated_hours: null,
      estimated_cost_usd: null,
    });
  }

  return uniqueIds(GAP_CATEGORIES.flatMap((c) => groups[c]));
}

/** 保证 id 在结果内唯一且稳定：重复时依次加 `#2`、`#3`。 */
function uniqueIds(items: GapItem[]): GapItem[] {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const n = (seen.get(item.id) ?? 0) + 1;
    seen.set(item.id, n);
    return n === 1 ? item : { ...item, id: `${item.id}#${n}` };
  });
}

function summarize(counts: Record<GapCategory, number>, items: GapItem[], reachable: boolean | null): string {
  const total = items.length;
  const reach =
    reachable === true
      ? 'Based on current info this is reachable (reachable does not mean admitted).'
      : reachable === false
        ? 'Right now this is not reachable.'
        : "We can't tell yet whether this is reachable.";
  if (total === 0) return `No gaps found from the info we have. ${reach}`;
  const parts = GAP_CATEGORIES.filter((c) => counts[c] > 0).map((c) => `${counts[c]} ${CATEGORY_LABEL[c]}`);
  let text = `${plural(total, 'gap')} found: ${parts.join(', ')}. ${reach}`;
  const blockers = items.filter((i) => i.category === 'unchangeable_eligibility');
  if (blockers.length > 0) {
    text += ` You can't apply this round because of: ${blockers.map((b) => b.title.replace(/^Does not meet: /, '')).join(', ')}.`;
  }
  return text;
}

export function analyzeGaps(
  profile: StudentProfile,
  opp: Opportunity,
  grants: ResourceGrant[],
  options?: EvalOptions,
): GapAnalysis {
  const p = safeProfile(profile);
  const o = safeOpportunity(opp);
  let r: ReachabilityResult;
  try {
    r = analyzeReachability(p, o, asArray<ResourceGrant>(grants), options);
  } catch {
    // 机会 / 档案数据缺关键字段：不猜，退回到「信息不足」。
    const item: GapItem = {
      id: 'unknown_info:opportunity',
      category: 'unknown_info',
      title: 'Opportunity data is incomplete',
      detail: 'Some details this check needs are missing from the opportunity data, so we could not analyze gaps and did not guess.',
      basis: { kind: 'missing_field', field: 'opportunity' },
      improvable: true,
      action: 'Check the official page or ask the organizer for the full requirements.',
      estimated_hours: null,
      estimated_cost_usd: null,
    };
    const counts = emptyCounts();
    counts.unknown_info = 1;
    return {
      profile_id: p.id,
      opportunity_id: o.id,
      items: [item],
      counts,
      eligibility_overall: 'unknown',
      reachable: null,
      summary: "We couldn't analyze this opportunity because its data is incomplete. Check the official page.",
    };
  }

  const items = buildItems(o, r);
  const counts = emptyCounts();
  for (const i of items) counts[i.category] += 1;
  return {
    profile_id: p.id,
    opportunity_id: o.id,
    items,
    counts,
    eligibility_overall: r.eligibility.overall,
    reachable: r.reachable,
    summary: summarize(counts, items, r.reachable),
  };
}
