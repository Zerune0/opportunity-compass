/**
 * Talent Board 的示例邀请（本地演示：发布者都是虚构的，没有真实联系，也不发送任何举报）。
 *
 * - `invitationReasons(view)`：可解释的理由，只由学生分享的内容拼成（技能名、证据条数、兴趣、是否写了说明）。
 *   view 必须是 ./talent 的 `publisherView`（已按保护规则过滤、去掉了像联系方式的字符串）。不含分数、名次或「匹配度」，
 *   也不含证据标题、说明原文、档案 id、显示名、学校、出生日期。
 * - `planInvitation(request)`：发送前的全部检查 + 组装一条邀请。邀请只指向 share_handle（发布者不知道档案 id），
 *   `is_sample: true`、`status: 'pending'`、`sent_on = today`。对所有档案都一样：邀请必须针对该示例发布者
 *   在本浏览器发布的一个任务（规则不随档案变化，发布者无从推断学生是否未成年）。拒绝时返回给发布者看的英文原因：
 *   什么都没分享；没选示例发布者；被这个学生屏蔽；没选任务或任务不是该发布者在本浏览器发布的；
 *   同一发布者 + 同一任务已有待回应的邀请；学生已回应过（接受或拒绝）同一发布者 + 同一任务的邀请；id 或日期不可用。
 * - 发布者端页面上的全部固定文字也在这里（PUBLISHER_PANE_TEXT 等），测试逐条确认它们不透露保护状态。
 * - `publisherQuests`：某示例发布者在本浏览器发布的任务。
 * - `invitationList`：学生端列表（隐藏已屏蔽的发布者）与已屏蔽的发布者名单。任务只在「该邀请的发布者」发布的任务里找；
 *   找不到（任务已撤回、id 属于别的发布者、或没有任务）时不能接受，只能拒绝或屏蔽。
 * - `actionsFor` / `ACTION_STATUS` / `actionMessage`：学生的四个操作。「Report and block」与「Block」写入的都是
 *   `blocked` 状态：没有举报的存储，也不发送任何举报。
 *
 * 纯函数：日期与 id 由调用方传入；不读时钟、无随机、不读写存储、永不抛异常、不修改输入。
 */
import { parseISODate } from '../eligibility/dates';
import { joinAnd, plural } from '../format';
import type { ISODate, Invitation, InvitationStatus, Opportunity, SamplePublisher, SharedProfileView } from '../types';
import { isUnprotected, type Protection } from './protection';
import { postedThroughConnect } from './quest-form';

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
/** 类型化的数组兜底：不是数组时为 []（元素仍需逐个检查）。 */
const arr = <T>(v: readonly T[] | null | undefined): readonly T[] => (Array.isArray(v) ? v : []);
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const unique = (xs: string[]): string[] => Array.from(new Set(xs));
const quoted = (s: string) => `"${s}"`;

// ───────────────────────────── 理由 ─────────────────────────────

/**
 * 邀请理由（第二人称，给学生看）：每类分享内容至多一句，顺序固定（技能、证据、兴趣、说明）。
 * 技能与兴趣原样加引号；证据只给条数；说明只说「分享了」，不引用原文。view 为 null 时为 []。
 */
export function invitationReasons(view: SharedProfileView | null): string[] {
  if (!isObj(view)) return [];
  const out: string[] = [];
  const skills = unique(
    list(view.skills)
      .filter(isObj)
      .map((s) => s.name)
      .filter(nonEmpty),
  );
  if (skills.length > 0) out.push(`You shared ${skills.length === 1 ? 'the skill' : 'the skills'} ${joinAnd(skills.map(quoted))}.`);
  const evidence = list(view.evidence).filter(isObj).length;
  if (evidence > 0) out.push(`You shared ${plural(evidence, 'piece of evidence', 'pieces of evidence')}.`);
  const interests = unique(list(view.interests).filter(nonEmpty));
  if (interests.length > 0) {
    out.push(`You shared ${interests.length === 1 ? 'the interest' : 'the interests'} ${joinAnd(interests.map(quoted))}.`);
  }
  if (nonEmpty(view.collaboration_note)) out.push('You shared a collaboration note.');
  return out;
}

// ───────────────────────────── 发布者端：发送 ─────────────────────────────

/** 某示例发布者在本浏览器发布的任务（只算经 Connect 发布、posted_by 是示例发布者的），顺序不变。 */
export function publisherQuests<T extends { posted_by?: string | null }>(
  stored: readonly T[],
  publisherId: string,
  publishers: readonly SamplePublisher[],
): T[] {
  if (!nonEmpty(publisherId)) return [];
  return postedThroughConnect(
    arr(stored).filter((o) => isObj(o)),
    arr(publishers).filter((p) => isObj(p)),
  ).filter((o) => o.posted_by === publisherId);
}

