/**
 * Talent Board：未成年人更严格的默认设置（本地示例）。
 *
 * 档案「受保护」= 下面任一成立：
 * - `under_18`：年龄小于 18。年龄的来源：
 *   1. 有 `birth_date`（非空字符串）时以它为准：按调用方给的 today 算整岁（2 月 29 日出生者在非闰年按 3 月 1 日满岁），
 *      与 `age` 矛盾时也以它为准（与 lib/types.ts 的约定一致）；
 *   2. 没有 `birth_date`（null / 缺省 / 空白）时用自填的 `age`（有限、非负的数字）；
 * - `grade_12_or_below`：`grade` 是有限数字（或纯数字字符串，如 "11"）且 ≤ 12
 *   （GradeLevel：1–12 = K-12 年级，13–16 本科，17 研究生）。这一条与年龄无关，始终适用；
 * - `age_unknown`：年龄得不出来——`birth_date` 与 `age` 都没有；或 `birth_date` 有但不是合法的 `YYYY-MM-DD`、
 *   晚于 today、或 today 本身不合法（这时不退回 `age`：给了出生日期却算不出来，宁严勿松）。
 * `grade` 缺失 / 不是数字本身不算理由：所以 grade 为 null、年龄已满 18 岁的档案不受保护。
 *
 * 受保护时（由 ./talent、./invitations 与页面执行）：合作说明不分享；收到的待回应邀请先收起（held），
 * 要和家长 / 监护人 / 老师一起查看时才展开，且不能接受；修改分享前要先确认和可信任的大人谈过。
 * 发布者一侧对所有档案完全相同：证据标题对谁都不显示（见 ./talent），发送邀请的规则与反馈也不随保护状态变化
 * （见 ./invitations），免得发布者推断出学生是否未成年。
 *
 * 失败时从严：调用方传来的 Protection 只有 `protected === false` 才算不受保护（见 isUnprotected）。
 *
 * 被隐藏的合作说明不会在保护解除后自动重新分享（2026-11-19）：Talent Board 挂载后读取数据时，若档案受保护且
 * 分享设置里存着非空的 `collaboration_note`，就把它清掉（`collaborationNoteToClear` 给出清掉后的设置，其他选择不动，
 * 页面用 lib/store.ts 的 saveShareSettings 保存）并告诉学生；以后不再受保护时，学生要重新写一条才会分享。
 *
 * 纯函数：日期由调用方传入，不读时钟、不读写存储、永不抛异常。年龄与出生日期只用于判断，
 * 不出现在任何返回的字符串里（发布者端永远看不到）。
 */
import { joinAnd } from '../format';
import { ageOn } from '../eligibility/dates';
import type { ISODate, ShareSettings, StudentProfile } from '../types';

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

/** 年龄：有 birth_date 时只按它算（算不出来为 null）；没有时用有限、非负的 age；都没有为 null。 */
function ageFor(p: Partial<StudentProfile>, today: ISODate): number | null {
  if (typeof p.birth_date === 'string' && p.birth_date.trim() !== '') return ageOn(p.birth_date, today);
  if (p.birth_date !== null && p.birth_date !== undefined && typeof p.birth_date !== 'string') return null;
  return typeof p.age === 'number' && Number.isFinite(p.age) && p.age >= 0 ? p.age : null;
}

/** 判断档案是否受保护。档案不是对象时按「年龄未知」处理（宁严勿松）。 */
export function protectionFor(profile: StudentProfile | null | undefined, today: ISODate): Protection {
  const p: Partial<StudentProfile> =
    typeof profile === 'object' && profile !== null && !Array.isArray(profile) ? profile : {};
  const reasons: ProtectionReason[] = [];
  const age = ageFor(p, today);
  if (age !== null && age < ADULT_AGE) reasons.push('under_18');
  const grade = gradeNumber(p.grade);
  if (grade !== null && grade <= PROTECTED_MAX_GRADE) reasons.push('grade_12_or_below');
  if (age === null) reasons.push('age_unknown');
  return { protected: reasons.length > 0, reasons };
}

