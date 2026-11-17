import type { Metadata } from "next";
import WhatIf from "./what-if";

export const metadata: Metadata = {
  title: "主办方 What-if（模拟）· Opportunity Compass",
  description: "示例场景下的主办方资源分配模拟：新增可达、失去可达、净变化与成本。模拟结果，不代表真实影响。",
};

export default function OrganizerPage() {
  return <WhatIf />;
}
