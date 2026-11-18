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
import {
  JOURNAL_STATUSES,
  PLAN_TRIGGERS,
  type EvidenceItem,
  type Invitation,
  type InvitationStatus,
  type ISODate,
  type JournalEntry,
  type JournalStatus,
  type JournalTask,
  type Material,
  type Opportunity,
  type PlanSnapshot,
  type ResourceGrant,
  type ShareSettings,
  type SharedProfileView,
  type StudentProfile,
} from './types';

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
  /** （第二阶段）Quest Journal 条目列表，按 opportunity_id 唯一。 */
  journal: 'journal',
  /** （第二阶段）规划快照列表（回放用），每个 (profile_id, opportunity_id) 保留最近几条。 */
  planSnapshots: 'plan_snapshots',
  /** （第二阶段）Connect：用户发布的机会（本地示例，强制 user_posted + is_sample）。 */
  userPostedOpportunities: 'user_posted_opportunities',
  /** （第二阶段）Connect：Talent Board 分享设置列表，按 profile_id 唯一。 */
  shareSettings: 'share_settings',
  /** （第二阶段）Connect：示例邀请列表。 */
  invitations: 'invitations',
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

// ═════════════════════════════ 第二阶段新增 ═════════════════════════════
//
// 约定（与上面一致）：SSR 安全、JSON 损坏或形状不对回退默认值、列表逐条过滤非法条目、不抛异常。
// 日期一律由调用方传入，存储层不读系统时钟（id 生成除外，见 newId）。

// ───────────── 内部工具 ─────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringOrNull(v: unknown): v is string | null {
  return typeof v === 'string' || v === null;
}

/** 读一个列表键：不是数组时回退 []；是数组时逐条用 guard 过滤。 */
function readList<T>(key: StoreKey, guard: (v: unknown) => v is T): T[] {
  return readJSON<unknown[]>(key, [], isUnknownArray).filter(guard);
}

let idCounter = 0;

/**
 * 生成 id：优先 crypto.randomUUID；不可用时回退到「时间戳 + 计数」。
 * 存储层允许非确定性（判断逻辑仍是纯函数）。
 */
