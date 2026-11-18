/**
 * 数据校验（纯函数）：检查 `data/*.json` 里的机会与学生档案是否符合 `lib/types.ts` 的约定。
 *
 * JSON 导入时只做了类型断言，写错的字段（不存在的 category、拼错的 requirement type、缺 source_text……）
 * 编译器发现不了。这里逐字段检查，返回中文问题列表：
 *
 * - `validateOpportunity(value)`：单条机会。
 * - `validateOpportunities(value)`：机会数组（逐条检查 + 跨条目检查：id 全局唯一）。
 * - `validateProfile(value)`：单个学生档案。
 * - `opportunityWarnings(opp)`：不算错误的提醒（不影响合格与否），例如字段为 null 会让可达性返回「无法判断」。
 *
 * 约定：
 * - 返回空数组 = 合格。每条问题写清「哪条机会 / 档案、哪个字段、期望什么、实际是什么」。
 * - 永不抛异常（输入可以是任何 JSON 值）。
 * - 「可能没填」的字段（optional / `| null`）缺省或为 null 都合法，只在给出值时检查取值。
 * - 纯函数：不读系统时钟、无 IO、不调 AI。
 */
import type {
  DeviceType,
  EvidenceKind,
  EvidenceStatus,
  OpportunityCategory,
  OpportunityFormat,
  RequirementType,
  SkillLevel,
  StudentStatus,
} from './types';
import { compareYMD, parseISODate } from './eligibility/dates';

// ───────────────────────────── 枚举（与 lib/types.ts 保持一致） ─────────────────────────────

/**
 * `satisfies` 保证这些数组只含合法取值；文件末尾的 `_enumsComplete` 在编译期保证没有漏掉类型里的取值
 * （lib/types.ts 新增取值而这里没跟上时 `npx tsc` / `npm run build` 会报错）。
 */
export const OPPORTUNITY_CATEGORIES = [
  'research',
  'scholarship',
  'hackathon',
  'competition',
  'internship',
  'fellowship',
  'summer_program',
  'public_service',
  'project',
  'other',
] as const satisfies readonly OpportunityCategory[];

export const OPPORTUNITY_FORMATS = ['online', 'in_person', 'hybrid'] as const satisfies readonly OpportunityFormat[];

export const DEVICE_TYPES = [
  'laptop',
  'desktop',
  'smartphone',
  'tablet',
  'webcam',
  'home_internet',
] as const satisfies readonly DeviceType[];

export const REQUIREMENT_TYPES = [
  'grade',
  'age',
  'region',
  'citizenship',
  'status',
  'prerequisite_skill',
  'portfolio',
  'manual',
] as const satisfies readonly RequirementType[];

export const STUDENT_STATUSES = [
  'middle_school_student',
  'high_school_student',
  'undergraduate',
  'graduate_student',
  'not_enrolled',
  'first_generation',
  'low_income',
  'underrepresented_in_stem',
] as const satisfies readonly StudentStatus[];

export const EVIDENCE_KINDS = [
  'project',
  'portfolio',
  'certificate',
  'competition_result',
  'work_experience',
  'volunteer_experience',
  'course',
  'recommendation_letter',
  'other',
] as const satisfies readonly EvidenceKind[];

export const EVIDENCE_STATUSES = [
  'self_reported',
  'evidence_attached',
  'reviewed',
  'unverified',
] as const satisfies readonly EvidenceStatus[];

export const SKILL_LEVELS = ['beginner', 'intermediate', 'advanced'] as const satisfies readonly SkillLevel[];

export const LOCALITIES = ['urban', 'suburban', 'rural'] as const;
export const TRANSPORT_LEVELS = ['reliable', 'limited', 'none'] as const;

/** 年级取值范围（见 lib/types.ts GradeLevel：1–12 K-12，13–16 本科，17 研究生及以上）。 */
const GRADE_MIN = 1;
const GRADE_MAX = 17;

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

