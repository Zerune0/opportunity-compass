/**
 * 数据备份：把浏览器 localStorage 里本应用存的全部数据导出成一个 JSON 文件、从文件导入、整体替换。
 *
 * - 没有账号、没有后端：这个文件是唯一的备份方式。只在浏览器内读写，不上传。
 * - buildBackup / parseBackup / summarizeBackup 是纯函数（日期由调用方传入），不读写存储。
 * - collectBackupData / applyBackup 是存储胶水，调用 lib/store.ts 现有函数；只能在浏览器（effect / 事件处理）里调用。
 * - 导入用 store 读取时的同一套单条校验规则（STORE_VALIDATORS）逐条过滤；坏条目丢弃并给出 warning。
 * - 导入的 grants 一律强制 is_sample: true（本应用只有模拟的主办方支持）；Journal 的 official_url 不是 http(s) 时置为空字符串。
 * - parseBackup 永不抛异常；忽略 `__proto__` / `constructor` / `prototype` 键；超过 2 MB 直接拒绝。
 *
 * 归属：主导（lib/）。
 */
import {
  STORE_KEYS,
  STORE_VALIDATORS,
  clearAll,
  loadGrants,
  loadInvitations,
  loadJournal,
  loadMaterials,
  loadPlanSnapshots,
  loadProfile,
  loadSavedOpportunityIds,
  loadUserPostedOpportunities,
  readJSON,
  saveGrants,
  saveInvitations,
  saveJournal,
  saveProfile,
  saveSavedOpportunityIds,
  storageKey,
  writeJSON,
} from './store';
import type {
  Invitation,
  ISODate,
  JournalEntry,
  Material,
  Opportunity,
  PlanSnapshot,
  ResourceGrant,
  ShareSettings,
  StudentProfile,
} from './types';

/** 备份文件里的应用标识。 */
export const BACKUP_APP_ID = 'opportunity-compass';
/** 当前备份格式版本。读取时接受 1..BACKUP_FORMAT_VERSION，更新的版本拒绝。 */
export const BACKUP_FORMAT_VERSION = 1;
/** 备份文件大小上限（字节）。 */
export const MAX_BACKUP_BYTES = 2 * 1024 * 1024;

/** 备份里的全部数据。键名与 STORE_KEYS 的值一一对应（一个不漏，也不多）。 */
export interface BackupData {
  profile: StudentProfile | null;
  saved_opportunity_ids: string[];
  grants: ResourceGrant[];
  journal: JournalEntry[];
  materials: Material[];
  plan_snapshots: PlanSnapshot[];
  user_posted_opportunities: Opportunity[];
  share_settings: ShareSettings[];
  invitations: Invitation[];
}

export interface BackupFile {
  app: typeof BACKUP_APP_ID;
  format_version: number;
  /** 导出日期（调用方传入）；读取时不是字符串则为 null。 */
  exported_on: ISODate | null;
  data: BackupData;
}

export type ParseBackupResult =
  | { ok: true; backup: BackupFile; warnings: string[] }
  | { ok: false; error: string };

export interface BackupSummary {
  has_profile: boolean;
  profile_is_sample: boolean;
  profile_name: string | null;
  evidence: number;
  saved_opportunities: number;
  grants: number;
  journal_entries: number;
  materials: number;
  plan_snapshots: number;
  user_posted_opportunities: number;
  share_settings: number;
  invitations: number;
}

export type ApplyBackupResult = { ok: true; warnings: string[] } | { ok: false; error: string };

/** 备份数据的键（= STORE_KEYS 的值）。 */
export const BACKUP_DATA_KEYS: readonly (keyof BackupData)[] = [
  'profile',
  'saved_opportunity_ids',
  'grants',
  'journal',
  'materials',
  'plan_snapshots',
  'user_posted_opportunities',
  'share_settings',
  'invitations',
];

// ───────────── 纯函数 ─────────────

function emptyData(): BackupData {
  return {
    profile: null,
    saved_opportunity_ids: [],
    grants: [],
    journal: [],
    materials: [],
    plan_snapshots: [],
    user_posted_opportunities: [],
    share_settings: [],
    invitations: [],
  };
}

function arr<T>(v: T[] | undefined | null): T[] {
  return Array.isArray(v) ? v.slice() : [];
}

