"use client";

/**
 * Quest Creator（客户端组件，本地演示）：以示例发布者的身份发布一条机会，只存在这个浏览器里。
 *
 * - 表单 → 机会、校验、问题对到字段，都在 lib/connect/quest-form.ts 的纯函数里（prepareQuestPost 内部调用
 *   validateOpportunity）；这里只负责输入控件和渲染。有任何问题时什么都不保存。
 * - 读写一律经过 lib/store：loadUserPostedOpportunities / addUserPostedOpportunity / removeUserPostedOpportunity。
 *   写入后再读一次，确认真的存进去了（或真的删掉了）才报告成功。
 * - 发布者只能从 props 里的示例发布者中选（服务器端已校验），没有自由填写。
 * - 今天的日期与 id 在提交的事件处理里生成；浏览器数据在挂载后用 setTimeout 读取，
 *   并在 focus / storage / pageshow 时重读，服务器渲染与首次客户端渲染一致。
 * - 发布成功后表单清空；没改任何东西就再次提交（连按回车、双击）什么都不做，保留成功消息（isRepeatSubmitAfterPost）。
 * - 日期输入框里没填完的日期浏览器当作空值、也不触发 onChange：提交时从表单元素的 validity.badInput 检查。
 * - 文案只说 Connect 能保证的事：Quest Board 与 Quest Details 上的标记；撤回不删除 Quest Journal 的条目。
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  CATEGORY_LABELS,
  DEVICE_LABELS,
  FORMAT_LABELS,
  GRADE_CHOICES,
  PUBLISHER_KIND_LABELS,
  SKILL_LEVEL_LABELS,
  gradeLabel,
  labelOf,
} from "@/lib/connect/labels";
import {
  DEVICE_CHOICES,
  QUEST_DATE_FIELDS,
  QUEST_MAX_LENGTH,
  SKILL_LEVEL_CHOICES,
  emptyQuestForm,
  isRepeatSubmitAfterPost,
  postedThroughConnect,
  prepareQuestPost,
  problemsFor,
  uniqueUserPostedId,
} from "@/lib/connect/quest-form";
import type { QuestForm, QuestFormField, QuestProblem } from "@/lib/connect/quest-form";
import { plural } from "@/lib/format";
import { addUserPostedOpportunity, loadUserPostedOpportunities, removeUserPostedOpportunity } from "@/lib/store";
import type { DeviceType, Opportunity, OpportunityCategory, SamplePublisher } from "@/lib/types";
import { localToday } from "../today";

const BUTTON_CLASS =
  "min-h-11 rounded border border-gray-400 px-3 py-1.5 text-left hover:border-gray-700 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-600";
const PRIMARY_BUTTON_CLASS = "min-h-11 rounded border-2 border-amber-600 px-4 py-1.5 font-semibold hover:bg-amber-50";
const TAG_CLASS = "rounded border border-amber-700 px-1.5 text-xs text-amber-900";
const INPUT_CLASS = "w-full rounded border px-2 py-1";
const CHOICE_CLASS = "flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-gray-50";

const CHECKING_TEXT = "Checking this browser's local data…";
const SAVE_FAILED = "Could not save to this browser's storage. Nothing was posted.";
const WITHDRAW_FAILED = "Could not update this browser's storage. The quest is still posted.";
const WHERE_LABELLED = "On the Quest Board and Quest Details it is labelled Sample and User-posted.";
/** 别的页面存在本地的示例机会（例如主办方页面的本地演示）不是这里发布的，不列出、也不在这里撤回。 */
const OTHER_LOCAL_NOTE =
  "Sample opportunities saved in this browser by other pages, such as the organizer demo, are not listed here.";
const WITHDRAW_EFFECT =
  "Removed from the Quest Board and Quest Details in this browser. Quest Journal entries that refer to it are kept.";

