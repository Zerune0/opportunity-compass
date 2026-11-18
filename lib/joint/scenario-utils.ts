/**
 * 场景的纯函数工具（不 import 任何数据 JSON，可以安全地被客户端组件间接引用）。
 *
 * - `resolveEnabledInterventions(scenario, ids)` / `withEnabledInterventions(scenario, ids)`：What-if「勾选措施」；
 *   前置依赖没有全部启用的措施一并移除（闭包），不放松依赖；运行中的措施（有已有 grant）不能移除，
 *   未勾选时保留但不接受新分配。
 * - `runningInterventionIds(scenario)`：运行中的措施。
 * - `withBudget(scenario, budget)`：改预算。
 * - `missingPrerequisites(scenario, enabledIds, id)`：某措施缺少的前置依赖（含依赖的依赖，传递闭包）。
 * - `anonymizeScenarioForClient(scenario)`：把场景交给浏览器前去掉学生身份与自由文本。
 * - `findStudentInfoInInterventions(scenario)`：措施 id / 标题里是否写进了学生的 id、显示名、学校名。
 *
 * 带数据的导出（deviceLoanScenario 等）在 ./scenarios，那个文件会把 JSON 打包进来，客户端不要 import 它。
 * 纯函数：不修改输入，返回新对象；无 IO。
 */
import type { EvidenceItem, Intervention, ResourceGrant, Scenario, StudentProfile } from '../types';

/** 因前置依赖没有全部启用而被移除的措施。 */
export interface RemovedIntervention {
  id: string;
  /** 移除时尚未启用（未勾选或已被移除）的前置依赖 id。 */
  missing_requires: string[];
}

/** 运行中的措施：场景内有已有 grant 的 intervention_id 指向它（不论学生是否在场景内、不论 approved / pending）。 */
export function runningInterventionIds(scenario: Scenario): string[] {
  const used = new Set(
    (scenario.existing_grants ?? []).map((g) => g?.intervention_id).filter((x): x is string => typeof x === 'string'),
  );
  return scenario.interventions.filter((iv) => used.has(iv.id)).map((iv) => iv.id);
}

/** 运行中、但不再接受新分配的措施（未勾选，或勾选了但前置依赖没有全部启用）。 */
export interface FrozenIntervention {
  id: string;
  /** 'unchecked' = 没有勾选；'missing_requires' = 勾选了但前置依赖没有全部启用。 */
  reason: 'unchecked' | 'missing_requires';
  /** reason = 'missing_requires' 时缺少的前置依赖 id；否则为空数组。 */
  missing_requires: string[];
}

/**
 * 计算 What-if 勾选后真正参与求解的措施（CONTRACT「联合求解模型」第 9 条）：
 * 1. 先取 `ids` 中存在于场景的措施，再把「前置依赖（requires）没有全部启用」的措施移除，反复判断直到不再变化（闭包）。
 *    不会替用户自动补上依赖，也不会删掉 requires 让措施单独生效。
 * 2. **运行中的措施**（有已有 grant 指向它，见 runningInterventionIds）一律保留在场景里，不受勾选影响；
 *    其中不在 enabled 里的（未勾选或依赖不全）列入 `frozen`：仍在运行、互斥与容量照常生效，但不接受新分配。
 * 返回 enabled（勾选且依赖满足的，按场景原顺序）、removed（真正从场景移除的，按移除顺序，不含运行中的措施）、
 * running（全部运行中的措施，按场景原顺序）、frozen（按场景原顺序）。纯函数。
 */
export function resolveEnabledInterventions(
  scenario: Scenario,
  ids: readonly string[],
): { enabled: string[]; removed: RemovedIntervention[]; running: string[]; frozen: FrozenIntervention[] } {
  const exists = new Set(scenario.interventions.map((iv) => iv.id));
  const enabled = new Set(ids.filter((id) => exists.has(id)));
  const removed: RemovedIntervention[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const iv of scenario.interventions) {
      if (!enabled.has(iv.id)) continue;
      const missing = (iv.requires ?? []).filter((r) => !enabled.has(r));
      if (missing.length > 0) {
        enabled.delete(iv.id);
        removed.push({ id: iv.id, missing_requires: missing });
        changed = true;
      }
    }
  }
  const running = runningInterventionIds(scenario);
  const runningSet = new Set(running);
  const removedById = new Map(removed.map((r) => [r.id, r]));
  const frozen: FrozenIntervention[] = running
    .filter((id) => !enabled.has(id))
    .map((id) => {
      const r = removedById.get(id);
      return r
        ? { id, reason: 'missing_requires' as const, missing_requires: [...r.missing_requires] }
        : { id, reason: 'unchecked' as const, missing_requires: [] };
    });
  return {
    enabled: scenario.interventions.filter((iv) => enabled.has(iv.id)).map((iv) => iv.id),
    removed: removed.filter((r) => !runningSet.has(r.id)),
    running,
    frozen,
  };
}

