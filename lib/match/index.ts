/**
 * explainMatch(profile, opp, options?) — 这个机会为什么适合 / 不适合这名学生（不含分数或名次）。
 * findAlternatives(profile, opp, catalog, options?) — 从传入的机会目录里找替代机会。
 *
 * PHASE 2 SAMPLE VERSION — replaced in layer 1 / 2
 * 示例版本：签名与返回形状和最终版一致，内容简化但如实。
 *
 * explainMatch 示例版本实际做的：理由只来自三件事，按 MATCH_REASON_KINDS 顺序输出：
 * - interest：profile.interests ∩ opp.fields（去首尾空格、不区分大小写；shared_interests 按 opp.fields 原顺序与原写法）；
 *   兴趣没填或机会没有领域标签 → positive: null；有交集 → true；都填了但没交集 → false。
 * - eligibility：checkEligibility 的 overall：eligible → true，not_eligible → false，unknown → null（列出待确认的硬性要求）。
 * - reachability：analyzeReachability（grants 传 []：explainMatch 不知道主办方资源）的 reachable 与 summary。
 * 省略：format / time / cost 三类理由（最终版从障碍里拆出单独理由）；不考虑已批准的 grants。
 * 不输出任何分数、百分比或名次。
 *
 * findAlternatives 示例版本实际做的：
 * - next_cycle：仅当 opp.recurring_annually === true 时给一条（opportunity_id = opp.id，eligibility_overall: null，
 *   shared_fields = opp.fields）。示例版本不判断阻断原因「是否会随时间改善」，理由文字也不承诺下一届能申请；
 *   最终版会收紧为：只在阻断原因会随时间改善（如年级低于下限）时才给。
 * - same_field：catalog 中与 opp.fields 有交集（精确匹配标签）、id 不是 opp.id、且
 *   checkEligibility(...).overall !== 'not_eligible' 的机会（目录内重复 id 只取第一条；数据不完整、判断抛错的跳过），
 *   按 id 排序，最多 3 条。user_posted 的机会在理由里注明是示例发布、未经官网核实。
 * 省略：不看截止日期是否已过、不看现实可达性、不按兴趣进一步筛选（最终版会补）。
 *
 * 公平性：不读取学校名、显示名。纯函数：不读系统时钟、无随机、无 IO、不调 AI。永不抛异常。
 */
import { checkEligibility } from '../eligibility';
import { analyzeReachability } from '../reachability';
import { asArray, asStringArray, safeOpportunity, safeProfile } from '../gap/inputs';
import type {
  AlternativeSuggestion,
  EligibilityResult,
  EvalOptions,
  MatchExplanation,
  MatchReason,
  Opportunity,
  OverallEligibility,
  ReachabilityResult,
  StudentProfile,
} from '../types';

const MAX_SAME_FIELD = 3;

function norm(s: string): string {
  return s.trim().toLowerCase();
}

function hardLabels(e: EligibilityResult, status: 'not_satisfied' | 'unknown'): string {
  return e.items
    .filter((i) => i.hard && i.status === status)
    .map((i) => `"${i.label}"`)
    .join(', ');
}

// ───────────────────────────── explainMatch ─────────────────────────────