// ───────────────────────────── 小工具 ─────────────────────────────

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isNonEmptyStr(v: unknown): v is string {
  return typeof v === 'string' && v.trim() !== '';
}

function isNonNegFinite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/** 严格的 `YYYY-MM-DD`：日期真实存在，前后不得有空格。 */
export function isStrictISODate(v: unknown): v is string {
  return typeof v === 'string' && v === v.trim() && parseISODate(v) !== null;
}

function isHttpUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v !== v.trim()) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

function includes<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

/** 把实际值缩成一小段，放进问题说明里。 */
function show(v: unknown): string {
  if (v === undefined) return '未填';
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : `"${v}"`;
  try {
    const s = JSON.stringify(v);
    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
  } catch {
    return String(v);
  }
}

function oneOf(list: readonly string[]): string {
  return `取值之一：${list.join(' / ')}`;
}

/** 收集问题：每条 = `${subject}字段 ${path}：期望 ${expected}，实际 ${actual}`。 */
class Reporter {
  readonly problems: string[] = [];
  constructor(private readonly subject: string) {}

  add(path: string, expected: string, actual?: unknown, hasActual = true): void {
    const tail = hasActual ? `，实际 ${show(actual)}` : '';
    this.problems.push(`${this.subject}字段 ${path}：期望 ${expected}${tail}`);
  }

  /** 不带「实际值」的问题（如重复、成环）。 */
  note(path: string, text: string): void {
    this.problems.push(`${this.subject}字段 ${path}：${text}`);
  }

  // —— 常用检查 ——
  nonEmptyStr(o: Obj, key: string, path = key): void {
    if (!isNonEmptyStr(o[key])) this.add(path, '非空字符串', o[key]);
  }

  /** 可缺省 / null；给出时必须是字符串。 */
  optStr(o: Obj, key: string, path = key): void {
    const v = o[key];
    if (v != null && typeof v !== 'string') this.add(path, '字符串或 null（可不填）', v);
  }

  optBool(o: Obj, key: string, path = key): void {
    const v = o[key];
    if (v != null && typeof v !== 'boolean') this.add(path, 'true / false 或 null（可不填）', v);
  }

  /** 可缺省 / null；给出时必须是非负有限数。 */
  optNonNeg(o: Obj, key: string, path = key): void {
    const v = o[key];
    if (v != null && !isNonNegFinite(v)) this.add(path, '非负有限数或 null（可不填）', v);
  }

  /** 必须有这个键，值为非负有限数或 null。 */
  reqNonNegOrNull(o: Obj, key: string, path = key): void {
    const v = o[key];
    if (v === undefined) this.add(path, '必填：非负有限数，官网没写清时填 null', v);
    else if (v !== null && !isNonNegFinite(v)) this.add(path, '非负有限数或 null', v);
  }

  optDate(o: Obj, key: string, path = key): void {
    const v = o[key];
    if (v != null && !isStrictISODate(v)) this.add(path, '合法日期 YYYY-MM-DD 或 null（可不填）', v);
  }

  stringArray(o: Obj, key: string, path = key, nonEmptyItems = true): void {
    const v = o[key];
    if (!Array.isArray(v)) {
      this.add(path, '字符串数组', v);
      return;
    }
    v.forEach((item, i) => {
      if (nonEmptyItems ? !isNonEmptyStr(item) : typeof item !== 'string') {
        this.add(`${path}[${i}]`, '非空字符串', item);
      }
    });
  }

  countryArray(o: Obj, key: string, path = key, required: boolean): void {
    const v = o[key];
    if (v == null && !required) return;
    if (!Array.isArray(v) || (required && v.length === 0)) {
      this.add(path, required ? '非空数组，元素为两位大写国家代码（如 "US"）' : '国家代码数组或 null（可不填）', v);
      return;
    }
    v.forEach((c, i) => {
      if (typeof c !== 'string' || !COUNTRY_RE.test(c)) this.add(`${path}[${i}]`, '两位大写国家代码（如 "US"）', c);
    });
  }

