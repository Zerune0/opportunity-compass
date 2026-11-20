/**
 * explainMatch 的完整实现（第二阶段第 2 层）。规则说明见 ./index.ts 文件头。
 *
 * 只整理已有引擎的结论，不另写判断：资格来自 checkEligibility（经 analyzeReachability），
 * 现实条件来自 analyzeReachability 的 barriers / missing_info；这里只把它们拆成分项理由、写成一句话。
 * 公平性：不读取学校名、显示名。纯函数：日期只来自 options.today 与机会数据，不读系统时钟、无随机、无 IO、不调 AI。
 */
import { analyzeReachability, isLocationUnclear, requiredPrepClosure } from '../reachability';
import { nonNegOrZero } from '../reachability/coverage';
import { daysBetween, parseISODate } from '../eligibility/dates';
import { fmt, joinAnd, plural, pluralNoun } from '../format';
import { asArray, safeOpportunity, safeProfile } from '../gap/inputs';
import { normalizedTagSet, sharedTags } from '../tags';
import { blockNature, type BlockNature } from './block';
import { profileFieldIssues } from './profile-issues';
import { MATCH_REASON_KINDS } from '../types';
import type {
  Barrier,
  BarrierType,
  EligibilityItem,
  EvalOptions,
  MatchExplanation,
  MatchOptions,
  MatchReason,
  MatchReasonKind,
  Opportunity,
  OverallEligibility,
  ReachabilityResult,
  ResourceGrant,
  StudentProfile,
} from '../types';

/** 资格理由里最多逐条列出的要求数，其余写「还有 N 条」。 */
const MAX_LISTED = 3;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// ───────────────────────────── 可读名称（与 analyzeGaps 的 FIELD_INFO 同一说法）─────────────────────────────

/** missing_info / 损坏字段 → 面向学生的名称。未列出的字段用最后一段字段名兜底，不露出内部前缀。 */
const FIELD_LABEL: Record<string, string> = {
  'profile.devices': 'which devices you have',
  'profile.budget_usd': 'how much you can pay yourself',
  'profile.transport': 'your transportation',
  'profile.hours_per_week_available': 'how many hours you have each week',
  'profile.skills': 'your skills',
  'profile.statuses': 'your status (for example high school student)',
  'profile.citizenships': 'your citizenship / legal residency',
  'profile.region': 'where you live',
  'profile.grade': 'your grade',
  'profile.age': 'your age',
  'profile.evidence': 'your evidence entries',
  'opportunity.cost.fee_usd': 'the official fee',
  'opportunity.cost.requires_travel_expense': 'whether participants must pay for their own travel',
  'opportunity.time_commitment.hours_per_week': 'how many hours per week the program needs',
  'opportunity.deadline': 'the deadline (the date given cannot be read)',
  'opportunity.location.format': 'whether it takes place online or in person',
  'opportunity.location': 'where exactly it takes place',
  'options.today': "today's date",
  'opportunity.deadline.closing_time': 'the exact closing time and time zone on the deadline day',
};

function fieldLabel(field: string): string {
  const known = FIELD_LABEL[field];
  if (known) return known;
  const last = field.split('.').filter((s) => s !== '').pop() ?? '';
  const readable = last.replace(/_/g, ' ').trim();
  return readable === '' ? 'some details' : `the "${readable}" information`;
}

/** 一组缺失字段 → 「在 Skill Passport 填写 …」/「向主办方确认 …」/「页面没有传今天的日期」几句话。 */
function missingText(fields: string[]): string {
  const profile = fields.filter((f) => f.startsWith('profile.')).map(fieldLabel);
  const opp = fields.filter((f) => f.startsWith('opportunity.')).map(fieldLabel);
  const parts: string[] = [];
  if (profile.length > 0) parts.push(`fill in ${joinAnd(profile)} in your Skill Passport`);
  if (opp.length > 0) parts.push(`confirm ${joinAnd(opp)} with the organizer`);
  if (fields.includes('options.today')) parts.push("reload the page so it can pass today's date");
  return parts.length > 0 ? `To check it, ${joinAnd(parts)}.` : '';
}

const DEVICE_LABEL: Record<string, string> = {
  laptop: 'a laptop',
  desktop: 'a desktop computer',
  smartphone: 'a smartphone',
  tablet: 'a tablet',
  webcam: 'a webcam',
  home_internet: 'reliable home internet',
};

