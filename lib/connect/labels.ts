/**
 * Connect 页面共用的英文标签表（纯数据）。
 * 用 `Record<联合类型, string>` 写，types.ts 新增取值而这里没跟上时编译报错；
 * 显示时仍用 `labelOf` 兜底，遇到不认识的值（如存储里的旧数据）也不会出错。
 */
import type {
  DeviceType,
  EvidenceKind,
  EvidenceStatus,
  OpportunityCategory,
  OpportunityFormat,
  PublisherKind,
  SkillLevel,
} from '../types';

export const PUBLISHER_KIND_LABELS: Record<PublisherKind, string> = {
  research_group: 'Research group',
  student_club: 'Student club',
  nonprofit: 'Nonprofit',
  project_team: 'Project team',
  individual: 'Individual',
};

export const CATEGORY_LABELS: Record<OpportunityCategory, string> = {
  research: 'Research',
  scholarship: 'Scholarship',
  hackathon: 'Hackathon',
  competition: 'Competition',
  internship: 'Internship',
  fellowship: 'Fellowship',
  summer_program: 'Summer program',
  public_service: 'Public service',
  project: 'Project',
  other: 'Other',
};

/** 发布表单可选的举办方式：发布者必须选定一种，不提供 'unknown'（那是官网没写明时目录用的）。 */
export const FORMAT_LABELS: Record<Exclude<OpportunityFormat, 'unknown'>, string> = {
  online: 'Online',
  in_person: 'In person',
  hybrid: 'Hybrid',
};

export const DEVICE_LABELS: Record<DeviceType, string> = {
  laptop: 'Laptop',
  desktop: 'Desktop computer',
  smartphone: 'Smartphone',
  tablet: 'Tablet',
  webcam: 'Webcam',
  home_internet: 'Home internet',
};

export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const EVIDENCE_KIND_LABELS: Record<EvidenceKind, string> = {
  project: 'Project',
  portfolio: 'Portfolio',
  certificate: 'Certificate',
  competition_result: 'Competition result',
  work_experience: 'Work experience',
  volunteer_experience: 'Volunteer experience',
  course: 'Course',
  recommendation_letter: 'Recommendation letter',
  other: 'Other',
};

/** 与 Skill Passport 的写法一致；附链接 ≠ 专业认证，所以没有 "Verified"。 */
export const EVIDENCE_STATUS_LABELS: Record<EvidenceStatus, string> = {
  self_reported: 'Self-reported',
  evidence_attached: 'Evidence attached',
  reviewed: 'Reviewed',
  unverified: 'Unverified',
};

/** 按标签表取标签；不认识的值把下划线换成空格显示，不是字符串时显示 "Unknown"。 */
export function labelOf(table: Readonly<Record<string, string>>, value: unknown): string {
  if (typeof value !== 'string') return 'Unknown';
  return Object.prototype.hasOwnProperty.call(table, value) ? table[value] : value.replace(/_/g, ' ');
}

/** 年级数字 → 标签（与 lib/types.ts 的 GradeLevel 一致：1–12 K-12，13–16 本科第 1–4 年，17 研究生及以上）。 */
export function gradeLabel(grade: number): string {
  if (!Number.isInteger(grade)) return 'Unknown grade';
  if (grade >= 1 && grade <= 12) return `Grade ${grade}`;
  if (grade >= 13 && grade <= 16) return `Undergraduate year ${grade - 12}`;
  if (grade === 17) return 'Graduate student';
  return 'Unknown grade';
}

/** 表单里可选的年级（1–17）。 */
export const GRADE_CHOICES: readonly number[] = Array.from({ length: 17 }, (_, i) => i + 1);
