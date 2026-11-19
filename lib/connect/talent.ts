/**
 * Talent Board 的纯逻辑（本地示例，没有真实发布者，也不发生任何联系）。
 *
 * - 学生端「What I share」：`shareChoices` 把档案 + 分享设置整理成可勾选的项（按 ShareSettings 的字段：
 *   evidence_ids / skills / share_interests / collaboration_note），`applyShareChange` 返回改一项之后的新设置。
 * - 发布者端「Shared profile」：`sharedProfilePreview` 只渲染 `buildSharedProfileView`（lib/store.ts，纯函数）的输出，
 *   逐字段整理成行；什么都没分享时为空。这里不读档案的其他字段，所以未授权的内容不可能出现在结果里。
 * - 不排序、不打分、不算「匹配度」：证据、技能、兴趣保持档案里的原顺序。
 * - 发布者视图一律经过 `publisherView`（对所有档案）：证据 id 换成按位置编号的 `evidence-1`、`evidence-2`……
 *   （示例 id 可能含名字或档案 id 片段）；像联系方式的技能名、兴趣、证据技能（`checkCollaborationNote` 不通过的字符串）
 *   直接去掉；同样不通过检查的合作说明（例如导入的旧数据）也不显示。
 * - 受保护的档案（./protection 的 protectionFor）：合作说明不分享（已保存的说明留在设置里，但不进发布者视图、
 *   不进任何邀请）；发布者视图里的证据不显示标题（只显示种类、状态、技能）。
 * - `shareChoices` / `applyShareChange` / `sharedProfilePreview` / `publisherView` 的 protection 参数是必填的，
 *   失败时从严：只有显式的 `protected === false` 才按不受保护处理。
 *
 * 纯函数：日期由调用方传入，不读时钟、不读写存储、永不抛异常、不修改输入。
 */
import { buildSharedProfileView } from '../store';
import type { EvidenceItem, ISODate, ShareSettings, SharedProfileView, StudentProfile } from '../types';
import { EVIDENCE_KIND_LABELS, EVIDENCE_STATUS_LABELS, SKILL_LEVEL_LABELS, labelOf } from './labels';
import { isUnprotected, type Protection } from './protection';

export const NOT_SHARING_TEXT = 'This student is not sharing anything.';

/** 学生端一个可勾选的项。`key` 是证据 id 或技能名（学生自己的浏览器里用，不进发布者视图）。 */
export interface ShareChoice {
  key: string;
  label: string;
  detail: string;
  checked: boolean;
  /** 这一项像联系方式，即使勾选，发布者也看不到（只有技能会是 true）。 */
  withheld: boolean;
}

export interface ShareChoices {
  evidence: ShareChoice[];
  skills: ShareChoice[];
  /** 档案里的兴趣（原写法）；`checked` = share_interests；`withheld` = 其中像联系方式、发布者看不到的那些。 */
  interests: { values: string[]; checked: boolean; withheld: string[] };
  /** 当前已保存的合作说明（空白视为 null）。受保护时它仍可能存在，但不分享。 */
  note: string | null;
  /** 可以分享合作说明（受保护时为 false）。 */
  note_allowed: boolean;
  /** 发布者此刻能看到合作说明（有说明且允许分享）。 */
  note_shared: boolean;
  /** 发布者此刻能看到任何东西（= publisherView 不为 null，已按保护规则过滤）。 */
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

/** 学生端：像联系方式、发布者看不到的项后面加的说明。 */
export const WITHHELD_DETAIL = 'Not shown to publishers (looks like contact details)';

/** 像联系方式（邮箱、网址、电话号码）或过长的字符串：发布者永远看不到。与合作说明用同一套检查。 */
export function looksLikeContact(s: string): boolean {
  return checkCollaborationNote(s) !== null;
}

const shownToPublisher = (s: unknown): s is string => typeof s === 'string' && !looksLikeContact(s);

/**
 * 发布者能看到的视图。所有档案：证据 id 换成 `evidence-<位置>`；像联系方式的技能名、兴趣、证据技能与合作说明去掉；
 * 去掉之后什么都不剩时为 null。受保护时：先把合作说明设为 null 再交给 buildSharedProfileView
 * （所以只分享了说明的受保护档案得到 null），并把证据标题清空，下游（预览、邀请理由）拿不到标题。
 * protection 只有显式 `protected === false` 才算不受保护。不修改输入；buildSharedProfileView 万一抛异常也返回 null。
 */
export function publisherView(
  profile: StudentProfile,
  settings: ShareSettings | null,
  protection: Protection,
): SharedProfileView | null {
  const strict = !isUnprotected(protection);
  const effective = strict && isObj(settings) ? { ...settings, collaboration_note: null } : settings;
  let view: SharedProfileView | null = null;
  try {
    view = buildSharedProfileView(profile, effective);
  } catch {
    return null;
  }
  if (view === null) return null;
  const evidence = view.evidence.map((e, i) => ({
    ...e,
    id: `evidence-${i + 1}`,
    title: strict ? '' : e.title,
    skills: strings(e.skills).filter(shownToPublisher),
  }));
  const skills = view.skills.filter((s) => shownToPublisher(s.name));
  const interests = strings(view.interests).filter(shownToPublisher);
  const note = !strict && shownToPublisher(view.collaboration_note) ? view.collaboration_note : null;
  if (evidence.length === 0 && skills.length === 0 && interests.length === 0 && note === null) return null;
  return { ...view, evidence, skills, interests, collaboration_note: note };
}

/** 学生端：档案里每条证据、每项技能、兴趣与合作说明的勾选状态。默认（settings 为 null）全部不勾。 */
export function shareChoices(
  profile: StudentProfile,
  settings: ShareSettings | null,
  protection: Protection,
): ShareChoices {
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
      withheld: false,
    });
  }

  const skills: ShareChoice[] = [];
  const seenSkills = new Set<string>();
  for (const s of Array.isArray(profile?.skills) ? (profile.skills as unknown[]) : []) {
    if (!isObj(s) || typeof s.name !== 'string' || seenSkills.has(s.name)) continue;
    seenSkills.add(s.name);
    const withheld = looksLikeContact(s.name);
    skills.push({
      key: s.name,
      label: s.name,
      detail: withheld
        ? `${labelOf(SKILL_LEVEL_LABELS, s.level)} · ${WITHHELD_DETAIL}`
        : labelOf(SKILL_LEVEL_LABELS, s.level),
      checked: skillNames.has(s.name),
      withheld,
    });
  }

  const interests = strings(profile?.interests);
  const note = cleanNote(own?.collaboration_note);
  const noteAllowed = isUnprotected(protection);
  return {
    evidence,
    skills,
    interests: { values: interests, checked: own?.share_interests === true, withheld: interests.filter(looksLikeContact) },
    note,
    note_allowed: noteAllowed,
    note_shared: noteAllowed && note !== null,
    anything_shared: publisherView(profile, own, protection) !== null,
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
 * 受保护时（protection 不是显式的 `protected === false`）不能写入新的说明（保留原值，不删除学生的数据）；
 * 删除说明（note 为 null 或空白）仍然可以。用 `shareChangeApplied` 判断这一项是否真的改成了想要的样子。
 */
export function applyShareChange(
  base: ShareSettings,
  change: ShareChange,
  today: ISODate,
  protection: Protection,
): ShareSettings {
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
    case 'note': {
      // 过不了 checkCollaborationNote 的说明（太长、像联系方式）不写进去，保留原来的说明；页面先检查并显示原因。
      // 受保护时只允许删除说明，不允许写入新说明。
      const cleaned = cleanNote(change.note);
      if (cleaned !== null && !isUnprotected(protection)) break;
      if (checkCollaborationNote(change.note) === null) next.collaboration_note = cleaned;
      break;
    }
  }
  return next;
}

