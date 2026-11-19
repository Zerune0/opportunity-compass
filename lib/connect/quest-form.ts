/**
 * Quest Creator 的纯逻辑：把表单文字变成一条用户发布的机会（`source_tier: 'user_posted'`），并在保存前校验。
 *
 * 约定（CONTRACT.md「来源等级」「用户发布的机会」）：
 * - `source_tier: 'user_posted'`、`is_sample: true`、`posted_by` = 示例发布者 id；
 *   `verified_on` / `verified_by` 只记录发布日期与示例发布者（界面不得显示为「已核实」）。
 * - 没有真实官网：`official_url` 用保留的示例域名 `example.com` 占位（`validateOpportunity` 要求 http(s) 链接）。
 * - 资格只收引擎能机器判定的种类：年级区间（grade）、地区（region）、先修技能（prerequisite_skill），
 *   设备写进 `required_devices`。全部是硬性要求；`source_text` 写明出自示例发布者，不是官网原文。
 *   地区与技能只接受代码 / 单个技能，避免自由文字生成永远无法满足的硬性要求。
 * - `Opportunity` 没有「报酬」「真实收获」字段：两者写进 `summary`（学生端 Quest Details 会显示），报酬另写进 `cost.note`。
 * - 截止日期留空 = 滚动申请：`deadline: null`，并在 `deadline_note` 写明（学生端 Quest Details 会显示这句）。
 *
 * 纯函数：日期（today）与 id 一律由调用方传入，不读时钟、无随机、不读写存储、永不抛异常、不修改输入。
 */
import { normalizeTag } from '../tags';
import type {
  DeviceType,
  ISODate,
  Opportunity,
  OpportunityCategory,
  OpportunityFormat,
  Requirement,
  SamplePublisher,
  SkillLevel,
} from '../types';
import { isStrictISODate, validateOpportunity } from '../validation';
import { DEVICE_LABELS, SKILL_LEVEL_LABELS, gradeLabel } from './labels';

/** 表单的原始值（全部是输入框里的文字，空字符串 = 没填）。 */
export interface QuestForm {
  /** 以哪个示例发布者的身份发布（只能从示例发布者里选）。 */
  publisher_id: string;
  // —— 目标 ——
  title: string;
  /** 参与者要做什么。 */
  activity: string;
  /** OpportunityCategory，'' = 没选。 */
  category: string;
  /** 领域标签，逗号分隔。 */
  topics: string;
  // —— 资格（只收机器可判定的种类）——
  /** 最低年级 '1'–'17'，'' = 不限。 */
  grade_min: string;
  /** 最高年级 '1'–'17'，'' = 不限。 */
  grade_max: string;
  /** 两位国家代码，'' = 不限地区。 */
  region_country: string;
  /** 州 / 省代码，逗号分隔；'' = 全国。 */
  region_states: string;
  required_devices: DeviceType[];
  /** 一项先修技能（slug），'' = 无。 */
  skill: string;
  /** SkillLevel（空表单为 'beginner'；不认识的值按 beginner 处理）。 */
  skill_level: string;
  // —— 时间与地点 ——
  /** OpportunityFormat，'' = 没选。 */
  format: string;
  city: string;
  state: string;
  country: string;
  hours_per_week: string;
  total_weeks: string;
  start_date: string;
  end_date: string;
  // —— 报酬与费用 ——
  fee_usd: string;
  /** 报酬 / 津贴总额（美元）；'' = 没写，'0' = 无报酬。 */
  pay_usd: string;
  /** 'yes' / 'no'；'' = 没选。 */
  travel_expense: string;
  // —— 参与者具体得到什么 ——
  outcome: string;
  // —— 截止 ——
  /** YYYY-MM-DD，'' = 滚动申请。 */
  deadline: string;
}

export type QuestFormField = keyof QuestForm;

/** 一条给发布者看的问题（英文）；`field` 为 null = 对不上具体输入框。 */
export interface QuestProblem {
  field: QuestFormField | null;
  message: string;
}

