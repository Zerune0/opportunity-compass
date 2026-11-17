/**
 * analyzeReachability(profile, opp, grants, options?) — 资格 + 准备差距 + 现实障碍 + 是否可达（第 1 层实现）。
 * 可达 ≠ 录取。
 *
 * 规则：
 * 1. eligibility = checkEligibility(profile, opp, options)。
 * 2. 准备差距 = 没有被证据覆盖的准备项（覆盖规则见 ./coverage.ts）。
 * 3. 只计入 student_id 与 opportunity_id 都匹配的 grants：approved 才能化解障碍（记入 applied_grant_ids）；
 *    pending 只列入对应障碍的 pending_grant_ids，不算化解。
 * 4. 四类障碍。信息不足时不造障碍，而是把缺的字段写进 missing_info：
 *    - device：缺的每个设备一条障碍；approved 且 device 相同的 device grant → 化解。
 *    - cost：需要的钱 = fee_usd + 未覆盖且申请必需的准备项费用；超过 budget_usd → 障碍（shortfall = 差额）；
 *      approved fee_waiver 金额之和 ≥ 差额 → 化解（amount_usd 为 null 视为全额免除 fee_usd）。
 *    - transport：线上机会跳过；交通 none/limited 或需要自费差旅 → 一条障碍；任一 approved transport_subsidy → 化解。
 *      若交通没填但官方明确需要自费差旅，仍记障碍，同时把 profile.transport 列为缺失信息。
 *    - time（最多两条）：
 *      a) 参与期每周时间：需要 > 可用 → 障碍（shortfall = 每周缺口）；time_support 小时和 ≥ 缺口 → 化解。
 *      b) 截止前准备时间：H = 未覆盖且申请必需的准备项小时合计。
 *         只要有截止日期和 today 且截止日期早于 today → 「已过截止日期」障碍，任何 grant 都不能化解（与 H 无关）。
 *         否则 H = 0 或无截止日期（滚动）→ 跳过；没有 today → 缺 options.today；
 *         剩余周数 W = max(剩余天数, 1) / 7；H > 可用 × W → 障碍，
 *         shortfall = 每周还缺的小时（向上取整到 0.5 小时）；time_support 小时和 ≥ shortfall → 化解。
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
import { findCoveringEvidence } from './coverage';

export { evidenceCoversPrep, findCoveringEvidence } from './coverage';

const DEVICE_ZH: Record<string, string> = {
  laptop: '笔记本电脑',
  desktop: '台式电脑',
  smartphone: '智能手机',
  tablet: '平板电脑',
  webcam: '摄像头',
  home_internet: '家里稳定的网络',
};

/** missing_info 字段 → 面向学生的中文名。 */
const MISSING_ZH: Record<string, string> = {
  'profile.devices': '你有哪些设备',
  'profile.budget_usd': '你能自掏的预算',
  'profile.transport': '你的交通条件',
  'profile.hours_per_week_available': '你每周可用的小时数',
  'opportunity.cost.fee_usd': '官方费用（官网未写清）',
  'opportunity.cost.requires_travel_expense': '是否需要自费差旅（官网未写清）',
  'opportunity.time_commitment.hours_per_week': '参与期间每周需要的时间（官网未写清）',
  'opportunity.deadline': '截止日期（格式无法识别）',
  'options.today': '今天的日期',
};