/** 错误摘要里显示的字段名。 */
const FIELD_NAMES: Record<QuestFormField, string> = {
  publisher_id: "Posting as",
  title: "Title",
  activity: "What the participant will do",
  category: "Category",
  topics: "Topic tags",
  grade_min: "Lowest grade",
  grade_max: "Highest grade",
  region_country: "Country",
  region_states: "States or provinces",
  required_devices: "Required devices",
  skill: "Required skill",
  skill_level: "Minimum skill level",
  format: "Format",
  city: "City",
  state: "State or province",
  country: "Country of the venue",
  hours_per_week: "Hours per week",
  total_weeks: "Number of weeks",
  start_date: "Start date",
  end_date: "End date",
  fee_usd: "Fee",
  pay_usd: "Pay or stipend",
  travel_expense: "Travel costs",
  outcome: "What participants concretely get",
  deadline: "Application deadline",
};

/** 页面上只有一个表单，字段 id 用固定前缀（错误摘要用 #id 链接过去）。 */
const fieldId = (field: QuestFormField) => `quest-field-${field}`;
const errorId = (field: QuestFormField) => `quest-field-${field}-error`;
const hintId = (field: QuestFormField) => `quest-field-${field}-hint`;
const maxLengthOf = (field: QuestFormField): number | undefined =>
  (QUEST_MAX_LENGTH as Partial<Record<QuestFormField, number>>)[field];

type FocusTarget = "errors" | "status" | "list";