export const NOTHING_SHARED_REFUSAL = 'Not sent. This student is not sharing anything.';
export const CHOOSE_PUBLISHER_REFUSAL = 'Choose a sample publisher.';
export const BLOCKED_REFUSAL = 'Not sent. This student has blocked this sample publisher.';
/** 没选任务，或选的任务不是该发布者在本浏览器发布的（对所有档案同一句）。 */
export const QUEST_REQUIRED_REFUSAL = "Not sent. Choose one of this sample publisher's posted quests.";
export const DUPLICATE_QUEST_REFUSAL =
  'Not sent. This sample publisher already has an invitation about this quest waiting for an answer.';
export const ANSWERED_REFUSAL = 'Not sent. This student already answered an invitation about this quest.';
export const TRY_AGAIN_REFUSAL = 'Not sent. Could not create the invitation. Try again.';

/** planInvitation 可能返回的全部拒绝原因（测试逐条检查不透露保护状态）。 */
export const PUBLISHER_REFUSALS: readonly string[] = [
  NOTHING_SHARED_REFUSAL,
  CHOOSE_PUBLISHER_REFUSAL,
  BLOCKED_REFUSAL,
  QUEST_REQUIRED_REFUSAL,
  DUPLICATE_QUEST_REFUSAL,
  ANSWERED_REFUSAL,
  TRY_AGAIN_REFUSAL,
];

/** 发布者端「Send a sample invitation」表单上的全部固定文字。对所有档案都相同。 */
export const PUBLISHER_PANE_TEXT = {
  heading: 'Send a sample invitation',
  intro: 'The invitation goes to the anonymous handle only. It is saved in this browser and no one is contacted.',
  publisherLabel: 'Sample publisher',
  publisherPlaceholder: 'Choose a sample publisher',
  questLabel: 'Quest',
  questPlaceholder: 'Choose a quest',
  questsHint: 'Only quests this sample publisher posted in this browser are listed.',
  noQuests: 'This sample publisher has no quests posted in this browser.',
  postQuestLink: 'Post a quest in Quest Creator',
  submit: 'Send sample invitation',
  saveFailed: "Could not save to this browser's storage. No invitation was added.",
} as const;

/** 发送成功后的提示。 */
export function sentMessage(publisherDisplayName: string): string {
  return (
    `Sample invitation from ${publisherDisplayName} saved in this browser. ` +
    'It is listed under Invitations on the student side. No one was contacted.'
  );
}

export interface InvitationRequest {
  /** 选中的示例发布者 id（'' = 没选）。 */
  publisher_id: string;
  /** 选中的任务 id；null / '' = 没选（一律拒绝）。 */
  quest_id: string | null;
  publishers: readonly SamplePublisher[];
  /** 本浏览器里用户发布的机会（loadUserPostedOpportunities）。 */
  stored_quests: readonly Pick<Opportunity, 'id' | 'posted_by'>[];
  /** ./talent 的 publisherView(profile, settings, protection)：已按保护规则过滤。 */
  view: SharedProfileView | null;
  /** 只用来再保险：受保护时理由里不提合作说明。 */
  protection: Protection;
  /** 本浏览器里的全部邀请（loadInvitations()）：查重与 id 冲突。 */
  existing: readonly Invitation[];
  /** blockedPublisherIds(view.share_handle)。 */
  blocked: readonly string[];
  today: ISODate;
  /** 新邀请的 id（页面在事件处理里由 crypto.randomUUID() 生成）。 */
  id: string;
}

export type InvitationPlan = { ok: true; invitation: Invitation } | { ok: false; message: string };