const DEVICE_NOUN: Record<string, string> = {
  laptop: 'laptop',
  desktop: 'desktop computer',
  smartphone: 'smartphone',
  tablet: 'tablet',
  webcam: 'webcam',
  home_internet: 'home internet',
};

const BARRIER_NAME: Record<BarrierType, string> = {
  time: 'time',
  cost: 'cost',
  transport: 'transportation',
  device: 'device',
};

/** 与 analyzeGaps 同一口径：pending 的支持尚未生效。 */
function pendingNote(n: number): string {
  if (n <= 0) return '';
  const lead = n === 1 ? 'There is a pending support request for this' : `There are ${n} pending support requests for this`;
  return ` ${lead}; ${pluralNoun(n, 'it is', 'they are')} not in effect yet (pending is not approved).`;
}

/** 已过截止日期的 time 障碍：analyzeReachability 只在这种情况下给 shortfall 为 null 的 time 障碍。 */
function isDeadlinePassed(b: Barrier): boolean {
  return b.type === 'time' && b.shortfall == null;
}

/** 与 analyzeReachability 相同的「对本学生、本机会生效」规则。 */
function appliesTo(g: ResourceGrant, p: StudentProfile, o: Opportunity): boolean {
  return g.student_id === p.id && (g.opportunity_id === null || g.opportunity_id === o.id);
}

function approvedGrants(grants: ResourceGrant[], p: StudentProfile, o: Opportunity): ResourceGrant[] {
  return grants.filter((g) => g.status === 'approved' && appliesTo(g, p, o));
}

/** 已批准且有金额的 fee_waiver 之和（与 analyzeGaps 的 coverage('cost') 同一算法）。 */
function costCoverage(grants: ResourceGrant[], p: StudentProfile, o: Opportunity): number {
  const waivers = approvedGrants(grants, p, o).filter((g) => g.type === 'fee_waiver');
  const known = waivers.reduce((s, g) => s + (typeof g.amount_usd === 'number' ? g.amount_usd : 0), 0);
  const fee = o.cost?.fee_usd;
  if (typeof fee !== 'number') return known;
  return known + (waivers.some((g) => g.amount_usd == null) ? fee : 0);
}

function reason(kind: MatchReasonKind, positive: boolean | null, text: string): MatchReason {
  return { kind, positive, text: text.replace(/\s+/g, ' ').trim() };
}

// ───────────────────────────── interest ─────────────────────────────

function interestReason(p: StudentProfile, o: Opportunity, shared: string[]): MatchReason {
  if (!Array.isArray(p.interests) || p.interests.length === 0) {
    return reason('interest', null, "You haven't added any interests yet, so we can't compare them with this opportunity's fields. You can add them in your Skill Passport.");
  }
  if (o.fields.length === 0) return reason('interest', null, "This opportunity lists no fields, so we can't compare it with your interests.");
  if (shared.length > 0) return reason('interest', true, `Matches your interests: ${shared.join(', ')}.`);
  return reason('interest', false, `None of your interests match this opportunity's fields (${o.fields.join(', ')}).`);
}

// ───────────────────────────── eligibility ─────────────────────────────

function natureText(item: EligibilityItem, nature: BlockNature): string {
  if (nature === 'improvable') {
    return item.requirement_type === 'grade' ? 'you may meet it later as you move up a grade' : 'you may meet it later as you get older';
  }
  if (nature === 'fixable') return 'something you can work on yourself';
  return 'not something you can change by preparing';
}

function moreText(n: number): string {
  return n > MAX_LISTED ? `, and ${n - MAX_LISTED} more` : '';
}

/**
 * checkEligibility 在「档案缺这一项」时给的确认提示（lib/eligibility 的 fillProfileHint）以
 * "Add your <字段> to your profile first." 开头；其余 unknown（manual、日期算不出、生日不确定等）是向主办方确认。
 */
const FILL_PROFILE_HINT = /^Add your (.+?) to your profile first\./;

/** unknown 的硬性要求需要学生补填还是向主办方确认：以引擎返回的 confirm_with_official 为准，不另猜。 */
function unknownAction(item: EligibilityItem): string {
  const hint = typeof item.confirm_with_official === 'string' ? FILL_PROFILE_HINT.exec(item.confirm_with_official) : null;
  return hint ? `fill in your ${hint[1]} in your Skill Passport` : 'confirm with the organizer';
}