/** 表单字段的显示顺序（问题列表按它排序）。 */
export const QUEST_FORM_FIELDS: readonly QuestFormField[] = [
  'publisher_id',
  'title',
  'activity',
  'category',
  'topics',
  'grade_min',
  'grade_max',
  'region_country',
  'region_states',
  'required_devices',
  'skill',
  'skill_level',
  'format',
  'city',
  'state',
  'country',
  'hours_per_week',
  'total_weeks',
  'start_date',
  'end_date',
  'fee_usd',
  'pay_usd',
  'travel_expense',
  'outcome',
  'deadline',
];

/** 日期字段（页面用来检查输入框里没填完的日期）。 */
export const QUEST_DATE_FIELDS = ['start_date', 'end_date', 'deadline'] as const satisfies readonly QuestFormField[];

/** 文字字段的长度上限（页面的 maxLength 与 checkQuestForm 用同一张表）。 */
export const QUEST_MAX_LENGTH = {
  title: 120,
  activity: 1000,
  topics: 120,
  region_country: 2,
  region_states: 120,
  skill: 120,
  city: 120,
  state: 120,
  country: 2,
  outcome: 1000,
} as const satisfies Partial<Record<QuestFormField, number>>;

export const INCOMPLETE_DATE_MESSAGE = 'Finish the date or clear it.';
export const ROLLING_DEADLINE_NOTE = 'Rolling applications (as posted by the sample publisher).';

export const DEVICE_CHOICES = Object.keys(DEVICE_LABELS) as DeviceType[];
export const SKILL_LEVEL_CHOICES = Object.keys(SKILL_LEVEL_LABELS) as SkillLevel[];

/** 空表单（可预选发布者）。 */
export function emptyQuestForm(publisherId = ''): QuestForm {
  return {
    publisher_id: publisherId,
    title: '',
    activity: '',
    category: '',
    topics: '',
    grade_min: '',
    grade_max: '',
    region_country: '',
    region_states: '',
    required_devices: [],
    skill: '',
    skill_level: 'beginner',
    format: '',
    city: '',
    state: '',
    country: '',
    hours_per_week: '',
    total_weeks: '',
    start_date: '',
    end_date: '',
    fee_usd: '',
    pay_usd: '',
    travel_expense: '',
    outcome: '',
    deadline: '',
  };
}

/** 两份表单逐字段相同（设备按集合比较）。 */
export function questFormsEqual(a: QuestForm, b: QuestForm): boolean {
  return QUEST_FORM_FIELDS.every((f) => {
    const x = a[f];
    const y = b[f];
    if (Array.isArray(x) || Array.isArray(y)) {
      const xs = Array.isArray(x) ? x : [];
      const ys = Array.isArray(y) ? y : [];
      return xs.length === ys.length && xs.every((v) => ys.includes(v as DeviceType));
    }
    return x === y;
  });
}

/**
 * 防重复提交：刚发布成功后表单被清空（`clearedAfterPost` 为那份空表单），用户还没改任何东西就再次提交
 * （连按回车、双击）时返回 true，页面应当什么都不做、保留成功消息。用户一开始编辑，页面就把 `clearedAfterPost` 设回 null。
 */
export function isRepeatSubmitAfterPost(form: QuestForm, clearedAfterPost: QuestForm | null): boolean {
  return clearedAfterPost !== null && questFormsEqual(form, clearedAfterPost);
}

// ───────────────────────────── 小工具 ─────────────────────────────

const raw = (v: unknown): string => (typeof v === 'string' ? v : '');
const str = (v: unknown): string => raw(v).trim();

const PLAIN_NUMBER_RE = /^\d+(\.\d+)?$/;

/** 只接受普通的非负十进制数（如 `3`、`1.5`）；`0x1A`、`1e3`、`-0`、`1,000` 都不算。 */
function isPlainNumberText(text: string): boolean {
  return PLAIN_NUMBER_RE.test(text.trim());
}

/** 空 → null；普通十进制数 → 数值；其他 → NaN（交给 validateOpportunity 报错）。 */
function numOrNull(text: unknown): number | null {
  const t = str(text);
  if (t === '') return null;
  return isPlainNumberText(t) ? Number(t) : Number.NaN;
}

