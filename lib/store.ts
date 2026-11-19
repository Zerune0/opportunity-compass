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
import { applyJournalEvent, isJournalEvent } from './journal';
import { isStrictISODate } from './validation';
import {
  MATERIAL_KINDS,
  MATERIAL_STATUSES,
  PLAN_TRIGGERS,
  VIEW_PREFERENCES,
  type EvidenceItem,
  type Invitation,
  type InvitationStatus,
  type ISODate,
  type JournalEntry,
  type JournalEvent,
  type JournalHistoryItem,
  type JournalTask,
  type Material,
  type MaterialStatus,
  type Opportunity,
  type PlanSnapshot,
  type ResourceGrant,
  type ShareSettings,
  type SharedProfileView,
  type StudentProfile,
  type StudentSkill,
  type ViewPreference,
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
  /** （第二阶段）Quest Journal 条目列表，按 (profile_id, opportunity_id) 唯一。 */
  journal: 'journal',
  /** （第二阶段）申请材料列表（按 id 唯一）；Journal 条目用 material_ids 引用，可复用材料只存一份。 */
  materials: 'materials',
  /** （第二阶段）规划快照列表（回放用），每个 (profile_id, opportunity_id) 保留最近几条。 */
  planSnapshots: 'plan_snapshots',
  /** （第二阶段）Connect：用户发布的机会（本地示例，强制 user_posted + is_sample）。 */
  userPostedOpportunities: 'user_posted_opportunities',
  /** （第二阶段）Connect：Talent Board 分享设置列表，按 profile_id 唯一。 */
  shareSettings: 'share_settings',
  /** （第二阶段）Connect：示例邀请列表。 */
  invitations: 'invitations',
  /** （第四阶段）地图页视图偏好：'adventure' | 'classic'。 */
  viewPreference: 'view_preference',
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

/**
 * 档案里可单独丢弃的非法可选值：birth_date 不是合法 `YYYY-MM-DD` 时改为 null（丢弃这个值，不丢弃整个档案）。
 * 不读系统时钟，所以这里不检查「未来日期」；引擎在给了 today 时会忽略晚于 today 的出生日期。
 */
function sanitizeProfile(p: StudentProfile): StudentProfile {
  const b = (p as { birth_date?: unknown }).birth_date;
  if (b === undefined || b === null || isStrictISODate(b)) return p;
  return { ...p, birth_date: null };
}

export function loadProfile(): StudentProfile | null {
  const p = readJSON<StudentProfile | null>(STORE_KEYS.profile, null, (v): v is StudentProfile | null =>
    isProfile(v),
  );
  return p == null ? null : sanitizeProfile(p);
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
 * - birth_date 不是合法 `YYYY-MM-DD` 时保存为 null（丢弃非法值，其余字段照常保存）。
 */
export function updateProfile(
  patch: Partial<Omit<StudentProfile, 'id' | 'evidence'>>,
): StudentProfile | null {
  const base = loadProfile() ?? createEmptyProfile();
  const next = sanitizeProfile(
    mergePatch(base, isRecord(patch) ? patch : {}, ['id', 'evidence'], ['display_name', 'is_sample']),
  );
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
 * undefined = 不改；null = 清空（只对可空字段 url / description 生效；必填字段 title / kind / skills / status / added_on
 * 忽略 null）；id 不能改。要清空 prep_item_ids，传空数组 `[]`（它的类型不接受 null）。
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
//
// 条目按 (profile_id, opportunity_id) 唯一；同一浏览器里可能切换示例档案，各档案的 Journal 互不影响。
// 材料单独存（见下一节），条目只存 material_ids。

const APPLICATION_STATUSES = ['preparing', 'submitted', 'withdrawn'] as const;
const ELIGIBILITY_CONFIRMATIONS = ['unconfirmed', 'confirmed', 'rejected'] as const;
const DECISIONS = ['pending', 'admitted', 'not_admitted'] as const;

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

function isHistoryItem(v: unknown): v is JournalHistoryItem {
  return isRecord(v) && isJournalEvent(v.event) && typeof v.on === 'string';
}

function isJournalTask(v: unknown): v is JournalTask {
  return isRecord(v) && typeof v.id === 'string' && typeof v.title === 'string' && typeof v.done === 'boolean';
}

function isJournalEntryShape(v: unknown): v is JournalEntry {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.profile_id === 'string' &&
    typeof v.opportunity_id === 'string' &&
    typeof v.added_on === 'string' &&
    oneOf(APPLICATION_STATUSES, v.application) &&
    isStringOrNull(v.submitted_on) &&
    oneOf(ELIGIBILITY_CONFIRMATIONS, v.eligibility_confirmation) &&
    oneOf(DECISIONS, v.decision) &&
    (typeof v.participated === 'boolean' || v.participated === null) &&
    Array.isArray(v.history) &&
    Array.isArray(v.tasks) &&
    Array.isArray(v.material_ids) &&
    typeof v.official_url === 'string'
  );
}

/** 条目内的子列表也逐条过滤非法项（material_ids 只留字符串并去重）。 */
function sanitizeJournalEntry(e: JournalEntry): JournalEntry {
  return {
    ...e,
    history: e.history.filter(isHistoryItem),
    tasks: e.tasks.filter(isJournalTask),
    material_ids: Array.from(new Set(e.material_ids.filter((x): x is string => typeof x === 'string'))),
  };
}

/** 损坏输入的 profile_id（若有），供写入失败时返回「该档案现有列表」；没有时返回 undefined（= 不过滤）。 */
function profileIdOf(v: unknown): string | undefined {
  return isRecord(v) && typeof v.profile_id === 'string' ? v.profile_id : undefined;
}

function sameEntry(a: Pick<JournalEntry, 'profile_id' | 'opportunity_id'>, profileId: string, opportunityId: string): boolean {
  return a.profile_id === profileId && a.opportunity_id === opportunityId;
}

/** 全部条目（所有档案）；损坏回退 []，非法条目逐条丢弃；同 (profile_id, opportunity_id) 重复时保留第一条。 */
function loadAllJournal(): JournalEntry[] {
  const seen = new Set<string>();
  const out: JournalEntry[] = [];
  for (const e of readList(STORE_KEYS.journal, isJournalEntryShape)) {
    const key = JSON.stringify([e.profile_id, e.opportunity_id]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(sanitizeJournalEntry(e));
  }
  return out;
}

/**
 * 读取 Journal：传 profileId = 只返回该档案的条目；不传 = 所有档案。
 * 损坏回退 []，非法条目逐条丢弃，同 (profile_id, opportunity_id) 重复时保留第一条。
 */
export function loadJournal(profileId?: string): JournalEntry[] {
  const all = loadAllJournal();
  return profileId === undefined ? all : all.filter((e) => e.profile_id === profileId);
}

/**
 * 整体保存 Journal（会覆盖所有档案的条目；同 (profile_id, opportunity_id) 只留最后一条）。
 * SSR / 写入失败返回 false。
 */
export function saveJournal(entries: JournalEntry[]): boolean {
  const byKey = new Map<string, JournalEntry>();
  for (const e of entries) {
    const key = JSON.stringify([e.profile_id, e.opportunity_id]);
    if (byKey.has(key)) byKey.delete(key);
    byKey.set(key, e);
  }
  return writeJSON(STORE_KEYS.journal, [...byKey.values()]);
}

export function getJournalEntry(profileId: string, opportunityId: string): JournalEntry | null {
  return loadAllJournal().find((e) => sameEntry(e, profileId, opportunityId)) ?? null;
}

/**
 * 构造一个新条目（纯构造，不写存储；id 由 newId 生成）：application 'preparing'、资格 'unconfirmed'、
 * 结果 'pending'、participated null、history 为 [{ event: 'added', on }]、无任务、无材料。
 */
export function createJournalEntry(
  profileId: string,
  opportunity: Pick<Opportunity, 'id' | 'official_url'>,
  on: ISODate,
): JournalEntry {
  return {
    id: newId('journal'),
    profile_id: profileId,
    opportunity_id: opportunity.id,
    added_on: on,
    application: 'preparing',
    submitted_on: null,
    eligibility_confirmation: 'unconfirmed',
    decision: 'pending',
    participated: null,
    history: [{ event: 'added', on }],
    tasks: [],
    material_ids: [],
    official_url: opportunity.official_url,
  };
}

/**
 * 新增或替换（按 (profile_id, opportunity_id) 唯一，替换时保持原位置）。
 * 返回该档案（entry.profile_id）更新后的条目列表。形状不对时不写，返回该档案现有列表（连 profile_id 都没有时返回 []）。
 */
export function upsertJournalEntry(entry: JournalEntry): JournalEntry[] {
  if (!isJournalEntryShape(entry)) {
    const pid = profileIdOf(entry);
    return pid === undefined ? [] : loadJournal(pid);
  }
  const clean = sanitizeJournalEntry(entry);
  const list = loadAllJournal();
  const idx = list.findIndex((e) => sameEntry(e, clean.profile_id, clean.opportunity_id));
  const next = idx >= 0 ? list.map((e, i) => (i === idx ? clean : e)) : [...list, clean];
  saveJournal(next);
  return next.filter((e) => e.profile_id === clean.profile_id);
}

/**
 * 删除某档案在某机会上的条目，返回该档案剩下的条目。
 * 条目引用的材料不删（可复用材料可能还被别的条目用；不再需要的材料用 removeMaterial 删）。
 */
export function removeJournalEntry(profileId: string, opportunityId: string): JournalEntry[] {
  const next = loadAllJournal().filter((e) => !sameEntry(e, profileId, opportunityId));
  saveJournal(next);
  return next.filter((e) => e.profile_id === profileId);
}

/**
 * 记录一个 Journal 事件（日期由调用方传入）：用 lib/journal.ts 的 applyJournalEvent 一致地更新对应字段
 * （见 JournalEvent 注释）并追加 history；与 history 最后一条相同（同一事件、同一天）时不重复追加。条目不存在或事件非法返回 null。
 *
 * 不阻止不合常理的顺序（如没提交就记 admitted）——学生记录的是现实。页面应当引导：
 * 未提交时把录取结果 / 资格确认放在次要位置并提示「通常在提交后才会有」；记录这些事件时若仍是 preparing，
 * 询问是否同时记一次 submitted；已退出时把 reopened 放在显眼处。四项始终分开显示。
 */
export function recordJournalEvent(
  profileId: string,
  opportunityId: string,
  event: JournalEvent,
  on: ISODate,
): JournalEntry | null {
  if (!isJournalEvent(event) || typeof on !== 'string') return null;
  const entry = getJournalEntry(profileId, opportunityId);
  if (!entry) return null;
  const next = applyJournalEvent(entry, event, on);
  upsertJournalEntry(next);
  return next;
}

/**
 * 勾选 / 取消某条任务。done = true 时 done_on = on（没传为 null）；done = false 时 done_on = null。
 * 条目或任务不存在返回 null。
 */
export function toggleJournalTask(
  profileId: string,
  opportunityId: string,
  taskId: string,
  done: boolean,
  on?: ISODate,
): JournalEntry | null {
  const entry = getJournalEntry(profileId, opportunityId);
  if (!entry || !entry.tasks.some((t) => t.id === taskId)) return null;
  const next: JournalEntry = {
    ...entry,
    tasks: entry.tasks.map((t) => (t.id === taskId ? { ...t, done, done_on: done ? (on ?? null) : null } : t)),
  };
  upsertJournalEntry(next);
  return next;
}

/** 不传 = 清空全部条目（所有档案）；传 profileId = 只清该档案的条目。 */
export function clearJournal(profileId?: string): void {
  if (profileId === undefined) {
    removeKey(STORE_KEYS.journal);
    return;
  }
  saveJournal(loadAllJournal().filter((e) => e.profile_id !== profileId));
}

// ───────────── 申请材料（单独存，Journal 条目用 material_ids 引用）─────────────

function isMaterial(v: unknown): v is Material {
  return (
    isRecord(v) &&
    typeof v.id === 'string' &&
    typeof v.profile_id === 'string' &&
    oneOf(MATERIAL_KINDS, v.kind) &&
    typeof v.title === 'string' &&
    typeof v.reusable === 'boolean' &&
    isStringOrNull(v.opportunity_id) &&
    (typeof v.estimated_hours === 'number' || v.estimated_hours === null) &&
    oneOf(MATERIAL_STATUSES, v.status)
  );
}

/** 全部材料（按 id 唯一，重复时保留第一条）。 */
function loadAllMaterials(): Material[] {
  const seen = new Set<string>();
  return readList(STORE_KEYS.materials, isMaterial).filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

/** 读取材料：传 profileId = 只返回该档案的；不传 = 全部。损坏回退 []，非法条目逐条丢弃。 */
export function loadMaterials(profileId?: string): Material[] {
  const all = loadAllMaterials();
  return profileId === undefined ? all : all.filter((m) => m.profile_id === profileId);
}

/**
 * 新增或替换一份材料（按 id 唯一，替换时保持原位置）。
 * 返回该档案（material.profile_id）更新后的材料列表；形状不对时不写，返回该档案现有列表（连 profile_id 都没有时返回 []）。
 */
export function upsertMaterial(material: Material): Material[] {
  if (!isMaterial(material)) {
    const pid = profileIdOf(material);
    return pid === undefined ? [] : loadMaterials(pid);
  }
  const list = loadAllMaterials();
  const idx = list.findIndex((m) => m.id === material.id);
  const next = idx >= 0 ? list.map((m, i) => (i === idx ? material : m)) : [...list, material];
  writeJSON(STORE_KEYS.materials, next);
  return next.filter((m) => m.profile_id === material.profile_id);
}

/**
 * 删除一份材料，并从所有 Journal 条目的 material_ids 里移除它。
 * 返回是否找到并删除了它（SSR / 不存在为 false）。
 */
export function removeMaterial(id: string): boolean {
  const list = loadAllMaterials();
  if (!list.some((m) => m.id === id)) return false;
  if (!writeJSON(STORE_KEYS.materials, list.filter((m) => m.id !== id))) return false;
  const journal = loadAllJournal();
  if (journal.some((e) => e.material_ids.includes(id))) {
    saveJournal(journal.map((e) => (e.material_ids.includes(id) ? { ...e, material_ids: e.material_ids.filter((x) => x !== id) } : e)));
  }
  return true;
}

/** 设置材料状态（可复用材料只有一条记录，所有引用它的条目都看到新状态）。材料不存在或状态非法返回 null。 */
export function setMaterialStatus(id: string, status: MaterialStatus): Material | null {
  if (!oneOf(MATERIAL_STATUSES, status)) return null;
  const current = loadAllMaterials().find((m) => m.id === id);
  if (!current) return null;
  const updated: Material = { ...current, status };
  upsertMaterial(updated);
  return updated;
}

/** 不传 = 清空全部材料；传 profileId = 只清该档案的材料（同时从该档案条目的 material_ids 中移除）。 */
export function clearMaterials(profileId?: string): void {
  if (profileId === undefined) {
    removeKey(STORE_KEYS.materials);
    const journal = loadAllJournal();
    if (journal.some((e) => e.material_ids.length > 0)) saveJournal(journal.map((e) => ({ ...e, material_ids: [] })));
    return;
  }
  writeJSON(STORE_KEYS.materials, loadAllMaterials().filter((m) => m.profile_id !== profileId));
  const journal = loadAllJournal();
  if (journal.some((e) => e.profile_id === profileId && e.material_ids.length > 0)) {
    saveJournal(journal.map((e) => (e.profile_id === profileId ? { ...e, material_ids: [] } : e)));
  }
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
 * 追加一个快照（同 id 先移除旧的，新的算作最新插入），每个 (profile_id, opportunity_id)
 * 按**插入顺序**只保留最近插入的 keep 条（keep 至少为 1）——刚推入的快照一定保留，
 * 即使它的 taken_on 比已有的都早。存储里按插入顺序存，读取时（loadPlanSnapshots）再按 taken_on 排序。
 * 返回该 (profile_id, opportunity_id) 保留下来的快照（按 taken_on 旧 → 新，同日按插入顺序）。
 */
export function pushPlanSnapshot(snapshot: PlanSnapshot, keep = 5): PlanSnapshot[] {
  const limit = Number.isFinite(keep) ? Math.max(1, Math.floor(keep)) : 5;
  const all = [...readList(STORE_KEYS.planSnapshots, isPlanSnapshot).filter((s) => s.id !== snapshot.id), snapshot];
  const same = (s: PlanSnapshot) =>
    s.profile_id === snapshot.profile_id && s.opportunity_id === snapshot.opportunity_id;
  const pair = all.filter(same);
  const dropped = new Set(pair.slice(0, Math.max(0, pair.length - limit)));
  const next = all.filter((s) => !dropped.has(s));
  writeJSON(STORE_KEYS.planSnapshots, next);
  return sortSnapshots(next.filter(same));
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
    typeof v.share_handle === 'string' &&
    v.share_handle !== '' &&
    isStringArray(v.evidence_ids) &&
    isStringArray(v.skills) &&
    typeof v.share_interests === 'boolean' &&
    isStringOrNull(v.collaboration_note) &&
    typeof v.updated_on === 'string'
  );
}

/** 生成一个不透明的分享句柄：`share-<uuid>`（没有 crypto.randomUUID 时回退到时间戳 + 计数），不含档案 id 或姓名。 */
function newShareHandle(): string {
  return newId('share');
}

/**
 * 默认分享设置：什么都不分享。share_handle 不传时新生成一个不透明句柄
 * （每次调用都不同——要让句柄稳定，请保存，或用 getOrCreateShareSettings）。
 */
export function defaultShareSettings(profileId: string, on: ISODate, shareHandle?: string): ShareSettings {
  return {
    profile_id: profileId,
    share_handle: typeof shareHandle === 'string' && shareHandle !== '' ? shareHandle : newShareHandle(),
    evidence_ids: [],
    skills: [],
    share_interests: false,
    collaboration_note: null,
    updated_on: on,
  };
}

/** 读取某档案的分享设置；没有（或损坏）返回 null（调用方可用 getOrCreateShareSettings 兜底）。 */
export function loadShareSettings(profileId: string): ShareSettings | null {
  return readList(STORE_KEYS.shareSettings, isShareSettings).find((s) => s.profile_id === profileId) ?? null;
}

/**
 * 读取某档案的分享设置；没有时用 defaultShareSettings 新建并保存（这样 share_handle 从此稳定）。
 * SSR / 写入失败时仍返回新建的默认设置（未保存，句柄下次会不同）。
 */
export function getOrCreateShareSettings(profileId: string, on: ISODate): ShareSettings {
  const existing = loadShareSettings(profileId);
  if (existing) return existing;
  const created = defaultShareSettings(profileId, on);
  saveShareSettings(created);
  return created;
}

/**
 * 保存分享设置（按 profile_id 替换）。形状不对、share_handle 已被别的档案使用、SSR 或写入失败返回 false。
 */
export function saveShareSettings(settings: ShareSettings): boolean {
  if (!isShareSettings(settings)) return false;
  const all = readList(STORE_KEYS.shareSettings, isShareSettings);
  if (all.some((s) => s.share_handle === settings.share_handle && s.profile_id !== settings.profile_id)) return false;
  const rest = all.filter((s) => s.profile_id !== settings.profile_id);
  return writeJSON(STORE_KEYS.shareSettings, [...rest, settings]);
}

/**
 * 学生自己的浏览器里：由分享句柄对回档案 id（邀请只带句柄）。找不到返回 null。
 */
export function profileIdForShareHandle(handle: string): string | null {
  if (typeof handle !== 'string' || handle === '') return null;
  return readList(STORE_KEYS.shareSettings, isShareSettings).find((s) => s.share_handle === handle)?.profile_id ?? null;
}

/**
 * 不传 = 清空全部分享设置（含句柄）。
 * 传 profileId = 撤回该档案的分享：恢复默认（什么都不分享），但**保留原 share_handle**，
 * 这样已有的邀请与屏蔽仍然对得上（updated_on 用 on；没传 on 时沿用原日期）。该档案没有设置时什么都不做。
 */
export function clearShareSettings(profileId?: string, on?: ISODate): void {
  if (profileId === undefined) {
    removeKey(STORE_KEYS.shareSettings);
    return;
  }
  const current = loadShareSettings(profileId);
  if (!current) return;
  saveShareSettings(defaultShareSettings(profileId, on ?? current.updated_on, current.share_handle));
}

function isObjectLike(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

/**
 * 纯函数：按分享设置过滤档案，只输出学生已授权的内容。
 * - share_handle：抄自 settings（不含档案 id）。
 * - evidence：只含 settings.evidence_ids 中且档案里确实存在的证据，只取 id / title / kind / skills / status
 *   （不含 url、description、prep_item_ids、added_on）。
 * - skills：只含被勾选、且档案里确实有的技能（name + level）。
 * - interests：仅当 share_interests 为 true。
 * - alias：示例档案 'Sample student'，否则 'Student'。永不包含档案 id、显示名、学校名、地区、联系方式、身份标签、年级、
 *   年龄、出生日期（birth_date）、预算等。
 * settings 为 null、属于别的档案、没有 share_handle、或最终什么都没分享时返回 null。
 * 档案损坏时不抛异常：evidence / skills / interests 不是数组、证据缺 skills 或 skills 不是数组等，一律按空处理；
 * 缺 id / title 的证据、缺 name 的技能直接跳过。
 */
export function buildSharedProfileView(
  profile: StudentProfile,
  settings: ShareSettings | null,
): SharedProfileView | null {
  if (!isObjectLike(profile) || !isObjectLike(settings)) return null;
  if (settings.profile_id !== profile.id) return null;
  if (typeof settings.share_handle !== 'string' || settings.share_handle === '') return null;
  const evidenceIds = new Set(strings(settings.evidence_ids));
  const skillNames = new Set(strings(settings.skills));
  const evidence = (Array.isArray(profile.evidence) ? (profile.evidence as unknown[]) : [])
    .filter(isObjectLike)
    .filter((e) => typeof e.id === 'string' && typeof e.title === 'string' && evidenceIds.has(e.id))
    .map((e) => ({
      id: e.id as string,
      title: e.title as string,
      kind: e.kind as EvidenceItem['kind'],
      skills: strings(e.skills),
      status: e.status as EvidenceItem['status'],
    }));
  const skills = (Array.isArray(profile.skills) ? (profile.skills as unknown[]) : [])
    .filter(isObjectLike)
    .filter((s) => typeof s.name === 'string' && skillNames.has(s.name))
    .map((s) => ({ name: s.name as string, level: s.level as StudentSkill['level'] }));
  const interests = settings.share_interests === true ? strings(profile.interests) : [];
  const note =
    typeof settings.collaboration_note === 'string' && settings.collaboration_note.trim() !== ''
      ? settings.collaboration_note
      : null;
  if (evidence.length === 0 && skills.length === 0 && interests.length === 0 && note === null) return null;
  return {
    share_handle: settings.share_handle,
    alias: profile.is_sample === true ? 'Sample student' : 'Student',
    evidence,
    skills,
    interests,
    collaboration_note: note,
    is_sample: profile.is_sample === true,
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
    typeof v.share_handle === 'string' &&
    isStringOrNull(v.opportunity_id) &&
    isStringArray(v.reasons) &&
    isInvitationStatus(v.status) &&
    v.is_sample === true &&
    typeof v.sent_on === 'string'
  );
}

/**
 * 读取邀请；可按 shareHandle（被邀请学生的 ShareSettings.share_handle）过滤。
 * 学生页面：先 loadShareSettings(profileId)?.share_handle，再用它读取。非法条目（含 is_sample 不为 true 的）逐条丢弃。
 */
export function loadInvitations(shareHandle?: string): Invitation[] {
  return readList(STORE_KEYS.invitations, isInvitation).filter(
    (i) => shareHandle === undefined || i.share_handle === shareHandle,
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

/** 某分享句柄（学生）屏蔽了的发布者 id（来自状态为 blocked 的邀请，去重）。 */
export function blockedPublisherIds(shareHandle: string): string[] {
  return Array.from(
    new Set(loadInvitations(shareHandle).filter((i) => i.status === 'blocked').map((i) => i.publisher_id)),
  );
}

export function clearInvitations(): void {
  removeKey(STORE_KEYS.invitations);
}

// ───────────── 地图视图偏好（第四阶段）─────────────

/** 默认视图：与地图页现有默认一致（不带 ?view=classic 时显示冒险地图）。 */
export const DEFAULT_VIEW_PREFERENCE: ViewPreference = 'adventure';

function isViewPreference(v: unknown): v is ViewPreference {
  return oneOf(VIEW_PREFERENCES, v);
}

/** 读取地图视图偏好；没存过、值非法、JSON 损坏或 SSR 时返回 'adventure'。 */
export function loadViewPreference(): ViewPreference {
  return readJSON<ViewPreference>(STORE_KEYS.viewPreference, DEFAULT_VIEW_PREFERENCE, isViewPreference);
}

/** 保存地图视图偏好；值非法时不写。SSR / 写入失败静默忽略（不抛错）。 */
export function saveViewPreference(v: ViewPreference): void {
  if (!isViewPreference(v)) return;
  writeJSON(STORE_KEYS.viewPreference, v);
}

// ───────────── 校验工具（只读导出，供 lib/backup.ts 复用同一套规则）─────────────

/**
 * 读取时使用的同一套单条校验 / 清洗规则（不读写存储，纯函数）。
 * 只是把上面已有的内部函数导出，行为不变；导入备份时用它们逐条过滤。
 */
export const STORE_VALIDATORS = {
  isProfile,
  sanitizeProfile,
  isGrant,
  isJournalEntryShape,
  sanitizeJournalEntry,
  isMaterial,
  isPlanSnapshot,
  isUserPostedOpportunity,
  isShareSettings,
  isInvitation,
  isViewPreference,
} as const;

// ───────────── 全部清除 ─────────────

/** 清除本应用（当前版本）写入的所有键（含第二阶段新增的键）。 */
export function clearAll(): void {
  for (const key of Object.values(STORE_KEYS)) removeKey(key);
}
