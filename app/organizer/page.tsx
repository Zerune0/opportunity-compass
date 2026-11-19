import type { Metadata } from "next";
import { SCENARIOS } from "@/lib/joint/scenarios";
import { findCatalogOpportunity, sampleProfiles } from "@/lib/data";
import WhatIf from "./what-if";
import type { ClientScenarioEntry } from "./what-if";
import { toClientScenarioEntry } from "./client-entry";

export const metadata: Metadata = {
  title: "Organizer What-if (Simulated) · Opportunity Compass",
  description:
    "Simulated organizer resource allocation on sample scenarios: newly reachable, lost, net change, cost, fairness floors and baseline comparison. Simulated results. They do not represent real-world impact.",
};

/**
 * Server component：在服务器端把每个演示场景匿名化（学生 id → s1…sN，按场景人数补零，如 10 人时为 s01…s10；
 * 去掉姓名 / 学校 / 出生日期 / 自由文本），
 * 连同各自的预设公平底线（示例）与「回到学生端的桥」所需的信息一起作为 props 传给客户端组件
 * （整理过程在 ./client-entry 的 toClientScenarioEntry，测试检查的就是它的输出）。
 * 场景专用的示例学生保持匿名：他们的 id、姓名、学校不会进入浏览器 JS。
 * 进入浏览器的原始 id 只有「可载入的示例档案」（data/profiles.json，本来就在 Skill Passport 公开）的 id，
 * 而且只有当它们是该场景的学生时才出现（桥的 roster：原始 id → 匿名编号）。
 * device-loan 与 venue-tradeoff 用占位机会、只有场景专用学生，roster 为空；
 * 共享支持场景（lib/joint/scenarios 的 sharedSupportScenario，两个 ref 都填好后才出现）目前引用的是
 * device-loan 场景里的示例机会 placeholder-inperson-event（页面照常标 Placeholder，不显示「真实机会」说明），
 * 演示学生在 roster 里；模板支持以后把 ref 换成已核实目录里的真实机会，那时页面才显示
 * 「真实机会 + 示例学生 + 模拟支持方」的说明。
 * lib/data 与 lib/joint/scenarios 只在这里（服务器端）import，客户端组件不要 import 它们。
 */
export default function OrganizerPage() {
  const loadableProfileIds = sampleProfiles().map((p) => p.id);
  const entries: ClientScenarioEntry[] = SCENARIOS.map((e) =>
    toClientScenarioEntry(e, {
      loadableProfileIds,
      catalogOpportunityIds: e.scenario.opportunities.filter((o) => findCatalogOpportunity(o.id) !== null).map((o) => o.id),
    }),
  );
  return <WhatIf entries={entries} />;
}
