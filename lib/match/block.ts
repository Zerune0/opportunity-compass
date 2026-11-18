/**
 * 阻断要求「随时间的走向」（纯函数），供 findAlternatives 判断是否给出 next_cycle。
 *
 * 规则与 lib/path/plan.ts 的 blockNature 保持一致（那里没有导出，这里按相同规则另写；改一处请同步另一处）：
 * - grade / age：档案值低于 min，且 max 缺省或 max ≥ min → 'improvable'（升年级 / 长大后可能满足）；
 *   其他情况（高于 max、档案值缺失、区间无效）→ 'permanent'。
 * - prerequisite_skill / portfolio → 'fixable'（学生可以自己补上，补上后这一届就能申请）。
 * - 其他（region / citizenship / status / manual / 找不到对应要求）→ 'permanent'。
 */
import type { EligibilityItem, Opportunity, StudentProfile } from '../types';

export type BlockNature = 'improvable' | 'permanent' | 'fixable';

export function blockNature(item: EligibilityItem, profile: StudentProfile, opp: Opportunity): BlockNature {
  const reqs = Array.isArray(opp.requirements) ? opp.requirements : [];
  const req = reqs.find((r) => r != null && r.id === item.requirement_id);
  if (!req) return 'permanent';
  switch (req.type) {
    case 'grade':
    case 'age': {
      const v = req.type === 'grade' ? profile.grade : profile.age;
      if (v != null && req.min != null && v < req.min && (req.max == null || req.max >= req.min)) {
        return 'improvable';
      }
      return 'permanent';
    }
    case 'prerequisite_skill':
    case 'portfolio':
      return 'fixable';
    default:
      return 'permanent';
  }
}