function eligibilityReason(r: ReachabilityResult, p: StudentProfile, o: Opportunity, opts: EvalOptions | undefined): MatchReason {
  const overall = r.eligibility.overall;
  if (overall === 'eligible') return reason('eligibility', true, 'You meet every hard official requirement we can check.');
  if (overall === 'not_eligible') {
    const blocking = r.eligibility.items.filter((i) => i.hard && i.status === 'not_satisfied');
    const natures = blocking.map((i) => blockNature(i, p, o, opts));
    const listed = blocking.slice(0, MAX_LISTED).map((i, k) => `"${i.label}" (${natureText(i, natures[k])})`);
    const n = blocking.length;
    const lead = n === 1 ? "You don't meet this hard official requirement" : `You don't meet ${n} hard official requirements`;
    const later = natures.includes('improvable')
      ? ' If you meet it later, check the official requirements again at that time, since they can change.'
      : '';
    return reason('eligibility', false, `${lead}: ${listed.join('; ')}${moreText(n)}.${later}`);
  }
  const unknown = r.eligibility.items.filter((i) => i.hard && i.status === 'unknown');
  const listed = unknown.slice(0, MAX_LISTED).map((i) => `"${i.label}" (${unknownAction(i)})`);
  const n = unknown.length;
  const lead = n === 1 ? "We can't check this hard requirement yet" : `We can't check ${n} hard requirements yet`;
  return reason('eligibility', null, `${lead}: ${listed.join('; ')}${moreText(n)}. We did not guess.`);
}

// ───────────────────────────── format ─────────────────────────────

function placeText(o: Opportunity): string {
  const loc = isObject(o.location) ? (o.location as unknown as Record<string, unknown>) : {};
  const parts = [loc.city, loc.state, loc.country].filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return parts.length > 0 ? ` in ${parts.join(', ')}` : '';
}

/** 地点不明确时的开头：有国家时说「只给了国家」，连国家都没有时只说「没说在哪」。 */
function unclearLead(format: unknown, o: Opportunity): string {
  const lead = format === 'hybrid' ? 'It is hybrid (partly in person)' : 'It is in person';
  const only = placeText(o) === '' ? 'has not said where' : 'has not said where (only the country is given)';
  return `${lead}, but the organizer ${only}`;
}

/**
 * The opportunity takes place outside the student's home area: both countries are known and differ ("country"),
 * or both states / provinces are known and differ in the same (or an unstated) country ("state").
 * Returns null when it can't tell (either side doesn't say), and 'unclear' when the states are written differently
 * and are not both two-letter codes (so they may be the same place).
 */
function outsideHomeArea(p: StudentProfile, o: Opportunity): 'country' | 'state' | 'unclear' | null {
  const norm = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim().toUpperCase() : null);
  const region = isObject(p.region) ? (p.region as { country?: unknown; state?: unknown }) : null;
  const loc = isObject(o.location) ? (o.location as { country?: unknown; state?: unknown }) : null;
  const pc = norm(region?.country), oc = norm(loc?.country);
  if (pc && oc && pc !== oc) return 'country';
  const ps = norm(region?.state), os = norm(loc?.state);
  if (ps && os && ps !== os && (!pc || !oc || pc === oc)) {
    // The profile's state is free text: only two-letter codes can be compared ("California" vs "CA" is not "away").
    const code = /^[A-Z]{2}$/;
    return code.test(ps) && code.test(os) ? 'state' : 'unclear';
  }
  return null;
}