function roundUpHalf(x: number): number {
  return Math.ceil(x * 2 - 1e-9) / 2;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
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
      const kind = prep.evidence_kind ? `「${EVIDENCE_KIND_ZH[prep.evidence_kind]}」类` : '';
      reason = `档案中还没有体现「${prep.skill}」的${kind}证据，也没有标注完成「${prep.title}」的证据。`;
    } else {
      reason = `档案中还没有标注完成「${prep.title}」的证据。`;
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
  const requiredUncovered = uncovered.filter((p) => p.required_for_application);
  const prepCost = requiredUncovered.reduce((s, p) => s + p.estimated_cost_usd, 0);
  const prepHours = requiredUncovered.reduce((s, p) => s + p.estimated_hours, 0);

  // ── grants ──
  const mine = grants.filter((g) => g.student_id === profile.id && g.opportunity_id === opp.id);
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
          description: `需要${DEVICE_ZH[device] ?? device}，档案中没有。`,
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
  if (fee == null) {
    miss('opportunity.cost.fee_usd');
  } else {
    const need = fee + prepCost;
    if (need > 0) {
      const budget = profile.budget_usd;
      if (budget == null) {
        miss('profile.budget_usd');
      } else if (need > budget) {
        const shortfall = need - budget;
        const waivers = approvedOf('fee_waiver');
        const covered = waivers.reduce((s, g) => s + (g.amount_usd == null ? fee : g.amount_usd), 0);
        const resolved = waivers.length > 0 && covered >= shortfall;
        const parts = [`报名 / 项目费 $${fmt(fee)}`];
        if (prepCost > 0) parts.push(`必需准备项费用 $${fmt(prepCost)}`);
        barriers.push({
          type: 'cost',
          description: `需要约 $${fmt(need)}（${parts.join(' + ')}），超出你的预算 $${fmt(budget)}，还差 $${fmt(shortfall)}。`,
          shortfall,
          resolved,
          resolved_by_grant_ids: resolved ? waivers.map((g) => g.id) : [],
          pending_grant_ids: pendingOf('fee_waiver'),
        });
      }
    }
  }

  // ── transport ──
  if (opp.location.format !== 'online') {
    const transport = profile.transport;
    const reasons: string[] = [];
    if (transport == null) {
      miss('profile.transport');
    } else if (transport.level === 'none') {
      reasons.push('这是线下 / 混合形式的机会，而你目前基本无法自行前往线下地点');
    } else if (transport.level === 'limited') {
      reasons.push('这是线下 / 混合形式的机会，而你的交通条件有限');
    }
    if (opp.cost.requires_travel_expense === true) {
      reasons.push('官方说明需要自费差旅，本地通勤条件好也不够');
    }
    if (reasons.length > 0) {
      const subsidies = approvedOf('transport_subsidy');
      barriers.push({
        type: 'transport',
        description: `交通障碍：${reasons.join('；')}。`,
        shortfall: null,
        resolved: subsidies.length > 0,
        resolved_by_grant_ids: subsidies.map((g) => g.id),
        pending_grant_ids: pendingOf('transport_subsidy'),
      });
    } else if (opp.cost.requires_travel_expense == null) {
      miss('opportunity.cost.requires_travel_expense');
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
        `参与期间每周需要约 ${fmt(needWeekly)} 小时，你每周可用 ${fmt(available)} 小时，每周还差 ${fmt(shortfall)} 小时。`,
        shortfall,
      ),
    );
  }

  // b) 截止前准备时间
  if (opp.deadline != null) {
    const deadline = parseISODate(opp.deadline);
    const today = parseISODate(options?.today);
    if (deadline == null) {
      if (prepHours > 0) miss('opportunity.deadline');
    } else if (today != null && daysBetween(today, deadline) < 0) {
      barriers.push({
        type: 'time',
        description: `已过截止日期（${opp.deadline}），本届无法再申请；可以关注下一届或同领域的其他机会。`,
        shortfall: null,
        resolved: false,
        resolved_by_grant_ids: [],
        pending_grant_ids: [],
      });
    } else if (prepHours > 0) {
      if (today == null) {
        miss('options.today');
      } else if (available == null) {
        miss('profile.hours_per_week_available');
      } else {
        const days = Math.max(daysBetween(today, deadline), 1);
        const weeks = days / 7;
        if (prepHours > available * weeks) {
          const shortfall = roundUpHalf(prepHours / weeks - available);
          barriers.push(
            timeBarrier(
              `截止前（还剩 ${days} 天）需要完成约 ${fmt(prepHours)} 小时的必需准备，按你每周 ${fmt(available)} 小时来不及，每周还差约 ${fmt(shortfall)} 小时（向上取整到 0.5 小时）。`,
              shortfall,
            ),
          );
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
      summary = `目前不可达：不满足硬性要求「${blocking.label}」。`;
    } else {
      summary = `目前不可达：${unresolved[0].description}`;
      if (unresolved.length > 1) summary += `（另有 ${unresolved.length - 1} 个未化解的障碍）`;
    }
  } else if (reachable === null) {
    const needs: string[] = [];
    const unknownHard = eligibility.items.filter((i) => i.hard && i.status === 'unknown').map((i) => `「${i.label}」`);
    if (unknownHard.length > 0) needs.push(`资格待确认：${unknownHard.join('、')}`);
    if (missing.length > 0) needs.push(`还缺信息：${missing.map((f) => MISSING_ZH[f] ?? f).join('、')}`);
    summary = `暂时无法判断是否可达。${needs.join('；')}。`;
  } else {
    const resolvedCount = barriers.length;
    summary =
      resolvedCount > 0
        ? `按目前信息，现实条件上走得通（${resolvedCount} 个障碍已被已批准的资源化解）。可达不等于录取。`
        : '按目前信息，现实条件上走得通。可达不等于录取。';
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