  enumArray(o: Obj, key: string, list: readonly string[], path = key, nullable = false): void {
    const v = o[key];
    if (v == null && nullable) return;
    if (!Array.isArray(v)) {
      this.add(path, nullable ? '数组或 null（可不填）' : '数组', v);
      return;
    }
    v.forEach((item, i) => {
      if (!includes(list, item)) this.add(`${path}[${i}]`, oneOf(list), item);
    });
  }
}

// ───────────────────────────── 机会 ─────────────────────────────

function opportunitySubject(value: unknown, index?: number): string {
  const id = isObj(value) && isNonEmptyStr(value.id) ? value.id : null;
  if (id) return `机会「${id}」`;
  return index === undefined ? '机会（id 缺失）' : `第 ${index + 1} 条机会（id 缺失）`;
}

function validateRequirementRule(r: Reporter, req: Obj, path: string): void {
  switch (req.type) {
    case 'grade': {
      for (const k of ['min', 'max'] as const) {
        const v = req[k];
        if (v != null && !(Number.isInteger(v) && (v as number) >= GRADE_MIN && (v as number) <= GRADE_MAX)) {
          r.add(`${path}.${k}`, `${GRADE_MIN}–${GRADE_MAX} 的整数年级或不填`, v);
        }
      }
      if (typeof req.min === 'number' && typeof req.max === 'number' && req.min > req.max) {
        r.add(`${path}.min / max`, 'min ≤ max', `${req.min} > ${req.max}`);
      }
      break;
    }
    case 'age': {
      r.optNonNeg(req, 'min', `${path}.min`);
      r.optNonNeg(req, 'max', `${path}.max`);
      if (typeof req.min === 'number' && typeof req.max === 'number' && req.min > req.max) {
        r.add(`${path}.min / max`, 'min ≤ max', `${req.min} > ${req.max}`);
      }
      r.optDate(req, 'as_of', `${path}.as_of`);
      break;
    }
    case 'region': {
      r.countryArray(req, 'countries', `${path}.countries`, true);
      const states = req.states;
      if (states != null) {
        if (!Array.isArray(states)) r.add(`${path}.states`, '字符串数组或不填', states);
        else
          states.forEach((s, i) => {
            if (!isNonEmptyStr(s)) r.add(`${path}.states[${i}]`, '非空字符串（州 / 省代码）', s);
          });
      }
      break;
    }
    case 'citizenship':
      r.countryArray(req, 'countries', `${path}.countries`, true);
      break;
    case 'status': {
      const anyOf = req.any_of;
      if (!Array.isArray(anyOf) || anyOf.length === 0) {
        r.add(`${path}.any_of`, `非空数组，${oneOf(STUDENT_STATUSES)}`, anyOf);
      } else {
        r.enumArray(req, 'any_of', STUDENT_STATUSES, `${path}.any_of`);
      }
      break;
    }
    case 'prerequisite_skill': {
      r.nonEmptyStr(req, 'skill', `${path}.skill`);
      const lv = req.min_level;
      if (lv != null && !includes(SKILL_LEVELS, lv)) r.add(`${path}.min_level`, `${oneOf(SKILL_LEVELS)}（或不填）`, lv);
      break;
    }
    case 'portfolio': {
      const kind = req.evidence_kind;
      if (kind != null && !includes(EVIDENCE_KINDS, kind)) {
        r.add(`${path}.evidence_kind`, `${oneOf(EVIDENCE_KINDS)}（或不填）`, kind);
      }
      if (req.skill != null && !isNonEmptyStr(req.skill)) r.add(`${path}.skill`, '非空字符串或不填', req.skill);
      break;
    }
    case 'manual':
    default:
      break;
  }
}