function formatReason(p: StudentProfile, o: Opportunity, transportBarriers: Barrier[]): MatchReason {
  const format = isObject(o.location) ? (o.location as { format?: unknown }).format : undefined;
  if (format === 'online') return reason('format', true, 'It runs online, so you can take part without traveling.');
  if (format === 'unknown') {
    // 官网没说清参与形式：不当作线上、混合或线下。
    return reason('format', null, 'The organizer has not said whether this is online or in person. Confirm the format with the organizer.');
  }
  if (format !== 'in_person' && format !== 'hybrid') {
    return reason('format', null, "The opportunity information doesn't say clearly whether it is online or in person. Confirm it with the organizer.");
  }
  const what = format === 'hybrid' ? `It is hybrid (partly in person${placeText(o)})` : `It is in person${placeText(o)}`;
  const t = isObject(p.transport) ? (p.transport as { level?: unknown }).level : undefined;
  const allResolved = transportBarriers.length > 0 && transportBarriers.every((b) => b.resolved);
  if (t === 'reliable') {
    // 交通可靠但引擎仍有未化解的交通障碍（如需自费差旅）：提醒去看 transport 那条，避免只看这一条以为没问题。
    const travel = transportBarriers.some((b) => !b.resolved)
      ? ' Getting there still has an unresolved issue (such as paying for your own travel); see the transportation reason.'
      : '';
    if (isLocationUnclear(o.location)) {
      // 没有州和城市：地点没定，「附近」无从谈起 → 无法判断。
      return reason('format', null, `${unclearLead(format, o)}, so we can't tell whether you can get there. Confirm the location with the organizer.${travel}`);
    }
    const away = outsideHomeArea(p, o);
    if (away === 'unclear') {
      return reason('format', null, `${what}. We can't tell from your profile whether that is in your state; use the two-letter state code in your Skill Passport, or check with the organizer how travel works.${travel}`);
    }
    if (away) {
      // 机会在学生所在州 / 国家以外：「附近交通可靠」不能说明去得了（issue 70）。
      // 未化解的交通障碍（如需自费差旅）→ false；交通障碍都已被批准的支持化解，或主办方写明不需要自费差旅 → true；
      // 其余（是否自费差旅未写明等）→ null，不猜。
      const lead = `${what}, which is outside your ${away}. Reliable local transportation does not show that you can get there`;
      if (transportBarriers.some((b) => !b.resolved)) {
        return reason('format', false, `${lead}, and getting there has an unresolved issue (such as paying for your own travel); see the transportation reason.`);
      }
      if (allResolved) {
        return reason('format', true, `${what}, which is outside your ${away}; the transportation support the organizer approved covers getting there.`);
      }
      if (o.cost?.requires_travel_expense === false) {
        return reason('format', true, `${what}, which is outside your ${away}; the organizer says participants do not pay for their own travel. Confirm how travel is arranged.`);
      }
      return reason('format', null, `${lead}. Check with the organizer how travel works and who pays for it.`);
    }
    return reason('format', true, `${what}, and your profile says you can reliably get to places nearby. Check how far it is from you.${travel}`);
  }
  if (t === 'limited' || t === 'none') {
    const own = t === 'none' ? 'you have almost no way to get to in-person places on your own' : 'your transportation is limited';
    if (allResolved && isLocationUnclear(o.location)) {
      // 支持已批准，但不知道去哪：无法确认它够不够用（引擎此时为 null，不给 true）。
      return reason(
        'format',
        null,
        `${unclearLead(format, o)}. Your profile says ${own}; the organizer approved transportation support, but without the location we can't confirm it is enough. Confirm the location with the organizer.`,
      );
    }
    if (allResolved) {
      return reason('format', true, `${what}. Your profile says ${own}, but the transportation support the organizer approved covers getting there.`);
    }
    return reason('format', false, `${what}, and your profile says ${own}.`);
  }
  return reason('format', null, `${what}. Your profile doesn't say what transportation you have, so we can't tell whether getting there works for you. Fill it in in your Skill Passport.`);
}

// ───────────────────────────── time ─────────────────────────────

const TIME_FIELDS = [
  'profile.hours_per_week_available',
  'opportunity.time_commitment.hours_per_week',
  'opportunity.deadline',
  'opportunity.deadline.closing_time',
  'options.today',
];

