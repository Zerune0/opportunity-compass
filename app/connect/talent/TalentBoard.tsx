"use client";

/**
 * Talent Board（客户端组件，本地演示）：同一页上两块明确分开的视图。
 *
 * 1. 学生端「What I share」：本浏览器里载入的档案，按 ShareSettings 的字段逐项开关（证据、技能、兴趣、合作说明）。
 *    默认全部不分享。打开页面只读取（loadShareSettings），不会创建任何分享设置；第一次打开某个开关时才用
 *    defaultShareSettings 新建并 saveShareSettings 保存。「Stop sharing everything」= clearShareSettings(profileId, today)
 *    （契约定义的撤回：恢复默认、保留句柄）。
 *    合作说明分享前先过 checkCollaborationNote（长度、像邮箱 / 网址 / 电话号码的内容一律拒绝）。
 *    说明草稿按档案 id 记：别的标签页换了档案时，旧档案没发出的草稿不会出现在新档案上。
 * 2. 发布者端「Shared profile」：只渲染 buildSharedProfileView 的输出（经 lib/connect/talent.ts 的 sharedProfilePreview
 *    整理成行）；什么都没分享时立即为空。不排序、不打分，也没有任何「匹配度」。
 *
 * 浏览器数据在挂载后用 setTimeout 读取，并在 focus / storage / pageshow 时重读；服务器渲染与首次客户端渲染一致。
 * 今天的日期只在事件处理里取。没有真实发布者，没有任何联系发生。
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  NOT_SHARING_TEXT,
  TALENT_NOTE_MAX,
  applyShareChange,
  checkCollaborationNote,
  shareChoices,
  sharedProfilePreview,
} from "@/lib/connect/talent";
import type { PreviewItem, ShareChange, ShareChoice } from "@/lib/connect/talent";
import {
  clearShareSettings,
  defaultShareSettings,
  loadProfile,
  loadShareSettings,
  saveShareSettings,
} from "@/lib/store";
import type { ShareSettings, StudentProfile } from "@/lib/types";
import { localToday } from "../today";

const BUTTON_CLASS =
  "min-h-11 rounded border border-gray-400 px-3 py-1.5 text-left hover:border-gray-700 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-600";
const TAG_CLASS = "rounded border border-amber-700 px-1.5 text-xs text-amber-900";
const CHOICE_CLASS = "flex min-h-11 cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-gray-50";

const CHECKING_TEXT = "Checking this browser's local data…";
const SAVE_FAILED = "Could not save to this browser's storage. Nothing was changed.";
const STOP_FAILED = "Could not update this browser's storage. Check the preview: it may still show shared items.";
const DATA_CHANGED = "The profile in this browser changed, so nothing was saved. Check the page and try again.";

/** 本浏览器里读到的数据；null = 还没读。 */
type LocalData = { profile: StudentProfile | null; settings: ShareSettings | null };

/** 合作说明的草稿，记着属于哪个档案。 */
type NoteDraft = { profileId: string; text: string };

