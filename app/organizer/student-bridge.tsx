"use client";

/**
 * 「回到学生端的桥」（客户端组件，放在主办方 What-if 页面的设置与结果下方，全宽）。
 *
 * 明确标注的本地演示操作：把当前方案（OPTIMAL 且通过独立复核）里已批准措施给「本浏览器里载入的示例档案」的分配，
 * 写成模拟的 approved grant，学生端的 Quest Details 就能看到效果；也可以撤回。
 * - 能不能写、写什么都由 lib/joint/bridge 的 decideBridge 决定；读写存储只经 ./bridge-store（它再调用 lib/store）。
 * - 「已经写入了哪些」从存储里推出来（不靠 React state），刷新页面后照样能撤回；输入无效（plan 为 null）或当前方案
 *   不能写时也能撤回。撤回只删本场景的桥写入的 grant，别的不动。
 * - 关于载入的学生，页面只说一句话（decision.membership_sentence）；不渲染档案的姓名、id、学校、年龄，
 *   也不渲染匿名编号或方案明细里的任何学生信息，不 console.log。
 * - 浏览器数据在挂载后读取（setTimeout，与 app/data/YourData.tsx 相同的做法），并在 focus / storage / pageshow 时重读；
 *   读到之前显示一行中性的提示，服务器渲染与首次客户端渲染一致。
 * 不要 import lib/joint/scenarios、lib/data 或任何 data/*.json。
 */
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  BRIDGE_DEMO_NOTICE,
  decideBridge,
  opportunitiesNeedingLocalCopy,
  rosterStudentId,
  summarizeApplied,
} from "@/lib/joint/bridge";
import type { BridgeDecision, BridgeProfileRef, ClientBridgeInfo } from "@/lib/joint/bridge";
import type { WhatIfPlanDetail } from "@/lib/joint/whatif";
import { plural, pluralNoun } from "@/lib/format";
import type { ResourceGrant, Scenario } from "@/lib/types";
import {
  applyBridgeGrants,
  readAppliedBridgeGrants,
  readLoadedProfileRef,
  readLocalOpportunityIds,
  storeLocalOpportunities,
  undoBridgeGrants,
} from "./bridge-store";

/** 本浏览器里读到的数据；null = 还没读（服务器渲染与首次客户端渲染都是 null）。 */
/** localOpportunityIds：场景里的机会中，已作为本地示例存在本浏览器里的（学生端打得开）。 */
type LocalData = { profile: BridgeProfileRef | null; applied: ResourceGrant[]; localOpportunityIds: string[] };

const CHECKING_TEXT = "Checking this browser's local data…";
const EXPLANATION =
  "It writes the support this plan allocates to the sample profile loaded in this browser as simulated grants, so that Quest Details can show the effect. Nothing leaves this browser.";
const LOCAL_COPY_NOTE =
  "This scenario uses a sample opportunity that is not in the student-side catalog. Writing also saves a copy of it in this browser, labelled Sample, so that Quest Details can open it.";
const PLACEHOLDER_NOTE =
  "The sample opportunity is not saved in this browser, so there is no Quest Details page to open. Undo, then write again to restore it.";
const COPY_KEPT_NOTE = " The sample opportunity stays on the Quest Board in this browser.";
const RECHECK_NOTE = "Quest Details re-checks everything with the profile stored in this browser. Reachable does not mean admitted.";
const PLAN_CHANGED_NOTE =
  "The plan shown now differs from what was written. Undo to remove it, then write again if the new plan allows it.";
const WRITE_FAILED = "Could not write to this browser's storage. No support was written.";
const WRITE_FAILED_COPY = "Could not save the sample opportunity in this browser, so no support was written.";
const UNDO_FAILED = "Could not update this browser's storage. Nothing was changed.";
const DATA_CHANGED = "This browser's data changed, so nothing was written. Check the panel and try again.";

const BUTTON_CLASS =
  "min-h-11 rounded border border-gray-400 px-3 py-1.5 text-left hover:border-gray-700 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-600 disabled:hover:border-gray-300";
const TAG_CLASS = "rounded border border-amber-700 px-1.5 text-xs text-amber-900";

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const x = [...a].sort(cmpStr);
  const y = [...b].sort(cmpStr);
  return x.every((id, i) => id === y[i]);
}