function timeReason(r: ReachabilityResult, p: StudentProfile, o: Opportunity, opts: EvalOptions | undefined): MatchReason {
  const time = r.barriers.filter((b) => b.type === 'time');
  const passed = time.find(isDeadlinePassed);
  if (passed) return reason('time', false, passed.description);

  const unresolved = time.filter((b) => !b.resolved);
  const resolved = time.filter((b) => b.resolved);
  if (unresolved.length > 0) {
    const pend = new Set(unresolved.flatMap((b) => b.pending_grant_ids ?? []));
    const more = unresolved.length > 1 ? ` ${unresolved[1].description}` : '';
    return reason('time', false, `${unresolved[0].description}${more}${pendingNote(pend.size)}`);
  }

  const parts: string[] = [];
  if (resolved.length > 0) parts.push('The time support the organizer approved covers the extra hours per week you would need.');
  const need = finite(o.time_commitment?.hours_per_week);
  const have = finite(p.hours_per_week_available);
  if (need != null && have != null && resolved.length === 0) {
    parts.push(`The program needs about ${plural(need, 'hour')} per week and you have ${plural(have, 'hour')} per week.`);
  }
  const deadline = typeof o.deadline === 'string' ? parseISODate(o.deadline) : null;
  const today = parseISODate(opts?.today);
  if (o.deadline == null) {
    parts.push('No deadline is listed (it may be rolling); check the official page.');
  } else if (deadline != null && today != null) {
    const days = daysBetween(today, deadline);
    const prepHours = requiredPrepClosure(p, o).reduce((s, x) => s + nonNegOrZero(x.estimated_hours), 0);
    const left = days === 0 ? `The deadline (${o.deadline}) is today` : `${plural(days, 'day')} ${pluralNoun(days, 'is', 'are')} left before the deadline (${o.deadline})`;
    // 截止当天不说「放得下」：截止的具体时刻未知（引擎记 opportunity.deadline.closing_time，下面给 null）。
    const prep =
      days === 0
        ? prepHours > 0
          ? `; your required prep is about ${plural(prepHours, 'hour')}`
          : '; no required prep is left'
        : prepHours > 0
        ? resolved.length > 0
          ? `; your required prep (about ${plural(prepHours, 'hour')}) fits with that support`
          : `; your required prep (about ${plural(prepHours, 'hour')}) fits in that time at your weekly hours`
        : '; no required prep is left';
    parts.push(`${left}${prep}.`);
  }

  const missing = r.missing_info.filter((f) => TIME_FIELDS.includes(f));
  if (missing.length > 0) {
    return reason('time', null, `${parts.join(' ')} We can't fully check the time yet: ${joinAnd(missing.map(fieldLabel))} ${pluralNoun(missing.length, 'is', 'are')} missing or unclear. ${missingText(missing)}`);
  }
  return reason('time', true, parts.join(' '));
}

// ───────────────────────────── cost ─────────────────────────────

function costReason(r: ReachabilityResult, p: StudentProfile, o: Opportunity, grants: ResourceGrant[]): MatchReason {
  const fee = finite(o.cost?.fee_usd);
  const aid = o.cost?.financial_aid_available === true ? ' The organizer says financial aid is available, but that does not mean you have it.' : '';
  const cost = r.barriers.filter((b) => b.type === 'cost');
  const unresolved = cost.filter((b) => !b.resolved);
  if (unresolved.length > 0) {
    const b = unresolved[0];
    const short = finite(b.shortfall);
    const cover = fee == null ? 0 : costCoverage(grants, p, o);
    // 官方费用已知且已批准的支持只抵掉一部分：与 analyzeGaps 同样说明还差多少（官方费用未知时引擎描述已扣掉有金额的减免）。
    const partial =
      fee != null && short != null && cover > 0 && cover < short
        ? ` Approved support already covers $${fmt(cover)} of it, so about $${fmt(short - cover)} is still uncovered.`
        : '';
    return reason('cost', false, `${b.description}${partial}${aid}${pendingNote((b.pending_grant_ids ?? []).length)}`);
  }
  if (cost.length > 0) {
    const short = finite(cost[0].shortfall);
    return reason(
      'cost',
      true,
      `The fee waiver the organizer approved covers the ${short != null ? `$${fmt(short)} ` : ''}you were short.`,
    );
  }

  const prepCost = requiredPrepClosure(p, o).reduce((s, x) => s + nonNegOrZero(x.estimated_cost_usd), 0);
  const budget = finite(p.budget_usd);
  const missing = r.missing_info.filter((f) => f === 'opportunity.cost.fee_usd' || f === 'profile.budget_usd');
  if (missing.length > 0) {
    let known: string;
    if (fee != null) {
      known = `It costs about $${fmt(fee + prepCost)}${prepCost > 0 ? ` (fee $${fmt(fee)} + required prep $${fmt(prepCost)})` : ''}.`;
    } else if (budget != null && prepCost > 0) {
      // 官方费用未知时引擎只用「有金额的已批准减免」抵必需准备费；没有障碍说明 prepCost ≤ 预算 + 这些减免。
      const waived = costCoverage(grants, p, o);
      known =
        prepCost <= budget
          ? `The official fee is not clear. Required prep alone (about $${fmt(prepCost)}) fits your budget of $${fmt(budget)}, but the total may be more.`
          : `The official fee is not clear. Required prep alone (about $${fmt(prepCost)}) is more than your budget of $${fmt(budget)}; it only fits once the $${fmt(waived)} of support the organizer approved is added, and the official fee may make the total higher.`;
    } else {
      known = 'The official fee is not clear.';
    }
    return reason('cost', null, `${known} We can't tell yet whether it fits what you can pay. ${missingText(missing)}${aid}`);
  }
  if (fee == null) return reason('cost', null, `The official fee is not clear. ${missingText(['opportunity.cost.fee_usd'])}`);
  const need = fee + prepCost;
  if (need <= 0) return reason('cost', true, 'There is no fee, and the required prep has no listed cost.');
  const breakdown = prepCost > 0 ? ` (fee $${fmt(fee)} + required prep $${fmt(prepCost)})` : '';
  const within = budget != null ? `, within your budget of $${fmt(budget)}` : '';
  return reason('cost', true, `It costs about $${fmt(need)}${breakdown}${within}.`);
}