function validateRequirements(r: Reporter, value: unknown): void {
  if (!Array.isArray(value)) {
    r.add('requirements', '数组（没有官方要求时填 []）', value);
    return;
  }
  const seen = new Set<string>();
  value.forEach((req, i) => {
    const label = isObj(req) && isNonEmptyStr(req.id) ? req.id : String(i);
    const path = `requirements[${label}]`;
    if (!isObj(req)) {
      r.add(path, '对象', req);
      return;
    }
    if (!isNonEmptyStr(req.id)) r.add(`${path}.id`, '非空字符串（机会内唯一）', req.id);
    else if (seen.has(req.id)) r.note(`${path}.id`, `id 重复（机会内必须唯一）："${req.id}"`);
    else seen.add(req.id);
    r.nonEmptyStr(req, 'label', `${path}.label`);
    if (typeof req.hard !== 'boolean') r.add(`${path}.hard`, 'true（硬性）/ false（偏好）', req.hard);
    if (!isNonEmptyStr(req.source_text)) r.add(`${path}.source_text`, '非空的官网原文（逐字摘录）', req.source_text);
    if (!includes(REQUIREMENT_TYPES, req.type)) {
      r.add(`${path}.type`, oneOf(REQUIREMENT_TYPES), req.type);
      return;
    }
    validateRequirementRule(r, req, path);
  });
}

function validatePreparation(r: Reporter, value: unknown): void {
  if (!Array.isArray(value)) {
    r.add('preparation', '数组（没有准备项时填 []）', value);
    return;
  }
  const ids = new Set<string>();
  const duplicates = new Set<string>();
  for (const p of value) {
    if (isObj(p) && isNonEmptyStr(p.id)) {
      if (ids.has(p.id)) duplicates.add(p.id);
      ids.add(p.id);
    }
  }
  const graph = new Map<string, string[]>();
  const reported = new Set<string>();

  value.forEach((p, i) => {
    const label = isObj(p) && isNonEmptyStr(p.id) ? p.id : String(i);
    const path = `preparation[${label}]`;
    if (!isObj(p)) {
      r.add(path, '对象', p);
      return;
    }
    if (!isNonEmptyStr(p.id)) r.add(`${path}.id`, '非空字符串（机会内唯一）', p.id);
    else if (duplicates.has(p.id) && !reported.has(p.id)) {
      reported.add(p.id);
      r.note(`${path}.id`, `id 重复（机会内必须唯一）："${p.id}"`);
    }
    r.nonEmptyStr(p, 'title', `${path}.title`);
    if (p.skill != null && !isNonEmptyStr(p.skill)) r.add(`${path}.skill`, '非空字符串（技能 slug）或 null', p.skill);
    if (p.evidence_kind != null && !includes(EVIDENCE_KINDS, p.evidence_kind)) {
      r.add(`${path}.evidence_kind`, `${oneOf(EVIDENCE_KINDS)}（或 null）`, p.evidence_kind);
    }
    if (!isNonNegFinite(p.estimated_hours)) r.add(`${path}.estimated_hours`, '非负有限数', p.estimated_hours);
    if (!isNonNegFinite(p.estimated_cost_usd)) r.add(`${path}.estimated_cost_usd`, '非负有限数', p.estimated_cost_usd);
    if (typeof p.required_for_application !== 'boolean') {
      r.add(`${path}.required_for_application`, 'true / false', p.required_for_application);
    }
    r.optStr(p, 'source_text', `${path}.source_text`);

    const deps = p.depends_on;
    if (!Array.isArray(deps)) {
      r.add(`${path}.depends_on`, '准备项 id 数组（没有依赖时填 []）', deps);
      return;
    }
    const valid: string[] = [];
    deps.forEach((d, j) => {
      if (!isNonEmptyStr(d)) r.add(`${path}.depends_on[${j}]`, '准备项 id 字符串', d);
      else if (d === p.id) r.note(`${path}.depends_on`, `不能依赖自己（"${d}"）`);
      else if (!ids.has(d)) r.note(`${path}.depends_on`, `引用了不存在的准备项 "${d}"`);
      else valid.push(d);
    });
    if (isNonEmptyStr(p.id) && !graph.has(p.id)) graph.set(p.id, valid);
  });

  // 环检测（三色 DFS），每个环报一次。
  const color = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const visit = (id: string): void => {
    color.set(id, 1);
    stack.push(id);
    for (const d of graph.get(id) ?? []) {
      const c = color.get(d) ?? 0;
      if (c === 0) visit(d);
      else if (c === 1) cycles.push([...stack.slice(stack.indexOf(d)), d]);
    }
    stack.pop();
    color.set(id, 2);
  };
  for (const id of graph.keys()) if ((color.get(id) ?? 0) === 0) visit(id);
  for (const cyc of cycles) r.note('preparation.depends_on', `依赖成环：${cyc.join(' → ')}`);
}