const REASON_TEXT: Record<ProtectionReason, string> = {
  under_18: 'is under 18',
  grade_12_or_below: 'is in grade 12 or below',
  age_unknown: 'does not have a usable age or birth date saved',
};

/** 学生端提示的第一句（只给学生自己看）；不受保护时为 null。不含具体年龄或出生日期。 */
export function protectionNotice(protection: Protection): string | null {
  if (isUnprotected(protection)) return null;
  const parts = (Array.isArray(protection?.reasons) ? protection.reasons : [])
    .map((r) => REASON_TEXT[r])
    .filter((t): t is string => typeof t === 'string');
  return `Stricter defaults apply because this profile ${parts.length > 0 ? joinAnd(parts) : 'needs extra protection'}.`;
}

/** 学生端提示的第二句：受保护时做了哪些限制（证据标题对所有档案都不显示，见 EVIDENCE_TITLE_NOTICE）。 */
export const PROTECTION_EFFECTS =
  'Your collaboration note is not shared, invitations are held until you review them with a trusted adult, and invitations cannot be accepted here.';

/** 学生端提示的第三句。 */
export const GUARDIAN_ADVICE = 'Talk with a parent, guardian or teacher before responding to any invitation.';

/** 学生端证据一节的说明：对所有档案都一样。 */
export const EVIDENCE_TITLE_NOTICE = 'Publishers see the kind and status of your evidence, never its title.';

/**
 * 学生端「原样显示」的提醒（始终显示）：受保护时只有技能名与兴趣原样给发布者看；不受保护时还有合作说明。
 * 证据标题对所有档案都不给发布者看。protection 为 null（还没读到数据）时用范围更大的那一句。
 */
export function exactlyAsWrittenWarning(protection: Protection | null): string {
  return protection !== null && !isUnprotected(protection)
    ? 'Skill names and interests are shown exactly as written, so do not put contact details, your name or your school in them.'
    : 'Skill names, interests and your note are shown exactly as written, so do not put contact details, your name or your school in them.';
}

/**
 * 能否修改分享开关（证据、技能、兴趣）：不受保护时始终可以；受保护时要先勾选「已经和家长 / 监护人 / 老师谈过」
 * （confirmed 只放在页面的组件状态里，不存储）。停止分享与删除说明不受这条限制。
 */
export function canChangeSharing(protection: Protection | null | undefined, confirmed: boolean): boolean {
  return isUnprotected(protection) || confirmed === true;
}

/** 受保护档案在分享区顶部看到的确认复选框文字，以及没勾选时开关禁用的原因。 */
export const SHARING_CONFIRM_LABEL = 'I have talked with a parent, guardian or teacher about what I share here.';
export const SHARING_LOCKED_REASON =
  'Check the box above before changing what you share. Items you already share stay as they are, and you can stop sharing everything at any time.';

/** 学生端：受保护时存着的合作说明被清掉后显示的说明。 */
export const NOTE_REMOVED_NOTICE =
  'Your collaboration note was removed from sharing because stricter defaults apply to this profile. You can write a new one if these defaults stop applying.';

/**
 * 受保护的档案里存着非空（去掉首尾空白后非空）的合作说明时，返回把 `collaboration_note` 设为 null 的新设置
 * （其他字段原样，包括 updated_on）；否则返回 null（不需要清除）。
 * 保护状态缺失或损坏按受保护处理（与 isUnprotected 一致）。不修改输入。
 */
export function collaborationNoteToClear(
  settings: ShareSettings | null | undefined,
  protection: Protection | null | undefined,
): ShareSettings | null {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return null;
  if (isUnprotected(protection)) return null;
  const note = settings.collaboration_note;
  if (typeof note !== 'string' || note.trim() === '') return null;
  return { ...settings, collaboration_note: null };
}
