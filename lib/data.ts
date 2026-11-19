/**
 * 数据加载层：页面通过这里读取 `data/opportunities.json` 与 `data/profiles.json`，加载时按共享类型校验。
 *
 * - 逐条用 `lib/validation.ts` 检查；**通过的才返回**，不通过的进 `rejected`（不抛异常），页面不会拿到坏记录。
 * - 只拒绝结构性错误（缺必需字段、类型错、日期格式非法、违反底线如没有 `official_url`）。
 *   官网没写的信息写 `null`（unknown）是合法的，不会因此被拒绝。
 * - 不读时钟：截止日期已过不是数据错误，不拒绝。
 * - id 重复：保留第一条通过校验的记录，后面同 id 的进 `rejected`。
 * - 示例档案必须 `is_sample: true`，否则拒绝。
 * - 纯同步、无 IO（JSON 由打包器内联）；结果在模块内缓存，对外每次返回数组的浅拷贝，调用方修改不影响下一次调用。
 * - 开发环境下有被拒绝的记录时 `console.warn` 一次；生产环境不输出。
 *
 * 核心逻辑是纯函数 `partitionOpportunities(raw)` / `partitionProfiles(raw)`，可注入任意数据测试。
 */
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import type { Opportunity, StudentProfile } from './types';
import { opportunityWarnings, validateOpportunity, validateProfile } from './validation';

/** 被拒绝的一条记录。`index` 是在原数组中的位置（0 起）；整个文件不是数组时为 -1。 */
export type RejectedRecord = { id: string | null; index: number; errors: string[] };

export type OpportunityWarning = { id: string; warnings: string[] };

export type CatalogResult = {
  opportunities: Opportunity[];
  rejected: RejectedRecord[];
  warnings: OpportunityWarning[];
};

export type SampleProfilesResult = {
  profiles: StudentProfile[];
  rejected: RejectedRecord[];
};

function idOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === 'string' && id.trim() !== '' ? id : null;
}

function notArray(label: string, raw: unknown): RejectedRecord[] {
  let shown: string;
  try {
    shown = raw === undefined ? 'undefined' : JSON.stringify(raw)?.slice(0, 40) ?? String(raw);
  } catch {
    shown = String(raw);
  }
  return [{ id: null, index: -1, errors: [`${label}: expected an array, got ${shown}`] }];
}

/** 纯函数：把任意输入分成通过校验的机会、被拒绝的记录和提醒。永不抛异常。 */
export function partitionOpportunities(raw: unknown): CatalogResult {
  if (!Array.isArray(raw)) return { opportunities: [], rejected: notArray('Opportunity list', raw), warnings: [] };
  const opportunities: Opportunity[] = [];
  const rejected: RejectedRecord[] = [];
  const warnings: OpportunityWarning[] = [];
  const accepted = new Map<string, number>();
  raw.forEach((entry: unknown, index) => {
    const id = idOf(entry);
    let errors: string[];
    try {
      errors = validateOpportunity(entry);
    } catch (e) {
      errors = [`Opportunity #${index + 1}: validation failed unexpectedly (${String(e)})`];
    }
    if (errors.length === 0 && id !== null && accepted.has(id)) {
      errors = [
        `Opportunity "${id}" field id: duplicate id (#${accepted.get(id)! + 1} and #${index + 1} are the same; the first one is kept)`,
      ];
    }
    if (errors.length > 0 || id === null) {
      rejected.push({ id, index, errors: errors.length > 0 ? errors : [`Opportunity #${index + 1}: missing id`] });
      return;
    }
    accepted.set(id, index);
    opportunities.push(entry as Opportunity);
    let w: string[] = [];
    try {
      w = opportunityWarnings(entry);
    } catch {
      w = [];
    }
    if (w.length > 0) warnings.push({ id, warnings: w });
  });
  return { opportunities, rejected, warnings };
}

