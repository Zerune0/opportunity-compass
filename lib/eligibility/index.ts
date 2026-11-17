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
const SKILL_LEVEL_ZH: Record<SkillLevel, string> = { beginner: '入门', intermediate: '中级', advanced: '高级' };

export const EVIDENCE_STATUS_ZH: Record<EvidenceStatus, string> = {
  self_reported: '自述',
  evidence_attached: '已附链接 / 文件',
  reviewed: '已有人审阅',
  unverified: '无法核实',
};

export const EVIDENCE_KIND_ZH: Record<EvidenceKind, string> = {
  project: '项目',
  portfolio: '作品集',
  certificate: '证书',
  competition_result: '比赛成绩',
  work_experience: '工作经历',
  volunteer_experience: '志愿经历',
  course: '课程',
  recommendation_letter: '推荐信',
  other: '其他',
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
  if (min != null) return `至少 ${min} ${unit}`;
  if (max != null) return `不超过 ${max} ${unit}`;
  return '不限';
}

function inRange(v: number, min: number | undefined, max: number | undefined): boolean {
  return (min == null || v >= min) && (max == null || v <= max);
}

function sameCode(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function fillProfileHint(fieldZh: string, source: string): string {
  return `请先在档案里补充「${fieldZh}」；如果仍不确定，请对照官网原文「${source}」向官方确认。`;
}

function evidenceHasSkill(e: EvidenceItem, skill: string): boolean {
  return e.skills.some((s) => s.trim().toLowerCase() === skill.trim().toLowerCase());
}

function judgeGrade(req: Extract<Requirement, { type: 'grade' }>, profile: StudentProfile): Judgement {
  const range = rangeText(req.min, req.max, '年级');
  if (profile.grade == null) {
    return {
      status: 'unknown',
      explanation: `这条要求年级为 ${range}，但档案里还没有填写年级，无法判断。`,
      used_profile_fields: ['grade'],
      confirm: fillProfileHint('年级', req.source_text),
    };
  }
  const ok = inRange(profile.grade, req.min, req.max);
  return {
    status: ok ? 'satisfied' : 'not_satisfied',
    explanation: `档案中的年级是 ${profile.grade}，要求为 ${range}，${ok ? '符合' : '不符合'}。`,
    used_profile_fields: ['grade'],
  };
}

function judgeAge(
  req: Extract<Requirement, { type: 'age' }>,
  profile: StudentProfile,
  opp: Opportunity,
  options: EvalOptions | undefined,
): Judgement {
  const range = rangeText(req.min, req.max, '岁');
  const fields = ['age'];
  const age = profile.age;
  if (age == null) {
    return {
      status: 'unknown',
      explanation: `这条要求年龄为 ${range}，但档案里还没有填写年龄，无法判断。`,
      used_profile_fields: fields,
      confirm: fillProfileHint('年龄', req.source_text),
    };
  }

  const refRaw = req.as_of ?? opp.deadline ?? null;
  const refWhich = req.as_of != null ? '官方规定的计算日' : '截止日期';
  const judgeCurrent = (prefix: string): Judgement => {
    const ok = inRange(age, req.min, req.max);
    return {
      status: ok ? 'satisfied' : 'not_satisfied',
      explanation: `${prefix}档案中的年龄是 ${age} 岁，要求为 ${range}，${ok ? '符合' : '不符合'}。`,
      used_profile_fields: fields,
    };
  };

  if (refRaw == null) return judgeCurrent('官方没有写按哪一天计算年龄，按你现在的年龄判断：');

  const ref = parseISODate(refRaw);
  if (ref == null) {
    return {
      status: 'unknown',
      explanation: `年龄要按${refWhich}（${refRaw}）计算，但这个日期格式无法识别，无法判断。`,
      used_profile_fields: fields,
      confirm: `请对照官网原文「${req.source_text}」向官方确认按哪一天计算年龄。`,
    };
  }
  const today = parseISODate(options?.today);
  if (today == null) {
    return {
      status: 'unknown',
      explanation: `年龄要按${refWhich}（${refRaw}）当天计算，但没有提供今天的日期，无法推算那天你几岁。`,
      used_profile_fields: fields,
      confirm: `这一条依赖日期计算；请对照官网原文「${req.source_text}」向官方确认你在 ${refRaw} 是否符合年龄要求。`,
    };
  }
  const cmp = compareYMD(ref, today);
  if (cmp === 0) {
    return judgeCurrent(`年龄按${refWhich}（${refRaw}）计算，该日就是今天，`);
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
  const verbWill = cmp < 0 ? '是' : '将是';
  const oks = candidates.map((a) => inRange(a, req.min, req.max));
  const candText = candidates.map((a) => `${a} 岁`).join('或');
  if (oks.every(Boolean)) {
    return {
      status: 'satisfied',
      explanation: `年龄按${refWhich}（${refRaw}）计算：你那天${verbWill} ${candText}，要求为 ${range}，符合。`,
      used_profile_fields: fields,
    };
  }
  if (oks.every((o) => !o)) {
    return {
      status: 'not_satisfied',
      explanation: `年龄按${refWhich}（${refRaw}）计算：你那天${verbWill} ${candText}，要求为 ${range}，不符合。`,
      used_profile_fields: fields,
    };
  }
  const birthdayHint = cmp < 0 ? '取决于你的生日在那天之前还是之后' : '取决于你的生日是否在这之前';
  return {
    status: 'unknown',
    explanation: `年龄按${refWhich}（${refRaw}）计算：你那天可能是 ${candText}，${birthdayHint}，要求为 ${range}，所以无法确定。`,
    used_profile_fields: fields,
    confirm: `结果取决于你的生日；请对照官网原文「${req.source_text}」向官方确认按哪一天计算年龄、你是否符合。`,
  };
}

function judgeRegion(req: Extract<Requirement, { type: 'region' }>, profile: StudentProfile): Judgement {
  const countries = req.countries.join(' / ');
  const region = profile.region;
  if (region == null || !region.country || region.country.trim() === '') {
    return {
      status: 'unknown',
      explanation: `这条要求所在地为 ${countries}，但档案里还没有填写所在地区，无法判断。`,
      used_profile_fields: ['region'],
      confirm: fillProfileHint('所在国家 / 地区', req.source_text),
    };
  }
  const countryOk = req.countries.some((c) => sameCode(c, region.country));
  if (!countryOk) {
    return {
      status: 'not_satisfied',
      explanation: `档案中的所在国家是 ${region.country}，要求为 ${countries}，不符合。`,
      used_profile_fields: ['region'],
    };
  }
  const states = req.states ?? [];
  if (states.length === 0) {
    return {
      status: 'satisfied',
      explanation: `档案中的所在国家是 ${region.country}，在要求范围（${countries}）内，符合。`,
      used_profile_fields: ['region'],
    };
  }
  const state = region.state;
  if (state == null || state.trim() === '') {
    return {
      status: 'unknown',
      explanation: `国家符合，但这条还要求州 / 省为 ${states.join(' / ')}，档案里没有填写州 / 省，无法判断。`,
      used_profile_fields: ['region', 'region.state'],
      confirm: fillProfileHint('所在州 / 省', req.source_text),
    };
  }
  const stateOk = states.some((s) => sameCode(s, state));
  return {
    status: stateOk ? 'satisfied' : 'not_satisfied',
    explanation: `档案中的所在地是 ${region.country} ${state}，要求州 / 省为 ${states.join(' / ')}，${stateOk ? '符合' : '不符合'}。`,
    used_profile_fields: ['region', 'region.state'],
  };
}

function judgeCitizenship(req: Extract<Requirement, { type: 'citizenship' }>, profile: StudentProfile): Judgement {
  const countries = req.countries.join(' / ');
  const cs = profile.citizenships;
  if (cs == null) {
    return {
      status: 'unknown',
      explanation: `这条要求是 ${countries} 的公民或合法居民，但档案里还没有填写国籍 / 居留身份，无法判断。`,
      used_profile_fields: ['citizenships'],
      confirm: fillProfileHint('国籍 / 合法居留身份', req.source_text),
    };
  }
  const ok = cs.some((c) => req.countries.some((r) => sameCode(r, c)));
  const mine = cs.length > 0 ? cs.join(' / ') : '（声明为无）';
  return {
    status: ok ? 'satisfied' : 'not_satisfied',
    explanation: `档案中的国籍 / 居留身份是 ${mine}，要求为 ${countries}，${ok ? '符合' : '不符合'}。`,
    used_profile_fields: ['citizenships'],
  };
}

function judgeStatus(req: Extract<Requirement, { type: 'status' }>, profile: StudentProfile): Judgement {
  const anyOf = req.any_of.join(' / ');
  const st = profile.statuses;
  if (st == null) {
    return {
      status: 'unknown',
      explanation: `这条要求身份为以下之一：${anyOf}，但档案里还没有填写身份信息，无法判断。`,
      used_profile_fields: ['statuses'],
      confirm: fillProfileHint('身份', req.source_text),
    };
  }
  const hit = st.filter((s) => req.any_of.includes(s));
  if (hit.length > 0) {
    return {
      status: 'satisfied',
      explanation: `档案中声明的身份包含 ${hit.join(' / ')}，符合要求（任一即可：${anyOf}）。`,
      used_profile_fields: ['statuses'],
    };
  }
  return {
    status: 'not_satisfied',
    explanation: `档案中声明的身份里没有要求的任一身份（${anyOf}）。如果你其实符合，请在档案里补上。`,
    used_profile_fields: ['statuses'],
  };
}

function judgeSkill(req: Extract<Requirement, { type: 'prerequisite_skill' }>, profile: StudentProfile): Judgement {
  const minLevel: SkillLevel = req.min_level ?? 'beginner';
  const need = `「${req.skill}」${SKILL_LEVEL_ZH[minLevel]}及以上`;
  const skills = profile.skills;
  const mine = skills?.find((s) => s.name.trim().toLowerCase() === req.skill.trim().toLowerCase());
  if (mine && SKILL_RANK[mine.level] >= SKILL_RANK[minLevel]) {
    return {
      status: 'satisfied',
      explanation: `档案中「${req.skill}」自评为${SKILL_LEVEL_ZH[mine.level]}，要求 ${need}，符合。`,
      used_profile_fields: ['skills'],
    };
  }
  if (minLevel === 'beginner') {
    const ev = profile.evidence.find((e) => evidenceHasSkill(e, req.skill));
    if (ev) {
      return {
        status: 'satisfied',
        explanation: `档案中的证据《${ev.title}》（${EVIDENCE_STATUS_ZH[ev.status]}）体现了「${req.skill}」，满足入门要求。`,
        used_profile_fields: ['skills', 'evidence'],
      };
    }
  }
  if (skills == null) {
    return {
      status: 'unknown',
      explanation: `这条要求 ${need}，但档案里还没有填写技能，也没有相关证据，无法判断。`,
      used_profile_fields: ['skills', 'evidence'],
      confirm: fillProfileHint('技能', req.source_text),
    };
  }
  const now = mine ? `自评为${SKILL_LEVEL_ZH[mine.level]}` : '没有这项技能';
  return {
    status: 'not_satisfied',
    explanation: `这条要求 ${need}，档案中「${req.skill}」${now}。如果你其实会，请在档案里补上。`,
    used_profile_fields: ['skills', 'evidence'],
  };
}

function judgePortfolio(req: Extract<Requirement, { type: 'portfolio' }>, profile: StudentProfile): Judgement {
  const parts: string[] = [];
  if (req.evidence_kind) parts.push(`「${EVIDENCE_KIND_ZH[req.evidence_kind]}」类`);
  if (req.skill) parts.push(`体现「${req.skill}」`);
  const need = parts.length > 0 ? `${parts.join('、')}的作品 / 材料` : '作品 / 材料';
  const ev = profile.evidence.find(
    (e) => (!req.evidence_kind || e.kind === req.evidence_kind) && (!req.skill || evidenceHasSkill(e, req.skill)),
  );
  if (ev) {
    return {
      status: 'satisfied',
      explanation: `这条要求${need}；档案中有《${ev.title}》（状态：${EVIDENCE_STATUS_ZH[ev.status]}），符合。注意：附链接不等于专业认证。`,
      used_profile_fields: ['evidence'],
    };
  }
  return {
    status: 'not_satisfied',
    explanation: `这条要求${need}，档案中还没有符合的证据。如果你已有相关作品，请在档案里补上。`,
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
        explanation: '这一条无法自动判断（例如需要面试、推荐或官方人工审核）。',
        used_profile_fields: [],
        confirm: `请对照官网原文「${req.source_text}」，自行判断或向官方确认。`,
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
        j.status === 'unknown' ? (j.confirm ?? `请对照官网原文「${req.source_text}」向官方确认。`) : null,
    };
  });

  return {
    profile_id: profile.id,
    opportunity_id: opp.id,
    overall: overallFromItems(items),
    items,
  };
}
