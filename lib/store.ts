/**
 * 浏览器 localStorage 的薄封装（无后端、无数据库）。
 *
 * - SSR 安全：服务器端（没有 window / localStorage）读返回默认值，写 / 清除为空操作。
 * - 键名统一前缀 + 版本：`oc:v1:<name>`。数据结构不兼容时升级版本号，旧数据自然失效。
 * - JSON 解析失败或形状不对时回退默认值，不抛错。
 * - 不依赖 React。React 组件请在 useEffect 中调用（避免 hydration 不一致）。
 *
 * 归属：主导（lib/store.ts）。需要新增键请找主导。
 */
import type { EvidenceItem, ResourceGrant, StudentProfile } from './types';

export const STORE_PREFIX = 'oc';
export const STORE_VERSION = 1;

/** 所有存储键（不含前缀）。 */
export const STORE_KEYS = {
  /** 当前学生档案（学生自己填写，或从示例档案复制而来）。 */
  profile: 'profile',
  /** 学生收藏的机会 id 列表。 */
  savedOpportunityIds: 'saved_opportunity_ids',
  /** 主办方分配的 grants（演示用，示例 / 模拟）。 */
  grants: 'grants',
} as const;

export type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS];

/** 完整键名，如 `oc:v1:profile`。 */
export function storageKey(key: StoreKey): string {
  return `${STORE_PREFIX}:v${STORE_VERSION}:${key}`;
}

/** 取得 localStorage；SSR 或浏览器禁用存储时返回 null。 */
function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    // 某些浏览器隐私模式下访问 localStorage 会抛错
    return null;
  }
}

/** 读取 JSON；不存在、解析失败或 validate 不通过时返回 fallback。 */
export function readJSON<T>(key: StoreKey, fallback: T, validate?: (v: unknown) => v is T): T {
  const storage = getStorage();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(storageKey(key));
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (validate && !validate(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

/** 写入 JSON；SSR 或写入失败（如配额满）时返回 false。 */
export function writeJSON(key: StoreKey, value: unknown): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.setItem(storageKey(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: StoreKey): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(key));
  } catch {
    // 忽略
  }
}

// ───────────── 形状校验（宽松：只防明显损坏的数据）─────────────

function isProfile(v: unknown): v is StudentProfile {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === 'string' &&
    typeof p.display_name === 'string' &&
    typeof p.is_sample === 'boolean' &&
    Array.isArray(p.evidence)
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isUnknownArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/**
 * 单条 grant 的形状校验。opportunity_id 必须是字符串或 null；
 * 缺少该字段（undefined）视为信息不足，不合法。
 */
function isGrant(g: unknown): g is ResourceGrant {
  if (typeof g !== 'object' || g === null) return false;
  const r = g as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.student_id === 'string' &&
    (typeof r.opportunity_id === 'string' || r.opportunity_id === null)
  );
}

// ───────────── 学生档案 ─────────────

export function loadProfile(): StudentProfile | null {
  return readJSON<StudentProfile | null>(STORE_KEYS.profile, null, (v): v is StudentProfile | null =>
    isProfile(v),
  );
}

export function saveProfile(profile: StudentProfile): boolean {
  return writeJSON(STORE_KEYS.profile, profile);
}

export function clearProfile(): void {
  removeKey(STORE_KEYS.profile);
}

// ───────────── 证据（存在档案的 evidence 字段里）─────────────

/** 读取当前档案的证据；没有档案时返回 []。 */
export function loadEvidence(): EvidenceItem[] {
  return loadProfile()?.evidence ?? [];
}

/**
 * 给当前档案添加一条证据（同 id 则替换）。
 * 返回更新后的档案；没有档案或写入失败返回 null。
 */
export function addEvidence(item: EvidenceItem): StudentProfile | null {
  const profile = loadProfile();
  if (!profile) return null;
  const next: StudentProfile = {
    ...profile,
    evidence: [...profile.evidence.filter((e) => e.id !== item.id), item],
  };
  return saveProfile(next) ? next : null;
}

/** 从当前档案删除一条证据。返回更新后的档案；没有档案或写入失败返回 null。 */
export function removeEvidence(evidenceId: string): StudentProfile | null {
  const profile = loadProfile();
  if (!profile) return null;
  const next: StudentProfile = {
    ...profile,
    evidence: profile.evidence.filter((e) => e.id !== evidenceId),
  };
  return saveProfile(next) ? next : null;
}

// ───────────── 收藏的机会 ─────────────

export function loadSavedOpportunityIds(): string[] {
  return readJSON<string[]>(STORE_KEYS.savedOpportunityIds, [], isStringArray);
}

export function saveSavedOpportunityIds(ids: string[]): boolean {
  return writeJSON(STORE_KEYS.savedOpportunityIds, Array.from(new Set(ids)));
}

/** 切换收藏状态，返回切换后的列表。 */
export function toggleSavedOpportunity(id: string): string[] {
  const ids = loadSavedOpportunityIds();
  const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
  saveSavedOpportunityIds(next);
  return next;
}

export function clearSavedOpportunityIds(): void {
  removeKey(STORE_KEYS.savedOpportunityIds);
}

// ───────────── 主办方 grants ─────────────

/**
 * 读取 grants。存的不是数组（或 JSON 损坏、SSR）时返回 []；
 * 是数组时逐条过滤，丢掉非法条目（如缺 opportunity_id），保留合法的。
 */
export function loadGrants(): ResourceGrant[] {
  return readJSON<unknown[]>(STORE_KEYS.grants, [], isUnknownArray).filter(isGrant);
}

export function saveGrants(grants: ResourceGrant[]): boolean {
  return writeJSON(STORE_KEYS.grants, grants);
}

/**
 * 某学生在某机会上生效的 grants（供 analyzeReachability 使用）：
 * 包括 opportunity_id 等于该机会的，以及 opportunity_id === null（对该学生所有机会有效）的。
 * 缺少 opportunity_id 字段的条目在读取时已被过滤掉，不会生效。
 */
export function grantsFor(studentId: string, opportunityId: string): ResourceGrant[] {
  return loadGrants().filter(
    (g) => g.student_id === studentId && (g.opportunity_id === null || g.opportunity_id === opportunityId),
  );
}

export function clearGrants(): void {
  removeKey(STORE_KEYS.grants);
}

// ───────────── 全部清除 ─────────────

/** 清除本应用（当前版本）写入的所有键。 */
export function clearAll(): void {
  for (const key of Object.values(STORE_KEYS)) removeKey(key);
}
