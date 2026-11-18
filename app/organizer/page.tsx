import type { Metadata } from "next";
import { anonymizeScenarioForClient, SCENARIOS } from "@/lib/joint/scenarios";
import WhatIf from "./what-if";
import type { ClientScenarioEntry } from "./what-if";

export const metadata: Metadata = {
  title: "主办方 What-if（模拟）· Opportunity Compass",
  description:
    "示例场景下的主办方资源分配模拟：新增可达、失去可达、净变化、成本、公平底线与基线对比。模拟结果，不代表真实影响。",
};

/**
 * Server component：在服务器端把每个演示场景匿名化（学生 id → s01…、去掉姓名 / 学校 / 自由文本），
 * 连同各自的预设公平底线（示例）一起作为 props 传给客户端组件；示例学生的 id、姓名、学校不会进入浏览器 JS。
 */
export default function OrganizerPage() {
  const entries: ClientScenarioEntry[] = SCENARIOS.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    scenario: anonymizeScenarioForClient(e.scenario),
    floors: e.suggestedFairnessFloors.map((f) => ({ ...f, statuses_any_of: [...f.statuses_any_of] })),
  }));
  return <WhatIf entries={entries} />;
}
