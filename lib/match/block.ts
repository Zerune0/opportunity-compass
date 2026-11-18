/**
 * 阻断要求「随时间的走向」（纯函数），供 findAlternatives 判断是否给出 next_cycle。
 *
 * - grade / age：lib/requirement-timing.ts 的 belowMinimumLater 为 true（在参考日确定低于 min，
 *   且 max 缺省或 max ≥ min）→ 'improvable'（升年级 / 长大后可能满足）；
 *   其他情况（高于 max、到参考日会超过 max、档案值缺失、区间无效）→ 'permanent'。
 *   与 analyzeGaps 的「以后可能满足」说明共用同一个函数，两处结论一致。
 * - prerequisite_skill / portfolio → 'fixable'（学生可以自己补上，补上后这一届就能申请）。
 * - 其他（region / citizenship / status / manual / 找不到对应要求）→ 'permanent'。
 *
 * 与 lib/path/plan.ts 的 blockNature（第一阶段，不改）的差别：plan.ts 判断年龄「低于下限」时直接用档案里的
 * 当前年龄；这里按参考日（as_of ?? deadline）当天可能的年龄判断。两者可能不同的情形：现在低于下限、但到参考日
 * 会超过上限（如要求 16–16 岁、参考日在三年后、学生现在 15 岁）——plan.ts 判 improvable，planRoutes 的
 * alternatives 里会有「下一届」提示；这里判 permanent，findAlternatives 不给 next_cycle。grade 的规则两者相同。
 */
import { belowMinimumLater } from '../requirement-timing';
import type { EligibilityItem, EvalOptions, Opportunity, StudentProfile } from '../types';

export type BlockNature = 'improvable' | 'permanent' | 'fixable';

export function blockNature(
  item: EligibilityItem,
  profile: StudentProfile,
  opp: Opportunity,
  options?: EvalOptions,
): BlockNature {
  const reqs = Array.isArray(opp.requirements) ? opp.requirements : [];
  const req = reqs.find((r) => r != null && r.id === item.requirement_id);
  if (!req) return 'permanent';
  switch (req.type) {
    case 'grade':
    case 'age':
      return belowMinimumLater(req, profile, opp, options) ? 'improvable' : 'permanent';
    case 'prerequisite_skill':
    case 'portfolio':
      return 'fixable';
    default:
      return 'permanent';
  }
}