function validateOpportunityInto(r: Reporter, value: unknown): void {
  if (!isObj(value)) {
    r.add('（整条）', '对象', value);
    return;
  }
  const o = value;
  if (!isNonEmptyStr(o.id)) r.add('id', '非空字符串（kebab-case，全局唯一）', o.id);
  else if (!KEBAB_RE.test(o.id)) r.add('id', 'kebab-case（小写字母、数字，用连字符连接，如 nasa-sees-2027）', o.id);
  r.nonEmptyStr(o, 'title');
  r.nonEmptyStr(o, 'organizer');
  if (!includes(OPPORTUNITY_CATEGORIES, o.category)) r.add('category', oneOf(OPPORTUNITY_CATEGORIES), o.category);
  r.stringArray(o, 'fields');
  if (typeof o.summary !== 'string') r.add('summary', '字符串', o.summary);
  if (!isHttpUrl(o.official_url)) r.add('official_url', 'http(s) 开头的主办方官网链接', o.official_url);
  if (!isStrictISODate(o.verified_on)) r.add('verified_on', '合法日期 YYYY-MM-DD', o.verified_on);
  if (!isNonEmptyStr(o.verified_by)) r.add('verified_by', '非空字符串（核实人）', o.verified_by);
  if (o.deadline === undefined) r.add('deadline', '必填：合法日期 YYYY-MM-DD，滚动录取 / 未写清时填 null', o.deadline);
  else if (o.deadline !== null && !isStrictISODate(o.deadline)) r.add('deadline', '合法日期 YYYY-MM-DD 或 null', o.deadline);
  r.optStr(o, 'deadline_note');
  r.optBool(o, 'recurring_annually');
  if (o.is_sample !== undefined && typeof o.is_sample !== 'boolean') r.add('is_sample', 'true / false 或不填', o.is_sample);

  // location
  const loc = o.location;
  if (!isObj(loc)) r.add('location', '对象（至少含 format）', loc);
  else {
    if (!includes(OPPORTUNITY_FORMATS, loc.format)) r.add('location.format', oneOf(OPPORTUNITY_FORMATS), loc.format);
    if (loc.country != null && !(typeof loc.country === 'string' && COUNTRY_RE.test(loc.country))) {
      r.add('location.country', '两位大写国家代码（如 "US"）或 null', loc.country);
    }
    for (const k of ['state', 'city', 'note']) r.optStr(loc, k, `location.${k}`);
  }

  // cost
  const cost = o.cost;
  if (!isObj(cost)) r.add('cost', '对象（含 fee_usd、requires_travel_expense）', cost);
  else {
    r.reqNonNegOrNull(cost, 'fee_usd', 'cost.fee_usd');
    const t = cost.requires_travel_expense;
    if (t === undefined) r.add('cost.requires_travel_expense', '必填：true / false，不清楚时填 null', t);
    else if (t !== null && typeof t !== 'boolean') r.add('cost.requires_travel_expense', 'true / false 或 null', t);
    r.optBool(cost, 'financial_aid_available', 'cost.financial_aid_available');
    r.optStr(cost, 'note', 'cost.note');
  }

  // time_commitment
  const tc = o.time_commitment;
  if (!isObj(tc)) r.add('time_commitment', '对象（含 hours_per_week、total_weeks）', tc);
  else {
    r.reqNonNegOrNull(tc, 'hours_per_week', 'time_commitment.hours_per_week');
    r.reqNonNegOrNull(tc, 'total_weeks', 'time_commitment.total_weeks');
    r.optDate(tc, 'start_date', 'time_commitment.start_date');
    r.optDate(tc, 'end_date', 'time_commitment.end_date');
    r.optStr(tc, 'note', 'time_commitment.note');
  }

  r.enumArray(o, 'required_devices', DEVICE_TYPES);
  validateRequirements(r, o.requirements);
  validatePreparation(r, o.preparation);
}

