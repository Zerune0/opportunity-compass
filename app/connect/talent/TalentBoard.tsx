"use client";

/**
 * Talent Board（客户端组件，本地演示）：同一页上两块明确分开的视图。
 *
 * 1. 学生端「What I share」：本浏览器里载入的档案，按 ShareSettings 的字段逐项开关（证据、技能、兴趣、合作说明）。
 *    默认全部不分享。打开页面只读取（loadShareSettings / loadInvitations），不会创建任何分享设置或邀请；
 *    第一次打开某个开关时才用 defaultShareSettings 新建并 saveShareSettings 保存。
 *    「Stop sharing everything」= clearShareSettings(profileId, today)（契约定义的撤回：恢复默认、保留句柄，
 *    所以已收到的邀请仍然对得上）。
 *    合作说明分享前先过 checkCollaborationNote（长度、像邮箱 / 网址 / 电话号码的内容一律拒绝）。
 *    说明草稿按档案 id 记：别的标签页换了档案时，旧档案没发出的草稿不会出现在新档案上。
 *    像联系方式的技能名 / 兴趣即使勾选，发布者也看不到（页面写明）。
 *    发布者对所有档案都看不到证据标题（页面写明）。
 *    受保护的档案（lib/connect/protection.ts：未满 18、12 年级及以下、或年龄未知）：显示提示；
 *    合作说明不能分享（输入框禁用）；挂载后第一次读取时，若分享设置里还存着以前写的说明，就用
 *    collaborationNoteToClear + saveShareSettings 把它清掉（其他选择不动）并显示 NOTE_REMOVED_NOTICE——
 *    这样以后不再受保护时，说明不会在学生没有重新同意的情况下自动重新分享；
 *    分享区顶部多一个「已经和家长 / 监护人 / 老师谈过」的复选框，没勾选时各分享开关禁用（canChangeSharing），
 *    已开着的分享不变，「Stop sharing everything」始终可用；勾选只放在组件状态里，每次打开页面要重新确认。
 *    「Invitations」：按本档案的 share_handle 列出示例邀请，隐藏已屏蔽的发布者（invitationList），再按保护状态分组
 *    （invitationInbox）：受保护时待回应的邀请先收起，只显示条数，点「Review held invitations with a trusted adult」
 *    才展开（组件状态，不存储），展开后只能 Decline / Block，不能 Accept。Accept / Decline / Block / Unblock
 *    都只改邀请状态（setInvitationStatus），没有举报，也不发送任何东西。任务找不到的邀请不能接受。
 *    已屏蔽的示例发布者各有一个 Unblock 按钮：把它 blocked 的邀请改回 declined。
 * 2. 发布者端「Shared profile」：只渲染 lib/connect/talent.ts 的 publisherView 整理出的预览（sharedProfilePreview）；
 *    什么都没分享时立即为空。有分享内容时可以选示例发布者及其在本浏览器发布的任务，发一条示例邀请：
 *    对所有档案规则与反馈完全相同（受保护的档案照样保存 pending 邀请，只在学生端收起），发布者端不透露保护状态；只指向 share_handle，理由只由分享的内容拼成
 *    （lib/connect/invitations.ts）。发布者端的固定文字都来自 PUBLISHER_PANE_TEXT。
 *    不排序、不打分，也没有任何「匹配度」。
 *
 * 浏览器数据在挂载后用 setTimeout 读取，并在 focus / storage / pageshow 时重读；服务器渲染与首次客户端渲染一致。
 * 今天的日期只在这些回调与事件处理里取（存进 state 供渲染使用）。
 * 每次写入（分享设置、撤回、发送邀请、回应邀请）之后都重新读取存储，与想要的结果比较后才显示成功。
 * 三条状态消息（role="status"）始终渲染，不随条件区块卸载；操作后焦点移到对应的状态消息。
 * 没有真实发布者，没有任何联系发生。
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ACTION_LABELS,
  ACTION_STATUS,
  BLOCK_HINT,
  PUBLISHER_PANE_TEXT,
  REVIEW_HELD_LABEL,
  actionMessage,
  blockedLine,
  heldNotice,
  inboxAllows,
  invitationInbox,
  invitationList,
  planInvitation,
  publisherName,
  publisherQuests,
  sentMessage,
  unblockTargets,
} from "@/lib/connect/invitations";
import type { InvitationAction, InvitationRow } from "@/lib/connect/invitations";
import {
  EVIDENCE_TITLE_NOTICE,
  GUARDIAN_ADVICE,
  NOTE_REMOVED_NOTICE,
  PROTECTION_EFFECTS,
  SHARING_CONFIRM_LABEL,
  SHARING_LOCKED_REASON,
  canChangeSharing,
  collaborationNoteToClear,
  exactlyAsWrittenWarning,
  isUnprotected,
  protectionFor,
  protectionNotice,
  unprotected,
} from "@/lib/connect/protection";
import {
  NOT_SHARING_TEXT,
  TALENT_NOTE_MAX,
  WITHHELD_DETAIL,
  applyShareChange,
  checkCollaborationNote,
  publisherView,
  sameShareSettings,
  shareChangeApplied,
  shareChoices,
  sharedProfilePreview,
} from "@/lib/connect/talent";
import type { PreviewItem, ShareChange, ShareChoice } from "@/lib/connect/talent";
import {
  addInvitation,
  blockedPublisherIds,
  clearShareSettings,
  defaultShareSettings,
  loadInvitations,
  loadProfile,
  loadShareSettings,
  loadUserPostedOpportunities,
  saveShareSettings,
  setInvitationStatus,
} from "@/lib/store";
import type { Invitation, Opportunity, SamplePublisher, ShareSettings, StudentProfile } from "@/lib/types";
import { localToday } from "../today";

const BUTTON_CLASS =
  "min-h-11 rounded border border-gray-400 px-3 py-1.5 text-left hover:border-gray-700 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-600";
const TAG_CLASS = "rounded border border-amber-700 px-1.5 text-xs text-amber-900";
const CHOICE_CLASS = "flex min-h-11 cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-50";
const SELECT_CLASS = "min-h-11 w-full rounded border border-gray-400 px-2 py-1";

const CHECKING_TEXT = "Checking this browser's local data…";
const SAVE_FAILED = "Could not save to this browser's storage. Nothing was changed.";
const CONFIRM_FAILED = "Could not confirm the change in this browser's storage. Check the page and try again.";
const STOP_FAILED = "Could not update this browser's storage. Check the preview: it may still show shared items.";
const DATA_CHANGED = "The profile in this browser changed, so nothing was saved. Check the page and try again.";
const NOTE_LOCKED = "Stricter defaults apply, so a collaboration note cannot be shared.";
const NOTE_NOT_SHARED = "The note was not shared.";
const INVITATION_CHANGED = "This invitation changed or is no longer in this browser. The list is updated.";

/** 本浏览器里读到的数据；null = 还没读。`today` 在读取时取（回调里），供渲染时判断保护规则。 */
type LocalData = {
  profile: StudentProfile | null;
  settings: ShareSettings | null;
  today: string;
  /** 这个档案的 share_handle 收到的邀请（没有分享设置时为空）。 */
  invitations: Invitation[];
  blocked: string[];
  /** 本浏览器里用户发布的机会（发布者端选任务、学生端链接任务）。 */
  quests: Opportunity[];
};