function newId(prefix: string): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c && typeof c.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`;
  } catch {
    // 回退
  }
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * 把 patch 合并进 base：undefined = 不改；null = 清空（保持 null）。
 * `forbidden` 里的键一律忽略；`required` 里的键不接受 null（必填字段不能被清空）。
 */
function mergePatch<T extends object>(
  base: T,
  patch: object,
  forbidden: readonly string[],
  required: readonly string[],
): T {
  const next: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (forbidden.includes(k)) continue;
    if (v === undefined) continue;
    if (v === null && required.includes(k)) continue;
    next[k] = v;
  }
  return next as T;
}

// ───────────── 档案编辑 ─────────────

/**
 * 构造一个空的非示例档案（纯构造，不写存储）。
 * display_name 缺省 'My profile'；evidence 为 []；其余字段都不填（= 没填）。
 */
export function createEmptyProfile(displayName?: string): StudentProfile {
  const name = typeof displayName === 'string' && displayName.trim() !== '' ? displayName : 'My profile';
  return { id: newId('profile'), is_sample: false, display_name: name, evidence: [] };
}

/**
 * 把 patch 合并到当前档案并保存，返回保存后的档案；写入失败（含 SSR）返回 null。
 * - 没有档案时先用 createEmptyProfile() 建一个非示例档案再合并。
 * - patch 中 undefined = 不改；null = 清空该字段（保存为 null）。
 * - id、evidence 不能通过 patch 修改（运行时也会忽略）；display_name / is_sample 不接受 null。
 * - 示例档案编辑后 is_sample 仍为 true，除非 patch 明确给出 is_sample。
 */
export function updateProfile(
  patch: Partial<Omit<StudentProfile, 'id' | 'evidence'>>,
): StudentProfile | null {
  const base = loadProfile() ?? createEmptyProfile();
  const next = mergePatch(base, isRecord(patch) ? patch : {}, ['id', 'evidence'], ['display_name', 'is_sample']);
  return saveProfile(next) ? next : null;
}

// ───────────── 证据编辑 ─────────────

/** 对当前档案中某条证据做变换；档案或证据不存在、写入失败时返回 null（不写存储）。 */
function mapEvidence(evidenceId: string, fn: (e: EvidenceItem) => EvidenceItem): StudentProfile | null {
  const profile = loadProfile();
  if (!profile) return null;
  const idx = profile.evidence.findIndex((e) => e.id === evidenceId);
  if (idx < 0) return null;
  const evidence = profile.evidence.slice();
  evidence[idx] = fn(evidence[idx]);
  const next: StudentProfile = { ...profile, evidence };
  return saveProfile(next) ? next : null;
}

/**
 * 修改一条证据（状态、标题、技能、链接、prep_item_ids 等），返回更新后的档案。
 * 找不到档案或该证据时返回 null，且不写存储。
 * undefined = 不改；null = 清空（只对可空字段 url / description / prep_item_ids 生效，必填字段忽略 null）；id 不能改。
 */
export function updateEvidence(
  evidenceId: string,
  patch: Partial<Omit<EvidenceItem, 'id'>>,
): StudentProfile | null {
  return mapEvidence(evidenceId, (e) =>
    mergePatch(e, isRecord(patch) ? patch : {}, ['id'], ['title', 'kind', 'skills', 'status', 'added_on']),
  );
}

/** prep_item_ids 中跨机会准备项的键：`<opportunity_id>:<prep_item_id>`。 */
export function prepLinkKey(opportunityId: string, prepItemId: string): string {
  return `${opportunityId}:${prepItemId}`;
}

/**
 * 把证据关联到某机会的准备项（写入 `${opportunityId}:${prepItemId}`，去重）。
 * 返回更新后的档案；档案 / 证据不存在返回 null。
 */
export function linkEvidenceToPrep(
  evidenceId: string,
  opportunityId: string,
  prepItemId: string,
): StudentProfile | null {
  const key = prepLinkKey(opportunityId, prepItemId);
  return mapEvidence(evidenceId, (e) => ({
    ...e,
    prep_item_ids: Array.from(new Set([...(e.prep_item_ids ?? []), key])),
  }));
}

/**
 * 解除证据与某机会准备项的关联（同时对剩余项去重）。
 * 返回更新后的档案（原本没关联也返回档案）；档案 / 证据不存在返回 null。
 */
export function unlinkEvidenceFromPrep(
  evidenceId: string,
  opportunityId: string,
  prepItemId: string,
): StudentProfile | null {
  const key = prepLinkKey(opportunityId, prepItemId);
  return mapEvidence(evidenceId, (e) => ({
    ...e,
    prep_item_ids: Array.from(new Set((e.prep_item_ids ?? []).filter((x) => x !== key))),
  }));
}

// ───────────── Quest Journal ─────────────

function isJournalStatus(v: unknown): v is JournalStatus {
  return typeof v === 'string' && (JOURNAL_STATUSES as readonly string[]).includes(v);
}

function isStatusHistoryItem(v: unknown): v is { status: JournalStatus; on: ISODate } {
  return isRecord(v) && isJournalStatus(v.status) && typeof v.on === 'string';
}

function isJournalTask(v: unknown): v is JournalTask {
  return isRecord(v) && typeof v.id === 'string' && typeof v.title === 'string' && typeof v.done === 'boolean';
}

function isMaterial(v: unknown): v is Material {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.kind === 'string' &&
    typeof v.title === 'string' &&
    typeof v.reusable === 'boolean' &&
    isStringOrNull(v.opportunity_id) &&
    typeof v.status === 'string'
  );
}

function isJournalEntryShape(v: unknown): v is JournalEntry {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.opportunity_id === 'string' &&
    typeof v.added_on === 'string' &&
    isJournalStatus(v.status) &&
    Array.isArray(v.status_history) &&
    Array.isArray(v.tasks) &&
    Array.isArray(v.materials) &&
    typeof v.official_url === 'string'
  );
}

/** 条目内的子列表也逐条过滤非法项。 */
function sanitizeJournalEntry(e: JournalEntry): JournalEntry {
  return {
    ...e,
    status_history: e.status_history.filter(isStatusHistoryItem),
    tasks: e.tasks.filter(isJournalTask),
    materials: e.materials.filter(isMaterial),
  };
}

/** 读取 Journal；损坏回退 []，非法条目逐条丢弃；同 opportunity_id 重复时保留第一条。 */
export function loadJournal(): JournalEntry[] {
  const seen = new Set<string>();
  const out: JournalEntry[] = [];
  for (const e of readList(STORE_KEYS.journal, isJournalEntryShape)) {
    if (seen.has(e.opportunity_id)) continue;
    seen.add(e.opportunity_id);
    out.push(sanitizeJournalEntry(e));
  }
  return out;
}

/** 整体保存 Journal（同 opportunity_id 只留最后一条）。SSR / 写入失败返回 false。 */
export function saveJournal(entries: JournalEntry[]): boolean {
  const byOpp = new Map<string, JournalEntry>();
  for (const e of entries) {
    if (byOpp.has(e.opportunity_id)) byOpp.delete(e.opportunity_id);
    byOpp.set(e.opportunity_id, e);
  }
  return writeJSON(STORE_KEYS.journal, [...byOpp.values()]);
}

export function getJournalEntry(opportunityId: string): JournalEntry | null {
  return loadJournal().find((e) => e.opportunity_id === opportunityId) ?? null;
}

/** 新增或替换（按 opportunity_id 唯一，替换时保持原位置），返回更新后的列表。 */
export function upsertJournalEntry(entry: JournalEntry): JournalEntry[] {
  const list = loadJournal();
  const idx = list.findIndex((e) => e.opportunity_id === entry.opportunity_id);
  const next = idx >= 0 ? list.map((e, i) => (i === idx ? entry : e)) : [...list, entry];
  saveJournal(next);
  return next;
}

export function removeJournalEntry(opportunityId: string): JournalEntry[] {
  const next = loadJournal().filter((e) => e.opportunity_id !== opportunityId);
  saveJournal(next);
  return next;
}

/**
 * 设置条目状态并追加 status_history（日期由调用方传入）。
 * 新状态与当前状态相同时不改动、不重复追加，直接返回原条目。条目不存在返回 null。
 */
export function setJournalStatus(opportunityId: string, status: JournalStatus, on: ISODate): JournalEntry | null {
  const entry = getJournalEntry(opportunityId);
  if (!entry || !isJournalStatus(status)) return null;
  if (entry.status === status) return entry;
  const next: JournalEntry = { ...entry, status, status_history: [...entry.status_history, { status, on }] };
  upsertJournalEntry(next);
  return next;
}

/**
 * 勾选 / 取消某条任务。done = true 时 done_on = on（没传为 null）；done = false 时 done_on = null。
 * 条目或任务不存在返回 null。
 */
export function toggleJournalTask(
  opportunityId: string,
  taskId: string,
  done: boolean,
  on?: ISODate,
): JournalEntry | null {
  const entry = getJournalEntry(opportunityId);
  if (!entry || !entry.tasks.some((t) => t.id === taskId)) return null;
  const next: JournalEntry = {
    ...entry,
    tasks: entry.tasks.map((t) => (t.id === taskId ? { ...t, done, done_on: done ? (on ?? null) : null } : t)),
  };
  upsertJournalEntry(next);
  return next;
}

export function clearJournal(): void {
  removeKey(STORE_KEYS.journal);
}

// ───────────── 规划快照 ─────────────

function isPlanSnapshot(v: unknown): v is PlanSnapshot {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.profile_id === 'string' &&
    typeof v.opportunity_id === 'string' &&
    typeof v.taken_on === 'string' &&
    isRecord(v.plan) &&
    typeof v.plan.status === 'string' &&
    isRecord(v.inputs) &&
    typeof v.trigger === 'string' &&
    (PLAN_TRIGGERS as readonly string[]).includes(v.trigger)
  );
}

/** 按 taken_on 升序；同一天按插入顺序（稳定排序）。 */
function sortSnapshots(list: PlanSnapshot[]): PlanSnapshot[] {
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.taken_on < b.s.taken_on ? -1 : a.s.taken_on > b.s.taken_on ? 1 : a.i - b.i))
    .map((x) => x.s);
}

/**
 * 读取快照（旧 → 新：按 taken_on，同日按插入顺序）。
 * 可按 opportunityId、profileId 过滤（不传 = 不过滤）。
 */
export function loadPlanSnapshots(opportunityId?: string, profileId?: string): PlanSnapshot[] {
  return sortSnapshots(readList(STORE_KEYS.planSnapshots, isPlanSnapshot)).filter(
    (s) =>
      (opportunityId === undefined || s.opportunity_id === opportunityId) &&
      (profileId === undefined || s.profile_id === profileId),
  );
}

/**
 * 追加一个快照（同 id 先移除旧的），每个 (profile_id, opportunity_id) 只保留最近 keep 条（keep 至少为 1）。
 * 返回该 (profile_id, opportunity_id) 保留下来的快照（旧 → 新）。
 */
export function pushPlanSnapshot(snapshot: PlanSnapshot, keep = 5): PlanSnapshot[] {
  const limit = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : 5;
  const all = sortSnapshots([
    ...readList(STORE_KEYS.planSnapshots, isPlanSnapshot).filter((s) => s.id !== snapshot.id),
    snapshot,
  ]);
  const same = (s: PlanSnapshot) =>
    s.profile_id === snapshot.profile_id && s.opportunity_id === snapshot.opportunity_id;
  const pair = all.filter(same);
  const dropped = new Set(pair.slice(0, Math.max(0, pair.length - limit)));
  const next = all.filter((s) => !dropped.has(s));
  writeJSON(STORE_KEYS.planSnapshots, next);
  return next.filter(same);
}

export function latestPlanSnapshot(opportunityId: string, profileId: string): PlanSnapshot | null {
  const list = loadPlanSnapshots(opportunityId, profileId);
  return list.length > 0 ? list[list.length - 1] : null;
}

/** 不传 = 清空全部快照；传 opportunityId = 只清该机会的快照（所有档案）。 */
export function clearPlanSnapshots(opportunityId?: string): void {
  if (opportunityId === undefined) {
    removeKey(STORE_KEYS.planSnapshots);
    return;
  }
  writeJSON(
    STORE_KEYS.planSnapshots,
    readList(STORE_KEYS.planSnapshots, isPlanSnapshot).filter((s) => s.opportunity_id !== opportunityId),
  );
}

// ───────────── Connect：用户发布的机会（本地示例）─────────────

/** 最小形状 + 强制标记：必须 source_tier = 'user_posted' 且 is_sample = true。 */
function isUserPostedOpportunity(v: unknown): v is Opportunity {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    typeof v.organizer === 'string' &&
    Array.isArray(v.requirements) &&
    Array.isArray(v.preparation) &&
    Array.isArray(v.required_devices) &&
    isRecord(v.location) &&
    isRecord(v.cost) &&
    isRecord(v.time_commitment) &&
    v.source_tier === 'user_posted' &&
    v.is_sample === true
  );
}

/** 读取用户发布的机会；不是 user_posted + is_sample 的条目一律丢弃。 */
export function loadUserPostedOpportunities(): Opportunity[] {
  return readList(STORE_KEYS.userPostedOpportunities, isUserPostedOpportunity);
}

/**
 * 添加一条用户发布的机会（同 id 替换）。传入的 source_tier / is_sample 一律被覆盖为
 * 'user_posted' / true——用户发布的机会永远不能伪装成官网核实的机会。返回更新后的列表。
 */
export function addUserPostedOpportunity(opp: Opportunity): Opportunity[] {
  const forced: Opportunity = { ...opp, source_tier: 'user_posted', is_sample: true };
  const list = loadUserPostedOpportunities();
  const idx = list.findIndex((o) => o.id === forced.id);
  const next = idx >= 0 ? list.map((o, i) => (i === idx ? forced : o)) : [...list, forced];
  writeJSON(STORE_KEYS.userPostedOpportunities, next);
  return next.filter(isUserPostedOpportunity);
}

export function removeUserPostedOpportunity(id: string): Opportunity[] {
  const next = loadUserPostedOpportunities().filter((o) => o.id !== id);
  writeJSON(STORE_KEYS.userPostedOpportunities, next);
  return next;
}

export function clearUserPostedOpportunities(): void {
  removeKey(STORE_KEYS.userPostedOpportunities);
}

// ───────────── Connect：分享设置 ─────────────

function isShareSettings(v: unknown): v is ShareSettings {
  return (
    isRecord(v) &&
    typeof v.profile_id === 'string' &&
    isStringArray(v.evidence_ids) &&
    isStringArray(v.skills) &&
    typeof v.share_interests === 'boolean' &&
    isStringOrNull(v.collaboration_note) &&
    typeof v.updated_on === 'string'
  );
}

/** 默认分享设置：什么都不分享。 */
export function defaultShareSettings(profileId: string, on: ISODate): ShareSettings {
  return {
    profile_id: profileId,
    evidence_ids: [],
    skills: [],
    share_interests: false,
    collaboration_note: null,
    updated_on: on,
  };
}

/** 读取某档案的分享设置；没有（或损坏）返回 null（调用方可用 defaultShareSettings 兜底）。 */
export function loadShareSettings(profileId: string): ShareSettings | null {
  return readList(STORE_KEYS.shareSettings, isShareSettings).find((s) => s.profile_id === profileId) ?? null;
}

/** 保存分享设置（按 profile_id 替换）。形状不对、SSR 或写入失败返回 false。 */
export function saveShareSettings(settings: ShareSettings): boolean {
  if (!isShareSettings(settings)) return false;
  const rest = readList(STORE_KEYS.shareSettings, isShareSettings).filter(
    (s) => s.profile_id !== settings.profile_id,
  );
  return writeJSON(STORE_KEYS.shareSettings, [...rest, settings]);
}

/** 不传 = 清空全部；传 profileId = 只撤回该档案的设置（等同恢复默认：什么都不分享）。 */
export function clearShareSettings(profileId?: string): void {
  if (profileId === undefined) {
    removeKey(STORE_KEYS.shareSettings);
    return;
  }
  writeJSON(
    STORE_KEYS.shareSettings,
    readList(STORE_KEYS.shareSettings, isShareSettings).filter((s) => s.profile_id !== profileId),
  );
}

/**
 * 纯函数：按分享设置过滤档案，只输出学生已授权的内容。
 * - evidence：只含 settings.evidence_ids 中且档案里确实存在的证据，只取 id / title / kind / skills / status
 *   （不含 url、description、prep_item_ids、added_on）。
 * - skills：只含被勾选、且档案里确实有的技能（name + level）。
 * - interests：仅当 share_interests 为 true。
 * - alias：示例档案 'Sample student'，否则 'Student'。永不包含显示名、学校名、地区、联系方式、身份标签、年级、预算等。
 * settings 为 null、属于别的档案、或最终什么都没分享时返回 null。
 */
export function buildSharedProfileView(
  profile: StudentProfile,
  settings: ShareSettings | null,
): SharedProfileView | null {
  if (!settings || settings.profile_id !== profile.id) return null;
  const evidenceIds = new Set(settings.evidence_ids);
  const skillNames = new Set(settings.skills);
  const evidence = profile.evidence
    .filter((e) => evidenceIds.has(e.id))
    .map((e) => ({ id: e.id, title: e.title, kind: e.kind, skills: [...e.skills], status: e.status }));
  const skills = (profile.skills ?? [])
    .filter((s) => skillNames.has(s.name))
    .map((s) => ({ name: s.name, level: s.level }));
  const interests = settings.share_interests ? [...(profile.interests ?? [])] : [];
  const note =
    typeof settings.collaboration_note === 'string' && settings.collaboration_note.trim() !== ''
      ? settings.collaboration_note
      : null;
  if (evidence.length === 0 && skills.length === 0 && interests.length === 0 && note === null) return null;
  return {
    profile_id: profile.id,
    alias: profile.is_sample ? 'Sample student' : 'Student',
    evidence,
    skills,
    interests,
    collaboration_note: note,
    is_sample: profile.is_sample,
  };
}

// ───────────── Connect：邀请（本地示例）─────────────

const INVITATION_STATUSES: readonly InvitationStatus[] = ['pending', 'declined', 'accepted', 'blocked'];

function isInvitationStatus(v: unknown): v is InvitationStatus {
  return typeof v === 'string' && (INVITATION_STATUSES as readonly string[]).includes(v);
}

function isInvitation(v: unknown): v is Invitation {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.publisher_id === 'string' &&
    typeof v.profile_id === 'string' &&
    isStringOrNull(v.opportunity_id) &&
    isStringArray(v.reasons) &&
    isInvitationStatus(v.status) &&
    v.is_sample === true &&
    typeof v.sent_on === 'string'
  );
}

/** 读取邀请；可按 profileId 过滤。非法条目（含 is_sample 不为 true 的）逐条丢弃。 */
export function loadInvitations(profileId?: string): Invitation[] {
  return readList(STORE_KEYS.invitations, isInvitation).filter(
    (i) => profileId === undefined || i.profile_id === profileId,
  );
}

/** 整体保存邀请（is_sample 强制为 true）。SSR / 写入失败返回 false。 */
export function saveInvitations(list: Invitation[]): boolean {
  return writeJSON(
    STORE_KEYS.invitations,
    list.map((i) => ({ ...i, is_sample: true as const })),
  );
}

/** 添加一条邀请（同 id 替换，is_sample 强制为 true），返回更新后的全部邀请。 */
export function addInvitation(inv: Invitation): Invitation[] {
  const forced: Invitation = { ...inv, is_sample: true };
  const list = loadInvitations();
  const idx = list.findIndex((i) => i.id === forced.id);
  const next = idx >= 0 ? list.map((i, k) => (k === idx ? forced : i)) : [...list, forced];
  saveInvitations(next);
  return next.filter(isInvitation);
}

/**
 * 设置邀请状态。改为 pending 时 responded_on = null，否则 = on。
 * 邀请不存在或状态非法返回 null。
 */
export function setInvitationStatus(id: string, status: InvitationStatus, on: ISODate): Invitation | null {
  if (!isInvitationStatus(status)) return null;
  const list = loadInvitations();
  const current = list.find((i) => i.id === id);
  if (!current) return null;
  const updated: Invitation = { ...current, status, responded_on: status === 'pending' ? null : on };
  saveInvitations(list.map((i) => (i.id === id ? updated : i)));
  return updated;
}

/** 某档案屏蔽了的发布者 id（来自状态为 blocked 的邀请，去重）。 */
export function blockedPublisherIds(profileId: string): string[] {
  return Array.from(
    new Set(loadInvitations(profileId).filter((i) => i.status === 'blocked').map((i) => i.publisher_id)),
  );
}

export function clearInvitations(): void {
  removeKey(STORE_KEYS.invitations);
}

// ───────────── 全部清除 ─────────────

/** 清除本应用（当前版本）写入的所有键（含第二阶段新增的键）。 */
export function clearAll(): void {
  for (const key of Object.values(STORE_KEYS)) removeKey(key);
}
