/**
 * 日期工具（纯函数）：只解析 `YYYY-MM-DD` 字符串，用 Date.UTC 计算，不读系统时钟。
 */
import type { ISODate } from '../types';

export interface YMD {
  y: number;
  m: number;
  d: number;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 解析 `YYYY-MM-DD`；格式不对或日期不存在（如 2027-02-30）返回 null。 */
export function parseISODate(s: ISODate | null | undefined): YMD | null {
  if (typeof s !== 'string') return null;
  const m = ISO_RE.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** 自 1970-01-01 起的天数（UTC）。 */
export function dayNumber(date: YMD): number {
  return Math.round(Date.UTC(date.y, date.m - 1, date.d) / 86_400_000);
}

/** b − a 的天数。 */
export function daysBetween(a: YMD, b: YMD): number {
  return dayNumber(b) - dayNumber(a);
}

/** 比较：a < b → 负数，相等 → 0，a > b → 正数。 */
export function compareYMD(a: YMD, b: YMD): number {
  return daysBetween(b, a);
}

/**
 * 从 from 到 to（to ≥ from）经过的完整年数，以及是否恰好是整年（无零头）。
 * 例：2026-11-17 → 2027-11-16 为 0 年（有零头）；→ 2027-11-17 为 1 年（无零头）。
 */
export function wholeYearsBetween(from: YMD, to: YMD): { years: number; exact: boolean } {
  let years = to.y - from.y;
  const beforeAnniversary = to.m < from.m || (to.m === from.m && to.d < from.d);
  if (beforeAnniversary) years -= 1;
  const exact = to.m === from.m && to.d === from.d;
  return { years: Math.max(0, years), exact };
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * 出生日期为 birth 的人在 on 这一天的整岁（按日历年月日）；birth 晚于 on → null。
 * 约定：2 月 29 日出生者在非闰年按 3 月 1 日满岁（2 月 28 日还差一天）。
 */
export function ageOnYMD(birth: YMD, on: YMD): number | null {
  if (compareYMD(birth, on) > 0) return null;
  let annM = birth.m;
  let annD = birth.d;
  if (annM === 2 && annD === 29 && !isLeapYear(on.y)) {
    annM = 3;
    annD = 1;
  }
  const beforeBirthday = on.m < annM || (on.m === annM && on.d < annD);
  return on.y - birth.y - (beforeBirthday ? 1 : 0);
}

/**
 * ageOn(birthDate, onDate)：birthDate 出生的人在 onDate 当天的整岁（纯函数，不读系统时钟）。
 * - 两个参数都必须是合法的 `YYYY-MM-DD`，否则 null；
 * - 出生日期晚于 onDate → null；同一天 → 0；
 * - 2 月 29 日出生者在非闰年按 3 月 1 日满岁。
 */
export function ageOn(birthDate: ISODate | null | undefined, onDate: ISODate | null | undefined): number | null {
  const b = parseISODate(birthDate);
  const on = parseISODate(onDate);
  if (b == null || on == null) return null;
  return ageOnYMD(b, on);
}
