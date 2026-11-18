/**
 * checkEligibility(profile, opp, options?) — 逐条判断官方要求（第 1 层实现）。
 *
 * 每条 Requirement 返回 satisfied / not_satisfied / unknown，并原样带出官网原文 source_text。
 * 原则：缺信息就 unknown（附「请向官方确认」提示），不猜。
 *
 * 规则：
 * - grade：profile.grade 没填 → unknown；否则按 min/max（缺一侧即该侧不限）比较。
 * - age：profile.age（今天的年龄）没填 → unknown。参考日 R = rule.as_of ?? opp.deadline。
 *   R 为空 → 直接用当前年龄比较；R 非空但没传 options.today → unknown；
 *   R = today → 候选年龄 [age]；
 *   R 早于 today → R 当天的年龄可能是 age−n−1 或 age−n（n = R 到 today 的完整年数；恰好整年时只有 age−n）；
 *   R 晚于 today → R 当天的年龄可能是 age+n 或 age+n+1（n = today 到 R 的完整年数；恰好整年时只有 age+n）。
 *   候选全满足 → satisfied，全不满足 → not_satisfied，混合 → unknown（取决于生日）。
 * - region：profile.region 没填 → unknown；国家代码大小写不敏感；国家不匹配 → not_satisfied；
 *   国家匹配且 states 非空时：region.state 没填 → unknown，匹配 → satisfied，否则 not_satisfied。
 * - citizenship：profile.citizenships 为 null/undefined → unknown；数组（含空）按交集判定。
 * - status：profile.statuses 为 null/undefined → unknown；数组按与 any_of 是否有交集判定。
 * - prerequisite_skill：skills 中该技能等级 ≥ min_level（缺省 beginner）→ satisfied；
 *   min_level 为 beginner 时，evidence 中有含该技能的证据也算 satisfied；
 *   否则 skills 没填 → unknown，填了 → not_satisfied。
 * - portfolio：evidence 中有（kind 匹配，若规定）且（skills 含该技能，若规定）的证据 → satisfied，否则 not_satisfied。
 * - manual：永远 unknown。
 * - overall：只看 hard 要求：任一 not_satisfied → not_eligible；否则任一 unknown → unknown；否则 eligible。
 *
 * 公平性：不读取学校名、显示名（见 lib/types.ts StudentProfile 的公平性约定）。
 * 纯函数：日期只来自 options.today 与机会数据，不读系统时钟、无随机、无 IO。
 */
import type {
  EligibilityItem,
  EligibilityResult,
  EligibilityStatus,
  EvalOptions,
  EvidenceItem,
  EvidenceKind,
  EvidenceStatus,
  Opportunity,
  OverallEligibility,
  Requirement,
  SkillLevel,
  StudentProfile,
} from '../types';
import { compareYMD, parseISODate, wholeYearsBetween } from './dates';

const SKILL_RANK: Record<SkillLevel, number> = { beginner: 1, intermediate: 2, advanced: 3 };
const SKILL_LEVEL_ZH: Record<SkillLevel, string> = { beginner: 'beginner', intermediate: 'intermediate', advanced: 'advanced' };

export const EVIDENCE_STATUS_ZH: Record<EvidenceStatus, string> = {
  self_reported: 'self-reported',
  evidence_attached: 'link / file attached',
  reviewed: 'reviewed by someone',
  unverified: 'cannot be verified',
};

export const EVIDENCE_KIND_ZH: Record<EvidenceKind, string> = {
  project: 'project',
  portfolio: 'portfolio',
  certificate: 'certificate',
  competition_result: 'competition result',
  work_experience: 'work experience',
  volunteer_experience: 'volunteer experience',
  course: 'course',
  recommendation_letter: 'recommendation letter',
  other: 'other',
};

interface Judgement {
  status: EligibilityStatus;
  explanation: string;
  used_profile_fields: string[];
  /** unknown 时的确认提示；不给则用默认文字。 */
  confirm?: string;
}

function rangeText(min: number | undefined, max: number | undefined, unit: string): string {
  if (min != null && max != null) return `${min}–${max} ${unit}`;
  if (min != null) return `at least ${min} ${unit}`;
  if (max != null) return `at most ${max} ${unit}`;
  return 'any';
}

function inRange(v: number, min: number | undefined, max: number | undefined): boolean {
  return (min == null || v >= min) && (max == null || v <= max);
}

