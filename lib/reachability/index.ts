/**
 * MOCK — 第 1 层替换（周三 23:00 前，主导）。
 *
 * analyzeReachability(profile, opp, grants, options?)：资格 + 准备差距 + 是否现实可达 + 障碍列表
 * （时间 / 费用 / 交通 / 设备）。grants = 主办方已分配给该学生的资源，approved 的会化解对应障碍。
 * 可达 ≠ 录取。
 *
 * 当前 mock：
 * - 资格直接用 checkEligibility（目前也是 mock，全部 unknown）；
 * - 准备差距 = 未被证据（prep_item_ids 或 skills）覆盖的准备项；
 * - 障碍只做「所需设备不在档案里」这一种简单检查，approved 的 device grant 可化解；
 * - reachable：有未化解的障碍 → false（按 lib/types.ts 的语义，与资格是否 unknown 无关）；
 *   否则 null（mock 资格各项全部 unknown，且未判断时间 / 费用 / 交通障碍，不猜）。mock 永远不返回 true。
 * 签名与最终版一致，之后只替换实现。纯函数、确定性、无 IO。
 */
import { checkEligibility } from '../eligibility';
import type {
  Barrier,
  EvalOptions,
  Opportunity,
  ReachabilityResult,
  ReadinessGap,
  ResourceGrant,
  StudentProfile,
} from '../types';

export function analyzeReachability(
  profile: StudentProfile,
  opp: Opportunity,
  grants: ResourceGrant[],
  options?: EvalOptions,
): ReachabilityResult {
  // MOCK 阶段只把 options 原样传给 checkEligibility，不做日期相关判断（第 1 层实现）。
  const eligibility = checkEligibility(profile, opp, options);

  const readiness_gaps: ReadinessGap[] = opp.preparation
    .filter(
      (prep) =>
        !profile.evidence.some(
          (e) =>
            e.prep_item_ids?.includes(prep.id) ||
            e.prep_item_ids?.includes(`${opp.id}:${prep.id}`) ||
            (prep.skill != null && e.skills.includes(prep.skill)),
        ),
    )
    .map((prep) => ({
      prep_item_id: prep.id,
      title: prep.title,
      skill: prep.skill ?? null,
      estimated_hours: prep.estimated_hours,
      estimated_cost_usd: prep.estimated_cost_usd,
      required_for_application: prep.required_for_application,
      reason: '（MOCK）档案中没有覆盖这一项的证据。',
    }));

  const approved = grants.filter(
    (g) => g.status === 'approved' && g.student_id === profile.id && g.opportunity_id === opp.id,
  );

  const barriers: Barrier[] = [];
  const missing_info: string[] = [];
  if (profile.devices == null) {
    if (opp.required_devices.length > 0) missing_info.push('profile.devices');
  } else {
    for (const device of opp.required_devices) {
      if (profile.devices.includes(device)) continue;
      const fixing = approved.filter((g) => g.type === 'device' && g.device === device);
      barriers.push({
        type: 'device',
        description: `（MOCK）需要 ${device}，档案中没有。`,
        shortfall: null,
        resolved: fixing.length > 0,
        resolved_by_grant_ids: fixing.map((g) => g.id),
      });
    }
  }

  return {
    profile_id: profile.id,
    opportunity_id: opp.id,
    eligibility,
    readiness_gaps,
    barriers,
    reachable: barriers.some((b) => !b.resolved) ? false : null,
    missing_info,
    applied_grant_ids: approved.map((g) => g.id),
    summary: '（MOCK）可达性分析尚未实现，结果仅供界面开发。可达 ≠ 录取。',
  };
}