/**
 * 只保留 `ids` 中列出的措施（保持原顺序；不存在的 id 忽略），
 * **前置依赖没有全部启用的措施一并移除**（按闭包反复判断，见 resolveEnabledInterventions），
 * 不会删掉 requires 让措施单独生效。
 * **运行中的措施**（有已有 grant 指向它）一律保留：没有勾选（或依赖不全）的运行中措施在副本里把
 * `opportunity_ids` 设为 `[]`（不适用于任何机会，因此不可能有新的 Allocation），其余字段不变——它的已有 grant
 * 照常生效、占容量（容量只数已有 grant 与 Allocation，不看 opportunity_ids），互斥照常生效
 * （选中与它互斥的措施仍须按规则撤回它的可撤回 grant）。
 * 保留措施的 mutually_exclusive_with / requires 中指向已移除措施的引用会被清理（对象不在场景里，不构成约束）；
 * 只有不接受新分配的运行中措施可能有这样的 requires（它不可能有新分配，清理不放松任何实际约束）。
 * 想知道移除 / 冻结了哪些，请调用 resolveEnabledInterventions。
 */
export function withEnabledInterventions(scenario: Scenario, ids: readonly string[]): Scenario {
  const res = resolveEnabledInterventions(scenario, ids);
  const frozen = new Set(res.frozen.map((f) => f.id));
  const keep = new Set([...res.enabled, ...frozen]);
  const interventions: Intervention[] = scenario.interventions
    .filter((iv) => keep.has(iv.id))
    .map((iv) => {
      const next: Intervention = { ...iv, resolves: [...iv.resolves] };
      if (frozen.has(iv.id)) next.opportunity_ids = [];
      else if (iv.opportunity_ids) next.opportunity_ids = [...iv.opportunity_ids];
      if (iv.requires) next.requires = iv.requires.filter((r) => keep.has(r));
      if (iv.mutually_exclusive_with) {
        next.mutually_exclusive_with = iv.mutually_exclusive_with.filter((r) => keep.has(r));
      }
      return next;
    });
  return { ...scenario, interventions };
}

/** 返回只改了预算的新场景。 */
export function withBudget(scenario: Scenario, budget: number): Scenario {
  return { ...scenario, budget_usd: budget };
}

/**
 * 措施 `id` 要生效还需要纳入、但不在 `enabledIds` 里的全部前置依赖——包括依赖的依赖（传递闭包）。
 * 按场景里措施的原顺序返回；场景里不存在的依赖 id 也会列出（排在最后，按出现顺序），环不会死循环。
 * 不包含 `id` 自己。纯函数。
 */
export function missingPrerequisites(scenario: Scenario, enabledIds: readonly string[], id: string): string[] {
  const byId = new Map(scenario.interventions.map((iv) => [iv.id, iv]));
  const enabled = new Set(enabledIds);
  const seen = new Set<string>([id]);
  const closure: string[] = [];
  const stack = [...(byId.get(id)?.requires ?? [])];
  while (stack.length > 0) {
    const r = stack.shift()!;
    if (seen.has(r)) continue;
    seen.add(r);
    closure.push(r);
    for (const rr of byId.get(r)?.requires ?? []) if (!seen.has(rr)) stack.push(rr);
  }
  const missing = new Set(closure.filter((r) => !enabled.has(r)));
  const known = scenario.interventions.filter((iv) => missing.has(iv.id)).map((iv) => iv.id);
  const unknown = closure.filter((r) => missing.has(r) && !byId.has(r));
  return [...known, ...unknown];
}

// ───────────────────────────── 学生身份检查 ─────────────────────────────

/** 姓名 / 学校名短于这个长度时不做子串匹配（避免把普通词误判为学生信息）。 */
export const MIN_NAME_TOKEN_LENGTH = 3;

/**
 * 找出措施 id / 标题里出现的学生 id（任意长度，按子串）、显示名或学校名（长度 ≥ 3，按子串）。
 * 返回问题描述列表；空数组 = 没有问题。纯函数，不抛错。
 */
export function findStudentInfoInInterventions(scenario: Scenario): string[] {
  const problems: string[] = [];
  const students = Array.isArray(scenario.students) ? scenario.students : [];
  const ivs = Array.isArray(scenario.interventions) ? scenario.interventions : [];
  const tokens: { token: string; what: string }[] = [];
  for (const s of students) {
    if (s == null || typeof s !== 'object') continue;
    if (typeof s.id === 'string' && s.id) tokens.push({ token: s.id, what: 'student id' });
    if (typeof s.display_name === 'string' && s.display_name.length >= MIN_NAME_TOKEN_LENGTH) {
      tokens.push({ token: s.display_name, what: 'student display name' });
    }
    if (typeof s.school_name === 'string' && s.school_name.length >= MIN_NAME_TOKEN_LENGTH) {
      tokens.push({ token: s.school_name, what: 'school name' });
    }
  }
  for (const iv of ivs) {
    if (iv == null || typeof iv !== 'object') continue;
    for (const field of ['id', 'title'] as const) {
      const value = iv[field];
      if (typeof value !== 'string') continue;
      for (const t of tokens) {
        if (value.includes(t.token)) problems.push(`Support measure ${field} "${value}" contains ${t.what} "${t.token}"`);
      }
    }
  }
  return problems;
}