/** 合作说明的草稿，记着属于哪个档案。 */
type NoteDraft = { profileId: string; text: string };

type FocusTarget = "share" | "publisher" | "invitations";

/** 读取与这个档案有关的全部本地数据。会读系统时钟，只在挂载后的回调与事件处理里调用。 */
function readLocal(profile: StudentProfile | null): LocalData {
  const settings = profile ? loadShareSettings(profile.id) : null;
  const handle = settings?.share_handle ?? null;
  return {
    profile,
    settings,
    today: localToday(),
    invitations: handle ? loadInvitations(handle) : [],
    blocked: handle ? blockedPublisherIds(handle) : [],
    quests: loadUserPostedOpportunities(),
  };
}

/** 邀请 id：优先 crypto.randomUUID()，不可用时回退 Math.random()。不读系统时钟；与已有 id 冲突时 planInvitation 会拒绝。 */
function newInvitationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `inv-${crypto.randomUUID()}`;
  return `inv-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}

export function TalentBoard({ publishers }: { publishers: SamplePublisher[] }) {
  const [local, setLocal] = useState<LocalData | null>(null);
  /** null = 跟随已保存的说明；只对 profileId 相同的档案生效。 */
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  /** 合作说明没通过检查的原因，同样记着属于哪个档案。 */
  const [noteError, setNoteError] = useState<{ profileId: string; message: string } | null>(null);
  const [message, setMessage] = useState("");
  const [inviteMessage, setInviteMessage] = useState("");
  const [publisherMessage, setPublisherMessage] = useState("");
  /** 发布者端：选中的示例发布者与任务（'' = 没选）。 */
  const [publisherId, setPublisherId] = useState("");
  const [questId, setQuestId] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; n: number } | null>(null);
  /** 受保护档案：已确认和可信任的大人谈过（只在组件状态里，按档案 id 记；不存储）。 */
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null);
  /** 受保护档案：收起的邀请已展开（只在组件状态里，按档案 id 记；不存储）。 */
  const [heldOpenFor, setHeldOpenFor] = useState<string | null>(null);
  /** 挂载时因受保护而清掉了存着的合作说明的档案 id（只在组件状态里；用于显示 NOTE_REMOVED_NOTICE）。 */
  const [noteRemovedFor, setNoteRemovedFor] = useState<string | null>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const inviteStatusRef = useRef<HTMLParagraphElement>(null);
  const publisherStatusRef = useRef<HTMLParagraphElement>(null);

  const refresh = useCallback(() => {
    setLocal(readLocal(loadProfile()));
  }, []);

  /**
   * 挂载后的第一次读取（setTimeout 里，不在渲染期间写存储）：受保护的档案若还存着合作说明，先把它从分享设置里清掉，
   * 保存成功并读回确认后才显示说明；然后照常读取。只在这一步做一次。
   */
  const initialLoad = useCallback(() => {
    const current = loadProfile();
    if (current) {
      const cleared = collaborationNoteToClear(loadShareSettings(current.id), protectionFor(current, localToday()));
      if (cleared && saveShareSettings(cleared) && sameShareSettings(loadShareSettings(current.id), cleared)) {
        setNoteRemovedFor(current.id);
      }
    }
    setLocal(readLocal(current));
  }, []);

  useEffect(() => {
    const initialRead = window.setTimeout(initialLoad);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.clearTimeout(initialRead);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [initialLoad, refresh]);

  useEffect(() => {
    if (focusRequest === null) return;
    const el =
      focusRequest.target === "share"
        ? statusRef.current
        : focusRequest.target === "invitations"
          ? inviteStatusRef.current
          : publisherStatusRef.current;
    el?.focus();
  }, [focusRequest]);

  const requestFocus = (target: FocusTarget) => setFocusRequest((prev) => ({ target, n: (prev?.n ?? 0) + 1 }));

  /** 点击时再读一次档案：别的标签页可能换了档案；对不上就不写，原因写进 report 指向的那条状态消息。 */
  const currentProfile = (report: (text: string) => void): StudentProfile | null => {
    const fresh = loadProfile();
    const shown = local?.profile ?? null;
    if (fresh === null || shown === null || fresh.id !== shown.id) {
      report(DATA_CHANGED);
      refresh();
      return null;
    }
    return fresh;
  };

  const profile = local?.profile ?? null;
  const settings = local?.settings ?? null;
  const protection = local && profile ? protectionFor(profile, local.today) : null;
  const strict = protection !== null && !isUnprotected(protection);
  const choices = profile && protection ? shareChoices(profile, settings, protection) : null;
  const preview = profile && protection ? sharedProfilePreview(profile, settings, protection) : null;
  const formShown = preview !== null && !preview.empty;
  const invitations =
    local && profile
      ? invitationList({
          invitations: local.invitations,
          share_handle: settings?.share_handle ?? null,
          blocked: local.blocked,
          publishers,
          stored_quests: local.quests,
        })
      : null;
  const inbox = invitations && protection ? invitationInbox(protection, invitations.rows) : null;
  const heldOpen = profile !== null && heldOpenFor === profile.id;
  const sharingConfirmed = profile !== null && confirmedFor === profile.id;
  const sharingUnlocked = protection !== null && canChangeSharing(protection, sharingConfirmed);
  const quests = local ? publisherQuests(local.quests, publisherId, publishers) : [];
  const draftText = profile && noteDraft && noteDraft.profileId === profile.id ? noteDraft.text : null;
  const noteValue = choices && !choices.note_allowed ? (choices.note ?? "") : (draftText ?? choices?.note ?? "");
  const noteProblem = profile && noteError && noteError.profileId === profile.id ? noteError.message : null;

  /**
   * 改一项分享设置：按刚读到的档案重新判断保护规则；applyShareChange 没按学生的意思改（例如受保护时的说明）就不保存，
   * 并如实说明；保存后读回，与想要的设置一致才显示成功。
   */
  const change = (c: ShareChange, done: string): boolean => {
    const fresh = currentProfile(setMessage);
    if (!fresh) return false;
    // 发布者表单此刻没显示：这次改动可能让它重新出现，先清掉上一轮的发布者消息。
    if (!formShown) setPublisherMessage("");
    const today = localToday();
    const freshProtection = protectionFor(fresh, today);
    // 受保护时，没确认过就不能改证据 / 技能 / 兴趣的开关（删除或分享说明另有规则）。
    if (c.kind !== "note" && !canChangeSharing(freshProtection, confirmedFor === fresh.id)) {
      setLocal(readLocal(fresh));
      setMessage(SHARING_LOCKED_REASON);
      return false;
    }
    // 第一次打开开关时才新建设置（默认什么都不分享），之后沿用已保存的句柄。
    const base = loadShareSettings(fresh.id) ?? defaultShareSettings(fresh.id, today);
    const next = applyShareChange(base, c, today, freshProtection);
    if (!shareChangeApplied(c, next)) {
      setLocal(readLocal(fresh));
      setMessage(isUnprotected(freshProtection) ? NOTE_NOT_SHARED : NOTE_LOCKED);
      return false;
    }
    const saved = saveShareSettings(next);
    const confirmed = saved && sameShareSettings(loadShareSettings(fresh.id), next);
    setLocal(readLocal(fresh));
    setMessage(confirmed ? done : saved ? CONFIRM_FAILED : SAVE_FAILED);
    return confirmed;
  };

  const stopAll = () => {
    const fresh = currentProfile(setMessage);
    if (!fresh) return;
    const today = localToday();
    const before = loadShareSettings(fresh.id);
    clearShareSettings(fresh.id, today);
    const after = loadShareSettings(fresh.id);
    setLocal(readLocal(fresh));
    setNoteDraft(null);
    setNoteError(null);
    // 读回确认时不套保护规则：要确认存储里的设置真的恢复了默认（包括受保护时不分享、但仍保存着的说明）。
    const stillShared = !sharedProfilePreview(fresh, after, unprotected()).empty;
    setMessage(
      stillShared
        ? STOP_FAILED
        : before === null
          ? "Nothing was being shared. A sample publisher sees nothing."
          : "Stopped sharing everything. A sample publisher would now see nothing and cannot send new invitations. Invitations you already received stay listed.",
    );
    requestFocus("share");
  };

  const shareNote = () => {
    if (!profile) return;
    const problem = checkCollaborationNote(noteValue);
    if (problem !== null) {
      setNoteError({ profileId: profile.id, message: problem });
      setMessage(NOTE_NOT_SHARED);
      return;
    }
    setNoteError(null);
    const text = noteValue.trim();
    const ok = change(
      { kind: "note", note: text },
      text === "" ? "The note is empty, so no note is shared." : "Sharing your collaboration note exactly as written.",
    );
    if (ok) setNoteDraft(null);
  };

  const removeNote = () => {
    setNoteError(null);
    const ok = change(
      { kind: "note", note: null },
      strict ? "Removed your saved collaboration note from this browser." : "Removed your collaboration note. It is no longer shared.",
    );
    if (ok) setNoteDraft(null);
  };

  /** 发布者端「Send sample invitation」：全部检查在 planInvitation 里；通过后 addInvitation 并读回确认。 */
  const sendInvitation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fresh = currentProfile(setPublisherMessage);
    if (!fresh) {
      requestFocus("publisher");
      return;
    }
    const today = localToday();
    const freshProtection = protectionFor(fresh, today);
    const freshSettings = loadShareSettings(fresh.id);
    const handle = freshSettings?.share_handle ?? "";
    const storedQuests = loadUserPostedOpportunities();
    const id = newInvitationId();
    const plan = planInvitation({
      publisher_id: publisherId,
      quest_id: questId === "" ? null : questId,
      publishers,
      stored_quests: storedQuests,
      view: publisherView(fresh, freshSettings, freshProtection),
      protection: freshProtection,
      existing: loadInvitations(),
      blocked: handle === "" ? [] : blockedPublisherIds(handle),
      today,
      id,
    });
    if (plan.ok) addInvitation(plan.invitation);
    // 存储函数不报告写入失败：再读一次确认真的存进去了。
    const saved = plan.ok && handle !== "" && loadInvitations(handle).some((i) => i.id === id);
    setLocal(readLocal(fresh));
    if (!plan.ok) {
      // 选的任务已经不在了（例如在别的标签页撤回）：清掉选择，下拉框与实际一致。
      if (questId !== "" && !publisherQuests(storedQuests, publisherId, publishers).some((q) => q.id === questId)) setQuestId("");
      setPublisherMessage(plan.message);
    } else {
      setPublisherMessage(
        saved ? sentMessage(publisherName(publishers, plan.invitation.publisher_id)) : PUBLISHER_PANE_TEXT.saveFailed,
      );
    }
    requestFocus("publisher");
  };

  /** 学生端对一条邀请的操作：先按最新数据确认这一行还在、这个操作仍可用，再写入并读回确认。 */
  const respond = (row: InvitationRow, action: InvitationAction) => {
    const fresh = currentProfile(setInviteMessage);
    if (!fresh) {
      requestFocus("invitations");
      return;
    }
    const today = localToday();
    const handle = loadShareSettings(fresh.id)?.share_handle ?? null;
    // 按最新数据与最新的保护状态重新分组：受保护时 accept 一律不允许。
    const freshInbox =
      handle === null
        ? null
        : invitationInbox(
            protectionFor(fresh, today),
            invitationList({
              invitations: loadInvitations(handle),
              share_handle: handle,
              blocked: blockedPublisherIds(handle),
              publishers,
              stored_quests: loadUserPostedOpportunities(),
            }).rows,
          );
    const current = freshInbox ? [...freshInbox.visible, ...freshInbox.held_rows].find((r) => r.id === row.id) : undefined;
    if (handle === null || freshInbox === null || !current || !inboxAllows(freshInbox, row.id, action)) {
      setLocal(readLocal(fresh));
      setInviteMessage(INVITATION_CHANGED);
      requestFocus("invitations");
      return;
    }
    const status = ACTION_STATUS[action];
    setInvitationStatus(row.id, status, today);
    const ok = loadInvitations(handle).some((i) => i.id === row.id && i.status === status);
    setLocal(readLocal(fresh));
    setInviteMessage(ok ? actionMessage(action, current.publisher_name) : SAVE_FAILED);
    requestFocus("invitations");
  };

  /** 解除屏蔽：把这个句柄下该发布者 blocked 的邀请全部改回 declined，读回确认。 */
  const unblock = (publisherIdToUnblock: string, name: string) => {
    const fresh = currentProfile(setInviteMessage);
    if (!fresh) {
      requestFocus("invitations");
      return;
    }
    const today = localToday();
    const handle = loadShareSettings(fresh.id)?.share_handle ?? null;
    const targets = unblockTargets(handle === null ? [] : loadInvitations(handle), handle, publisherIdToUnblock);
    if (handle === null || targets.length === 0) {
      setLocal(readLocal(fresh));
      setInviteMessage(INVITATION_CHANGED);
      requestFocus("invitations");
      return;
    }
    for (const id of targets) setInvitationStatus(id, ACTION_STATUS.unblock, today);
    const ok = !blockedPublisherIds(handle).includes(publisherIdToUnblock);
    setLocal(readLocal(fresh));
    setInviteMessage(ok ? actionMessage("unblock", name) : SAVE_FAILED);
    requestFocus("invitations");
  };

  const noteState = choices?.note_shared
    ? "A note is shared."
    : choices && !choices.note_allowed && choices.note !== null
      ? "Your earlier note is kept in this browser and is not shared now. It will be shared again if stricter defaults stop applying. Remove it if you do not want that."
      : "No note is shared.";
  const blocked = invitations ? blockedLine(invitations.blocked_publishers) : null;

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Talent Board</h1>
        <p className="text-gray-700">
          Decide what a sample publisher could see about the profile in this browser. The publishers are fictional, and
          nothing leaves this browser.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="share-heading" className="min-w-0 space-y-4 rounded border border-gray-300 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="share-heading" className="text-lg font-semibold">
              What I share
            </h2>
            <span className={TAG_CLASS}>Student view</span>
          </div>
          <p className="font-semibold">Nothing is shared unless you turn it on. You can turn it off at any time.</p>
          <p className="text-sm text-gray-700">
            Contact details, location, school name, identity labels, age, grade, budget and private materials are never
            taken from your profile. {exactlyAsWrittenWarning(protection)}
          </p>

          {local === null ? (
            <p className="text-sm text-gray-700">{CHECKING_TEXT}</p>
          ) : profile === null || choices === null || protection === null ? (
            <div className="space-y-2">
              <p>No profile is loaded in this browser, so there is nothing to share.</p>
              <p>
                <Link href="/passport" className="inline-flex min-h-11 items-center">
                  Open Skill Passport to create or load a profile
                </Link>
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="flex flex-wrap items-center gap-2 text-sm">
                Settings for the profile loaded in this browser.
                {profile.is_sample && <span className={TAG_CLASS}>Sample profile</span>}
              </p>

              {strict && (
                <div role="note" className="space-y-1 rounded border border-sky-700 bg-sky-50 p-2 text-sm text-sky-950">
                  <p className="font-semibold">{protectionNotice(protection)}</p>
                  <p>{PROTECTION_EFFECTS}</p>
                  <p>{GUARDIAN_ADVICE}</p>
                </div>
              )}

              {noteRemovedFor === profile.id && (
                <p role="note" className="rounded border border-amber-700 bg-amber-50 p-2 text-sm text-amber-950">
                  {NOTE_REMOVED_NOTICE}
                </p>
              )}

              {strict && (
                <div className="space-y-1">
                  <label className={CHOICE_CLASS}>
                    <input
                      type="checkbox"
                      className="mt-1 shrink-0"
                      checked={sharingConfirmed}
                      onChange={(e) => setConfirmedFor(e.target.checked ? profile.id : null)}
                    />
                    <span className="min-w-0 font-medium">{SHARING_CONFIRM_LABEL}</span>
                  </label>
                  {!sharingUnlocked && (
                    <p id="talent-sharing-locked" className="text-sm">
                      {SHARING_LOCKED_REASON}
                    </p>
                  )}
                </div>
              )}

              <ShareGroup legend="Evidence" empty="Your profile has no evidence yet." items={choices.evidence}>
                {(item) => (
                  <ShareCheckbox
                    key={item.key}
                    item={item}
                    disabled={!sharingUnlocked}
                    onChange={(on) =>
                      change(
                        { kind: "evidence", id: item.key, on },
                        on
                          ? `Sharing the kind, skills and status of the evidence "${item.label}". Its title is not shown.`
                          : `Stopped sharing the evidence "${item.label}".`,
                      )
                    }
                  />
                )}
              </ShareGroup>
              {choices.evidence.length > 0 && <p className="text-xs text-gray-600">{EVIDENCE_TITLE_NOTICE}</p>}

              <ShareGroup legend="Skills" empty="Your profile has no skills yet." items={choices.skills}>
                {(item) => (
                  <ShareCheckbox
                    key={item.key}
                    item={item}
                    disabled={!sharingUnlocked}
                    onChange={(on) =>
                      change(
                        { kind: "skill", name: item.key, on },
                        on
                          ? item.withheld
                            ? `Saved, but publishers do not see the skill "${item.label}" because it looks like contact details.`
                            : `Sharing the skill "${item.label}".`
                          : `Stopped sharing the skill "${item.label}".`,
                      )
                    }
                  />
                )}
              </ShareGroup>

              <fieldset className="min-w-0 space-y-1">
                <legend className="mb-1 font-medium">Interests</legend>
                {choices.interests.values.length === 0 ? (
                  <p className="text-sm text-gray-700">Your profile has no interests yet.</p>
                ) : (
                  <ShareCheckbox
                    item={{
                      key: "interests",
                      label: "Share my interests",
                      detail:
                        choices.interests.withheld.length === 0
                          ? choices.interests.values.join(", ")
                          : `${choices.interests.values.join(", ")} · ${WITHHELD_DETAIL}: ${choices.interests.withheld.join(", ")}`,
                      checked: choices.interests.checked,
                      withheld: false,
                    }}
                    disabled={!sharingUnlocked}
                    onChange={(on) =>
                      change({ kind: "interests", on }, on ? "Sharing your interests." : "Stopped sharing your interests.")
                    }
                  />
                )}
              </fieldset>

              <fieldset className="min-w-0 space-y-2">
                <legend className="mb-1 font-medium">Collaboration note</legend>
                <label htmlFor="talent-note" className="block text-sm">
                  A short note for publishers, such as when you are free or what you would like to work on. It is shown
                  exactly as written. Email addresses, web addresses and phone numbers are refused.
                </label>
                <textarea
                  id="talent-note"
                  rows={3}
                  maxLength={TALENT_NOTE_MAX}
                  value={noteValue}
                  disabled={!choices.note_allowed}
                  onChange={(e) => {
                    setNoteError(null);
                    setNoteDraft({ profileId: profile.id, text: e.target.value });
                  }}
                  aria-invalid={noteProblem !== null ? true : undefined}
                  aria-describedby={[
                    noteProblem !== null ? "talent-note-error" : "",
                    !choices.note_allowed ? "talent-note-locked" : "",
                    "talent-note-state",
                  ]
                    .filter((x) => x !== "")
                    .join(" ")}
                  className={`w-full rounded border px-2 py-1 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-700 ${noteProblem !== null ? "border-red-700" : "border-gray-300"}`}
                />
                {noteProblem !== null && (
                  <p id="talent-note-error" className="text-sm text-red-800">
                    {noteProblem}
                  </p>
                )}
                {!choices.note_allowed && (
                  <p id="talent-note-locked" className="text-sm font-medium">
                    {NOTE_LOCKED}
                  </p>
                )}
                <p id="talent-note-state" className="text-xs text-gray-600">
                  {noteState}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={BUTTON_CLASS}
                    onClick={shareNote}
                    disabled={!choices.note_allowed}
                    aria-describedby={!choices.note_allowed ? "talent-note-locked" : undefined}
                  >
                    Share this note
                  </button>
                  {choices.note !== null && (
                    <button type="button" className={BUTTON_CLASS} onClick={removeNote}>
                      Remove note
                    </button>
                  )}
                </div>
              </fieldset>

              <div className="space-y-1 border-t border-gray-300 pt-3">
                <button type="button" className={BUTTON_CLASS} onClick={stopAll} aria-describedby="talent-stop-hint">
                  Stop sharing everything
                </button>
                <p id="talent-stop-hint" className="text-xs text-gray-600">
                  {choices.anything_shared
                    ? "Turns every item off at once. The preview becomes empty immediately."
                    : "Nothing is shared right now."}
                </p>
              </div>
            </div>
          )}

          <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm font-medium">
            {message}
          </p>

          {invitations !== null && (
            <section aria-labelledby="invitations-heading" className="space-y-3 border-t border-gray-300 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id="invitations-heading" className="font-semibold">
                  Invitations
                </h3>
                <span className={TAG_CLASS}>Sample</span>
              </div>
              <p className="text-sm text-gray-700">
                Sample invitations from fictional publishers, saved only in this browser. Nothing you choose here is sent
                to anyone.
              </p>
              {inbox !== null && inbox.held > 0 && (
                <div role="note" className="space-y-2 rounded border border-sky-700 bg-sky-50 p-2 text-sm text-sky-950">
                  <p className="font-medium">{heldNotice(inbox.held)}</p>
                  {heldOpen ? (
                    <ul className="space-y-3" aria-label="Held sample invitations">
                      {inbox.held_rows.map((row) => (
                        <InvitationCard key={row.id} row={row} onAction={(a) => respond(row, a)} />
                      ))}
                    </ul>
                  ) : (
                    <button
                      type="button"
                      className={BUTTON_CLASS}
                      onClick={() => profile && setHeldOpenFor(profile.id)}
                    >
                      {REVIEW_HELD_LABEL}
                    </button>
                  )}
                </div>
              )}
              {inbox === null || inbox.visible.length === 0 ? (
                inbox !== null && inbox.held > 0 ? null : <p className="text-sm text-gray-700">No invitations.</p>
              ) : (
                <ul className="space-y-3">
                  {inbox.visible.map((row) => (
                    <InvitationCard key={row.id} row={row} onAction={(a) => respond(row, a)} />
                  ))}
                </ul>
              )}
              {inbox !== null && (inbox.visible.length > 0 || (heldOpen && inbox.held > 0)) && (
                <p id="invite-block-hint" className="text-xs text-gray-600">
                  {BLOCK_HINT}
                </p>
              )}
              {blocked !== null && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-700">{blocked}</p>
                  <ul className="space-y-2">
                    {invitations.blocked_list.map((b) => (
                      <li key={b.id} className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="break-words">{b.name} (sample publisher)</span>
                        <button
                          type="button"
                          className={BUTTON_CLASS}
                          aria-label={`Unblock ${b.name}`}
                          onClick={() => unblock(b.id, b.name)}
                        >
                          {ACTION_LABELS.unblock}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <p ref={inviteStatusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm font-medium">
            {inviteMessage}
          </p>
        </section>

        <section
          aria-labelledby="preview-heading"
          className="min-w-0 space-y-3 rounded border-2 border-dashed border-gray-400 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="preview-heading" className="text-lg font-semibold">
              Shared profile
            </h2>
            <span className={TAG_CLASS}>Publisher view</span>
            <span className={TAG_CLASS}>Local demo</span>
          </div>
          <p className="font-semibold">Preview of what a sample publisher would see. No one is actually viewing this.</p>

          {local === null ? (
            <p className="text-sm text-gray-700">{CHECKING_TEXT}</p>
          ) : preview === null || preview.empty ? (
            <p>{preview?.empty ? preview.message : NOT_SHARING_TEXT}</p>
          ) : (
            <div className="space-y-3">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                {preview.alias}
                {preview.is_sample && <span className={TAG_CLASS}>Sample</span>}
              </p>
              <dl className="text-sm">
                <dt>Anonymous handle</dt>
                <dd className="break-all">{preview.share_handle}</dd>
              </dl>
              {preview.sections.map((s) => (
                <div key={s.category} className="space-y-1">
                  <h3 className="font-semibold">{s.heading}</h3>
                  {s.items.length === 0 ? (
                    <p className="text-sm text-gray-700">Not shared.</p>
                  ) : (
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {s.items.map((item, i) => (
                        <li key={i} className="break-words">
                          {item.primary}
                          <PreviewDetails item={item} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}

              <form
                noValidate
                onSubmit={sendInvitation}
                aria-labelledby="send-heading"
                className="min-w-0 space-y-3 border-t border-gray-300 pt-3"
              >
                <h3 id="send-heading" className="font-semibold">
                  {PUBLISHER_PANE_TEXT.heading}
                </h3>
                <p className="text-sm text-gray-700">{PUBLISHER_PANE_TEXT.intro}</p>
                <div className="space-y-1">
                  <label htmlFor="invite-publisher" className="block text-sm font-medium">
                    {PUBLISHER_PANE_TEXT.publisherLabel}
                  </label>
                  <select
                    id="invite-publisher"
                    value={publisherId}
                    onChange={(e) => {
                      setPublisherId(e.target.value);
                      setQuestId("");
                      setPublisherMessage("");
                    }}
                    aria-required="true"
                    className={SELECT_CLASS}
                  >
                    <option value="">{PUBLISHER_PANE_TEXT.publisherPlaceholder}</option>
                    {publishers.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                {publisherId !== "" && (
                  <div className="space-y-1">
                    <label htmlFor="invite-quest" className="block text-sm font-medium">
                      {PUBLISHER_PANE_TEXT.questLabel}
                    </label>
                    <select
                      id="invite-quest"
                      value={questId}
                      onChange={(e) => {
                        setQuestId(e.target.value);
                        setPublisherMessage("");
                      }}
                      aria-required="true"
                      aria-describedby="invite-quest-hint"
                      className={SELECT_CLASS}
                    >
                      <option value="">{PUBLISHER_PANE_TEXT.questPlaceholder}</option>
                      {quests.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.title}
                        </option>
                      ))}
                    </select>
                    <p id="invite-quest-hint" className="text-xs text-gray-600">
                      {quests.length === 0 ? PUBLISHER_PANE_TEXT.noQuests : PUBLISHER_PANE_TEXT.questsHint}
                    </p>
                    {quests.length === 0 && (
                      <p className="text-sm">
                        <Link href="/connect/create" className="inline-flex min-h-11 items-center">
                          {PUBLISHER_PANE_TEXT.postQuestLink}
                        </Link>
                      </p>
                    )}
                  </div>
                )}
                <button type="submit" className={BUTTON_CLASS}>
                  {PUBLISHER_PANE_TEXT.submit}
                </button>
              </form>
            </div>
          )}

          <p ref={publisherStatusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm font-medium">
            {publisherMessage}
          </p>
        </section>
      </div>
    </div>
  );
}

/** 学生端的一条邀请：发布者、任务、理由、状态与可用的操作按钮。按钮组用「发布者 + 任务」两行命名，同一发布者的两条邀请也能区分。 */
function InvitationCard({ row, onAction }: { row: InvitationRow; onAction: (action: InvitationAction) => void }) {
  // 存储里的 id 可能含空格等字符（例如导入的备份），不直接拿来当 DOM id。
  const nameId = useId();
  const questLineId = useId();
  return (
    <li className="min-w-0 space-y-2 rounded border border-gray-300 p-2 text-sm">
      <p id={nameId} className="font-medium break-words">
        {row.publisher_name} (sample publisher)
      </p>
      <p id={questLineId} className="break-words">
        {row.quest.kind === "none" ? (
          "Not about a specific quest."
        ) : row.quest.kind === "stored" ? (
          <>
            Quest:{" "}
            <Link href={`/quests/${encodeURIComponent(row.quest.id)}`} className="inline-flex min-h-11 items-center">
              {row.quest.title}
            </Link>
          </>
        ) : (
          "About a quest that is not posted by this sample publisher in this browser."
        )}
      </p>
      {row.reasons.length > 0 && (
        <div>
          <p>Based on what you shared:</p>
          <ul className="list-disc pl-5">
            {row.reasons.map((r, i) => (
              <li key={i} className="break-words">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p>
        Status: {row.status_label}
        {row.sent_on !== "" && ` · Sent ${row.sent_on}`}
      </p>
      {row.notice !== null && <p>{row.notice}</p>}
      {row.actions.length > 0 && (
        <div role="group" aria-labelledby={`${nameId} ${questLineId}`} className="flex flex-wrap gap-2">
          {row.actions.map((a) => (
            <button
              key={a}
              type="button"
              className={BUTTON_CLASS}
              onClick={() => onAction(a)}
              aria-describedby={a === "block" ? "invite-block-hint" : undefined}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/** 一行的补充说明：种类 / 状态 / 等级用 " · " 连接，技能前加 "Skills:"。 */
function PreviewDetails({ item }: { item: PreviewItem }) {
  const parts = [...item.details];
  if (item.skills.length > 0) parts.push(`Skills: ${item.skills.join(", ")}`);
  if (parts.length === 0) return null;
  return <span className="block text-xs text-gray-600">{parts.join(" · ")}</span>;
}

function ShareGroup({
  legend,
  empty,
  items,
  children,
}: {
  legend: string;
  empty: string;
  items: ShareChoice[];
  children: (item: ShareChoice) => ReactNode;
}) {
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="mb-1 font-medium">{legend}</legend>
      {items.length === 0 ? <p className="text-sm text-gray-700">{empty}</p> : items.map(children)}
    </fieldset>
  );
}

/** disabled 时（受保护且还没确认）用 aria-describedby 指向 talent-sharing-locked 的原因说明。 */
function ShareCheckbox({
  item,
  onChange,
  disabled = false,
}: {
  item: ShareChoice;
  onChange: (on: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={disabled ? CHOICE_CLASS.replace("cursor-pointer", "cursor-not-allowed text-gray-600") : CHOICE_CLASS}>
      <input
        type="checkbox"
        className="mt-1 shrink-0"
        checked={item.checked}
        disabled={disabled}
        aria-describedby={disabled ? "talent-sharing-locked" : undefined}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block break-words">{item.label}</span>
        <span className="block text-xs text-gray-600">{item.detail}</span>
      </span>
    </label>
  );
}
