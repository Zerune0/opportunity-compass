/**
 * Talent Board 的纯逻辑（本地示例，没有真实发布者，也不发生任何联系）。
 *
 * - 学生端「What I share」：`shareChoices` 把档案 + 分享设置整理成可勾选的项（按 ShareSettings 的字段：
 *   evidence_ids / skills / share_interests / collaboration_note），`applyShareChange` 返回改一项之后的新设置。
 * - 发布者端「Shared profile」：`sharedProfilePreview` 只渲染 `buildSharedProfileView`（lib/store.ts，纯函数）的输出，
 *   逐字段整理成行；什么都没分享时为空。这里不读档案的其他字段，所以未授权的内容不可能出现在结果里。
 * - 不排序、不打分、不算「匹配度」：证据、技能、兴趣保持档案里的原顺序。
 *
 * 纯函数：日期由调用方传入，不读时钟、不读写存储、永不抛异常、不修改输入。
 */
import { buildSharedProfileView } from '../store';
import type { EvidenceItem, ISODate, ShareSettings, StudentProfile } from '../types';
import { EVIDENCE_KIND_LABELS, EVIDENCE_STATUS_LABELS, SKILL_LEVEL_LABELS, labelOf } from './labels';

export const NOT_SHARING_TEXT = 'This student is not sharing anything.';

/** 学生端一个可勾选的项。`key` 是证据 id 或技能名（学生自己的浏览器里用，不进发布者视图）。 */
export interface ShareChoice {
  key: string;
  label: string;
  detail: string;
  checked: boolean;
}