export function QuestCreator({ publishers }: { publishers: SamplePublisher[] }) {
  const [form, setForm] = useState<QuestForm>(() => emptyQuestForm(publishers.length === 1 ? publishers[0].id : ""));
  /** 刚发布成功后清空出来的那份表单；用户一编辑就设回 null。 */
  const [clearedAfterPost, setClearedAfterPost] = useState<QuestForm | null>(null);
  /** 发布成功或清空时加 1，让所有输入框重新挂载（顺带清掉日期框里没填完的内容）。 */
  const [formKey, setFormKey] = useState(0);
  const [problems, setProblems] = useState<QuestProblem[]>([]);
  const [message, setMessage] = useState("");
  const [listMessage, setListMessage] = useState("");
  /** null = 还没读（服务器渲染与首次客户端渲染都是 null）。 */
  const [posted, setPosted] = useState<Opportunity[] | null>(null);
  /** 挂载后才知道今天（只用于日期输入框的 min）。 */
  const [today, setToday] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; n: number } | null>(null);
  const errorsRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const listStatusRef = useRef<HTMLParagraphElement>(null);

  const refresh = useCallback(() => {
    setPosted(loadUserPostedOpportunities());
    setToday(localToday());
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
    if (focusRequest === null) return;
    const el =
      focusRequest.target === "errors"
        ? errorsRef.current
        : focusRequest.target === "status"
          ? statusRef.current
          : listStatusRef.current;
    el?.focus();
  }, [focusRequest]);

  const requestFocus = (target: FocusTarget) => setFocusRequest((prev) => ({ target, n: (prev?.n ?? 0) + 1 }));

  /** 开始编辑下一条：清掉上一次的成功 / 撤回消息，不再把提交当作重复提交。 */
  const startEditing = () => {
    setMessage("");
    setListMessage("");
    setClearedAfterPost(null);
  };
  const set = <K extends QuestFormField>(field: K, value: QuestForm[K]) => {
    startEditing();
    setForm((prev) => ({ ...prev, [field]: value }));
  };
  const toggleDevice = (device: DeviceType, on: boolean) => {
    startEditing();
    setForm((prev) => ({
      ...prev,
      required_devices: DEVICE_CHOICES.filter((d) => (d === device ? on : prev.required_devices.includes(d))),
    }));
  };

  /** 列表只列 Connect 自己发布的；`posted`（全部本地机会）仍用于避免 id 重复。 */
  const listed = posted === null ? null : postedThroughConnect(posted, publishers);

  const publisherName = (id: string | null | undefined, fallback: string) =>
    publishers.find((p) => p.id === id)?.name ?? fallback;

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 刚发布成功、表单没动过：重复提交，什么都不做，保留成功消息。
    if (isRepeatSubmitAfterPost(form, clearedAfterPost)) return;
    const elements = event.currentTarget.elements;
    const incompleteDates = QUEST_DATE_FIELDS.filter((f) => {
      const el = elements.namedItem(f);
      return el instanceof HTMLInputElement && el.validity.badInput;
    });
    const day = localToday();
    // id 在这里生成：由标题与当前时间决定，并避开这个浏览器里已有的 id。
    const id = uniqueUserPostedId(
      form.title,
      Date.now(),
      loadUserPostedOpportunities().map((o) => o.id),
    );
    const result = prepareQuestPost(form, publishers, { today: day, id, incompleteDates });
    if (!result.ok) {
      setProblems(result.problems);
      setMessage("");
      requestFocus("errors");
      return;
    }
    const returned = addUserPostedOpportunity(result.opportunity);
    // 存储函数不抛异常，写入失败时返回的列表也可能含新条目：再读一次确认真的存进去了。
    const stored = loadUserPostedOpportunities();
    setPosted(stored);
    setProblems([]);
    const saved = returned.some((o) => o.id === id) ? stored.find((o) => o.id === id) : undefined;
    if (!saved) {
      setMessage(SAVE_FAILED);
      requestFocus("status");
      return;
    }
    const cleared = emptyQuestForm(form.publisher_id);
    setForm(cleared);
    setClearedAfterPost(cleared);
    setFormKey((k) => k + 1);
    setListMessage("");
    setMessage(
      `Posted "${saved.title}" in this browser as ${publisherName(saved.posted_by, saved.organizer)}. ${WHERE_LABELLED} ` +
        "The form is cleared for another quest.",
    );
    requestFocus("status");
  };

  const onClear = () => {
    setForm(emptyQuestForm(form.publisher_id));
    setClearedAfterPost(null);
    setFormKey((k) => k + 1);
    setProblems([]);
    setListMessage("");
    setMessage("The form was cleared. Nothing was posted.");
  };

  const onWithdraw = (opp: Opportunity) => {
    const question =
      `Withdraw "${opp.title}"? It will be removed from the Quest Board and Quest Details in this browser. ` +
      "Quest Journal entries that refer to it are kept.";
    if (!window.confirm(question)) return;
    removeUserPostedOpportunity(opp.id);
    const after = loadUserPostedOpportunities();
    setPosted(after);
    setMessage("");
    setListMessage(after.some((o) => o.id === opp.id) ? WITHDRAW_FAILED : `Withdrew "${opp.title}". ${WITHDRAW_EFFECT}`);
    requestFocus("list");
  };

  const errs = (field: QuestFormField) => problemsFor(problems, field);
  const selected = publishers.find((p) => p.id === form.publisher_id) ?? null;
  const showLocation = form.format === "in_person" || form.format === "hybrid";

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Quest Creator</h1>
        <p className="text-gray-700">
          Post a quest as one of the fictional sample publishers. It is saved only in this browser. {WHERE_LABELLED}
        </p>
      </header>

      {publishers.length === 0 ? (
        <p className="rounded border border-gray-300 p-3">No sample publishers are available, so nothing can be posted.</p>
      ) : (
        <form noValidate onSubmit={onSubmit} aria-labelledby="quest-form-heading" className="min-w-0 space-y-6">
          <h2 id="quest-form-heading" className="text-lg font-semibold">
            Post a quest
          </h2>

          {problems.length > 0 && (
            <div
              ref={errorsRef}
              tabIndex={-1}
              aria-labelledby="quest-errors-heading"
              className="space-y-2 rounded border border-red-700 bg-red-50 p-3 text-red-900"
            >
              <p id="quest-errors-heading" className="font-semibold">
                Nothing was posted. Fix {plural(problems.length, "problem")}:
              </p>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {problems.map((p, i) => (
                  <li key={`${p.field ?? "general"}-${i}`}>
                    {p.field ? (
                      <a href={`#${fieldId(p.field)}`}>
                        {FIELD_NAMES[p.field]}: {p.message}
                      </a>
                    ) : (
                      p.message
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* key：发布成功或清空后重新挂载所有输入框。 */}
          <div key={formKey} className="space-y-6">
            <SelectField
              field="publisher_id"
              label="Posting as (required)"
              required
              hint={
                selected
                  ? `${selected.name} · ${labelOf(PUBLISHER_KIND_LABELS, selected.kind)} · Sample. ${selected.description ?? ""}`.trim()
                  : "Only fictional sample publishers can post here."
              }
              value={form.publisher_id}
              onChange={(v) => set("publisher_id", v)}
              errors={errs("publisher_id")}
              options={[
                { value: "", label: "Choose a sample publisher…" },
                ...publishers.map((p) => ({ value: p.id, label: `${p.name} (${labelOf(PUBLISHER_KIND_LABELS, p.kind)})` })),
              ]}
            />

            <Group legend="1. Goal">
              <TextField
                field="title"
                label="Title (required)"
                required
                value={form.title}
                onChange={(v) => set("title", v)}
                errors={errs("title")}
              />
              <TextArea
                field="activity"
                label="What the participant will do (required)"
                required
                hint="One or two sentences, for example: build and test a small air-quality sensor with the club."
                value={form.activity}
                onChange={(v) => set("activity", v)}
                errors={errs("activity")}
              />
              <SelectField
                field="category"
                label="Category (required)"
                required
                value={form.category}
                onChange={(v) => set("category", v)}
                errors={errs("category")}
                options={[
                  { value: "", label: "Choose a category…" },
                  ...(Object.keys(CATEGORY_LABELS) as OpportunityCategory[]).map((c) => ({ value: c, label: CATEGORY_LABELS[c] })),
                ]}
              />
              <TextField
                field="topics"
                label="Topic tags (optional)"
                hint="Separated by commas, such as climate, data science. Students with matching interests can find the quest."
                value={form.topics}
                onChange={(v) => set("topics", v)}
                errors={errs("topics")}
              />
            </Group>

            <Group
              legend="2. Required eligibility"
              description="Only requirements the eligibility check can test automatically. Leave a part blank if it does not apply."
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  field="grade_min"
                  label="Lowest grade (optional)"
                  value={form.grade_min}
                  onChange={(v) => set("grade_min", v)}
                  errors={errs("grade_min")}
                  options={[{ value: "", label: "No minimum" }, ...GRADE_CHOICES.map((g) => ({ value: String(g), label: gradeLabel(g) }))]}
                />
                <SelectField
                  field="grade_max"
                  label="Highest grade (optional)"
                  value={form.grade_max}
                  onChange={(v) => set("grade_max", v)}
                  errors={errs("grade_max")}
                  options={[{ value: "", label: "No maximum" }, ...GRADE_CHOICES.map((g) => ({ value: String(g), label: gradeLabel(g) }))]}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  field="region_country"
                  label="Participants must live in country (optional)"
                  hint="Two-letter code, such as US. Leave blank if anyone can join."
                  value={form.region_country}
                  onChange={(v) => set("region_country", v)}
                  errors={errs("region_country")}
                  autoComplete="off"
                />
                <TextField
                  field="region_states"
                  label="Only these states or provinces (optional)"
                  hint="Codes separated by commas, such as CA, OR. Leave blank for the whole country."
                  value={form.region_states}
                  onChange={(v) => set("region_states", v)}
                  errors={errs("region_states")}
                  autoComplete="off"
                />
              </div>
              <ChoiceGroup kind="checkbox" legend="Required devices (optional)" field="required_devices" errors={errs("required_devices")}>
                {DEVICE_CHOICES.map((d, i) => (
                  <label key={d} className={CHOICE_CLASS}>
                    <input
                      id={i === 0 ? fieldId("required_devices") : undefined}
                      type="checkbox"
                      checked={form.required_devices.includes(d)}
                      onChange={(e) => toggleDevice(d, e.target.checked)}
                      aria-invalid={errs("required_devices").length > 0 ? true : undefined}
                    />
                    <span>{DEVICE_LABELS[d]}</span>
                  </label>
                ))}
              </ChoiceGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  field="skill"
                  label="Required skill (optional)"
                  hint="One skill participants must already have, such as python."
                  value={form.skill}
                  onChange={(v) => set("skill", v)}
                  errors={errs("skill")}
                  autoComplete="off"
                />
                <SelectField
                  field="skill_level"
                  label="Minimum skill level"
                  hint="Used only when a required skill is given."
                  value={form.skill_level}
                  onChange={(v) => set("skill_level", v)}
                  errors={errs("skill_level")}
                  options={SKILL_LEVEL_CHOICES.map((l) => ({ value: l, label: `${SKILL_LEVEL_LABELS[l]} or above` }))}
                />
              </div>
            </Group>

            <Group legend="3. Time and place">
              <ChoiceGroup kind="radio" required legend="Format (required)" field="format" errors={errs("format")}>
                {(Object.keys(FORMAT_LABELS) as (keyof typeof FORMAT_LABELS)[]).map((f, i) => (
                  <label key={f} className={CHOICE_CLASS}>
                    <input
                      id={i === 0 ? fieldId("format") : undefined}
                      type="radio"
                      name="quest-format"
                      value={f}
                      checked={form.format === f}
                      onChange={() => set("format", f)}
                    />
                    <span>{FORMAT_LABELS[f]}</span>
                  </label>
                ))}
              </ChoiceGroup>
              {showLocation && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <TextField field="city" label="City (optional)" value={form.city} onChange={(v) => set("city", v)} errors={errs("city")} />
                  <TextField
                    field="state"
                    label="State or province (optional)"
                    hint="Code, such as CA."
                    value={form.state}
                    onChange={(v) => set("state", v)}
                    errors={errs("state")}
                  />
                  <TextField
                    field="country"
                    label="Country (optional)"
                    hint="Two-letter code, such as US."
                    value={form.country}
                    onChange={(v) => set("country", v)}
                    errors={errs("country")}
                  />
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  field="hours_per_week"
                  label="Hours per week (optional)"
                  hint="A number such as 3 or 1.5. Leave blank if it varies."
                  value={form.hours_per_week}
                  onChange={(v) => set("hours_per_week", v)}
                  errors={errs("hours_per_week")}
                  inputMode="decimal"
                />
                <TextField
                  field="total_weeks"
                  label="Number of weeks (optional)"
                  value={form.total_weeks}
                  onChange={(v) => set("total_weeks", v)}
                  errors={errs("total_weeks")}
                  inputMode="numeric"
                />
                <TextField
                  field="start_date"
                  label="Start date (optional)"
                  type="date"
                  value={form.start_date}
                  onChange={(v) => set("start_date", v)}
                  errors={errs("start_date")}
                />
                <TextField
                  field="end_date"
                  label="End date (optional)"
                  type="date"
                  value={form.end_date}
                  onChange={(v) => set("end_date", v)}
                  errors={errs("end_date")}
                  min={form.start_date || today || undefined}
                />
              </div>
            </Group>

            <Group legend="4. Pay and cost">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  field="fee_usd"
                  label="Fee to take part, in US dollars (optional)"
                  hint="Enter 0 if it is free. Leave blank if it is not decided."
                  value={form.fee_usd}
                  onChange={(v) => set("fee_usd", v)}
                  errors={errs("fee_usd")}
                  inputMode="decimal"
                />
                <TextField
                  field="pay_usd"
                  label="Pay or stipend, total in US dollars (optional)"
                  hint="Enter 0 if it is unpaid. Leave blank if it is not decided."
                  value={form.pay_usd}
                  onChange={(v) => set("pay_usd", v)}
                  errors={errs("pay_usd")}
                  inputMode="decimal"
                />
              </div>
              <ChoiceGroup
                kind="radio"
                required
                legend="Do participants pay for their own travel? (required)"
                field="travel_expense"
                errors={errs("travel_expense")}
              >
                {[
                  { value: "no", label: "No" },
                  { value: "yes", label: "Yes" },
                ].map((o, i) => (
                  <label key={o.value} className={CHOICE_CLASS}>
                    <input
                      id={i === 0 ? fieldId("travel_expense") : undefined}
                      type="radio"
                      name="quest-travel"
                      value={o.value}
                      checked={form.travel_expense === o.value}
                      onChange={() => set("travel_expense", o.value)}
                    />
                    <span>{o.label}</span>
                  </label>
                ))}
              </ChoiceGroup>
            </Group>

            <Group legend="5. What participants concretely get">
              <TextArea
                field="outcome"
                label="What the participant concretely gets (required)"
                required
                hint="For example: a finished project, a reference letter, a certificate, or time with a mentor."
                value={form.outcome}
                onChange={(v) => set("outcome", v)}
                errors={errs("outcome")}
              />
            </Group>

            <Group legend="6. Deadline">
              <TextField
                field="deadline"
                label="Application deadline (optional)"
                hint="Leave blank for rolling applications."
                type="date"
                value={form.deadline}
                onChange={(v) => set("deadline", v)}
                errors={errs("deadline")}
                min={today || undefined}
              />
            </Group>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className={PRIMARY_BUTTON_CLASS}>
              Post quest in this browser
            </button>
            <button type="button" onClick={onClear} className={BUTTON_CLASS}>
              Clear form
            </button>
          </div>
          <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm font-medium">
            {message}
          </p>
        </form>
      )}

      <section aria-labelledby="posted-heading" className="min-w-0 space-y-3">
        <h2 id="posted-heading" className="text-lg font-semibold">
          Posted in this browser
        </h2>
        <p className="text-sm text-gray-700">
          Withdrawing a quest removes it from the Quest Board and Quest Details in this browser. Quest Journal entries
          that refer to it are kept.
        </p>
        {listed === null ? (
          <p className="text-sm text-gray-700">{CHECKING_TEXT}</p>
        ) : listed.length === 0 ? (
          <p className="text-sm text-gray-700">Nothing has been posted in this browser.</p>
        ) : (
          <ul className="space-y-3">
            {listed.map((o) => (
              <li key={o.id} className="min-w-0 space-y-2 rounded border border-gray-300 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words font-semibold">{o.title}</h3>
                  <span className="flex shrink-0 flex-wrap gap-1">
                    <span className={TAG_CLASS}>Sample</span>
                    <span className={TAG_CLASS}>User-posted</span>
                  </span>
                </div>
                <dl className="text-sm">
                  <dt>Posted by</dt>
                  <dd>{publisherName(o.posted_by, o.organizer)} (sample publisher)</dd>
                  <dt>Posted on</dt>
                  <dd>{o.verified_on}</dd>
                  <dt>Deadline</dt>
                  <dd>{o.deadline ?? "Rolling (no deadline set)"}</dd>
                </dl>
                <p className="text-sm text-gray-700">Not verified against an official site.</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Link href={`/quests/${encodeURIComponent(o.id)}`} className="inline-flex min-h-11 items-center">
                    Open Quest Details<span className="sr-only">: {o.title}</span>
                  </Link>
                  <button type="button" onClick={() => onWithdraw(o)} className={BUTTON_CLASS}>
                    Withdraw<span className="sr-only">: {o.title}</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {posted !== null && listed !== null && posted.length > listed.length && (
          <p className="text-sm text-gray-700">{OTHER_LOCAL_NOTE}</p>
        )}
        <p ref={listStatusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm font-medium">
          {listMessage}
        </p>
      </section>
    </div>
  );
}

// ───────────────────────────── 表单小部件 ─────────────────────────────

function describedBy(field: QuestFormField, hasHint: boolean, hasErrors: boolean): string | undefined {
  const ids = [hasErrors ? errorId(field) : null, hasHint ? hintId(field) : null].filter((x): x is string => x !== null);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

function FieldErrors({ field, errors }: { field: QuestFormField; errors: string[] }) {
  if (errors.length === 0) return null;
  return (
    <p id={errorId(field)} className="text-sm text-red-800">
      {errors.join(" ")}
    </p>
  );
}

function Hint({ field, text }: { field: QuestFormField; text?: string }) {
  if (!text) return null;
  return (
    <p id={hintId(field)} className="text-xs text-gray-600">
      {text}
    </p>
  );
}

function Group({ legend, description, children }: { legend: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 space-y-4 rounded border border-gray-300 p-3">
      <legend className="px-1 font-semibold">{legend}</legend>
      {description && <p className="text-sm text-gray-700">{description}</p>}
      {children}
    </fieldset>
  );
}

/**
 * 单选组用 role="radiogroup"（它支持 aria-required / aria-invalid）；复选组保持 fieldset，
 * aria-invalid 放在每个复选框上（页面传入）。两者都用 aria-describedby 指向错误说明。
 */
function ChoiceGroup({
  kind,
  required = false,
  legend,
  field,
  errors,
  children,
}: {
  kind: "radio" | "checkbox";
  required?: boolean;
  legend: string;
  field: QuestFormField;
  errors: string[];
  children: ReactNode;
}) {
  const invalid = errors.length > 0;
  return (
    <fieldset
      role={kind === "radio" ? "radiogroup" : undefined}
      aria-required={kind === "radio" && required ? true : undefined}
      aria-invalid={kind === "radio" && invalid ? true : undefined}
      aria-describedby={describedBy(field, false, invalid)}
      className="min-w-0 space-y-1"
    >
      <legend className="mb-1 font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-x-4">{children}</div>
      <FieldErrors field={field} errors={errors} />
    </fieldset>
  );
}

function TextField({
  field,
  label,
  hint,
  value,
  onChange,
  errors,
  required = false,
  type = "text",
  inputMode,
  min,
  autoComplete,
}: {
  field: QuestFormField;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  errors: string[];
  required?: boolean;
  type?: "text" | "date";
  inputMode?: "decimal" | "numeric";
  min?: string;
  autoComplete?: string;
}) {
  const invalid = errors.length > 0;
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={fieldId(field)} className="block font-medium">
        {label}
      </label>
      <Hint field={field} text={hint} />
      <input
        id={fieldId(field)}
        name={field}
        type={type}
        inputMode={inputMode}
        maxLength={maxLengthOf(field)}
        min={min}
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required ? true : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy(field, Boolean(hint), invalid)}
        className={`${INPUT_CLASS} ${invalid ? "border-red-700" : "border-gray-300"}`}
      />
      <FieldErrors field={field} errors={errors} />
    </div>
  );
}

function TextArea({
  field,
  label,
  hint,
  value,
  onChange,
  errors,
  required = false,
}: {
  field: QuestFormField;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  errors: string[];
  required?: boolean;
}) {
  const invalid = errors.length > 0;
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={fieldId(field)} className="block font-medium">
        {label}
      </label>
      <Hint field={field} text={hint} />
      <textarea
        id={fieldId(field)}
        name={field}
        rows={3}
        maxLength={maxLengthOf(field)}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required ? true : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy(field, Boolean(hint), invalid)}
        className={`${INPUT_CLASS} ${invalid ? "border-red-700" : "border-gray-300"}`}
      />
      <FieldErrors field={field} errors={errors} />
    </div>
  );
}

function SelectField({
  field,
  label,
  hint,
  value,
  onChange,
  errors,
  options,
  required = false,
}: {
  field: QuestFormField;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  errors: string[];
  options: { value: string; label: string }[];
  required?: boolean;
}) {
  const invalid = errors.length > 0;
  return (
    <div className="min-w-0 space-y-1">
      <label htmlFor={fieldId(field)} className="block font-medium">
        {label}
      </label>
      <Hint field={field} text={hint} />
      <select
        id={fieldId(field)}
        name={field}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required ? true : undefined}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy(field, Boolean(hint), invalid)}
        className={`${INPUT_CLASS} ${invalid ? "border-red-700" : "border-gray-300"}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldErrors field={field} errors={errors} />
    </div>
  );
}