/** 美元金额：整数不带小数，否则保留两位（0.04 → $0.04，1.5 → $1.50）。 */
export function formatUsd(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

/** 末尾没有句号、感叹号或问号时补一个句号。 */
function sentence(s: string): string {
  return s === '' || /[.!?]$/.test(s) ? s : `${s}.`;
}

/** 逗号分隔的列表：去空白、去空项、去重（保留第一次出现的顺序）。 */
function splitList(text: unknown, map: (s: string) => string): string[] {
  const out: string[] = [];
  for (const part of str(text).split(',')) {
    const v = map(part.trim());
    if (v !== '' && v !== '_' && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 领域标签：按 normalizeTag 归一化（小写 + 下划线），与档案的 interests 同一套写法。 */
export function parseTopics(text: string): string[] {
  return splitList(text, normalizeTag);
}

function gradeOrUndefined(text: unknown): number | undefined {
  const t = str(text);
  return t === '' ? undefined : Number(t);
}

function gradeRangeLabel(min: number | undefined, max: number | undefined): string {
  if (min !== undefined && max !== undefined) return min === max ? gradeLabel(min) : `${gradeLabel(min)} to ${gradeLabel(max)}`;
  if (min !== undefined) return `${gradeLabel(min)} or above`;
  if (max !== undefined) return `${gradeLabel(max)} or below`;
  return 'Any grade';
}

/** 要求的 source_text：写明出自示例发布者，不是官网原文。 */
function postedText(publisher: SamplePublisher, label: string): string {
  return `As posted by ${publisher.name} (sample publisher, not an official source): ${label}.`;
}

function isSkillLevel(v: string): v is SkillLevel {
  return (SKILL_LEVEL_CHOICES as readonly string[]).includes(v);
}

// ───────────────────────────── id ─────────────────────────────

/** 用户发布的机会 id 的前缀；官方目录的 id 不用它（有测试钉住），所以两者不会重合。 */
export const USER_POSTED_ID_PREFIX = 'sample-post-';

/**
 * 由标题与调用方给的数字（页面在事件处理里传一个由 crypto.randomUUID() 得到的随机整数）生成 kebab-case id：`sample-post-<标题片段>-<数字的 36 进制>`。
 * 同样的输入永远得到同样的 id。
 */
export function userPostedId(title: string, stamp: number): string {
  const slug = str(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const n = Number.isFinite(stamp) && stamp >= 0 ? Math.floor(stamp) : 0;
  return `${USER_POSTED_ID_PREFIX}${slug === '' ? 'quest' : slug}-${n.toString(36)}`;
}

/** 与 `existingIds` 不重复的 id：从 `stamp` 开始逐个加 1，直到不重复。 */
export function uniqueUserPostedId(title: string, stamp: number, existingIds: readonly string[]): string {
  const taken = new Set(existingIds);
  const start = Number.isFinite(stamp) && stamp >= 0 ? Math.floor(stamp) : 0;
  for (let i = 0; i <= existingIds.length; i += 1) {
    const id = userPostedId(title, start + i);
    if (!taken.has(id)) return id;
  }
  // 理论上走不到：existingIds.length + 1 个候选里至少有一个不重复。
  return userPostedId(title, start + existingIds.length + 1);
}

// ───────────────────────────── 组装 ─────────────────────────────

/** 学生端 Quest Details 只显示 summary，所以「做什么 + 得到什么 + 报酬」都写进这里，每段以句号结尾。 */
function composeSummary(activity: string, outcome: string, pay: number | null): string {
  const parts = [sentence(activity)];
  if (outcome !== '') parts.push(sentence(`What you get: ${outcome}`));
  if (pay !== null && Number.isFinite(pay)) parts.push(pay > 0 ? `Pay: ${formatUsd(pay)} in total.` : 'Pay: none.');
  return parts.filter((p) => p !== '').join(' ');
}

function payNote(pay: number | null): string | null {
  if (pay === null || !Number.isFinite(pay) || pay < 0) return null;
  return pay > 0 ? `Pay offered by the sample publisher: ${formatUsd(pay)} in total.` : 'No pay is offered.';
}

function buildRequirements(form: QuestForm, publisher: SamplePublisher): Requirement[] {
  const reqs: Requirement[] = [];

  const min = gradeOrUndefined(form.grade_min);
  const max = gradeOrUndefined(form.grade_max);
  if (min !== undefined || max !== undefined) {
    const label = gradeRangeLabel(min, max);
    reqs.push({
      id: 'req-grade',
      type: 'grade',
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      hard: true,
      label,
      source_text: postedText(publisher, label),
    });
  }

  const country = str(form.region_country).toUpperCase();
  const states = splitList(form.region_states, (s) => s.toUpperCase());
  if (country !== '' || states.length > 0) {
    const label = states.length > 0 ? `Located in ${states.join(', ')} (${country || 'country not given'})` : `Located in ${country}`;
    reqs.push({
      id: 'req-region',
      type: 'region',
      countries: country === '' ? [] : [country],
      ...(states.length > 0 ? { states } : {}),
      hard: true,
      label,
      source_text: postedText(publisher, label),
    });
  }

  const skill = normalizeTag(str(form.skill));
  if (skill !== '' && skill !== '_') {
    const level = isSkillLevel(str(form.skill_level)) ? (str(form.skill_level) as SkillLevel) : 'beginner';
    const label = `Skill: ${skill} (${SKILL_LEVEL_LABELS[level].toLowerCase()} or above)`;
    reqs.push({
      id: 'req-skill',
      type: 'prerequisite_skill',
      skill,
      min_level: level,
      hard: true,
      label,
      source_text: postedText(publisher, label),
    });
  }
  return reqs;
}

/**
 * 把表单变成一条用户发布的机会（不校验；保存前用 `prepareQuestPost`，它会再调用 `validateOpportunity`）。
 * `options.today` 是发布日期（`verified_on`），`options.id` 是新机会的 id，都由页面在事件处理里给出。
 */
export function buildUserPostedOpportunity(
  form: QuestForm,
  publisher: SamplePublisher,
  options: { today: ISODate; id: string },
): Opportunity {
  const format = str(form.format) as OpportunityFormat;
  const online = format === 'online';
  const pay = numOrNull(form.pay_usd);
  const travel = str(form.travel_expense);
  const deadline = str(form.deadline);
  const start = str(form.start_date);
  const end = str(form.end_date);
  const devices = DEVICE_CHOICES.filter((d) => Array.isArray(form.required_devices) && form.required_devices.includes(d));
  const id = options.id;

  return {
    id,
    title: str(form.title),
    organizer: publisher.name,
    category: str(form.category) as OpportunityCategory,
    fields: parseTopics(form.topics),
    summary: composeSummary(str(form.activity), str(form.outcome), pay),
    official_url: `https://example.com/connect-sample/${encodeURIComponent(id)}`,
    verified_on: options.today,
    verified_by: publisher.name,
    deadline: deadline === '' ? null : deadline,
    deadline_note: deadline === '' ? ROLLING_DEADLINE_NOTE : null,
    recurring_annually: null,
    location: {
      format,
      country: online ? null : str(form.country).toUpperCase() || null,
      state: online ? null : str(form.state).toUpperCase() || null,
      city: online ? null : str(form.city) || null,
    },
    cost: {
      fee_usd: numOrNull(form.fee_usd),
      requires_travel_expense: travel === 'yes' ? true : travel === 'no' ? false : null,
      note: payNote(pay),
    },
    time_commitment: {
      hours_per_week: numOrNull(form.hours_per_week),
      total_weeks: numOrNull(form.total_weeks),
      start_date: start === '' ? null : start,
      end_date: end === '' ? null : end,
    },
    required_devices: devices,
    requirements: buildRequirements(form, publisher),
    preparation: [],
    is_sample: true,
    source_tier: 'user_posted',
    posted_by: publisher.id,
  };
}

// ───────────────────────────── 校验 ─────────────────────────────

const CHOOSE_PUBLISHER = 'Choose a sample publisher.';
/** 每周小时的上限（一周 168 小时）。 */
export const MAX_HOURS_PER_WEEK = 168;
/** 总周数的上限（约十年）。 */
export const MAX_TOTAL_WEEKS = 520;

const STATE_CODE_RE = /^[A-Z0-9]{1,3}$/;
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;
const USE_STATE_CODES = 'Use codes such as CA, not full names.';
const USE_COUNTRY_CODE = 'Use a two-letter country code such as US, not a full name.';

/** `validateOpportunity` 看不到的表单层检查（它只看组装后的机会）。 */
function checkQuestForm(form: QuestForm, publishers: readonly SamplePublisher[], today: ISODate): QuestProblem[] {
  const out: QuestProblem[] = [];
  const add = (field: QuestFormField, message: string) => out.push({ field, message });

  if (!publishers.some((p) => p.id === form.publisher_id && p.is_sample === true)) add('publisher_id', CHOOSE_PUBLISHER);
  if (str(form.activity) === '') add('activity', 'Describe what the participant will do.');

  // 长度上限（与输入框的 maxLength 相同）
  for (const [field, max] of Object.entries(QUEST_MAX_LENGTH) as [keyof typeof QUEST_MAX_LENGTH, number][]) {
    if (max > 2 && raw(form[field]).length > max) add(field, `Keep this under ${max} characters.`);
  }

  // 地区与技能：只接受代码 / 单个技能，避免生成永远无法满足的硬性要求
  const regionCountry = str(form.region_country).toUpperCase();
  if (regionCountry !== '' && !COUNTRY_CODE_RE.test(regionCountry)) add('region_country', USE_COUNTRY_CODE);
  const regionStates = str(form.region_states)
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s !== '');
  if (regionStates.some((s) => !STATE_CODE_RE.test(s))) add('region_states', USE_STATE_CODES);
  if (raw(form.skill).includes(',')) add('skill', 'Enter one skill.');
  const venueState = str(form.state).toUpperCase();
  if (str(form.format) !== 'online' && venueState !== '' && !STATE_CODE_RE.test(venueState)) add('state', USE_STATE_CODES);

  // 时间投入的范围（只检查普通数字；不是数字、负数由 validateOpportunity 报）：都必须大于 0，
  // 每周小时不超过一周的 168 小时，周数是整数且不超过 520（约十年）。
  const hours = str(form.hours_per_week);
  if (isPlainNumberText(hours)) {
    const n = Number(hours);
    if (n <= 0) add('hours_per_week', 'Hours per week must be more than 0. Leave it blank if it varies.');
    else if (n > MAX_HOURS_PER_WEEK) add('hours_per_week', `Hours per week cannot be more than ${MAX_HOURS_PER_WEEK} (the hours in a week).`);
  }
  const weeks = str(form.total_weeks);
  if (isPlainNumberText(weeks)) {
    const n = Number(weeks);
    if (!Number.isInteger(n)) add('total_weeks', 'Total weeks must be a whole number of weeks.');
    else if (n <= 0) add('total_weeks', 'Total weeks must be more than 0. Leave it blank if it is not decided.');
    else if (n > MAX_TOTAL_WEEKS) add('total_weeks', `Total weeks cannot be more than ${MAX_TOTAL_WEEKS} (about ten years).`);
  }

  const pay = str(form.pay_usd);
  if (pay !== '' && !isPlainNumberText(pay)) add('pay_usd', 'Enter the pay in US dollars (0 for unpaid), or leave it blank.');
  const travel = str(form.travel_expense);
  if (travel !== 'yes' && travel !== 'no') add('travel_expense', 'Choose whether participants pay for their own travel.');

  // 日期（只在都是合法日期时比较；非法日期由 validateOpportunity 报）
  const start = str(form.start_date);
  const end = str(form.end_date);
  const deadline = str(form.deadline);
  const okToday = isStrictISODate(today);
  if (isStrictISODate(start) && isStrictISODate(end) && end < start) add('end_date', 'The end date cannot be before the start date.');
  if (isStrictISODate(end) && okToday && end < today) add('end_date', 'The end date cannot be in the past.');
  if (isStrictISODate(deadline) && okToday && deadline < today) add('deadline', 'The deadline cannot be in the past.');
  if (isStrictISODate(deadline) && isStrictISODate(end) && deadline > end) add('deadline', 'The deadline cannot be after the end date.');

  if (str(form.outcome) === '') {
    add('outcome', 'Describe what the participant concretely gets, such as a finished project, a reference letter or a certificate.');
  }
  return out;
}

/** validateOpportunity 的路径 → 表单字段与一句好懂的英文。 */
function mapPath(path: string): { field: QuestFormField | null; message: string } | null {
  if (path === 'title') return { field: 'title', message: 'Give the quest a title.' };
  if (path === 'summary') return { field: 'activity', message: 'Describe what the participant will do.' };
  if (path === 'category') return { field: 'category', message: 'Choose a category.' };
  if (path === 'fields' || path.startsWith('fields[')) {
    return { field: 'topics', message: 'Write topic tags as words separated by commas.' };
  }
  if (path === 'organizer' || path === 'verified_by' || path === 'posted_by') return { field: 'publisher_id', message: CHOOSE_PUBLISHER };
  if (path === 'deadline') {
    return { field: 'deadline', message: 'Enter the deadline as a real date, or leave it blank for rolling applications.' };
  }
  if (path === 'location.format') return { field: 'format', message: 'Choose online, in person or hybrid.' };
  if (path === 'location.country') return { field: 'country', message: 'Use a two-letter country code such as US, or leave it blank.' };
  if (path === 'location.state') return { field: 'state', message: 'Enter the state or province as a code, or leave it blank.' };
  if (path === 'location.city') return { field: 'city', message: 'Enter the city as text, or leave it blank.' };
  if (path === 'cost.fee_usd') {
    return { field: 'fee_usd', message: 'Enter the fee in US dollars (0 if free), or leave it blank if it is not decided.' };
  }
  if (path === 'cost.requires_travel_expense') {
    return { field: 'travel_expense', message: 'Choose whether participants pay for their own travel.' };
  }
  if (path === 'cost.note') return { field: 'pay_usd', message: 'Enter the pay in US dollars (0 for unpaid), or leave it blank.' };
  if (path === 'time_commitment.hours_per_week') {
    return { field: 'hours_per_week', message: 'Enter hours per week as a number above 0, or leave it blank if it varies.' };
  }
  if (path === 'time_commitment.total_weeks') {
    return { field: 'total_weeks', message: 'Enter the number of weeks as a whole number above 0, or leave it blank.' };
  }
  if (path === 'time_commitment.start_date') return { field: 'start_date', message: 'Enter a real start date, or leave it blank.' };
  if (path === 'time_commitment.end_date') return { field: 'end_date', message: 'Enter a real end date, or leave it blank.' };
  if (path === 'required_devices' || path.startsWith('required_devices[')) {
    return { field: 'required_devices', message: 'Choose required devices from the list.' };
  }
  if (path.startsWith('requirements[req-grade]')) {
    if (path.endsWith('min / max')) return { field: 'grade_min', message: 'The lowest grade must not be above the highest grade.' };
    if (path.endsWith('.max')) return { field: 'grade_max', message: 'Choose the highest grade from the list.' };
    return { field: 'grade_min', message: 'Choose the lowest grade from the list.' };
  }
  if (path.startsWith('requirements[req-region]')) {
    if (path.includes('.states')) return { field: 'region_states', message: USE_STATE_CODES };
    // 只填了州、没填国家时也走到这里（countries 为空数组）。
    return { field: 'region_country', message: 'Enter a two-letter country code such as US (it is needed when you list states).' };
  }
  if (path.startsWith('requirements[req-skill]')) {
    if (path.endsWith('.min_level')) return { field: 'skill_level', message: 'Choose a skill level from the list.' };
    return { field: 'skill', message: 'Enter the skill as a short name, such as python.' };
  }
  return null;
}

const PROBLEM_RE = /^Opportunity (?:"[^"]*"|#\d+ \(missing id\)|\(missing id\)) field (.+?): ([\s\S]+)$/;

/**
 * 把 `validateOpportunity` 的问题列表翻成给发布者看的英文，尽量对到表单字段；
 * 对不上的保留原文（去掉 `Opportunity "<id>" field` 前缀），`field` 为 null。
 */
export function describeValidationProblems(problems: readonly string[]): QuestProblem[] {
  return problems.map((p) => {
    const m = PROBLEM_RE.exec(p);
    if (!m) return { field: null, message: `This posting could not be checked: ${p}` };
    const mapped = mapPath(m[1]);
    return mapped ?? { field: null, message: `This posting has a problem the form cannot fix (${m[1]}): ${m[2]}` };
  });
}

/**
 * 合并表单层问题与 validateOpportunity 的问题：某字段已有表单层问题时，丢掉它在校验里的重复说法；
 * 再去重（同字段同一句只留一条），按表单字段顺序排序，对不上字段的放最后。
 */
function tidy(formProblems: readonly QuestProblem[], validationProblems: readonly QuestProblem[]): QuestProblem[] {
  const formFields = new Set(formProblems.map((p) => p.field));
  const all = [...formProblems, ...validationProblems.filter((p) => p.field === null || !formFields.has(p.field))];
  const seen = new Set<string>();
  const unique = all.filter((p) => {
    const key = `${p.field ?? ''}\u0000${p.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const rank = (f: QuestFormField | null) => (f === null ? QUEST_FORM_FIELDS.length : QUEST_FORM_FIELDS.indexOf(f));
  return unique
    .map((p, i) => ({ p, i }))
    .sort((a, b) => rank(a.p.field) - rank(b.p.field) || a.i - b.i)
    .map((x) => x.p);
}

export type QuestPostResult =
  | { ok: true; opportunity: Opportunity; problems: [] }
  | { ok: false; opportunity: null; problems: QuestProblem[] };

/** 没选发布者时用它组装，只为让 validateOpportunity 照样检查其余字段（organizer 为空的问题会对到 publisher_id）。 */
const NO_PUBLISHER: SamplePublisher = { id: '', name: '', kind: 'individual', is_sample: true };

/**
 * 保存前的完整检查：表单层检查 + `buildUserPostedOpportunity` + `validateOpportunity`。
 * 任何问题都返回 `ok: false`（什么都不保存）；没有问题时返回可直接交给 `addUserPostedOpportunity` 的机会。
 * 发布者只能来自 `publishers`（示例发布者列表）。
 * `options.incompleteDates`：页面发现日期输入框里有没填完的日期（浏览器把它当空值）时传入这些字段，各报一条问题。
 */
export function prepareQuestPost(
  form: QuestForm,
  publishers: readonly SamplePublisher[],
  options: { today: ISODate; id: string; incompleteDates?: readonly QuestFormField[] },
): QuestPostResult {
  const publisher = publishers.find((p) => p.id === form.publisher_id && p.is_sample === true) ?? null;
  const opportunity = buildUserPostedOpportunity(form, publisher ?? NO_PUBLISHER, options);
  const incomplete = (options.incompleteDates ?? []).filter((f) => (QUEST_DATE_FIELDS as readonly string[]).includes(f));
  const problems = tidy(
    [...incomplete.map((field) => ({ field, message: INCOMPLETE_DATE_MESSAGE })), ...checkQuestForm(form, publishers, options.today)],
    describeValidationProblems(validateOpportunity(opportunity)),
  );
  if (problems.length > 0 || publisher === null) {
    return { ok: false, opportunity: null, problems: problems.length > 0 ? problems : [{ field: 'publisher_id', message: CHOOSE_PUBLISHER }] };
  }
  return { ok: true, opportunity, problems: [] };
}

/**
 * 「Posted in this browser」列表只列 Connect 自己发布的任务：`posted_by` 指向示例发布者列表里的某一位。
 * 别的页面存进本地的示例机会（例如主办方页面为了让 Quest Details 打得开而存的那一份）没有示例发布者，
 * 不能说成「某位示例发布者发布的」，也不该在这里被撤回。返回原对象，顺序不变。
 */
export function postedThroughConnect<T extends { posted_by?: string | null }>(
  opportunities: readonly T[],
  publishers: readonly SamplePublisher[],
): T[] {
  const ids = new Set(publishers.filter((p) => p.is_sample === true).map((p) => p.id));
  return opportunities.filter((o) => typeof o.posted_by === 'string' && ids.has(o.posted_by));
}

/** 某个字段的全部问题。 */
export function problemsFor(problems: readonly QuestProblem[], field: QuestFormField): string[] {
  return problems.filter((p) => p.field === field).map((p) => p.message);
}