/** `applyShareChange` 的结果里，这一项是否真的是学生想要的样子（说明可能因受保护或检查不通过而没写进去）。 */
export function shareChangeApplied(change: ShareChange, next: ShareSettings): boolean {
  switch (change.kind) {
    case 'evidence':
      return strings(next?.evidence_ids).includes(change.id) === change.on;
    case 'skill':
      return strings(next?.skills).includes(change.name) === change.on;
    case 'interests':
      return next?.share_interests === change.on;
    case 'note':
      return cleanNote(next?.collaboration_note) === cleanNote(change.note);
  }
}

/** 读回确认：两份设置在分享相关的字段上完全一致（证据、技能按顺序比较）。 */
export function sameShareSettings(a: ShareSettings | null, b: ShareSettings | null): boolean {
  if (!isObj(a) || !isObj(b)) return false;
  const sameList = (x: unknown, y: unknown) => {
    const xs = strings(x);
    const ys = strings(y);
    return xs.length === ys.length && xs.every((v, i) => v === ys[i]);
  };
  return (
    a.profile_id === b.profile_id &&
    a.share_handle === b.share_handle &&
    sameList(a.evidence_ids, b.evidence_ids) &&
    sameList(a.skills, b.skills) &&
    a.share_interests === b.share_interests &&
    (a.collaboration_note ?? null) === (b.collaboration_note ?? null)
  );
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

/** 受保护时的证据行：不显示标题，种类作主行、状态作补充，技能照常。 */
function evidenceItemWithoutTitle(e: Pick<EvidenceItem, 'kind' | 'skills' | 'status'>): PreviewItem {
  return {
    primary: labelOf(EVIDENCE_KIND_LABELS, e.kind),
    details: [labelOf(EVIDENCE_STATUS_LABELS, e.status)],
    skills: strings(e.skills),
  };
}

const textItem = (primary: string): PreviewItem => ({ primary, details: [], skills: [] });

/**
 * 发布者端预览：只用 `buildSharedProfileView(profile, settings)` 的输出（不读档案的其他字段）。
 * 视图为 null（默认、撤回、设置属于别的档案、勾选的都不存在……）→ `{ empty: true }`。
 * 证据只显示标题、种类、状态与技能（证据 id 不显示）；顺序与档案一致，不排序、不打分。
 * 受保护时（见 publisherView）：合作说明一节为空，证据不显示标题；只分享了说明时整个预览为空。
 * 像联系方式的技能名、兴趣、证据技能对所有档案都不显示。
 */
export function sharedProfilePreview(
  profile: StudentProfile,
  settings: ShareSettings | null,
  protection: Protection,
): SharedPreview {
  const view = publisherView(profile, settings, protection);
  if (view === null) return { empty: true, message: NOT_SHARING_TEXT };
  const strict = !isUnprotected(protection);
  return {
    empty: false,
    alias: view.alias,
    share_handle: view.share_handle,
    is_sample: view.is_sample,
    sections: [
      { category: 'evidence', heading: 'Evidence', items: view.evidence.map(strict ? evidenceItemWithoutTitle : evidenceItem) },
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