// ───────────────────────────── device ─────────────────────────────

function deviceReason(r: ReachabilityResult, p: StudentProfile, o: Opportunity): MatchReason {
  const required = o.required_devices.map((d) => String(d));
  if (required.length === 0) return reason('device', true, "It doesn't list any required devices.");
  const needText = joinAnd(required.map((d) => DEVICE_LABEL[d] ?? d));
  if (!Array.isArray(p.devices)) {
    return reason('device', null, `It needs ${needText}. Your profile doesn't say which devices you have, so we can't tell. Fill it in in your Skill Passport.`);
  }
  const have = p.devices as unknown[];
  const missing = required.filter((d) => !have.includes(d));
  const barriers = r.barriers.filter((b) => b.type === 'device');
  // 设备障碍与「档案里没有的必需设备」按引擎同样的顺序一一对应；数量对不上时（不应发生）只用引擎描述。
  const aligned = missing.length === barriers.length;
  if (barriers.length === 0) return reason('device', true, `You have the required ${pluralNoun(required.length, 'device', 'devices')} (${needText}).`);

  const sentences = barriers.map((b, i) => {
    const d = aligned ? missing[i] : null;
    const noun = d ? (DEVICE_NOUN[d] ?? d) : null;
    if (b.resolved) {
      if (!noun) return 'Support the organizer approved covers a required device.';
      const what = d === 'home_internet' ? `${noun} support` : `${noun} loan`;
      return `The ${what} the organizer approved covers the ${noun} requirement.`;
    }
    return `${b.description}${pendingNote((b.pending_grant_ids ?? []).length)}`;
  });
  const anyUnresolved = barriers.some((b) => !b.resolved);
  return reason('device', !anyUnresolved, sentences.join(' '));
}

// ───────────────────────────── transport ─────────────────────────────

const TRANSPORT_FIELDS = [
  'profile.transport',
  'opportunity.cost.requires_travel_expense',
  'opportunity.location.format',
  'opportunity.location',
];

function transportReason(r: ReachabilityResult, p: StudentProfile, o: Opportunity, grants: ResourceGrant[]): MatchReason | null {
  const format = isObject(o.location) ? (o.location as { format?: unknown }).format : undefined;
  if (format === 'online') return null; // 线上机会没有交通问题，format 理由已说明。
  const barriers = r.barriers.filter((b) => b.type === 'transport');
  const unresolved = barriers.filter((b) => !b.resolved);
  if (unresolved.length > 0) {
    const b = unresolved[0];
    return reason('transport', false, `${b.description}${pendingNote((b.pending_grant_ids ?? []).length)}`);
  }
  if (barriers.length > 0) {
    const ids = new Set(barriers.flatMap((b) => b.resolved_by_grant_ids));
    const used = grants.filter((g) => ids.has(g.id));
    const kinds: string[] = [];
    if (used.some((g) => g.type === 'transport_subsidy')) kinds.push('travel subsidy');
    if (used.some((g) => g.type === 'alternative_access')) kinds.push('alternative way to take part');
    const what = kinds.length > 0 ? joinAnd(kinds) : 'transportation support';
    // 支持已批准，但形式未知或地点不明确：无法确认它够不够用，不说「covers getting there」（引擎此时为 null）。
    const open = r.missing_info.filter((f) => f === 'opportunity.location.format' || f === 'opportunity.location');
    if (open.length > 0) {
      return reason(
        'transport',
        null,
        `The organizer approved a ${what}, but ${joinAnd(open.map(fieldLabel))} ${pluralNoun(open.length, 'is', 'are')} not clear, so we can't confirm it is enough. ${missingText(open)}`,
      );
    }
    return reason('transport', true, `The ${what} the organizer approved covers getting there.`);
  }
  // 形式未知 / 地点不明确也属于交通这一项的缺失信息：不能说没问题，也不说有障碍。
  const missing = r.missing_info.filter((f) => TRANSPORT_FIELDS.includes(f));
  if (missing.length > 0) {
    return reason('transport', null, `We can't fully check transportation yet: ${joinAnd(missing.map(fieldLabel))} ${pluralNoun(missing.length, 'is', 'are')} missing or unclear. ${missingText(missing)}`);
  }
  const t = isObject(p.transport) ? (p.transport as { level?: unknown }).level : undefined;
  const travel = o.cost?.requires_travel_expense === false ? ' and the organizer does not require you to pay for your own travel' : '';
  return reason('transport', true, `No transportation barrier: your transportation is ${t === 'reliable' ? 'reliable' : 'listed in your profile'}${travel}.`);
}