/** 发送前的全部检查 + 组装。通过时返回可直接交给 addInvitation 的邀请；否则什么都不该保存。 */
export function planInvitation(req: InvitationRequest): InvitationPlan {
  const view = isObj(req?.view) && nonEmpty(req.view.share_handle) ? req.view : null;
  if (view === null) return { ok: false, message: NOTHING_SHARED_REFUSAL };
  const publisher = arr(req.publishers).find(
    (p) => isObj(p) && nonEmpty(p.id) && p.id === req.publisher_id && p.is_sample === true,
  );
  if (!publisher) return { ok: false, message: CHOOSE_PUBLISHER_REFUSAL };

  const existing = arr(req.existing).filter((i) => isObj(i));
  const sameStudentAndPublisher = existing.filter(
    (i) => i.share_handle === view.share_handle && i.publisher_id === publisher.id,
  );
  // 屏蔽：调用方给的名单，再加上存储里这个句柄状态为 blocked 的邀请（两处任一说屏蔽就拒绝）。
  if (arr(req.blocked).includes(publisher.id) || sameStudentAndPublisher.some((i) => i.status === 'blocked')) {
    return { ok: false, message: BLOCKED_REFUSAL };
  }

  // 对所有档案：必须是该发布者在本浏览器发布的任务。
  const questId = nonEmpty(req.quest_id) ? req.quest_id : null;
  if (questId === null || !publisherQuests(req.stored_quests, publisher.id, req.publishers).some((o) => o.id === questId)) {
    return { ok: false, message: QUEST_REQUIRED_REFUSAL };
  }

  const sameQuest = sameStudentAndPublisher.filter((i) => i.opportunity_id === questId);
  if (sameQuest.some((i) => i.status === 'pending')) return { ok: false, message: DUPLICATE_QUEST_REFUSAL };
  if (sameQuest.some((i) => i.status === 'declined' || i.status === 'accepted')) return { ok: false, message: ANSWERED_REFUSAL };

  if (!nonEmpty(req.id) || existing.some((i) => i.id === req.id) || parseISODate(req.today) === null) {
    return { ok: false, message: TRY_AGAIN_REFUSAL };
  }

  // 受保护时即使调用方给了未过滤的视图，理由里也不提合作说明；理由为空 = 实际上没有可分享的内容。
  const strict = !isUnprotected(req.protection);
  const reasons = invitationReasons(strict ? { ...view, collaboration_note: null } : view);
  if (reasons.length === 0) return { ok: false, message: NOTHING_SHARED_REFUSAL };

  return {
    ok: true,
    invitation: {
      id: req.id,
      publisher_id: publisher.id,
      share_handle: view.share_handle,
      opportunity_id: questId,
      reasons,
      status: 'pending',
      is_sample: true,
      sent_on: req.today,
      responded_on: null,
    },
  };
}

// ───────────────────────────── 学生端：列表与操作 ─────────────────────────────

export const UNKNOWN_PUBLISHER = 'Unknown sample publisher';

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  pending: 'Waiting for your answer',
  accepted: 'Accepted',
  declined: 'Declined',
  blocked: 'Blocked',
};

/** 以前接受过、但它的任务现在找不到了：用这句代替单纯的 "Accepted"。 */
export const ACCEPTED_QUEST_GONE_LABEL = 'Accepted earlier. Its quest is no longer posted in this browser.';

/** 待回应、但任务找不到（不能接受）时的说明。 */
export const NOT_ACCEPTABLE_NOTICE =
  'This invitation is not about a quest this sample publisher has posted in this browser, so it cannot be accepted.';

/** 「Report and block」按钮下的说明。 */
export const REPORT_HINT =
  'Report and block blocks the publisher. This is a local demo, so no report is sent to anyone. ' +
  'If something worried you, talk with a parent, guardian or teacher.';

/**
 * 邀请针对的任务：none = 邀请没有任务 id（旧数据）；stored = 该邀请的发布者在本浏览器发布了这个任务（可以链接、可以接受）；
 * missing = 有任务 id，但不在该发布者发布的任务里（已撤回、属于别的发布者、或从没有过）。
 */
export type InvitationQuest = { kind: 'none' } | { kind: 'stored'; id: string; title: string } | { kind: 'missing' };

export type InvitationAction = 'accept' | 'decline' | 'block' | 'report';

export interface InvitationRow {
  id: string;
  publisher_id: string;
  publisher_name: string;
  quest: InvitationQuest;
  reasons: string[];
  status: InvitationStatus;
  status_label: string;
  /** 需要额外说明时的一句话（例如为什么不能接受）；没有为 null。 */
  notice: string | null;
  sent_on: string;
  /** 这一行可用的操作（顺序即按钮顺序）。 */
  actions: InvitationAction[];
}

export interface InvitationList {
  rows: InvitationRow[];
  /** 已屏蔽的示例发布者名称（去重，按 blocked 的顺序）。 */
  blocked_publishers: string[];
}

/** 示例发布者的名称；找不到时为 UNKNOWN_PUBLISHER。 */
export function publisherName(publishers: readonly SamplePublisher[], id: string): string {
  const found = arr(publishers).find((p) => isObj(p) && p.id === id);
  return found && nonEmpty(found.name) ? found.name : UNKNOWN_PUBLISHER;
}

/**
 * 某一行可用的操作：待回应且任务找得到时 Accept / Decline / Block / Report and block；
 * 待回应但任务找不到时没有 Accept；已回应时只剩 Block / Report and block。对所有档案都一样。
 */
