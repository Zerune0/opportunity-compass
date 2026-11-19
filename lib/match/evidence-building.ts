/**
 * findEvidenceBuildingCandidates(profile, target, catalog, options?) — 共用筛选（第四阶段第 1 层）：
 * 从传入的机会目录里找「这名学生现在能参加、并且能为目标机会积累证据」的机会。
 * planRoutes 的 competition 路线与 findAlternatives 的 stepping_stone 都只从这里取候选。
 *
 * 一、目标「还缺什么证据」（needs，先官方要求、后准备项，各按机会里的原顺序）：
 *   - 要求：type = 'portfolio'、checkEligibility 判为 not_satisfied（硬性与偏好都算）、**没有限定 skill**
 *     （限定了技能的作品要求说不清一场活动能不能证明那项技能，不算）。想要的证据种类 = 要求的 evidence_kind；
 *     没限定种类时，任何种类的证据都能满足它（与 checkEligibility 一致）。
 *   - 准备项：未被证据覆盖（lib/reachability/coverage.ts 的 findCoveringEvidence 为空）、id 不与固定步骤冲突，
 *     并且 evidence_kind 非空或 material_kind = 'portfolio'。想要的种类 = evidence_kind，以及 material_kind 为
 *     portfolio 时的 'portfolio'。
 *   - prerequisite_skill 要求不直接对应：我们无法说清一场活动能教会哪项技能；学生若因缺技能受阻，
 *     只有当目标里有对应的、需要实践证据的未覆盖准备项时，才通过那个准备项建立关系。
 * 二、候选机会能产出什么证据（CATEGORY_PRODUCES，只按类别，确定、可测）：
 *   - hackathon → project、portfolio（做出一个项目，可放进作品集）；
 *   - competition → competition_result；
 *   - project → project、portfolio。
 *   其他类别（research、scholarship、internship、fellowship、summer_program、public_service、other）一律不算——
 *   它们本身是选拔性机会或产出说不清，不能说成「积累证据的一步」。
 * 三、候选必须同时满足：
 *   - 是对象、`id` 为非空字符串、不是目标自身、id 不重复（重复只取第一条）；
 *   - 来源等级不是 user_posted（`source_tier ?? 'official'` 为 official / trusted_aggregator）；
 *   - 类别在 CATEGORY_PRODUCES 里；
 *   - 与目标至少一个共同领域标签（lib/tags.ts 的 normalizeTag 比较）**并且**至少对应一条 need
 *     （候选产出的种类 ∩ need 想要的种类非空；没限定种类的作品要求对任何产出都成立）——两者缺一不算；
 *   - 给了 options.today（可解析）时，候选截止日期没过（null = 滚动 / 未写清、无法解析的保留，与 same_field 一致）；
 *   - checkEligibility(profile, 候选, { today }) 不出错且 overall 不是 not_eligible。
 * 四、排序：截止日期早的在前（null / 无法解析的最后）→ id 字典序。与目录顺序无关。
 *
 * 一句话关系（供调用方写文字）：「参加 <候选> 能产出 <种类> 证据，对应目标的 <要求 / 准备项>」，见 links。
 * 不是官方前置条件：调用方的文字里必须写明。
 *
 * 公平性：不读取学校名、显示名。纯函数：日期只来自 options.today，不读系统时钟、无随机、无 IO、不调 AI；
 * 不修改输入；永不抛异常（出错的候选跳过，整体出错返回 []）。
 */
import { checkEligibility } from '../eligibility';
import { dayNumber, parseISODate } from '../eligibility/dates';
import { findCoveringEvidence } from '../reachability/coverage';
import { asArray, safeOpportunity, safeProfile } from '../gap/inputs';
import { normalizedTagSet, sharedTags } from '../tags';
import type {
  EvalOptions,
  EvidenceKind,
  Opportunity,
  OpportunityCategory,
  OverallEligibility,
  PrepItem,
  StudentProfile,
} from '../types';

/** 候选类别 → 参加后能产出的证据种类。不在表里的类别不作为积累证据的候选。 */
export const CATEGORY_PRODUCES: Partial<Record<OpportunityCategory, readonly EvidenceKind[]>> = {
  hackathon: ['project', 'portfolio'],
  competition: ['competition_result'],
  project: ['project', 'portfolio'],
};

/** 与 lib/path/shared.ts 的 RESERVED_STEP_IDS 相同（这里不 import lib/path，避免循环依赖）。 */
const RESERVED_IDS: readonly string[] = ['submit-application', 'find-partner'];

/** 目标机会里一条「还缺的证据」与候选的对应关系。 */
export type EvidenceLink =
  | {
      kind: 'requirement';
      requirement_id: string;
      label: string;
      source_text: string;
      /** 这条对应里候选产出、目标想要的证据种类。 */
      evidence_kind: EvidenceKind;
    }
  | {
      kind: 'prep_item';
      prep: PrepItem;
      evidence_kind: EvidenceKind;
    };

export interface EvidenceBuildingCandidate {
  opportunity: Opportunity;
  /** 与目标共有的领域标签（候选原本的写法，去重），非空。 */
  shared_fields: string[];
  /** 该学生对候选的资格结论（不会是 not_eligible）。 */
  eligibility_overall: Exclude<OverallEligibility, 'not_eligible'>;
  /** 候选能产出的证据种类（CATEGORY_PRODUCES）。 */
  produces: readonly EvidenceKind[];
  /** 对应目标的哪些要求 / 准备项（先要求、后准备项，各按原顺序），非空。 */
  links: EvidenceLink[];
}

