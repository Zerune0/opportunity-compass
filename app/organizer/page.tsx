import type { Metadata } from "next";
import { anonymizeScenarioForClient, deviceLoanScenario } from "@/lib/joint/scenarios";
import WhatIf from "./what-if";

export const metadata: Metadata = {
  title: "主办方 What-if（模拟）· Opportunity Compass",
  description: "示例场景下的主办方资源分配模拟：新增可达、失去可达、净变化与成本。模拟结果，不代表真实影响。",
};

/**
 * Server component：在服务器端把示例场景匿名化（学生 id → s01…、去掉姓名 / 学校 / 自由文本），
 * 只把匿名化后的场景作为 prop 传给客户端组件，示例学生的姓名、学校不会进入浏览器 JS。
 */
export default function OrganizerPage() {
  const scenario = anonymizeScenarioForClient(deviceLoanScenario);
  return <WhatIf scenario={scenario} />;
}
