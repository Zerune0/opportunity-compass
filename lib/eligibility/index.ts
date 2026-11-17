/**
 * MOCK — 第 1 层替换（周三 23:00 前，主导）。
 *
 * checkEligibility(profile, opp)：逐条判断官方要求，返回 satisfied / not_satisfied / unknown，附来源原文。
 * 当前 mock：对所有要求一律返回 unknown（不猜），总体为 unknown（若无硬性要求则 eligible）。
 * 签名与最终版一致，之后只替换实现。纯函数、确定性、无 IO。
 */
import type { EligibilityItem, EligibilityResult, Opportunity, StudentProfile } from '../types';

export function checkEligibility(profile: StudentProfile, opp: Opportunity): EligibilityResult {
  const items: EligibilityItem[] = opp.requirements.map((req) => ({
    requirement_id: req.id,
    requirement_type: req.type,
    label: req.label,
    hard: req.hard,
    status: 'unknown',
    source_text: req.source_text,
    explanation: '（MOCK）资格判断尚未实现，暂按「未知」处理。',
    used_profile_fields: [],
    confirm_with_official: `请对照官网原文确认这一条：「${req.source_text}」`,
  }));

  const hasHard = items.some((i) => i.hard);
  return {
    profile_id: profile.id,
    opportunity_id: opp.id,
    overall: hasHard ? 'unknown' : 'eligible',
    items,
  };
}