interface Need {
  link: Omit<Extract<EvidenceLink, { kind: 'requirement' }>, 'evidence_kind'> | Omit<Extract<EvidenceLink, { kind: 'prep_item' }>, 'evidence_kind'>;
  /** 想要的证据种类；null = 任何种类都行（没限定种类的作品要求）。 */
  wants: EvidenceKind[] | null;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 目标机会还缺的证据（见文件头「一」）。 */
function targetNeeds(p: StudentProfile, o: Opportunity, options: EvalOptions | undefined): Need[] {
  const needs: Need[] = [];
  let elig: ReturnType<typeof checkEligibility> | null = null;
  try {
    elig = checkEligibility(p, o, options);
  } catch {
    elig = null;
  }
  if (elig) {
    const reqs = asArray<unknown>(o.requirements).filter(isObject) as unknown as Opportunity['requirements'];
    for (const item of elig.items) {
      if (item.status !== 'not_satisfied') continue;
      const req = reqs.find((r) => r.id === item.requirement_id);
      if (!req || req.type !== 'portfolio') continue;
      if (typeof req.skill === 'string' && req.skill.trim() !== '') continue;
      needs.push({
        link: { kind: 'requirement', requirement_id: req.id, label: req.label, source_text: req.source_text },
        wants: req.evidence_kind ? [req.evidence_kind] : null,
      });
    }
  }
  const seen = new Set<string>();
  for (const prep of o.preparation) {
    if (typeof prep.id !== 'string' || RESERVED_IDS.includes(prep.id) || seen.has(prep.id)) continue;
    seen.add(prep.id);
    const wants: EvidenceKind[] = [];
    if (prep.evidence_kind != null) wants.push(prep.evidence_kind);
    if (prep.material_kind === 'portfolio' && !wants.includes('portfolio')) wants.push('portfolio');
    if (wants.length === 0) continue;
    let covered = false;
    try {
      covered = findCoveringEvidence(p, o, prep).length > 0;
    } catch {
      covered = false;
    }
    if (covered) continue;
    needs.push({ link: { kind: 'prep_item', prep }, wants });
  }
  return needs;
}

function linksFor(needs: Need[], produces: readonly EvidenceKind[]): EvidenceLink[] {
  const out: EvidenceLink[] = [];
  for (const n of needs) {
    const kind = n.wants == null ? produces[0] : produces.find((k) => (n.wants as EvidenceKind[]).includes(k));
    if (kind == null) continue;
    out.push({ ...n.link, evidence_kind: kind } as EvidenceLink);
  }
  return out;
}

function dayOf(d: unknown): number | null {
  const ymd = typeof d === 'string' ? parseISODate(d) : null;
  return ymd ? dayNumber(ymd) : null;
}

export function findEvidenceBuildingCandidates(
  profile: StudentProfile,
  target: Opportunity,
  catalog: Opportunity[],
  options?: EvalOptions,
): EvidenceBuildingCandidate[] {
  try {
    const p = safeProfile(profile);
    const o = safeOpportunity(target);
    const evalOptions: EvalOptions | undefined = options?.today == null ? undefined : { today: options.today };
    const todayDay = dayOf(evalOptions?.today);
    const targetTags = normalizedTagSet(o.fields);
    if (targetTags.size === 0) return [];
    const needs = targetNeeds(p, o, evalOptions);
    if (needs.length === 0) return [];

    const out: { c: EvidenceBuildingCandidate; deadlineDay: number | null; id: string }[] = [];
    const seen = new Set<string>();
    for (const raw of asArray<unknown>(catalog)) {
      if (!isObject(raw) || typeof raw.id !== 'string' || raw.id === '') continue;
      const id = raw.id;
      if (id === o.id || seen.has(id)) continue;
      seen.add(id);
      const c = safeOpportunity(raw);
      if ((c.source_tier ?? 'official') === 'user_posted') continue;
      const produces = CATEGORY_PRODUCES[c.category];
      if (!produces || produces.length === 0) continue;
      const shared = sharedTags(c.fields, targetTags);
      if (shared.length === 0) continue;
      const links = linksFor(needs, produces);
      if (links.length === 0) continue;
      const deadlineDay = dayOf(c.deadline);
      if (todayDay != null && deadlineDay != null && deadlineDay < todayDay) continue;
      let overall: OverallEligibility;
      try {
        overall = checkEligibility(p, c, evalOptions).overall;
      } catch {
        continue; // 数据不完整，无法确认 → 不推荐。
      }
      if (overall === 'not_eligible') continue;
      out.push({ c: { opportunity: c, shared_fields: shared, eligibility_overall: overall, produces, links }, deadlineDay, id });
    }
    out.sort((a, b) => {
      if (a.deadlineDay !== b.deadlineDay) {
        if (a.deadlineDay == null) return 1;
        if (b.deadlineDay == null) return -1;
        return a.deadlineDay - b.deadlineDay;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return out.map((x) => x.c);
  } catch {
    return [];
  }
}

/** 一条对应关系的英文短语，如 `the prep item "Build a small project"` / `the requirement "Portfolio"`。 */
export function linkPhrase(link: EvidenceLink): string {
  return link.kind === 'requirement' ? `the requirement "${link.label}"` : `the prep item "${link.prep.title}"`;
}