export function actionsFor(status: InvitationStatus, quest: InvitationQuest): InvitationAction[] {
  if (status === 'blocked') return [];
  if (status !== 'pending') return ['block', 'report'];
  return quest?.kind === 'stored' ? ['accept', 'decline', 'block', 'report'] : ['decline', 'block', 'report'];
}

/** 已屏蔽的示例发布者那一行文字（单复数一致）；没有屏蔽时为 null。 */
export function blockedLine(names: readonly string[]): string | null {
  const shown = arr(names).filter(nonEmpty);
  if (shown.length === 0) return null;
  return shown.length === 1
    ? `Blocked sample publisher: ${shown[0]}. Its invitations are hidden and it cannot send you new ones.`
    : `Blocked sample publishers: ${joinAnd(shown)}. Their invitations are hidden and they cannot send you new ones.`;
}

/**
 * 学生端列表：只列 share_handle 相同的邀请，隐藏已屏蔽发布者的全部邀请（状态为 blocked 的也就不显示）。
 * 顺序与存储一致。share_handle 为 null（这个档案从没保存过分享设置）时为空。
 */
export function invitationList(input: {
  invitations: readonly Invitation[];
  share_handle: string | null;
  blocked: readonly string[];
  publishers: readonly SamplePublisher[];
  stored_quests: readonly Pick<Opportunity, 'id' | 'title' | 'posted_by'>[];
}): InvitationList {
  const handle = nonEmpty(input?.share_handle) ? input.share_handle : null;
  const blocked = unique(list(input?.blocked).filter(nonEmpty));
  const blockedSet = new Set(blocked);
  const rows: InvitationRow[] = [];
  if (handle !== null) {
    for (const inv of arr(input.invitations)) {
      if (!isObj(inv) || inv.share_handle !== handle || !nonEmpty(inv.id) || !nonEmpty(inv.publisher_id)) continue;
      if (blockedSet.has(inv.publisher_id) || inv.status === 'blocked') continue;
      const status: InvitationStatus =
        inv.status === 'accepted' || inv.status === 'declined' || inv.status === 'pending' ? inv.status : 'pending';
      const questId = nonEmpty(inv.opportunity_id) ? inv.opportunity_id : null;
      // 只在「这条邀请的发布者」发布的任务里找。
      const owned =
        questId === null
          ? undefined
          : publisherQuests(input.stored_quests, inv.publisher_id, input.publishers).find((q) => q.id === questId);
      const quest: InvitationQuest =
        questId === null
          ? { kind: 'none' }
          : owned && typeof owned.title === 'string'
            ? { kind: 'stored', id: questId, title: owned.title }
            : { kind: 'missing' };
      const resolved = quest.kind === 'stored';
      rows.push({
        id: inv.id,
        publisher_id: inv.publisher_id,
        publisher_name: publisherName(input.publishers, inv.publisher_id),
        quest,
        reasons: list(inv.reasons).filter(nonEmpty),
        status,
        status_label: status === 'accepted' && !resolved ? ACCEPTED_QUEST_GONE_LABEL : INVITATION_STATUS_LABELS[status],
        notice: status === 'pending' && !resolved ? NOT_ACCEPTABLE_NOTICE : null,
        sent_on: typeof inv.sent_on === 'string' ? inv.sent_on : '',
        actions: actionsFor(status, quest),
      });
    }
  }
  return { rows, blocked_publishers: unique(blocked.map((id) => publisherName(input?.publishers ?? [], id))) };
}

/** 学生的操作 → 写入的状态。「Report and block」只是屏蔽：没有举报的存储。 */
export const ACTION_STATUS: Record<InvitationAction, InvitationStatus> = {
  accept: 'accepted',
  decline: 'declined',
  block: 'blocked',
  report: 'blocked',
};

export const ACTION_LABELS: Record<InvitationAction, string> = {
  accept: 'Accept',
  decline: 'Decline',
  block: 'Block this publisher',
  report: 'Report and block',
};

/** 操作成功后的提示（英文，给学生看）：每一句都写明本地演示里没有发送任何东西。 */
export function actionMessage(action: InvitationAction, name: string): string {
  switch (action) {
    case 'accept':
      return `Accepted the sample invitation from ${name}. In this local demo nothing is sent and no one is contacted.`;
    case 'decline':
      return `Declined the sample invitation from ${name}. In this local demo nothing is sent and no one is contacted.`;
    case 'block':
      return `Blocked ${name}. Its invitations are hidden and it cannot send you new ones. Nothing is sent to anyone.`;
    case 'report':
      return (
        `Blocked ${name}. This is a local demo, so no report is sent to anyone. ` +
        'If something worried you, talk with a parent, guardian or teacher.'
      );
  }
}