/** 校验单条机会。返回中文问题列表，空数组 = 合格。不抛异常。 */
export function validateOpportunity(value: unknown): string[] {
  const r = new Reporter(opportunitySubject(value));
  validateOpportunityInto(r, value);
  return r.problems;
}

/** 校验机会数组：逐条检查 + 跨条目检查（id 全局唯一）。不抛异常。 */
export function validateOpportunities(value: unknown): string[] {
  if (!Array.isArray(value)) return [`机会列表：期望数组，实际 ${show(value)}`];
  const problems: string[] = [];
  const firstIndex = new Map<string, number>();
  value.forEach((opp, i) => {
    const r = new Reporter(opportunitySubject(opp, i));
    validateOpportunityInto(r, opp);
    problems.push(...r.problems);
    if (isObj(opp) && isNonEmptyStr(opp.id)) {
      const prev = firstIndex.get(opp.id);
      if (prev !== undefined) {
        problems.push(`机会「${opp.id}」字段 id：id 重复（第 ${prev + 1} 条与第 ${i + 1} 条相同，全局必须唯一）`);
      } else firstIndex.set(opp.id, i);
    }
  });
  return problems;
}

// ───────────────────────────── 提醒（不算错误） ─────────────────────────────

const PLACEHOLDER_HOSTS = ['example.com', 'example.org', 'example.net'];

function isPlaceholderHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return PLACEHOLDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/**
 * 不算错误的提醒（不影响合格与否），提示数据录入者补全或复查。
 * 入参按 unknown 处理，字段缺失或类型不对时跳过对应提醒（错误由 validateOpportunity 报）。
 */