export interface ShareChoices {
  evidence: ShareChoice[];
  skills: ShareChoice[];
  /** 档案里的兴趣（原写法）；`checked` = share_interests。 */
  interests: { values: string[]; checked: boolean };
  /** 当前已保存的合作说明（空白视为 null）。 */
  note: string | null;
  /** 发布者此刻能看到任何东西（= buildSharedProfileView 不为 null）。 */
  anything_shared: boolean;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** 只在设置属于这个档案时才用它（与 buildSharedProfileView 的口径一致）。 */
function settingsFor(profile: StudentProfile, settings: ShareSettings | null): ShareSettings | null {
  return isObj(settings) && isObj(profile) && settings.profile_id === profile.id ? settings : null;
}

function cleanNote(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** 学生端：档案里每条证据、每项技能、兴趣与合作说明的勾选状态。默认（settings 为 null）全部不勾。 */
export function shareChoices(profile: StudentProfile, settings: ShareSettings | null): ShareChoices {
  const own = settingsFor(profile, settings);
  const evidenceIds = new Set(strings(own?.evidence_ids));
  const skillNames = new Set(strings(own?.skills));

  const evidence: ShareChoice[] = [];
  const seenEvidence = new Set<string>();
  for (const e of Array.isArray(profile?.evidence) ? (profile.evidence as unknown[]) : []) {
    if (!isObj(e) || typeof e.id !== 'string' || typeof e.title !== 'string' || seenEvidence.has(e.id)) continue;
    seenEvidence.add(e.id);
    evidence.push({
      key: e.id,
      label: e.title,
      detail: `${labelOf(EVIDENCE_KIND_LABELS, e.kind)} · ${labelOf(EVIDENCE_STATUS_LABELS, e.status)}`,
      checked: evidenceIds.has(e.id),
    });
  }

  const skills: ShareChoice[] = [];
  const seenSkills = new Set<string>();
  for (const s of Array.isArray(profile?.skills) ? (profile.skills as unknown[]) : []) {
    if (!isObj(s) || typeof s.name !== 'string' || seenSkills.has(s.name)) continue;
    seenSkills.add(s.name);
    skills.push({ key: s.name, label: s.name, detail: labelOf(SKILL_LEVEL_LABELS, s.level), checked: skillNames.has(s.name) });
  }

  return {
    evidence,
    skills,
    interests: { values: strings(profile?.interests), checked: own?.share_interests === true },
    note: cleanNote(own?.collaboration_note),
    anything_shared: buildSharedProfileView(profile, own) !== null,
  };
}

/** 学生改动的一项。 */
export type ShareChange =
  | { kind: 'evidence'; id: string; on: boolean }
  | { kind: 'skill'; name: string; on: boolean }
  | { kind: 'interests'; on: boolean }
  | { kind: 'note'; note: string | null };

function toggled(list: readonly string[], value: string, on: boolean): string[] {
  const rest = list.filter((x) => x !== value);
  return on ? [...rest, value] : rest;
}

/**
 * 返回改了一项之后的新设置（不修改 base）：只动这一项，其余字段与 share_handle 原样保留，`updated_on = today`。
 * 合作说明去首尾空白，空白视为 null（= 不分享说明）；过不了 `checkCollaborationNote` 的说明不会写进去。
 */
export function applyShareChange(base: ShareSettings, change: ShareChange, today: ISODate): ShareSettings {
  const next: ShareSettings = {
    ...base,
    evidence_ids: strings(base.evidence_ids),
    skills: strings(base.skills),
    updated_on: today,
  };
  switch (change.kind) {
    case 'evidence':
      next.evidence_ids = toggled(next.evidence_ids, change.id, change.on);
      break;
    case 'skill':
      next.skills = toggled(next.skills, change.name, change.on);
      break;
    case 'interests':
      next.share_interests = change.on;
      break;
    case 'note':
      // 过不了 checkCollaborationNote 的说明（太长、像联系方式）不写进去，保留原来的说明；页面先检查并显示原因。
      if (checkCollaborationNote(change.note) === null) next.collaboration_note = cleanNote(change.note);
      break;
  }
  return next;
}

/** 发布者视图的一节（四个类别各一节；没分享的那一节 `items` 为空）。 */
export type PreviewCategory = 'evidence' | 'skills' | 'interests' | 'collaboration';

/**
 * 发布者视图的一行。每个字符串都直接取自视图（标题、技能名、兴趣、说明）或固定的标签表（种类、状态、等级），
 * 不拼接新的句子，这样测试可以逐个叶子核对来源。页面显示时用 " · " 连接 `details`，`skills` 前加 "Skills:"。
 */
export interface PreviewItem {
  primary: string;
  details: string[];
  skills: string[];
}

export interface PreviewSection {
  category: PreviewCategory;
  heading: string;
  items: PreviewItem[];
}

export type SharedPreview =
  | { empty: true; message: string }
  | { empty: false; alias: string; share_handle: string; is_sample: boolean; sections: PreviewSection[] };

function evidenceItem(e: Pick<EvidenceItem, 'title' | 'kind' | 'skills' | 'status'>): PreviewItem {
  return {
    primary: e.title,
    details: [labelOf(EVIDENCE_KIND_LABELS, e.kind), labelOf(EVIDENCE_STATUS_LABELS, e.status)],
    skills: strings(e.skills),
  };
}

const textItem = (primary: string): PreviewItem => ({ primary, details: [], skills: [] });

/**
 * 发布者端预览：只用 `buildSharedProfileView(profile, settings)` 的输出（不读档案的其他字段）。
 * 视图为 null（默认、撤回、设置属于别的档案、勾选的都不存在……）→ `{ empty: true }`。
 * 证据只显示标题、种类、状态与技能（证据 id 不显示）；顺序与档案一致，不排序、不打分。
 */
export function sharedProfilePreview(profile: StudentProfile, settings: ShareSettings | null): SharedPreview {
  let view: ReturnType<typeof buildSharedProfileView> = null;
  try {
    view = buildSharedProfileView(profile, settings);
  } catch {
    view = null;
  }
  if (view === null) return { empty: true, message: NOT_SHARING_TEXT };
  return {
    empty: false,
    alias: view.alias,
    share_handle: view.share_handle,
    is_sample: view.is_sample,
    sections: [
      { category: 'evidence', heading: 'Evidence', items: view.evidence.map(evidenceItem) },
      {
        category: 'skills',
        heading: 'Skills',
        items: view.skills.map((s) => ({ primary: s.name, details: [labelOf(SKILL_LEVEL_LABELS, s.level)], skills: [] })),
      },
      { category: 'interests', heading: 'Interests', items: view.interests.map(textItem) },
      {
        category: 'collaboration',
        heading: 'Collaboration note',
        items: view.collaboration_note === null ? [] : [textItem(view.collaboration_note)],
      },
    ],
  };
}

// ───────────────────────────── 合作说明的检查 ─────────────────────────────

/** 合作说明的长度上限（页面 textarea 的 maxLength 用同一个数）。 */
export const TALENT_NOTE_MAX = 1000;

const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_RE = /(?:https?:\/\/|www\.)\S|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|edu|gov|io|me|co|us|info|app|dev|ly)\b/i;
/** 7 位以上数字（数字之间可有一个空格、点、括号或连字符）。先去掉 YYYY-MM-DD 日期，免得把日期当成电话号码。 */
const PHONE_RE = /\d(?:[\s().-]?\d){6,}/;
const ISO_DATE_RE = /\b\d{4}-\d{2}-\d{2}\b/g;

const AS_WRITTEN = 'The note is shown exactly as written.';

/**
 * 分享合作说明之前的检查：返回给学生看的英文问题，没有问题时返回 null。
 * 拒绝：超过 TALENT_NOTE_MAX 个字符；看起来像电子邮箱、网址或电话号码（7 位以上数字）的内容。
 * 空白说明不算问题（等于不分享说明）。
 */
export function checkCollaborationNote(note: string | null): string | null {
  if (typeof note !== 'string' || note.trim() === '') return null;
  if (note.length > TALENT_NOTE_MAX) return `Keep the note under ${TALENT_NOTE_MAX} characters.`;
  if (EMAIL_RE.test(note)) return `Remove the email address before sharing. ${AS_WRITTEN}`;
  if (URL_RE.test(note)) return `Remove the web address before sharing. ${AS_WRITTEN}`;
  if (PHONE_RE.test(note.replace(ISO_DATE_RE, ' '))) return `Remove the phone number before sharing. ${AS_WRITTEN}`;
  return null;
}