// ───────────────────────────── summary ─────────────────────────────

function interestClause(interest: MatchReason, shared: string[]): string {
  if (interest.positive === true) return `it matches your interests (${shared.join(', ')})`;
  if (interest.positive === false) return "it doesn't overlap with your listed interests";
  return "we can't compare it with your interests yet";
}

/** 现实条件为什么不可达：已过截止 / 未化解障碍的类别（按 BARRIER 顺序，去重）。 */
function blockedClause(r: ReachabilityResult): string {
  const unresolved = r.barriers.filter((b) => !b.resolved);
  if (unresolved.some(isDeadlinePassed)) return 'the deadline for this round has passed';
  const types: BarrierType[] = [];
  for (const b of unresolved) if (!types.includes(b.type)) types.push(b.type);
  const order: BarrierType[] = ['time', 'cost', 'transport', 'device'];
  types.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const names = joinAnd(types.map((t) => BARRIER_NAME[t]));
  if (types.length === 0) return 'of unresolved barriers';
  return types.length === 1 ? `of an unresolved ${names} barrier` : `of unresolved ${names} barriers`;
}

function summarize(
  r: ReachabilityResult,
  interest: MatchReason,
  shared: string[],
  p: StudentProfile,
  o: Opportunity,
  opts: EvalOptions | undefined,
): string {
  const overall = r.eligibility.overall;
  if (overall === 'not_eligible') {
    const blocking = r.eligibility.items.filter((i) => i.hard && i.status === 'not_satisfied');
    const first = blocking[0];
    const more = blocking.length > 1 ? ` (and ${plural(blocking.length - 1, 'more hard requirement')})` : '';
    if (!first) return "You can't apply this round because you don't meet a hard requirement.";
    // 全部是可以自己补上的（fixable）：不说「本届不能申请」，也不鼓励申请、不承诺补上后会被录取。
    if (blocking.every((i) => blockNature(i, p, o, opts) === 'fixable')) {
      const what = blocking.length > 1 ? 'these are things you can work on yourself' : 'this is something you can work on yourself';
      return `Right now you don't meet the hard requirement "${first.label}"${more} — ${what}.`;
    }
    return `You can't apply this round because you don't meet the hard requirement "${first.label}"${more}.`;
  }
  const clauses: string[] = [];
  if (overall === 'unknown') {
    const unknown = r.eligibility.items.filter((i) => i.hard && i.status === 'unknown').map((i) => `"${i.label}"`);
    const listed = unknown.slice(0, MAX_LISTED);
    const extra = unknown.length > MAX_LISTED ? ` and ${unknown.length - MAX_LISTED} more` : '';
    clauses.push(`first confirm with the organizer (or fill in your profile) whether you qualify: ${listed.join(', ')}${extra}`);
    if (r.reachable === false) clauses.push(`even then, it is not realistic right now because ${blockedClause(r)}`);
    else if (r.missing_info.length > 0) clauses.push(`we also still need ${joinAnd(r.missing_info.map(fieldLabel))}`);
  } else if (r.reachable === true) {
    clauses.push('you meet the hard requirements we can check and, based on current info, it is within reach (this is not a prediction of admission)');
  } else if (r.reachable === false) {
    clauses.push(`you meet the hard requirements we can check, but it is not realistic right now because ${blockedClause(r)}`);
  } else {
    const missing = r.missing_info.length > 0 ? joinAnd(r.missing_info.map(fieldLabel)) : 'some details';
    clauses.push(`you meet the hard requirements we can check, but we can't tell yet whether it is realistic: we still need ${missing}`);
  }
  clauses.push(interestClause(interest, shared));
  const s = clauses.join('; ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

// ───────────────────────────── 主函数 ─────────────────────────────

function sortReasons(reasons: MatchReason[]): MatchReason[] {
  return [...reasons].sort((a, b) => MATCH_REASON_KINDS.indexOf(a.kind) - MATCH_REASON_KINDS.indexOf(b.kind));
}

function incomplete(
  p: StudentProfile,
  o: Opportunity,
  interest: MatchReason,
  shared: string[],
  profileIssues: string[],
): MatchExplanation {
  let eligibility: MatchReason;
  let reachability: MatchReason;
  let summary: string;
  if (profileIssues.length > 0) {
    const labels = joinAnd(profileIssues.map(fieldLabel));
    eligibility = reason('eligibility', null, `Your profile has ${labels} in a form we can't read, so we couldn't check eligibility. Correct it in your Skill Passport. We did not guess.`);
    reachability = reason('reachability', null, `Your profile has ${labels} in a form we can't read, so we can't tell whether this is realistic for you. Correct it in your Skill Passport.`);
    summary = `We couldn't check this opportunity because some details in your profile can't be read (${labels}); correct them in your Skill Passport.`;
  } else {
    eligibility = reason('eligibility', null, "The opportunity data is incomplete, so we can't check eligibility. Check the official page.");
    reachability = reason('reachability', null, "The opportunity data is incomplete, so we can't tell whether this is realistic for you.");
    summary = "We couldn't check this opportunity because its data is incomplete; check the official page.";
  }
  return {
    profile_id: p.id,
    opportunity_id: o.id,
    reasons: [interest, eligibility, reachability],
    eligibility_overall: 'unknown' as OverallEligibility,
    reachable: null,
    shared_interests: shared,
    summary,
  };
}

export function explainMatch(profile: StudentProfile, opp: Opportunity, options?: MatchOptions): MatchExplanation {
  const p = safeProfile(profile);
  const o = safeOpportunity(opp);
  const shared = sharedTags(o.fields, normalizedTagSet(asArray<unknown>(p.interests)));
  let interest: MatchReason;
  try {
    interest = interestReason(p, o, shared);
  } catch {
    interest = reason('interest', null, "We can't compare this opportunity with your interests.");
  }

  let profileIssues: string[];
  try {
    profileIssues = profileFieldIssues(profile);
  } catch {
    profileIssues = [];
  }
  if (profileIssues.length > 0) return incomplete(p, o, interest, shared, profileIssues);

  const o2 = isObject(options) ? (options as MatchOptions) : undefined;
  const opts: EvalOptions | undefined = o2?.today == null ? undefined : { today: o2.today };
  const grants = asArray<unknown>(o2?.grants).filter(isObject) as unknown as ResourceGrant[];

  let r: ReachabilityResult;
  try {
    r = analyzeReachability(p, o, grants, opts);
  } catch {
    return incomplete(p, o, interest, shared, []);
  }

  try {
    const reasons: MatchReason[] = [
      interest,
      eligibilityReason(r, p, o, opts),
      reason('reachability', r.reachable, r.summary),
      formatReason(p, o, r.barriers.filter((b) => b.type === 'transport')),
      timeReason(r, p, o, opts),
      costReason(r, p, o, grants),
      deviceReason(r, p, o),
    ];
    const transport = transportReason(r, p, o, grants);
    if (transport) reasons.push(transport);
    return {
      profile_id: p.id,
      opportunity_id: o.id,
      reasons: sortReasons(reasons),
      eligibility_overall: r.eligibility.overall,
      reachable: r.reachable,
      shared_interests: shared,
      summary: summarize(r, interest, shared, p, o, opts),
    };
  } catch {
    // 不应发生（引擎已成功返回）；保底仍给出与引擎一致的结论，不抛异常。
    return {
      profile_id: p.id,
      opportunity_id: o.id,
      reasons: [interest, reason('eligibility', null, 'Some details could not be read. Check the official page.'), reason('reachability', r.reachable, r.summary)],
      eligibility_overall: r.eligibility.overall,
      reachable: r.reachable,
      shared_interests: shared,
      summary: r.summary,
    };
  }
}