/** 组装一个带版本的备份对象（纯函数，只取白名单键）。 */
export function buildBackup(data: Partial<BackupData>, exportedOn: ISODate): BackupFile {
  const d = data ?? {};
  return {
    app: BACKUP_APP_ID,
    format_version: BACKUP_FORMAT_VERSION,
    exported_on: exportedOn,
    data: {
      profile: d.profile ?? null,
      saved_opportunity_ids: arr(d.saved_opportunity_ids),
      grants: arr(d.grants),
      journal: arr(d.journal),
      materials: arr(d.materials),
      plan_snapshots: arr(d.plan_snapshots),
      user_posted_opportunities: arr(d.user_posted_opportunities),
      share_settings: arr(d.share_settings),
      invitations: arr(d.invitations),
    },
  };
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** JSON.parse 的 reviver：丢掉可能造成原型污染的键。 */
function dropUnsafeKeys(key: string, value: unknown): unknown {
  return UNSAFE_KEYS.has(key) ? undefined : value;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function byteLength(text: string): number {
  try {
    return new TextEncoder().encode(text).length;
  } catch {
    return text.length * 3;
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const SECTION_LABELS: Record<keyof BackupData, string> = {
  profile: 'Profile',
  saved_opportunity_ids: 'Saved opportunities',
  grants: 'Organizer grants',
  journal: 'Journal entries',
  materials: 'Materials',
  plan_snapshots: 'Plan history',
  user_posted_opportunities: 'Opportunities posted in this browser',
  share_settings: 'Sharing settings',
  invitations: 'Invitations',
};

/**
 * 把一个列表段落逐条过滤：不是数组 → 整段跳过并 warning；坏条目 / 重复条目丢弃并 warning。
 * keyOf 返回 null 表示不去重。
 */
function filterSection<T>(
  raw: unknown,
  section: keyof BackupData,
  guard: (v: unknown) => v is T,
  warnings: string[],
  options: { keyOf?: (item: T) => string | null; clean?: (item: T) => T; extraReject?: (item: T, kept: T[]) => boolean } = {},
): T[] {
  const label = SECTION_LABELS[section];
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warnings.push(`${label}: this section is not a list and was skipped.`);
    return [];
  }
  const out: T[] = [];
  const seen = new Set<string>();
  let invalid = 0;
  let duplicate = 0;
  for (const item of raw) {
    if (!guard(item)) {
      invalid += 1;
      continue;
    }
    const key = options.keyOf ? options.keyOf(item) : null;
    if ((key !== null && seen.has(key)) || (options.extraReject && options.extraReject(item, out))) {
      duplicate += 1;
      continue;
    }
    if (key !== null) seen.add(key);
    out.push(options.clean ? options.clean(item) : item);
  }
  if (invalid > 0) warnings.push(`${label}: ${plural(invalid, 'invalid item was', 'invalid items were')} skipped.`);
  if (duplicate > 0) warnings.push(`${label}: ${plural(duplicate, 'duplicate item was', 'duplicate items were')} skipped.`);
  return out;
}

/** 导入的 grant 一律 is_sample: true。 */
function forceSampleGrant(g: ResourceGrant): ResourceGrant {
  return { ...g, is_sample: true };
}

/** 只接受 http: / https: 链接（避免 javascript: 等协议进入 href）。 */
function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function sanitizeData(raw: Record<string, unknown>, warnings: string[]): BackupData {
  const V = STORE_VALIDATORS;
  const data = emptyData();

  for (const key of Object.keys(raw)) {
    if (!(BACKUP_DATA_KEYS as readonly string[]).includes(key)) {
      warnings.push(`Ignored an unknown section "${key.slice(0, 40)}".`);
    }
  }

  // 档案
  const p = raw.profile;
  if (p !== undefined && p !== null) {
    if (V.isProfile(p)) {
      const clean = V.sanitizeProfile(p);
      const b = (p as { birth_date?: unknown }).birth_date;
      if (b !== undefined && b !== null && clean.birth_date === null) {
        warnings.push('Profile: the date of birth was not a valid date and was removed.');
      }
      data.profile = clean;
    } else {
      warnings.push('Profile: the profile in this file is not valid and was skipped.');
    }
  }

  data.saved_opportunity_ids = filterSection(raw.saved_opportunity_ids, 'saved_opportunity_ids', isString, warnings, {
    keyOf: (id) => id,
  });
  // 本应用没有真实的主办方发放渠道：导入的 grants 一律标为示例 / 模拟（参照 saveInvitations 对邀请的处理）。
  const grants = filterSection(raw.grants, 'grants', V.isGrant, warnings);
  const unmarked = grants.filter((g) => g.is_sample !== true).length;
  if (unmarked > 0) {
    warnings.push(
      `${plural(unmarked, 'organizer grant was', 'organizer grants were')} marked as Sample: this app only has simulated support.`,
    );
  }
  data.grants = grants.map(forceSampleGrant);
  let badUrls = 0;
  data.journal = filterSection(raw.journal, 'journal', V.isJournalEntryShape, warnings, {
    keyOf: (e) => JSON.stringify([e.profile_id, e.opportunity_id]),
    clean: (e) => {
      const clean = V.sanitizeJournalEntry(e);
      if (clean.official_url !== '' && !isHttpUrl(clean.official_url)) {
        badUrls += 1;
        return { ...clean, official_url: '' };
      }
      return clean;
    },
  });
  if (badUrls > 0) {
    warnings.push(
      `Journal entries: ${plural(badUrls, 'official link was', 'official links were')} not an http(s) link and ${badUrls === 1 ? 'was' : 'were'} removed.`,
    );
  }
  data.materials = filterSection(raw.materials, 'materials', V.isMaterial, warnings, { keyOf: (m) => m.id });
  data.plan_snapshots = filterSection(raw.plan_snapshots, 'plan_snapshots', V.isPlanSnapshot, warnings, {
    keyOf: (s) => s.id,
  });
  data.user_posted_opportunities = filterSection(
    raw.user_posted_opportunities,
    'user_posted_opportunities',
    V.isUserPostedOpportunity,
    warnings,
    { keyOf: (o) => o.id },
  );
  data.share_settings = filterSection(raw.share_settings, 'share_settings', V.isShareSettings, warnings, {
    keyOf: (s) => s.profile_id,
    // 同一个分享句柄不能属于两个档案（与 saveShareSettings 一致）
    extraReject: (s, kept) => kept.some((k) => k.share_handle === s.share_handle),
  });
  data.invitations = filterSection(raw.invitations, 'invitations', V.isInvitation, warnings, { keyOf: (i) => i.id });
  return data;
}

/**
 * 解析并校验一个备份（文件文本，或已解析的对象）。永不抛异常。
 * 失败：不是 JSON、过大、不是本应用的文件、format_version 比当前新或不合法、没有 data 段。
 * 成功：每类数据用 store 的同一套规则逐条过滤，坏条目丢弃并写进 warnings。
 */
export function parseBackup(input: unknown): ParseBackupResult {
  try {
    let text: string;
    if (typeof input === 'string') {
      text = input;
    } else {
      try {
        const s = JSON.stringify(input);
        if (typeof s !== 'string') return { ok: false, error: 'This is not an Opportunity Compass backup.' };
        text = s;
      } catch {
        return { ok: false, error: 'This is not an Opportunity Compass backup.' };
      }
    }
    if (text.length > MAX_BACKUP_BYTES || byteLength(text) > MAX_BACKUP_BYTES) {
      return { ok: false, error: 'This file is larger than 2 MB, so it is not an Opportunity Compass backup.' };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text, dropUnsafeKeys);
    } catch {
      // 真正的非 JSON 与超深嵌套（引擎栈溢出）都走这里，用同一句笼统且准确的提示
      return { ok: false, error: 'This file could not be read as a backup.' };
    }

    if (!isPlainRecord(parsed) || parsed.app !== BACKUP_APP_ID) {
      return { ok: false, error: 'This file is not an Opportunity Compass backup.' };
    }
    const version = parsed.format_version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return { ok: false, error: 'This backup has an unknown format version and cannot be read.' };
    }
    if (version > BACKUP_FORMAT_VERSION) {
      return {
        ok: false,
        error: `This backup was made by a newer version of Opportunity Compass (format ${version}). This version can only read format ${BACKUP_FORMAT_VERSION}.`,
      };
    }
    if (!isPlainRecord(parsed.data)) {
      return { ok: false, error: 'This backup has no data section.' };
    }

    const warnings: string[] = [];
    const data = sanitizeData(parsed.data, warnings);
    const exportedOn = typeof parsed.exported_on === 'string' ? parsed.exported_on : null;
    return {
      ok: true,
      backup: { app: BACKUP_APP_ID, format_version: BACKUP_FORMAT_VERSION, exported_on: exportedOn, data },
      warnings,
    };
  } catch {
    return { ok: false, error: 'This file could not be read as an Opportunity Compass backup.' };
  }
}

/** 各类数据的条数（纯函数），供导入前给用户确认、或显示当前浏览器里存了什么。 */
export function summarizeBackup(backup: Pick<BackupFile, 'data'>): BackupSummary {
  const d = backup?.data ?? emptyData();
  const profile = d.profile ?? null;
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  return {
    has_profile: profile !== null,
    profile_is_sample: profile?.is_sample === true,
    profile_name: profile && typeof profile.display_name === 'string' ? profile.display_name : null,
    evidence: profile ? len(profile.evidence) : 0,
    saved_opportunities: len(d.saved_opportunity_ids),
    grants: len(d.grants),
    journal_entries: len(d.journal),
    materials: len(d.materials),
    plan_snapshots: len(d.plan_snapshots),
    user_posted_opportunities: len(d.user_posted_opportunities),
    share_settings: len(d.share_settings),
    invitations: len(d.invitations),
  };
}

/** 备份文件名：`opportunity-compass-backup-YYYY-MM-DD.json`。 */
export function backupFileName(on: ISODate): string {
  return `opportunity-compass-backup-${on}.json`;
}

// ───────────── 存储胶水（只在浏览器里调用）─────────────

/** 读取本应用存的全部数据（用 store 现有的 load 函数，所有档案）。 */
export function collectBackupData(): BackupData {
  return {
    profile: loadProfile(),
    saved_opportunity_ids: loadSavedOpportunityIds(),
    grants: loadGrants(),
    journal: loadJournal(),
    materials: loadMaterials(),
    plan_snapshots: loadPlanSnapshots(),
    user_posted_opportunities: loadUserPostedOpportunities(),
    share_settings: readJSON<unknown[]>(STORE_KEYS.shareSettings, [], (v): v is unknown[] => Array.isArray(v)).filter(
      STORE_VALIDATORS.isShareSettings,
    ),
    invitations: loadInvitations(),
  };
}

function getStorage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 用备份**整体替换**本应用存的全部数据（先清再写，不合并）。
 * 写之前再用 parseBackup 校验一遍。任何一项写入失败（如配额满）时，恢复导入前的原始内容并返回失败。
 */
export function applyBackup(backup: BackupFile): ApplyBackupResult {
  const storage = getStorage();
  if (!storage) return { ok: false, error: 'This browser does not allow saving data, so nothing was imported.' };

  const checked = parseBackup(backup);
  if (!checked.ok) return checked;
  const d = checked.backup.data;

  const keys = Object.values(STORE_KEYS);
  const before = new Map<string, string | null>();
  try {
    for (const k of keys) before.set(k, storage.getItem(storageKey(k)));
  } catch {
    return { ok: false, error: 'Could not read the data currently stored in this browser, so nothing was imported.' };
  }

  clearAll();
  const writes: boolean[] = [];
  if (d.profile) writes.push(saveProfile(d.profile));
  if (d.saved_opportunity_ids.length) writes.push(saveSavedOpportunityIds(d.saved_opportunity_ids));
  if (d.grants.length) writes.push(saveGrants(d.grants.map(forceSampleGrant)));
  if (d.journal.length) writes.push(saveJournal(d.journal));
  if (d.materials.length) writes.push(writeJSON(STORE_KEYS.materials, d.materials));
  if (d.plan_snapshots.length) writes.push(writeJSON(STORE_KEYS.planSnapshots, d.plan_snapshots));
  if (d.user_posted_opportunities.length) {
    writes.push(writeJSON(STORE_KEYS.userPostedOpportunities, d.user_posted_opportunities));
  }
  if (d.share_settings.length) writes.push(writeJSON(STORE_KEYS.shareSettings, d.share_settings));
  if (d.invitations.length) writes.push(saveInvitations(d.invitations));

  if (writes.every(Boolean)) return { ok: true, warnings: checked.warnings };

  // 写入失败：恢复导入前的原始内容
  clearAll();
  let restored = true;
  for (const [k, raw] of before) {
    if (raw === null) continue;
    try {
      storage.setItem(storageKey(k as (typeof keys)[number]), raw);
    } catch {
      restored = false;
    }
  }
  return {
    ok: false,
    error: restored
      ? 'This browser could not save the imported data (storage may be full). Your previous data was kept.'
      : 'This browser could not save the imported data (storage may be full), and some previous data could not be restored.',
  };
}