export function opportunityWarnings(opp: unknown): string[] {
  if (!isObj(opp)) return [];
  const subject = opportunitySubject(opp);
  const out: string[] = [];
  const warn = (path: string, text: string) => out.push(`${subject}字段 ${path}：${text}`);

  if (Array.isArray(opp.fields)) {
    if (opp.fields.length === 0) warn('fields', '为空，「同领域替代」提示将无法给出。');
    for (const f of opp.fields) {
      if (typeof f === 'string' && f.includes('-')) {
        warn('fields', `"${f}" 含连字符，约定用下划线（如 ${f.replace(/-/g, '_')}），否则与学生 interests 对不上。`);
      }
    }
  }
  if (opp.recurring_annually == null) {
    warn('recurring_annually', '没填，硬性不满足时「下一届」提示只能写「请向官方确认是否每年举办」。');
  }

  const loc = isObj(opp.location) ? opp.location : null;
  const cost = isObj(opp.cost) ? opp.cost : null;
  if (cost && cost.fee_usd === null) warn('cost.fee_usd', '为 null，可达性的费用判断会是「无法判断」。');
  if (cost && cost.requires_travel_expense === null && loc && loc.format !== 'online') {
    warn('cost.requires_travel_expense', '为 null（线下 / 混合机会），交通与差旅只能按学生交通条件判断，信息不全。');
  }
  const tc = isObj(opp.time_commitment) ? opp.time_commitment : null;
  if (tc && tc.hours_per_week === null) {
    warn('time_commitment.hours_per_week', '为 null，可达性的「参与期每周时间」判断会是「无法判断」。');
  }
  if (tc && isStrictISODate(tc.start_date) && isStrictISODate(tc.end_date)) {
    if (compareYMD(parseISODate(tc.start_date)!, parseISODate(tc.end_date)!) > 0) {
      warn('time_commitment.start_date / end_date', `开始日期 ${tc.start_date} 晚于结束日期 ${tc.end_date}，请复查。`);
    }
  }
  if (Array.isArray(opp.preparation) && opp.preparation.length === 0) {
    warn('preparation', '为空，路线里只有固定步骤（如「提交申请」），没有可按证据跳过的准备项。');
  }
  if (opp.is_sample !== true && typeof opp.official_url === 'string' && isPlaceholderHost(opp.official_url)) {
    warn('official_url', `真实机会（is_sample 不为 true）的链接指向占位域名：${opp.official_url}`);
  }
  if (isStrictISODate(opp.verified_on) && isStrictISODate(opp.deadline)) {
    if (compareYMD(parseISODate(opp.verified_on)!, parseISODate(opp.deadline)!) > 0) {
      warn('verified_on', `核实日期 ${opp.verified_on} 晚于截止日期 ${opp.deadline}：核实时已经截止，请确认是否换成下一届。`);
    }
  }
  if (tc && isStrictISODate(opp.deadline) && isStrictISODate(tc.start_date)) {
    if (compareYMD(parseISODate(opp.deadline)!, parseISODate(tc.start_date)!) > 0) {
      warn('deadline', `截止日期 ${opp.deadline} 晚于活动开始日期 ${tc.start_date}，请复查。`);
    }
  }
  return out;
}

// ───────────────────────────── 学生档案 ─────────────────────────────