export default function StudentBridge({
  scenario,
  bridge,
  plan,
}: {
  /** 完整的（匿名化后的）场景：撤回时按它的全部措施找回写入的 grant。 */
  scenario: Scenario;
  bridge: ClientBridgeInfo;
  /** 当前方案明细；输入无效（没有计算）时为 null。 */
  plan: WhatIfPlanDetail | null;
}) {
  const [local, setLocal] = useState<LocalData | null>(null);
  const [message, setMessage] = useState("");
  const headingId = useId();
  const membershipId = useId();
  const reasonId = useId();
  const writeRef = useRef<HTMLButtonElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  /** 写入 / 撤回成功后，把焦点移到替换了原按钮的那个按钮上（原按钮会消失）。 */
  const focusNext = useRef<"write" | "undo" | null>(null);

  const refresh = useCallback(() => {
    setLocal({
      profile: readLoadedProfileRef(),
      applied: readAppliedBridgeGrants(scenario),
      localOpportunityIds: readLocalOpportunityIds(scenario.opportunities.map((o) => o.id)),
    });
  }, [scenario]);

  useEffect(() => {
    // localStorage 只在挂载后读（首屏与服务器渲染一致），其他标签页改动或回到本页时重读。
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
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const button = target === "undo" ? undoRef.current : writeRef.current;
    if (button && !button.disabled) button.focus();
    else statusRef.current?.focus();
  }, [local]);

  const decide = (profile: BridgeProfileRef | null): BridgeDecision =>
    decideBridge({
      scenarioId: scenario.id,
      plan,
      profile,
      // 匿名编号只用来判定，不渲染。
      scenarioStudentId: profile ? rosterStudentId(bridge.roster, profile.id) : null,
      provider: bridge.provider,
    });

  const onWrite = () => {
    // 点击时再读一次存储：别的标签页可能刚换了档案或已经写过。
    // 要写的必须就是面板上显示的那一份（同一个档案、同一个方案）；对不上就不写，让用户先看更新后的面板。
    const fresh = decide(readLoadedProfileRef());
    const shown = local ? decide(local.profile) : null;
    const matchesShown =
      shown !== null &&
      shown.can_apply &&
      sameIds(
        fresh.grants.map((g) => g.id),
        shown.grants.map((g) => g.id),
      );
    if (!fresh.can_apply || !matchesShown || readAppliedBridgeGrants(scenario).length > 0) {
      // 焦点留在面板里：写入按钮还在且可用就回到它，否则落到状态消息上。
      focusNext.current = "write";
      setMessage(DATA_CHANGED);
      refresh();
      return;
    }
    // 学生端机会目录里没有的机会先存一份本地示例（否则 Quest Details 打不开）；存不进去就什么都不写。
    const copies = opportunitiesNeedingLocalCopy({
      scenarioOpportunities: scenario.opportunities,
      grantOpportunityIds: fresh.opportunity_ids,
      catalogOpportunityIds: bridge.quest_opportunity_ids,
    });
    if (!storeLocalOpportunities(copies).ok) {
      focusNext.current = "write";
      setMessage(WRITE_FAILED_COPY);
      refresh();
      return;
    }
    const res = applyBridgeGrants(fresh.grants);
    if (res.ok) focusNext.current = "undo";
    setMessage(res.ok ? `Wrote ${plural(fresh.grants.length, "simulated grant")} in this browser.` : WRITE_FAILED);
    refresh();
  };

  const onUndo = () => {
    const res = undoBridgeGrants(scenario);
    if (res.ok) focusNext.current = "write";
    const keptCopy = readLocalOpportunityIds(scenario.opportunities.map((o) => o.id)).length > 0;
    setMessage(
      res.ok
        ? `Removed ${plural(res.removed, "simulated grant")}. Other grants were not touched.${keptCopy ? COPY_KEPT_NOTE : ""}`
        : UNDO_FAILED,
    );
    refresh();
  };

  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-3 rounded border border-gray-300 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          Send approved support to the student side
        </h2>
        <span className="flex shrink-0 flex-wrap gap-1">
          <span className={TAG_CLASS}>Local demo</span>
          <span className={TAG_CLASS}>Simulated</span>
        </span>
      </div>
      <div role="note" className="rounded border-2 border-amber-600 bg-amber-50 p-3 text-amber-950">
        <p className="font-semibold">{BRIDGE_DEMO_NOTICE}</p>
      </div>
      <p className="text-sm text-gray-700">{EXPLANATION}</p>
      {/* 只在本场景真的可能写入（有可载入的示例档案）且机会不在学生端目录里时才说明。 */}
      {Object.keys(bridge.roster).length > 0 &&
        scenario.opportunities.some((o) => !bridge.quest_opportunity_ids.includes(o.id)) && (
          <p className="text-sm text-gray-700">{LOCAL_COPY_NOTE}</p>
        )}

      {local === null ? (
        <p className="text-sm text-gray-700">{CHECKING_TEXT}</p>
      ) : (
        <BridgeBody
          scenario={scenario}
          bridge={bridge}
          local={local}
          decision={decide(local.profile)}
          ids={{ membership: membershipId, reason: reasonId }}
          writeRef={writeRef}
          undoRef={undoRef}
          onWrite={onWrite}
          onUndo={onUndo}
        />
      )}

      <p ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="text-sm font-medium">
        {message}
      </p>
    </section>
  );
}

