/**
 * analyzeReachability(profile, opp, grants, options?) — 资格 + 准备差距 + 现实障碍 + 是否可达（第 1 层实现）。
 * 可达 ≠ 录取。
 *
 * 规则：
 * 1. eligibility = checkEligibility(profile, opp, options)。
 * 2. 准备差距 = 没有被证据覆盖的准备项（覆盖规则见 ./coverage.ts）。
 *    「必需准备」= requiredPrepClosure：未覆盖的必需项 + 它们未覆盖的前置依赖（传递闭包；
 *    遇到已覆盖的节点不计、也不再往前追），与 planRoutes 的「只做申请必需项」同一口径。
 *    小时 / 费用为负数或非有限数时按 0。
 * 3. 只计入对本学生、本机会生效的 grants：student_id === profile.id，且
 *    opportunity_id === null（对该学生所有机会有效）或等于 opp.id；
 *    缺少 opportunity_id 字段（undefined）的 grant 不生效。
 *    approved 才能化解障碍（记入 applied_grant_ids）；pending 只列入对应障碍的 pending_grant_ids，不算化解。
 * 4. 四类障碍。信息不足时不造障碍，而是把缺的字段写进 missing_info：
 *    - device：缺的每个设备一条障碍；approved 且 device 相同的 device grant → 化解。
 *    - cost：需要的钱 = fee_usd + 必需准备（见第 2 条）的费用；超过 budget_usd → 障碍（shortfall = 差额）；
 *      approved fee_waiver 可抵金额 ≥ 差额 → 化解。可抵金额 = 有金额的 waiver 之和
 *      + （存在 amount_usd 为 null 的 waiver ? fee_usd : 0）——null 金额只表示「免报名费」，
 *      多张合计也只抵一次 fee_usd，不能抵准备费。
 *      fee_usd 为 null：记 opportunity.cost.fee_usd；预算没填再记 profile.budget_usd；
 *      预算已填且「必需准备费」这个下限 > 预算 + 有金额的 waiver 之和 → 一条未化解的 cost 障碍
 *      （shortfall = 下限 − 预算，文案写明「至少还差」「实际可能更多」）。
 *    - transport：线上机会跳过；交通 none/limited 或需要自费差旅 → 一条障碍；
 *      任一 approved 的 transport_subsidy 或 alternative_access（替代参与方式，如线上入口、卫星会场）→ 化解，
 *      两者同等对待；resolved_by_grant_ids / pending_grant_ids 按 grants 输入顺序列出这两类 grant。
 *      若交通没填但官方明确需要自费差旅，仍记障碍，同时把 profile.transport 列为缺失信息。
 *      线下 / 混合且「地点不明确」（isLocationUnclear：没有州也没有城市）、又没有未化解的交通障碍时
 *      （本来没有障碍，或障碍已被 approved 的支持化解），把 opportunity.location 列为缺失信息 → 最多 null：
 *      不知道去哪，就无法确认补助 / 替代方式够不够用。仍有未化解的交通障碍时不记（结论已是 false）。
 *      format 为 unknown（官网没说清参与形式）——以及 location 不是对象、format 缺失或非法（坏数据）——
 *      一律按 unknown：交通等级不造障碍，也不当作线上放行；记 opportunity.location.format，
 *      交通没填记 profile.transport，「是否自费差旅」为 null 记 opportunity.cost.requires_travel_expense；
 *      requires_travel_expense === true 时照常生成「需要自费差旅」障碍（文字只说差旅，不推断线下），
 *      未化解 → false，化解后仍因形式未知为 null。approved 的支持不会让形式变成已知，所以永远不会因此可达。
 *    - time（最多两条）：
 *      a) 参与期每周时间：需要 > 可用 → 障碍（shortfall = 每周缺口）；time_support 小时和 ≥ 缺口 → 化解。
 *      b) 截止前准备时间：H = 必需准备（见第 2 条，含未覆盖的前置依赖）小时合计。
 *         无截止日期（滚动）→ 跳过。有截止日期时（与 H 无关）：格式无法识别 → 缺 opportunity.deadline；
 *         today 缺失或无法解析 → 缺 options.today；截止日期早于 today → 「已过截止日期」障碍，任何 grant 都不能化解。
 *         否则 H = 0 → 跳过；剩余周数 W = max(剩余天数, 1) / 7；H > 可用 × W → 障碍
 *         （剩余 0 天时文案为「今天截止」），shortfall = 每周还缺的小时（向上取整到 0.5 小时）；
 *         time_support 小时和 ≥ shortfall → 化解。
 * 5. reachable：硬性 not_satisfied 或有未化解障碍 → false；否则资格 unknown 或 missing_info 非空 → null；否则 true。
 *
 * 公平性：不读取学校名、显示名（见 lib/types.ts StudentProfile 的公平性约定）。
 * 纯函数：日期只来自 options.today 与机会数据，不读系统时钟、无随机、无 IO。
 */