/** 校验单个学生档案。返回中文问题列表，空数组 = 合格。不抛异常。 */
export function validateProfile(value: unknown): string[] {
  const id = isObj(value) && isNonEmptyStr(value.id) ? value.id : null;
  const r = new Reporter(id ? `档案「${id}」` : '档案（id 缺失）');
  if (!isObj(value)) {
    r.add('（整条）', '对象', value);
    return r.problems;
  }
  const p = value;
  if (!isNonEmptyStr(p.id)) r.add('id', '非空字符串', p.id);
  if (typeof p.is_sample !== 'boolean') r.add('is_sample', 'true / false', p.is_sample);
  r.nonEmptyStr(p, 'display_name');

  if (p.grade != null && !(Number.isInteger(p.grade) && (p.grade as number) >= GRADE_MIN && (p.grade as number) <= GRADE_MAX)) {
    r.add('grade', `${GRADE_MIN}–${GRADE_MAX} 的整数或 null（可不填）`, p.grade);
  }
  r.optNonNeg(p, 'age');

  const region = p.region;
  if (region != null) {
    if (!isObj(region)) r.add('region', '对象或 null（可不填）', region);
    else {
      if (!(typeof region.country === 'string' && COUNTRY_RE.test(region.country))) {
        r.add('region.country', '两位大写国家代码（如 "US"）', region.country);
      }
      r.optStr(region, 'state', 'region.state');
      r.optStr(region, 'city', 'region.city');
      if (region.locality != null && !includes(LOCALITIES, region.locality)) {
        r.add('region.locality', `${oneOf(LOCALITIES)}（或 null）`, region.locality);
      }
    }
  }
  r.countryArray(p, 'citizenships', 'citizenships', false);
  r.enumArray(p, 'statuses', STUDENT_STATUSES, 'statuses', true);
  r.optStr(p, 'school_name');
  r.optNonNeg(p, 'hours_per_week_available');
  r.optNonNeg(p, 'budget_usd');

  const tr = p.transport;
  if (tr != null) {
    if (!isObj(tr)) r.add('transport', '对象或 null（可不填）', tr);
    else {
      if (!includes(TRANSPORT_LEVELS, tr.level)) r.add('transport.level', oneOf(TRANSPORT_LEVELS), tr.level);
      r.optNonNeg(tr, 'max_one_way_minutes', 'transport.max_one_way_minutes');
      r.optStr(tr, 'note', 'transport.note');
    }
  }
  r.enumArray(p, 'devices', DEVICE_TYPES, 'devices', true);

  const skills = p.skills;
  if (skills != null) {
    if (!Array.isArray(skills)) r.add('skills', '数组或 null（可不填）', skills);
    else
      skills.forEach((s, i) => {
        if (!isObj(s)) {
          r.add(`skills[${i}]`, '对象 { name, level }', s);
          return;
        }
        r.nonEmptyStr(s, 'name', `skills[${i}].name`);
        if (!includes(SKILL_LEVELS, s.level)) r.add(`skills[${i}].level`, oneOf(SKILL_LEVELS), s.level);
      });
  }

  const ev = p.evidence;
  if (!Array.isArray(ev)) r.add('evidence', '数组（没有证据时填 []）', ev);
  else {
    const seen = new Set<string>();
    ev.forEach((e, i) => {
      const label = isObj(e) && isNonEmptyStr(e.id) ? e.id : String(i);
      const path = `evidence[${label}]`;
      if (!isObj(e)) {
        r.add(path, '对象', e);
        return;
      }
      if (!isNonEmptyStr(e.id)) r.add(`${path}.id`, '非空字符串（档案内唯一）', e.id);
      else if (seen.has(e.id)) r.note(`${path}.id`, `id 重复（档案内必须唯一）："${e.id}"`);
      else seen.add(e.id);
      r.nonEmptyStr(e, 'title', `${path}.title`);
      if (!includes(EVIDENCE_KINDS, e.kind)) r.add(`${path}.kind`, oneOf(EVIDENCE_KINDS), e.kind);
      r.stringArray(e, 'skills', `${path}.skills`);
      if (e.prep_item_ids !== undefined) r.stringArray(e, 'prep_item_ids', `${path}.prep_item_ids`);
      if (!includes(EVIDENCE_STATUSES, e.status)) r.add(`${path}.status`, oneOf(EVIDENCE_STATUSES), e.status);
      if (e.url != null && !isHttpUrl(e.url)) r.add(`${path}.url`, 'http(s) 链接或 null（可不填）', e.url);
      r.optStr(e, 'description', `${path}.description`);
      if (!isStrictISODate(e.added_on)) r.add(`${path}.added_on`, '合法日期 YYYY-MM-DD', e.added_on);
    });
  }

  const interests = p.interests;
  if (interests != null) r.stringArray(p, 'interests');
  return r.problems;
}

// ───────────────────────────── 编译期：枚举数组没有漏掉类型里的取值 ─────────────────────────────

type Covers<T, L extends readonly unknown[]> = [Exclude<T, L[number]>] extends [never] ? true : false;

/** 任何一项为 false 都会编译失败（说明 lib/types.ts 新增了取值，这里的数组需要补上）。 */
export const _enumsComplete: {
  category: Covers<OpportunityCategory, typeof OPPORTUNITY_CATEGORIES>;
  format: Covers<OpportunityFormat, typeof OPPORTUNITY_FORMATS>;
  device: Covers<DeviceType, typeof DEVICE_TYPES>;
  requirement: Covers<RequirementType, typeof REQUIREMENT_TYPES>;
  status: Covers<StudentStatus, typeof STUDENT_STATUSES>;
  evidenceKind: Covers<EvidenceKind, typeof EVIDENCE_KINDS>;
  evidenceStatus: Covers<EvidenceStatus, typeof EVIDENCE_STATUSES>;
  skill: Covers<SkillLevel, typeof SKILL_LEVELS>;
} = {
  category: true,
  format: true,
  device: true,
  requirement: true,
  status: true,
  evidenceKind: true,
  evidenceStatus: true,
  skill: true,
};