// ───────────────────────────── 客户端匿名化 ─────────────────────────────

const GENERIC_EVIDENCE_TITLE = 'Sample evidence';

/**
 * 把场景交给浏览器前做的匿名化（纯函数，不修改输入）：
 * - 学生 id 换成 `s1`…`sN`（N ≥ 10 时补零到相同位数，如 `s01`…`s10`，使按编号排序与原数组顺序一致）；
 *   `existing_grants[].student_id` 同步改写（不在场景里的学生 id 换成 `x1`、`x2`…，同一 id 映射一致）。
 * - `display_name` 换成「示例学生 N」；去掉 `school_name`。
 * - 去掉自由文本：`transport.note`、证据的 `url` / `description`；证据 `title` 换成通用占位。
 *   证据的 id / kind / skills / prep_item_ids / status / added_on 保留（id 若含原学生 id 则改写）。
 *   已有 grant 的 `note` 去掉；grant id 若含原学生 id 则改写。
 * - 其余影响判断的字段（年级、年龄、地区、身份、时间、预算、交通等级、设备、技能、兴趣）原样保留；
 *   学生对象只保留 StudentProfile 里已知的字段（未知字段不带出去）。
 * 匿名化前后求解结果（状态、G、L、N、成本）一致；平手时按编号分配的具体学生可能因编号变化而不同。
 */
export function anonymizeScenarioForClient(scenario: Scenario): Scenario {
  const n = scenario.students.length;
  const width = String(n).length;
  const idMap = new Map<string, string>();
  scenario.students.forEach((s, i) => {
    if (!idMap.has(s.id)) idMap.set(s.id, `s${String(i + 1).padStart(width, '0')}`);
  });
  const originalIds = [...idMap.keys()].filter((x) => typeof x === 'string' && x.length > 0);
  const containsOriginal = (text: string) => originalIds.some((sid) => text.includes(sid));

  let extCount = 0;
  const mapStudentId = (sid: string): string => {
    const hit = idMap.get(sid);
    if (hit !== undefined) return hit;
    extCount += 1;
    const next = `x${extCount}`;
    idMap.set(sid, next);
    return next;
  };

  const students: StudentProfile[] = scenario.students.map((s, i) => {
    const newId = idMap.get(s.id)!;
    const out: StudentProfile = {
      id: newId,
      is_sample: s.is_sample,
      display_name: `Sample student ${i + 1}`,
      evidence: (s.evidence ?? []).map((e, k) => anonymizeEvidence(e, containsOriginal(e.id) ? `${newId}-ev${k + 1}` : e.id)),
    };
    const has = (key: keyof StudentProfile) => Object.prototype.hasOwnProperty.call(s, key);
    if (has('grade')) out.grade = s.grade;
    if (has('age')) out.age = s.age;
    if (has('region')) out.region = s.region == null ? s.region : { ...s.region };
    if (has('citizenships')) out.citizenships = s.citizenships == null ? s.citizenships : [...s.citizenships];
    if (has('statuses')) out.statuses = s.statuses == null ? s.statuses : [...s.statuses];
    if (has('hours_per_week_available')) out.hours_per_week_available = s.hours_per_week_available;
    if (has('budget_usd')) out.budget_usd = s.budget_usd;
    if (has('transport')) {
      if (s.transport == null) out.transport = s.transport;
      else {
        const t = { ...s.transport };
        if (Object.prototype.hasOwnProperty.call(t, 'note')) t.note = null;
        out.transport = t;
      }
    }
    if (has('devices')) out.devices = s.devices == null ? s.devices : [...s.devices];
    if (has('skills')) out.skills = s.skills == null ? s.skills : s.skills.map((sk) => ({ ...sk }));
    if (has('interests')) out.interests = s.interests == null ? s.interests : [...s.interests];
    return out;
  });

  const next: Scenario = { ...scenario, students };
  if (scenario.existing_grants !== undefined) {
    next.existing_grants =
      scenario.existing_grants == null
        ? scenario.existing_grants
        : scenario.existing_grants.map((g, k) => {
            const out: ResourceGrant = { ...g, student_id: mapStudentId(String(g.student_id)) };
            if (typeof g.id === 'string' && containsOriginal(g.id)) out.id = `g${k + 1}`;
            if (Object.prototype.hasOwnProperty.call(out, 'note')) out.note = null;
            return out;
          });
  }
  return next;
}

function anonymizeEvidence(e: EvidenceItem, id: string): EvidenceItem {
  const out: EvidenceItem = {
    id,
    title: GENERIC_EVIDENCE_TITLE,
    kind: e.kind,
    skills: [...(e.skills ?? [])],
    status: e.status,
    added_on: e.added_on,
  };
  if (e.prep_item_ids !== undefined) out.prep_item_ids = e.prep_item_ids == null ? e.prep_item_ids : [...e.prep_item_ids];
  return out;
}