import { checkEligibility, EVIDENCE_KIND_ZH } from '../eligibility';
import { daysBetween, parseISODate } from '../eligibility/dates';
import type {
  Barrier,
  EvalOptions,
  Opportunity,
  ReachabilityResult,
  ReadinessGap,
  ResourceGrant,
  StudentProfile,
  SupportType,
} from '../types';
import { fmt, plural, pluralNoun } from '../format';
import { findCoveringEvidence, nonNegOrZero, requiredPrepClosure } from './coverage';

export { evidenceCoversPrep, findCoveringEvidence, requiredPrepClosure } from './coverage';

const DEVICE_ZH: Record<string, string> = {
  laptop: 'a laptop',
  desktop: 'a desktop computer',
  smartphone: 'a smartphone',
  tablet: 'a tablet',
  webcam: 'a webcam',
  home_internet: 'reliable home internet',
};

/** missing_info 字段 → 面向学生的中文名。 */
const MISSING_ZH: Record<string, string> = {
  'profile.devices': 'which devices you have',
  'profile.budget_usd': 'how much you can pay yourself',
  'profile.transport': 'your transportation',
  'profile.hours_per_week_available': 'hours you have each week',
  'opportunity.cost.fee_usd': 'the official fee (not clear on the website)',
  'opportunity.cost.requires_travel_expense': 'whether you must pay for travel (not clear on the website)',
  'opportunity.time_commitment.hours_per_week': 'weekly hours needed during the program (not clear on the website)',
  'opportunity.deadline': "the deadline (date format can't be read)",
  'options.today': "today's date",
  'opportunity.location.format': 'whether it is online or in person (not clear on the website)',
  'opportunity.location': 'where exactly it takes place (the state or city is not given)',
};

function hasText(v: unknown): boolean {
  return typeof v === 'string' && v.trim() !== '';
}

/**
 * 读出参与形式：只认 online / in_person / hybrid；其余（'unknown'、缺失、非法值、location 不是对象）一律返回 'unknown'。
 * 入参按 unknown 处理，永不抛异常。
 */
function readFormat(location: unknown): 'online' | 'in_person' | 'hybrid' | 'unknown' {
  if (typeof location !== 'object' || location === null || Array.isArray(location)) return 'unknown';
  const f = (location as Record<string, unknown>).format;
  return f === 'online' || f === 'in_person' || f === 'hybrid' ? f : 'unknown';
}

/**
 * 「地点不明确」：format 为 in_person 或 hybrid，且 city 与 state 都没有（空 / null / 缺失）。只有国家不算明确。
 * 形式未知 / 缺失 / 非法时返回 false——那种情况由「形式未知」规则处理（记 opportunity.location.format），不重复记地点。
 * explainMatch 与 analyzeReachability 共用这一个定义。入参按 unknown 处理，永不抛异常。
 */
export function isLocationUnclear(location: unknown): boolean {
  const format = readFormat(location);
  if (format !== 'in_person' && format !== 'hybrid') return false;
  const loc = location as Record<string, unknown>;
  return !hasText(loc.city) && !hasText(loc.state);
}

/** 能化解 transport 障碍的 grant 类型（与 SUPPORT_RESOLVES 中映射到 'transport' 的类型一致）。 */
const TRANSPORT_FIX_TYPES: readonly SupportType[] = ['transport_subsidy', 'alternative_access'];

function roundUpHalf(x: number): number {
  return Math.ceil(x * 2 - 1e-9) / 2;
}