export function explainMatch(profile: StudentProfile, opp: Opportunity, options?: EvalOptions): MatchExplanation {
  const p = safeProfile(profile);
  const o = safeOpportunity(opp);

  // ── interest ──
  const interestsFilled = Array.isArray(p.interests);
  const interests = asStringArray(p.interests).map(norm);
  const shared_interests = o.fields.filter((f) => interests.includes(norm(f)));
  let interest: MatchReason;
  if (!interestsFilled) {
    interest = { kind: 'interest', positive: null, text: "Your profile has no interests yet, so we can't compare them with this opportunity's fields." };
  } else if (o.fields.length === 0) {
    interest = { kind: 'interest', positive: null, text: "This opportunity lists no fields, so we can't compare it with your interests." };
  } else if (shared_interests.length > 0) {
    interest = { kind: 'interest', positive: true, text: `Matches your interests: ${shared_interests.join(', ')}.` };
  } else {
    interest = {
      kind: 'interest',
      positive: false,
      text: `None of your interests match this opportunity's fields (${o.fields.join(', ')}).`,
    };
  }

  // ── eligibility / reachability ──
  let r: ReachabilityResult | null = null;
  try {
    r = analyzeReachability(p, o, [], options);
  } catch {
    r = null;
  }

  let eligibility_overall: OverallEligibility;
  let eligibility: MatchReason;
  let reachability: MatchReason;
  let reachable: boolean | null;
  if (r == null) {
    eligibility_overall = 'unknown';
    reachable = null;
    eligibility = { kind: 'eligibility', positive: null, text: "The opportunity data is incomplete, so we can't check eligibility. Check the official page." };
    reachability = { kind: 'reachability', positive: null, text: "The opportunity data is incomplete, so we can't tell whether this is realistic for you." };
  } else {
    eligibility_overall = r.eligibility.overall;
    reachable = r.reachable;
    if (eligibility_overall === 'eligible') {
      eligibility = { kind: 'eligibility', positive: true, text: 'You meet every hard official requirement we can check.' };
    } else if (eligibility_overall === 'not_eligible') {
      eligibility = { kind: 'eligibility', positive: false, text: `You don't meet the hard requirement(s): ${hardLabels(r.eligibility, 'not_satisfied')}.` };
    } else {
      eligibility = {
        kind: 'eligibility',
        positive: null,
        text: `Some hard requirements can't be checked yet: ${hardLabels(r.eligibility, 'unknown')}. Confirm with the organizer.`,
      };
    }
    reachability = { kind: 'reachability', positive: reachable, text: r.summary };
  }

  const interestPart =
    interest.positive === true
      ? `Shares your interests (${shared_interests.join(', ')}).`
      : interest.positive === false
        ? "Doesn't overlap with your listed interests."
        : 'Interest match unknown.';
  const eligPart =
    eligibility_overall === 'eligible'
      ? 'Eligibility: you meet the checkable hard requirements.'
      : eligibility_overall === 'not_eligible'
        ? 'Eligibility: not eligible this round.'
        : 'Eligibility: to be confirmed.';
  const reachPart =
    reachable === true
      ? 'Realistically doable right now (not a prediction of admission).'
      : reachable === false
        ? 'Not realistic right now.'
        : 'Realistic or not: unknown yet.';

  return {
    profile_id: p.id,
    opportunity_id: o.id,
    reasons: [interest, eligibility, reachability],
    eligibility_overall,
    reachable,
    shared_interests,
    summary: `${interestPart} ${eligPart} ${reachPart}`,
  };
}

// ───────────────────────────── findAlternatives ─────────────────────────────

export function findAlternatives(
  profile: StudentProfile,
  opp: Opportunity,
  catalog: Opportunity[],
  options?: EvalOptions,
): AlternativeSuggestion[] {
  const p = safeProfile(profile);
  const o = safeOpportunity(opp);
  const out: AlternativeSuggestion[] = [];

  if (o.recurring_annually === true) {
    out.push({
      kind: 'next_cycle',
      opportunity_id: o.id || null,
      title: o.title,
      reason:
        "Our data says this runs every year. If this round doesn't work out, watch for the next one and check the official rules again then; we can't tell in advance whether you will be eligible next time.",
      eligibility_overall: null,
      shared_fields: [...o.fields],
    });
  }

  if (o.fields.length > 0) {
    const seen = new Set<string>();
    const candidates: AlternativeSuggestion[] = [];
    for (const raw of asArray<unknown>(catalog)) {
      const c = safeOpportunity(raw);
      if (c.id === '' || c.id === o.id || seen.has(c.id)) continue;
      seen.add(c.id);
      const shared = c.fields.filter((f) => o.fields.includes(f));
      if (shared.length === 0) continue;
      let overall: OverallEligibility;
      try {
        overall = checkEligibility(p, c, options).overall;
      } catch {
        continue; // 数据不完整，无法确认硬性资格不冲突 → 不推荐。
      }
      if (overall === 'not_eligible') continue;
      const eligText =
        overall === 'eligible'
          ? 'You meet its hard requirements that we can check.'
          : 'Some of its requirements need to be confirmed with the organizer.';
      const tier = c.source_tier === 'user_posted' ? ' This is a sample posting, not verified on an official site.' : '';
      candidates.push({
        kind: 'same_field',
        opportunity_id: c.id,
        title: c.title,
        reason: `Also in ${shared.join(', ')}. ${eligText}${tier}`,
        eligibility_overall: overall,
        shared_fields: shared,
      });
    }
    candidates.sort((a, b) => ((a.opportunity_id as string) < (b.opportunity_id as string) ? -1 : 1));
    out.push(...candidates.slice(0, MAX_SAME_FIELD));
  }

  return out;
}