function BridgeBody({
  scenario,
  bridge,
  local,
  decision,
  ids,
  writeRef,
  undoRef,
  onWrite,
  onUndo,
}: {
  scenario: Scenario;
  bridge: ClientBridgeInfo;
  local: LocalData;
  decision: BridgeDecision;
  ids: { membership: string; reason: string };
  writeRef: RefObject<HTMLButtonElement | null>;
  undoRef: RefObject<HTMLButtonElement | null>;
  onWrite: () => void;
  onUndo: () => void;
}) {
  const { profile, applied, localOpportunityIds } = local;
  const membership = decision.membership_sentence;
  // 「不在本场景」时原因与那句话相同：只说一次，按钮的说明指向那句话。
  const reasonIsMembership = decision.reason !== null && decision.reason === membership;
  const describedBy = decision.can_apply ? undefined : reasonIsMembership ? ids.membership : ids.reason;

  const membershipLine = membership !== null && (
    <p id={ids.membership} className="font-medium">
      {membership}
    </p>
  );

  if (applied.length === 0) {
    return (
      <div className="space-y-2">
        {membershipLine}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            ref={writeRef}
            disabled={!decision.can_apply}
            aria-describedby={describedBy}
            onClick={onWrite}
            className={BUTTON_CLASS}
          >
            Write simulated support for the loaded sample profile
          </button>
          {!decision.can_apply && decision.reason !== null && !reasonIsMembership && (
            <p id={ids.reason} className="min-w-0 text-sm text-gray-700">
              {decision.reason}
            </p>
          )}
        </div>
        {decision.state === "no_profile" && (
          <p className="text-sm">
            <Link href="/passport">Open Skill Passport</Link>
          </p>
        )}
      </div>
    );
  }

  // 有 Quest Details 页面的机会：目录里的，加上已存成本地示例的。
  const summary = summarizeApplied({
    applied,
    profile,
    decision,
    questOpportunityIds: [...bridge.quest_opportunity_ids, ...localOpportunityIds],
  });
  const { others, plan_changed: planChanged, quest_opportunity_ids: questIds, has_placeholder: hasPlaceholder } = summary;
  const titleOf = (id: string) => scenario.opportunities.find((o) => o.id === id)?.title ?? id;

  return (
    <div className="space-y-2">
      {membershipLine}
      <p className="text-sm">Written in this browser: {plural(applied.length, "simulated grant")} from this scenario.</p>
      {others > 0 && (
        <p className="text-sm">
          {others} of them {pluralNoun(others, "belongs", "belong")} to a sample profile that is not loaded now; Undo removes those too.
        </p>
      )}
      {planChanged && <p className="text-sm font-medium">{PLAN_CHANGED_NOTE}</p>}
      {questIds.length > 0 && (
        <ul className="space-y-1 text-sm">
          {questIds.map((id) => (
            <li key={id} className="break-words">
              <Link href={`/quests/${encodeURIComponent(id)}`}>Open Quest Details: {titleOf(id)}</Link>
            </li>
          ))}
        </ul>
      )}
      {hasPlaceholder && <p className="text-sm text-gray-700">{PLACEHOLDER_NOTE}</p>}
      <p className="text-sm text-gray-700">{RECHECK_NOTE}</p>
      <button type="button" ref={undoRef} onClick={onUndo} className={BUTTON_CLASS}>
        Undo: remove the simulated support written from this scenario
      </button>
    </div>
  );
}