export function analyzeReachability(
  profile: StudentProfile,
  opp: Opportunity,
  grants: ResourceGrant[],
  options?: EvalOptions,
): ReachabilityResult {
  const eligibility = checkEligibility(profile, opp, options);

  // ── 准备差距 ──
  const uncovered = opp.preparation.filter((prep) => findCoveringEvidence(profile, opp, prep).length === 0);
  const readiness_gaps: ReadinessGap[] = uncovered.map((prep) => {
    let reason: string;
    if (prep.skill) {
      const kind = prep.evidence_kind ? ` (type: ${EVIDENCE_KIND_ZH[prep.evidence_kind]})` : '';
      reason = `Your profile has no evidence${kind} showing "${prep.skill}" yet, and no evidence marked as completing "${prep.title}".`;
    } else {
      reason = `Your profile has no evidence marked as completing "${prep.title}" yet.`;
    }
    return {
      prep_item_id: prep.id,
      title: prep.title,
      skill: prep.skill ?? null,
      estimated_hours: prep.estimated_hours,
      estimated_cost_usd: prep.estimated_cost_usd,
      required_for_application: prep.required_for_application,
      reason,
    };
  });
  // 必需准备 = 未覆盖的必需项 + 它们未覆盖的前置依赖（传递），与 planRoutes 共用同一函数。
  const requiredPrep = requiredPrepClosure(profile, opp);
  const prepCost = requiredPrep.reduce((s, p) => s + nonNegOrZero(p.estimated_cost_usd), 0);
  const prepHours = requiredPrep.reduce((s, p) => s + nonNegOrZero(p.estimated_hours), 0);

  // ── grants ──
  // 只有 opportunity_id === null 才表示「对该学生的所有机会都有效」；
  // 缺少 opportunity_id 字段（undefined）的 grant 一律不生效（信息不足不猜）。
  const mine = grants.filter(
    (g) => g.student_id === profile.id && (g.opportunity_id === null || g.opportunity_id === opp.id),
  );
  const approved = mine.filter((g) => g.status === 'approved');
  const pending = mine.filter((g) => g.status === 'pending');
  const approvedOf = (t: SupportType) => approved.filter((g) => g.type === t);
  const pendingOf = (t: SupportType) => pending.filter((g) => g.type === t).map((g) => g.id);

  const barriers: Barrier[] = [];
  const missing: string[] = [];
  const miss = (f: string) => {
    if (!missing.includes(f)) missing.push(f);
  };

  // ── device ──
  if (opp.required_devices.length > 0) {
    if (profile.devices == null) {
      miss('profile.devices');
    } else {
      for (const device of opp.required_devices) {
        if (profile.devices.includes(device)) continue;
        const fixing = approvedOf('device').filter((g) => g.device === device);
        const pend = pending.filter((g) => g.type === 'device' && g.device === device).map((g) => g.id);
        barriers.push({
          type: 'device',
          description: `Needs ${DEVICE_ZH[device] ?? device}, which is not in your profile.`,
          shortfall: null,
          resolved: fixing.length > 0,
          resolved_by_grant_ids: fixing.map((g) => g.id),
          pending_grant_ids: pend,
        });
      }
    }
  }

  // ── cost ──
  const fee = opp.cost.fee_usd;
  const budget = profile.budget_usd;
  const waivers = approvedOf('fee_waiver');
  /** 有明确金额的已批准减免之和（可抵任何费用）。 */
  const knownWaivers = waivers.reduce((s, g) => s + (g.amount_usd ?? 0), 0);
  /** 是否有「金额为 null」的已批准减免：只表示免报名费，合计最多抵一次 fee_usd。 */
  const hasFeeOnlyWaiver = waivers.some((g) => g.amount_usd == null);
  if (fee == null) {
    miss('opportunity.cost.fee_usd');
    if (budget == null) {
      miss('profile.budget_usd');
    } else if (prepCost > budget + knownWaivers) {
      // 官方费用未知，但仅必需准备费用这个下限就已超出预算 + 有金额的减免 → 已确定走不通。
      const shortfall = prepCost - budget;
      const rest = prepCost - budget - knownWaivers;
      const waiverText = knownWaivers > 0 ? `; after the approved waiver of $${fmt(knownWaivers)}, ` : '; ';
      barriers.push({
        type: 'cost',
        description: `The official fee is not clear. Required prep alone costs about $${fmt(prepCost)}, over your budget of $${fmt(budget)}${waiverText}you are short at least $${fmt(rest)} (the official fee is not clear, so the real cost may be higher).`,
        shortfall,
        resolved: false,
        resolved_by_grant_ids: [],
        pending_grant_ids: pendingOf('fee_waiver'),
      });
    }
  } else {
    const need = fee + prepCost;
    if (need > 0) {
      if (budget == null) {
        miss('profile.budget_usd');
      } else if (need > budget) {
        const shortfall = need - budget;
        const covered = (hasFeeOnlyWaiver ? fee : 0) + knownWaivers;
        const resolved = waivers.length > 0 && covered >= shortfall;
        const parts = [`application / program fee $${fmt(fee)}`];
        if (prepCost > 0) parts.push(`required prep costs $${fmt(prepCost)}`);
        barriers.push({
          type: 'cost',
          description: `Needs about $${fmt(need)} (${parts.join(' + ')}), over your budget of $${fmt(budget)}; you are short $${fmt(shortfall)}.`,
          shortfall,
          resolved,
          resolved_by_grant_ids: resolved ? waivers.map((g) => g.id) : [],
          pending_grant_ids: pendingOf('fee_waiver'),
        });
      }
    }
  }

  // ── transport ──
  // location 不是对象、format 缺失或不是四个合法值之一（只可能来自浏览器本地存储 / 备份导入的坏数据）：
  // 一律按 unknown 处理，绝不当作线下或线上。
  const format = readFormat(opp.location);
  if (format !== 'online') {
    const formatKnown = format === 'in_person' || format === 'hybrid';
    const transport = profile.transport;
    const travel = opp.cost.requires_travel_expense;
    const reasons: string[] = [];
    if (transport == null) {
      miss('profile.transport');
    } else if (formatKnown && transport.level === 'none') {
      reasons.push('this is in person / hybrid, and right now you have almost no way to get there on your own');
    } else if (formatKnown && transport.level === 'limited') {
      reasons.push('this is in person / hybrid, and your transportation is limited');
    }
    if (travel === true) {
      // 「需要自费差旅」是主办方写明的事实，形式未知时照样成立；但那时文字只说差旅，不推断是线下项目。
      reasons.push(
        formatKnown
          ? 'the organizer says you must pay for your own travel, so good local transportation is not enough'
          : 'the organizer says you must pay for your own travel',
      );
    }
    let unresolvedTransport = false;
    if (reasons.length > 0) {
      // 交通补助与替代参与方式同等对待：任一 approved 即化解（保持 grants 输入顺序）。
      const isTransportFix = (g: ResourceGrant) => TRANSPORT_FIX_TYPES.includes(g.type);
      const subsidies = approved.filter(isTransportFix);
      unresolvedTransport = subsidies.length === 0;
      barriers.push({
        type: 'transport',
        description: `Transportation barrier: ${reasons.join('; ')}.`,
        shortfall: null,
        resolved: subsidies.length > 0,
        resolved_by_grant_ids: subsidies.map((g) => g.id),
        pending_grant_ids: pending.filter(isTransportFix).map((g) => g.id),
      });
    } else if (formatKnown && travel == null) {
      miss('opportunity.cost.requires_travel_expense');
    }
    if (!formatKnown) {
      // 形式未知：不当作线下（交通等级不造障碍），也不当作线上（不放行）→ reachable 不会是 true。
      if (travel == null) miss('opportunity.cost.requires_travel_expense');
      miss('opportunity.location.format');
    } else if (!unresolvedTransport && isLocationUnclear(opp.location)) {
      // 线下 / 混合但没有州和城市：不知道去哪，就无法确认「附近」能到、也无法确认已批准的补助 / 替代方式够用 →
      // 地点列为缺失信息（不造障碍、不给 true）。仍有未化解的交通障碍时结论已确定为 false，不再记。
      miss('opportunity.location');
    }
  }

  // ── time ──
  const timeSupport = approvedOf('time_support');
  const supportHours = timeSupport.reduce((s, g) => s + (g.hours_per_week ?? 0), 0);
  const available = profile.hours_per_week_available;
  const timeBarrier = (description: string, shortfall: number): Barrier => {
    const resolved = timeSupport.length > 0 && supportHours >= shortfall;
    return {
      type: 'time',
      description,
      shortfall,
      resolved,
      resolved_by_grant_ids: resolved ? timeSupport.map((g) => g.id) : [],
      pending_grant_ids: pendingOf('time_support'),
    };
  };

  // a) 参与期每周时间
  const needWeekly = opp.time_commitment.hours_per_week;
  if (needWeekly == null) miss('opportunity.time_commitment.hours_per_week');
  if (available == null) miss('profile.hours_per_week_available');
  if (needWeekly != null && available != null && needWeekly > available) {
    const shortfall = needWeekly - available;
    barriers.push(
      timeBarrier(
        `The program needs about ${plural(needWeekly, 'hour')} per week; you have ${plural(available, 'hour')} per week, so you are short ${plural(shortfall, 'hour')} per week.`,
        shortfall,
      ),
    );
  }

  // b) 截止前准备时间
  if (opp.deadline != null) {
    const deadline = parseISODate(opp.deadline);
    const today = parseISODate(options?.today);
    if (deadline == null) {
      miss('opportunity.deadline');
    } else if (today == null) {
      // 无法判断是否已过截止，也无法计算剩余时间。
      miss('options.today');
    } else if (daysBetween(today, deadline) < 0) {
      barriers.push({
        type: 'time',
        description: `The deadline (${opp.deadline}) has passed, so you can't apply this round. Watch for the next round or similar opportunities in the same field.`,
        shortfall: null,
        resolved: false,
        resolved_by_grant_ids: [],
        pending_grant_ids: [],
      });
    } else if (prepHours > 0) {
      if (available == null) {
        miss('profile.hours_per_week_available');
      } else {
        const daysLeft = daysBetween(today, deadline);
        const days = Math.max(daysLeft, 1);
        const weeks = days / 7;
        if (prepHours > available * weeks) {
          const shortfall = roundUpHalf(prepHours / weeks - available);
          const description =
            daysLeft === 0
              ? `The deadline is today (${opp.deadline}). About ${plural(prepHours, 'hour')} of required prep ${pluralNoun(prepHours, 'is', 'are')} not done, and that can't be finished today.`
              : `Before the deadline (${plural(days, 'day')} left) you need about ${plural(prepHours, 'hour')} of required prep. At ${plural(available, 'hour')} per week that is not enough; you are short about ${plural(shortfall, 'hour')} per week (rounded up to 0.5 hours).`;
          barriers.push(timeBarrier(description, shortfall));
        }
      }
    }
  }

  // ── reachable ──
  const unresolved = barriers.filter((b) => !b.resolved);
  let reachable: boolean | null;
  if (eligibility.overall === 'not_eligible' || unresolved.length > 0) reachable = false;
  else if (eligibility.overall === 'unknown' || missing.length > 0) reachable = null;
  else reachable = true;

  // ── summary ──
  let summary: string;
  if (reachable === false) {
    const blocking = eligibility.items.find((i) => i.hard && i.status === 'not_satisfied');
    if (blocking) {
      summary = `Not reachable right now: you don't meet the hard requirement "${blocking.label}".`;
    } else {
      summary = `Not reachable right now: ${unresolved[0].description}`;
      if (unresolved.length > 1) summary += ` (plus ${plural(unresolved.length - 1, 'more unresolved barrier')})`;
    }
  } else if (reachable === null) {
    const needs: string[] = [];
    const unknownHard = eligibility.items.filter((i) => i.hard && i.status === 'unknown').map((i) => `"${i.label}"`);
    if (unknownHard.length > 0) needs.push(`eligibility to confirm with the organizer: ${unknownHard.join(', ')}`);
    if (missing.length > 0) needs.push(`missing info: ${missing.map((f) => MISSING_ZH[f] ?? f).join(', ')}`);
    summary = `We can't tell yet if this is reachable. ${needs.join('; ')}.`;
  } else {
    const resolvedCount = barriers.length;
    summary =
      resolvedCount > 0
        ? `Based on current info, this is realistically doable (${plural(resolvedCount, 'barrier')} resolved by approved support). Reachable does not mean admitted.`
        : 'Based on current info, this is realistically doable. Reachable does not mean admitted.';
  }

  return {
    profile_id: profile.id,
    opportunity_id: opp.id,
    eligibility,
    readiness_gaps,
    barriers,
    reachable,
    missing_info: missing,
    applied_grant_ids: approved.map((g) => g.id),
    summary,
  };
}