function sameCode(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function fillProfileHint(fieldZh: string, source: string): string {
  return `Add your ${fieldZh} to your profile first. Still unsure? Confirm with the organizer using the official text: "${source}".`;
}

function evidenceHasSkill(e: EvidenceItem, skill: string): boolean {
  return e.skills.some((s) => s.trim().toLowerCase() === skill.trim().toLowerCase());
}

function judgeGrade(req: Extract<Requirement, { type: 'grade' }>, profile: StudentProfile): Judgement {
  const range = rangeText(req.min, req.max, '').trim();
  if (profile.grade == null) {
    return {
      status: 'unknown',
      explanation: `This requires grade ${range}, but your profile has no grade yet, so we can't tell.`,
      used_profile_fields: ['grade'],
      confirm: fillProfileHint('grade', req.source_text),
    };
  }
  const ok = inRange(profile.grade, req.min, req.max);
  return {
    status: ok ? 'satisfied' : 'not_satisfied',
    explanation: `Your profile says grade ${profile.grade}; required: grade ${range}. ${ok ? 'Meets it.' : 'Does not meet it.'}`,
    used_profile_fields: ['grade'],
  };
}

function judgeAge(
  req: Extract<Requirement, { type: 'age' }>,
  profile: StudentProfile,
  opp: Opportunity,
  options: EvalOptions | undefined,
): Judgement {
  const range = rangeText(req.min, req.max, 'years');
  const fields = ['age'];
  const age = profile.age;
  if (age == null) {
    return {
      status: 'unknown',
      explanation: `This requires age ${range}, but your profile has no age yet, so we can't tell.`,
      used_profile_fields: fields,
      confirm: fillProfileHint('age', req.source_text),
    };
  }

  const refRaw = req.as_of ?? opp.deadline ?? null;
  const refWhich = req.as_of != null ? 'the official reference date' : 'the deadline';
  const judgeCurrent = (prefix: string): Judgement => {
    const ok = inRange(age, req.min, req.max);
    return {
      status: ok ? 'satisfied' : 'not_satisfied',
      explanation: `${prefix}your profile says you are ${age}; required: ${range}. ${ok ? 'Meets it.' : 'Does not meet it.'}`,
      used_profile_fields: fields,
    };
  };

  if (refRaw == null) return judgeCurrent('The organizer does not say which date age is counted on, so we use your current age: ');

  const ref = parseISODate(refRaw);
  if (ref == null) {
    return {
      status: 'unknown',
      explanation: `Age is counted on ${refWhich} (${refRaw}), but that date format can't be read, so we can't tell.`,
      used_profile_fields: fields,
      confirm: `Confirm with the organizer which date age is counted on, using the official text: "${req.source_text}".`,
    };
  }
  const today = parseISODate(options?.today);
  if (today == null) {
    return {
      status: 'unknown',
      explanation: `Age is counted on ${refWhich} (${refRaw}), but today's date was not provided, so we can't work out your age on that day.`,
      used_profile_fields: fields,
      confirm: `This depends on a date calculation. Confirm with the organizer whether you meet the age rule on ${refRaw}, using the official text: "${req.source_text}".`,
    };
  }
  const cmp = compareYMD(ref, today);
  if (cmp === 0) {
    return judgeCurrent(`Age is counted on ${refWhich} (${refRaw}), which is today: `);
  }

  let candidates: number[];
  if (cmp < 0) {
    // 参考日已过：那天的年龄 = 今天的年龄 − 期间经过的生日数（n 或 n+1）。
    const { years, exact } = wholeYearsBetween(ref, today);
    candidates = exact ? [age - years] : [age - years - 1, age - years];
  } else {
    // 参考日在未来：那天的年龄 = 今天的年龄 + 期间经过的生日数（n 或 n+1）。
    const { years, exact } = wholeYearsBetween(today, ref);
    candidates = exact ? [age + years] : [age + years, age + years + 1];
  }
  const verbWill = cmp < 0 ? 'were' : 'will be';
  const oks = candidates.map((a) => inRange(a, req.min, req.max));
  const candText = candidates.map((a) => `${a}`).join(' or ');
  if (oks.every(Boolean)) {
    return {
      status: 'satisfied',
      explanation: `Age is counted on ${refWhich} (${refRaw}): on that day you ${verbWill} ${candText} years old; required: ${range}. Meets it.`,
      used_profile_fields: fields,
    };
  }
  if (oks.every((o) => !o)) {
    return {
      status: 'not_satisfied',
      explanation: `Age is counted on ${refWhich} (${refRaw}): on that day you ${verbWill} ${candText} years old; required: ${range}. Does not meet it.`,
      used_profile_fields: fields,
    };
  }
  const birthdayHint = cmp < 0 ? 'depending on whether your birthday falls before or after that day' : 'depending on whether your birthday comes before then';
  return {
    status: 'unknown',
    explanation: `Age is counted on ${refWhich} (${refRaw}): on that day you may be ${candText} years old, ${birthdayHint}; required: ${range}, so we can't be sure.`,
    used_profile_fields: fields,
    confirm: `The result depends on your birthday. Confirm with the organizer which date age is counted on and whether you qualify, using the official text: "${req.source_text}".`,
  };
}

function judgeRegion(req: Extract<Requirement, { type: 'region' }>, profile: StudentProfile): Judgement {
  const countries = req.countries.join(' / ');
  const region = profile.region;
  if (region == null || !region.country || region.country.trim() === '') {
    return {
      status: 'unknown',
      explanation: `This requires living in ${countries}, but your profile has no location yet, so we can't tell.`,
      used_profile_fields: ['region'],
      confirm: fillProfileHint('country / region', req.source_text),
    };
  }
  const countryOk = req.countries.some((c) => sameCode(c, region.country));
  if (!countryOk) {
    return {
      status: 'not_satisfied',
      explanation: `Your profile says your country is ${region.country}; required: ${countries}. Does not meet it.`,
      used_profile_fields: ['region'],
    };
  }
  const states = req.states ?? [];
  if (states.length === 0) {
    return {
      status: 'satisfied',
      explanation: `Your profile says your country is ${region.country}, which is in the required list (${countries}). Meets it.`,
      used_profile_fields: ['region'],
    };
  }
  const state = region.state;
  if (state == null || state.trim() === '') {
    return {
      status: 'unknown',
      explanation: `Your country matches, but this also requires state / province ${states.join(' / ')}, and your profile has no state / province, so we can't tell.`,
      used_profile_fields: ['region', 'region.state'],
      confirm: fillProfileHint('state / province', req.source_text),
    };
  }
  const stateOk = states.some((s) => sameCode(s, state));
  return {
    status: stateOk ? 'satisfied' : 'not_satisfied',
    explanation: `Your profile says your location is ${region.country} ${state}; required state / province: ${states.join(' / ')}. ${stateOk ? 'Meets it.' : 'Does not meet it.'}`,
    used_profile_fields: ['region', 'region.state'],
  };
}

function judgeCitizenship(req: Extract<Requirement, { type: 'citizenship' }>, profile: StudentProfile): Judgement {
  const countries = req.countries.join(' / ');
  const cs = profile.citizenships;
  if (cs == null) {
    return {
      status: 'unknown',
      explanation: `This requires being a citizen or legal resident of ${countries}, but your profile has no citizenship / residency yet, so we can't tell.`,
      used_profile_fields: ['citizenships'],
      confirm: fillProfileHint('citizenship / legal residency', req.source_text),
    };
  }
  const ok = cs.some((c) => req.countries.some((r) => sameCode(r, c)));
  const mine = cs.length > 0 ? cs.join(' / ') : '(none declared)';
  return {
    status: ok ? 'satisfied' : 'not_satisfied',
    explanation: `Your profile says your citizenship / residency is ${mine}; required: ${countries}. ${ok ? 'Meets it.' : 'Does not meet it.'}`,
    used_profile_fields: ['citizenships'],
  };
}

function judgeStatus(req: Extract<Requirement, { type: 'status' }>, profile: StudentProfile): Judgement {
  const anyOf = req.any_of.join(' / ');
  const st = profile.statuses;
  if (st == null) {
    return {
      status: 'unknown',
      explanation: `This requires one of these statuses: ${anyOf}, but your profile has no status yet, so we can't tell.`,
      used_profile_fields: ['statuses'],
      confirm: fillProfileHint('status', req.source_text),
    };
  }
  const hit = st.filter((s) => req.any_of.includes(s));
  if (hit.length > 0) {
    return {
      status: 'satisfied',
      explanation: `Your profile lists ${hit.join(' / ')}, which meets the requirement (any one of: ${anyOf}).`,
      used_profile_fields: ['statuses'],
    };
  }
  return {
    status: 'not_satisfied',
    explanation: `Your profile does not list any of the required statuses (${anyOf}). If one does apply to you, add it to your profile.`,
    used_profile_fields: ['statuses'],
  };
}

function judgeSkill(req: Extract<Requirement, { type: 'prerequisite_skill' }>, profile: StudentProfile): Judgement {
  const minLevel: SkillLevel = req.min_level ?? 'beginner';
  const need = `"${req.skill}" at ${SKILL_LEVEL_ZH[minLevel]} level or above`;
  const skills = profile.skills;
  const mine = skills?.find((s) => s.name.trim().toLowerCase() === req.skill.trim().toLowerCase());
  if (mine && SKILL_RANK[mine.level] >= SKILL_RANK[minLevel]) {
    return {
      status: 'satisfied',
      explanation: `Your profile rates "${req.skill}" as ${SKILL_LEVEL_ZH[mine.level]}; required: ${need}. Meets it.`,
      used_profile_fields: ['skills'],
    };
  }
  if (minLevel === 'beginner') {
    const ev = profile.evidence.find((e) => evidenceHasSkill(e, req.skill));
    if (ev) {
      return {
        status: 'satisfied',
        explanation: `Your evidence "${ev.title}" (${EVIDENCE_STATUS_ZH[ev.status]}) shows "${req.skill}", which meets the beginner requirement.`,
        used_profile_fields: ['skills', 'evidence'],
      };
    }
  }
  if (skills == null) {
    return {
      status: 'unknown',
      explanation: `This requires ${need}, but your profile has no skills or related evidence yet, so we can't tell.`,
      used_profile_fields: ['skills', 'evidence'],
      confirm: fillProfileHint('skills', req.source_text),
    };
  }
  const now = mine ? `is rated ${SKILL_LEVEL_ZH[mine.level]}` : 'is not listed';
  return {
    status: 'not_satisfied',
    explanation: `This requires ${need}; in your profile "${req.skill}" ${now}. If you do have this skill, add it to your profile.`,
    used_profile_fields: ['skills', 'evidence'],
  };
}

function judgePortfolio(req: Extract<Requirement, { type: 'portfolio' }>, profile: StudentProfile): Judgement {
  const parts: string[] = [];
  if (req.evidence_kind) parts.push(`evidence type: ${EVIDENCE_KIND_ZH[req.evidence_kind]}`);
  if (req.skill) parts.push(`showing "${req.skill}"`);
  const need = parts.length > 0 ? `work / materials (${parts.join(', ')})` : 'work / materials';
  const ev = profile.evidence.find(
    (e) => (!req.evidence_kind || e.kind === req.evidence_kind) && (!req.skill || evidenceHasSkill(e, req.skill)),
  );
  if (ev) {
    return {
      status: 'satisfied',
      explanation: `This requires ${need}. Your profile has "${ev.title}" (status: ${EVIDENCE_STATUS_ZH[ev.status]}). Meets it. Note: an attached link is not a professional certification.`,
      used_profile_fields: ['evidence'],
    };
  }
  return {
    status: 'not_satisfied',
    explanation: `This requires ${need}, and your profile has no matching evidence yet. If you already have related work, add it to your profile.`,
    used_profile_fields: ['evidence'],
  };
}

function judge(req: Requirement, profile: StudentProfile, opp: Opportunity, options?: EvalOptions): Judgement {
  switch (req.type) {
    case 'grade':
      return judgeGrade(req, profile);
    case 'age':
      return judgeAge(req, profile, opp, options);
    case 'region':
      return judgeRegion(req, profile);
    case 'citizenship':
      return judgeCitizenship(req, profile);
    case 'status':
      return judgeStatus(req, profile);
    case 'prerequisite_skill':
      return judgeSkill(req, profile);
    case 'portfolio':
      return judgePortfolio(req, profile);
    case 'manual':
      return {
        status: 'unknown',
        explanation: "This can't be checked automatically (for example, it needs an interview, a recommendation or a manual review by the organizer).",
        used_profile_fields: [],
        confirm: `Confirm with the organizer (or check it yourself), using the official text: "${req.source_text}".`,
      };
  }
}

export function overallFromItems(items: EligibilityItem[]): OverallEligibility {
  const hard = items.filter((i) => i.hard);
  if (hard.some((i) => i.status === 'not_satisfied')) return 'not_eligible';
  if (hard.some((i) => i.status === 'unknown')) return 'unknown';
  return 'eligible';
}

export function checkEligibility(
  profile: StudentProfile,
  opp: Opportunity,
  options?: EvalOptions,
): EligibilityResult {
  const items: EligibilityItem[] = opp.requirements.map((req) => {
    const j = judge(req, profile, opp, options);
    return {
      requirement_id: req.id,
      requirement_type: req.type,
      label: req.label,
      hard: req.hard,
      status: j.status,
      source_text: req.source_text,
      explanation: j.explanation,
      used_profile_fields: j.used_profile_fields,
      confirm_with_official:
        j.status === 'unknown' ? (j.confirm ?? `Confirm with the organizer, using the official text: "${req.source_text}".`) : null,
    };
  });

  return {
    profile_id: profile.id,
    opportunity_id: opp.id,
    overall: overallFromItems(items),
    items,
  };
}