/** 纯函数：把任意输入分成通过校验的示例档案和被拒绝的记录。示例档案必须 `is_sample: true`。永不抛异常。 */
export function partitionProfiles(raw: unknown): SampleProfilesResult {
  if (!Array.isArray(raw)) return { profiles: [], rejected: notArray('Sample profile list', raw) };
  const profiles: StudentProfile[] = [];
  const rejected: RejectedRecord[] = [];
  const accepted = new Map<string, number>();
  raw.forEach((entry: unknown, index) => {
    const id = idOf(entry);
    let errors: string[];
    try {
      errors = validateProfile(entry);
    } catch (e) {
      errors = [`Profile #${index + 1}: validation failed unexpectedly (${String(e)})`];
    }
    const subject = id ? `Profile "${id}"` : `Profile #${index + 1} (missing id)`;
    if (
      typeof entry === 'object' &&
      entry !== null &&
      !Array.isArray(entry) &&
      (entry as Record<string, unknown>).is_sample !== true
    ) {
      errors = [...errors, `${subject} field is_sample: sample profiles in data/profiles.json must be marked is_sample: true`];
    }
    if (errors.length === 0 && id !== null && accepted.has(id)) {
      errors = [`${subject} field id: duplicate id (#${accepted.get(id)! + 1} and #${index + 1} are the same; the first one is kept)`];
    }
    if (errors.length > 0 || id === null) {
      rejected.push({ id, index, errors: errors.length > 0 ? errors : [`${subject}: missing id`] });
      return;
    }
    accepted.set(id, index);
    profiles.push(entry as StudentProfile);
  });
  return { profiles, rejected };
}

// ───────────────────────────── 缓存与对外函数 ─────────────────────────────

function isDev(): boolean {
  return typeof process === 'undefined' || process.env?.NODE_ENV !== 'production';
}

function warnRejected(file: string, rejected: readonly RejectedRecord[]): void {
  if (rejected.length === 0 || !isDev()) return;
  const lines = rejected.flatMap((r) => r.errors.map((e) => `  - ${e}`));
  console.warn(`${file}: ${rejected.length} record(s) failed validation and are hidden from the pages:\n${lines.join('\n')}`);
}

let catalogCache: Readonly<CatalogResult> | null = null;
let catalogIndex: Map<string, Opportunity> | null = null;
let profilesCache: Readonly<SampleProfilesResult> | null = null;

function catalog(): Readonly<CatalogResult> {
  if (catalogCache === null) {
    const result = partitionOpportunities(opportunitiesJson as unknown);
    catalogCache = Object.freeze({
      opportunities: Object.freeze(result.opportunities) as Opportunity[],
      rejected: Object.freeze(result.rejected) as RejectedRecord[],
      warnings: Object.freeze(result.warnings) as OpportunityWarning[],
    });
    catalogIndex = new Map(result.opportunities.map((o) => [o.id, o]));
    warnRejected('data/opportunities.json', result.rejected);
  }
  return catalogCache;
}

function samples(): Readonly<SampleProfilesResult> {
  if (profilesCache === null) {
    const result = partitionProfiles(profilesJson as unknown);
    profilesCache = Object.freeze({
      profiles: Object.freeze(result.profiles) as StudentProfile[],
      rejected: Object.freeze(result.rejected) as RejectedRecord[],
    });
    warnRejected('data/profiles.json', result.rejected);
  }
  return profilesCache;
}

/** 读取并校验 `data/opportunities.json`。每次返回新的数组（浅拷贝），记录对象是共享的，请勿修改。 */
export function loadCatalog(): CatalogResult {
  const c = catalog();
  return { opportunities: [...c.opportunities], rejected: [...c.rejected], warnings: [...c.warnings] };
}

/** 读取并校验 `data/profiles.json`（必须全部 `is_sample: true`）。每次返回新的数组（浅拷贝）。 */
export function loadSampleProfiles(): SampleProfilesResult {
  const s = samples();
  return { profiles: [...s.profiles], rejected: [...s.rejected] };
}

/** 通过校验的仓库机会（浅拷贝）。 */
export function catalogOpportunities(): Opportunity[] {
  return [...catalog().opportunities];
}

/** 按 id 找通过校验的仓库机会；找不到或被拒绝时返回 null。 */
export function findCatalogOpportunity(id: string | null | undefined): Opportunity | null {
  if (typeof id !== 'string') return null;
  catalog();
  return catalogIndex?.get(id) ?? null;
}

/** 通过校验的示例档案（浅拷贝）。 */
export function sampleProfiles(): StudentProfile[] {
  return [...samples().profiles];
}
