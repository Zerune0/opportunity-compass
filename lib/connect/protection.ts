/**
 * Talent Board：未成年人更严格的默认设置（本地示例）。
 *
 * 档案「受保护」= 下面任一成立：
 * - `under_18`：按调用方给的 today，由 `birth_date` 算出的整岁小于 18（2 月 29 日出生者在非闰年按 3 月 1 日满岁）；
 * - `grade_12_or_below`：`grade` 是有限数字（或纯数字字符串，如 "11"）且 ≤ 12
 *   （GradeLevel：1–12 = K-12 年级，13–16 本科，17 研究生）；
 * - `age_unknown`：年龄算不出来——没有 `birth_date`、不是合法的 `YYYY-MM-DD`、晚于 today，或 today 本身不合法。
 * 只看 `birth_date`，不看自填的 `age` 字段。`grade` 缺失 / 不是数字本身不算理由：
 * 所以 grade 为 null、按 birth_date 已满 18 岁的档案不受保护。
 *
 * 受保护时（由 ./talent 执行）：合作说明不分享；发布者视图里的证据不显示标题。
 * （邀请必须针对一个具体发布的任务——这一条对所有档案都成立，见 ./invitations，免得发布者从规则差异推断出学生未成年。）
 *
 * 失败时从严：调用方传来的 Protection 只有 `protected === false` 才算不受保护（见 isUnprotected）。
 *
 * 纯函数：日期由调用方传入，不读时钟、不读写存储、永不抛异常。年龄与出生日期只用于判断，
 * 不出现在任何返回的字符串里（发布者端永远看不到）。
 */
import { joinAnd } from '../format';
import { ageOn } from '../eligibility/dates';
import type { ISODate, StudentProfile } from '../types';

export type ProtectionReason = 'under_18' | 'grade_12_or_below' | 'age_unknown';

export interface Protection {
  protected: boolean;
  /** 成立的理由（按上面的顺序）；不受保护时为 []。 */
  reasons: ProtectionReason[];
}

/** 成年年龄。 */
export const ADULT_AGE = 18;
/** 受保护的最高年级（含）：12 = 高中最后一年。 */
export const PROTECTED_MAX_GRADE = 12;

/** 不受保护（显式）。每次返回新对象，调用方修改不影响别处。 */
export function unprotected(): Protection {
  return { protected: false, reasons: [] };
}

/** 只有显式的 `protected === false` 才算不受保护；缺失、损坏的值一律按受保护处理。 */
export function isUnprotected(protection: Protection | null | undefined): boolean {
  return typeof protection === 'object' && protection !== null && protection.protected === false;
}

const NUMERIC_TEXT_RE = /^\s*-?\d+(?:\.\d+)?\s*$/;

/** 年级 → 数字：有限数字原样；纯数字字符串（如 "11"）按数字；其他（含 "eleven"）为 null。 */
function gradeNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && NUMERIC_TEXT_RE.test(v)) return Number(v);
  return null;
}

/** 判断档案是否受保护。档案不是对象时按「年龄未知」处理（宁严勿松）。 */
export function protectionFor(profile: StudentProfile | null | undefined, today: ISODate): Protection {
  const p: Partial<StudentProfile> =
    typeof profile === 'object' && profile !== null && !Array.isArray(profile) ? profile : {};
  const reasons: ProtectionReason[] = [];
  const age = ageOn(typeof p.birth_date === 'string' ? p.birth_date : null, today);
  if (age !== null && age < ADULT_AGE) reasons.push('under_18');
  const grade = gradeNumber(p.grade);
  if (grade !== null && grade <= PROTECTED_MAX_GRADE) reasons.push('grade_12_or_below');
  if (age === null) reasons.push('age_unknown');
  return { protected: reasons.length > 0, reasons };
}

const REASON_TEXT: Record<ProtectionReason, string> = {
  under_18: 'is under 18',
  grade_12_or_below: 'is in grade 12 or below',
  age_unknown: 'does not have a birth date saved',
};

/** 学生端提示的第一句（只给学生自己看）；不受保护时为 null。不含具体年龄或出生日期。 */
export function protectionNotice(protection: Protection): string | null {
  if (isUnprotected(protection)) return null;
  const parts = (Array.isArray(protection?.reasons) ? protection.reasons : [])
    .map((r) => REASON_TEXT[r])
    .filter((t): t is string => typeof t === 'string');
  return `Stricter defaults apply because this profile ${parts.length > 0 ? joinAnd(parts) : 'needs extra protection'}.`;
}

/** 学生端提示的第二句：受保护时做了哪些限制。 */
export const PROTECTION_EFFECTS = 'Your collaboration note is not shared, and publishers do not see the titles of your evidence.';

/** 学生端提示的第三句。 */
export const GUARDIAN_ADVICE = 'Talk with a parent, guardian or teacher before responding to any invitation.';

/**
 * 学生端「原样显示」的提醒（始终显示）：受保护时只有技能名与兴趣原样给发布者看；不受保护时还有合作说明与证据标题。
 * protection 为 null（还没读到数据）时用范围更大的那一句。
 */
export function exactlyAsWrittenWarning(protection: Protection | null): string {
  return protection !== null && !isUnprotected(protection)
    ? 'Skill names and interests are shown exactly as written, so do not put contact details, your name or your school in them.'
    : 'Skill names, interests, your note and evidence titles are shown exactly as written, so do not put contact details, your name or your school in them.';
}
