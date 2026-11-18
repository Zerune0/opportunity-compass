/**
 * 档案里「有值但类型不对」的字段（纯函数），供 explainMatch 判断「档案数据损坏」。
 *
 * 规则与 lib/gap/index.ts 的 profileFieldIssues 相同（那边没有导出，本任务不改 lib/gap，所以这里保留一份同口径的副本；
 * 两处改动时请同步）：没填（null / 缺省）不算；数字字段为有限数；skills 为对象数组且 name 为字符串、level 合法；
 * statuses / citizenships / devices 为字符串数组；region 为对象且 country / state 为字符串（或没填）；
 * transport 为对象且 level 合法；evidence 为数组且每条的 id / title / kind / status 为字符串、
 * skills / prep_item_ids 为字符串数组（或没填）。按固定顺序返回 `profile.<字段>`。
 *
 * 公平性：不读取学校名、显示名。不抛异常（非对象输入返回 []）。
 */

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const SKILL_LEVELS: readonly string[] = ['beginner', 'intermediate', 'advanced'];
const TRANSPORT_LEVELS: readonly string[] = ['reliable', 'limited', 'none'];

function isStringArray(v: unknown): boolean {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function optionalString(v: unknown): boolean {
  return v == null || typeof v === 'string';
}

function optionalStringArray(v: unknown): boolean {
  return v == null || isStringArray(v);
}

function validEvidence(e: unknown): boolean {
  return (
    isObject(e) &&
    typeof e.id === 'string' &&
    typeof e.title === 'string' &&
    typeof e.kind === 'string' &&
    typeof e.status === 'string' &&
    optionalStringArray(e.skills) &&
    optionalStringArray(e.prep_item_ids)
  );
}

export function profileFieldIssues(raw: unknown): string[] {
  if (!isObject(raw)) return [];
  const out: string[] = [];
  const bad = (key: string) => out.push(`profile.${key}`);
  for (const key of ['grade', 'age']) {
    const v = raw[key];
    if (v != null && !(typeof v === 'number' && Number.isFinite(v))) bad(key);
  }
  const skills = raw.skills;
  if (
    skills != null &&
    !(Array.isArray(skills) && skills.every((s) => isObject(s) && typeof s.name === 'string' && SKILL_LEVELS.includes(s.level as string)))
  ) {
    bad('skills');
  }
  for (const key of ['statuses', 'citizenships']) {
    if (!optionalStringArray(raw[key])) bad(key);
  }
  const region = raw.region;
  if (region != null && !(isObject(region) && optionalString(region.country) && optionalString(region.state))) bad('region');
  if (!optionalStringArray(raw.devices)) bad('devices');
  for (const key of ['budget_usd', 'hours_per_week_available']) {
    const v = raw[key];
    if (v != null && !(typeof v === 'number' && Number.isFinite(v))) bad(key);
  }
  const transport = raw.transport;
  if (transport != null && !(isObject(transport) && TRANSPORT_LEVELS.includes(transport.level as string))) bad('transport');
  const evidence = raw.evidence;
  if (evidence != null && !(Array.isArray(evidence) && evidence.every(validEvidence))) bad('evidence');
  return out;
}