export function TalentBoard() {
  const [local, setLocal] = useState<LocalData | null>(null);
  /** null = 跟随已保存的说明；只对 profileId 相同的档案生效。 */
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  /** 合作说明没通过检查的原因，同样记着属于哪个档案。 */
  const [noteError, setNoteError] = useState<{ profileId: string; message: string } | null>(null);
  const [message, setMessage] = useState("");
  const [focusTick, setFocusTick] = useState(0);
  const statusRef = useRef<HTMLParagraphElement>(null);

  const refresh = useCallback(() => {
    const profile = loadProfile();
    setLocal({ profile, settings: profile ? loadShareSettings(profile.id) : null });
  }, []);

  useEffect(() => {
    const initialRead = window.setTimeout(refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.clearTimeout(initialRead);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pageshow", refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (focusTick > 0) statusRef.current?.focus();
  }, [focusTick]);

  /** 点击时再读一次档案：别的标签页可能换了档案；对不上就不写。 */
  const currentProfile = (): StudentProfile | null => {
    const fresh = loadProfile();
    const shown = local?.profile ?? null;
    if (fresh === null || shown === null || fresh.id !== shown.id) {
      setMessage(DATA_CHANGED);
      refresh();
      return null;
    }
    return fresh;
  };

  const change = (c: ShareChange, done: string): boolean => {
    const profile = currentProfile();
    if (!profile) return false;
    const today = localToday();
    // 第一次打开开关时才新建设置（默认什么都不分享），之后沿用已保存的句柄。
    const base = loadShareSettings(profile.id) ?? defaultShareSettings(profile.id, today);
    const ok = saveShareSettings(applyShareChange(base, c, today));
    setLocal({ profile, settings: loadShareSettings(profile.id) });
    setMessage(ok ? done : SAVE_FAILED);
    return ok;
  };

  const stopAll = () => {
    const profile = currentProfile();
    if (!profile) return;
    const before = loadShareSettings(profile.id);
    clearShareSettings(profile.id, localToday());
    const after = loadShareSettings(profile.id);
    setLocal({ profile, settings: after });
    setNoteDraft(null);
    setNoteError(null);
    const stillShared = !sharedProfilePreview(profile, after).empty;
    setMessage(
      stillShared
        ? STOP_FAILED
        : before === null
          ? "Nothing was being shared. A sample publisher sees nothing."
          : "Stopped sharing everything. A sample publisher would now see nothing.",
    );
    setFocusTick((n) => n + 1);
  };

  const profile = local?.profile ?? null;
  const settings = local?.settings ?? null;
  const choices = profile ? shareChoices(profile, settings) : null;
  const preview = profile ? sharedProfilePreview(profile, settings) : null;
  const draftText = profile && noteDraft && noteDraft.profileId === profile.id ? noteDraft.text : null;
  const noteValue = draftText ?? choices?.note ?? "";
  const noteProblem = profile && noteError && noteError.profileId === profile.id ? noteError.message : null;

  const shareNote = () => {
    if (!profile) return;
    const problem = checkCollaborationNote(noteValue);
    if (problem !== null) {
      setNoteError({ profileId: profile.id, message: problem });
      setMessage("The note was not shared.");
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
    const ok = change({ kind: "note", note: null }, "Removed your collaboration note. It is no longer shared.");
    if (ok) setNoteDraft(null);
  };

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
            taken from your profile. Your note and the titles of evidence you choose are shown exactly as written, so do
            not put contact details in them.
          </p>

          {local === null ? (
            <p className="text-sm text-gray-700">{CHECKING_TEXT}</p>
          ) : profile === null || choices === null ? (
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

              <ShareGroup legend="Evidence" empty="Your profile has no evidence yet." items={choices.evidence}>
                {(item) => (
                  <ShareCheckbox
                    key={item.key}
                    item={item}
                    onChange={(on) =>
                      change(
                        { kind: "evidence", id: item.key, on },
                        on ? `Sharing the evidence "${item.label}".` : `Stopped sharing the evidence "${item.label}".`,
                      )
                    }
                  />
                )}
              </ShareGroup>

              <ShareGroup legend="Skills" empty="Your profile has no skills yet." items={choices.skills}>
                {(item) => (
                  <ShareCheckbox
                    key={item.key}
                    item={item}
                    onChange={(on) =>
                      change(
                        { kind: "skill", name: item.key, on },
                        on ? `Sharing the skill "${item.label}".` : `Stopped sharing the skill "${item.label}".`,
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
                      detail: choices.interests.values.join(", "),
                      checked: choices.interests.checked,
                    }}
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
                  onChange={(e) => {
                    setNoteError(null);
                    setNoteDraft({ profileId: profile.id, text: e.target.value });
                  }}
                  aria-invalid={noteProblem !== null ? true : undefined}
                  aria-describedby={noteProblem !== null ? "talent-note-error talent-note-state" : "talent-note-state"}
                  className={`w-full rounded border px-2 py-1 ${noteProblem !== null ? "border-red-700" : "border-gray-300"}`}
                />
                {noteProblem !== null && (
                  <p id="talent-note-error" className="text-sm text-red-800">
                    {noteProblem}
                  </p>
                )}
                <p id="talent-note-state" className="text-xs text-gray-600">
                  {choices.note === null ? "No note is shared." : "A note is shared."}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button type="button" className={BUTTON_CLASS} onClick={shareNote}>
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
            </div>
          )}
        </section>
      </div>
    </div>
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

function ShareCheckbox({ item, onChange }: { item: ShareChoice; onChange: (on: boolean) => void }) {
  return (
    <label className={CHOICE_CLASS}>
      <input type="checkbox" className="mt-1 shrink-0" checked={item.checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="block break-words">{item.label}</span>
        <span className="block text-xs text-gray-600">{item.detail}</span>
      </span>
    </label>
  );
}
