import type { Metadata } from "next";
import { buildClientBridgeInfo } from "@/lib/joint/bridge";
import { anonymizeScenarioForClient, SCENARIOS } from "@/lib/joint/scenarios";
import { findCatalogOpportunity, sampleProfiles } from "@/lib/data";
import WhatIf from "./what-if";
import type { ClientScenarioEntry } from "./what-if";

export const metadata: Metadata = {
  title: "Organizer What-if (Simulated) · Opportunity Compass",
  description:
    "Simulated organizer resource allocation on sample scenarios: newly reachable, lost, net change, cost, fairness floors and baseline comparison. Simulated results. They do not represent real-world impact.",
};

/**
 * Server component：在服务器端把每个演示场景匿名化（学生 id → s01…、去掉姓名 / 学校 / 自由文本），
 * 连同各自的预设公平底线（示例）与「回到学生端的桥」所需的信息（buildClientBridgeInfo）一起作为 props 传给客户端组件。
 * 场景专用的示例学生保持匿名：他们的 id、姓名、学校不会进入浏览器 JS。
 * 进入浏览器的原始 id 只有「可载入的示例档案」（data/profiles.json，本来就在 Skill Passport 公开）的 id，
 * 而且只有当它们是该场景的学生时才出现（桥的 roster：原始 id → 匿名编号）；目前两个演示场景都没有这样的学生，roster 为空。
 * lib/data 与 lib/joint/scenarios 只在这里（服务器端）import，客户端组件不要 import 它们。
 */
export default function OrganizerPage() {
  const loadableProfileIds = sampleProfiles().map((p) => p.id);
  const entries: ClientScenarioEntry[] = SCENARIOS.map((e) => {
    const anonymized = anonymizeScenarioForClient(e.scenario);
    return {
      id: e.id,
      title: e.title,
      description: e.description,
      scenario: anonymized,
      floors: e.suggestedFairnessFloors.map((f) => ({ ...f, statuses_any_of: [...f.statuses_any_of] })),
      bridge: buildClientBridgeInfo({
        original: e.scenario,
        anonymized,
        loadableProfileIds,
        catalogOpportunityIds: e.scenario.opportunities.filter((o) => findCatalogOpportunity(o.id) !== null).map((o) => o.id),
        provider: e.sampleOrganizer,
      }),
    };
  });
  return <WhatIf entries={entries} />;
}
