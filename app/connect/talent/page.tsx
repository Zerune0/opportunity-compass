import type { Metadata } from "next";
import { samplePublishers } from "@/lib/connect/publishers";
import { TalentBoard } from "./TalentBoard";

export const metadata: Metadata = {
  title: "Talent Board (Local demo) · Opportunity Compass",
  description:
    "Choose what a fictional sample publisher could see about your profile. Sharing is off by default and can be turned off at any time. Nothing leaves this browser.",
};

/** Server component：在服务器端读取并校验示例发布者，作为 props 交给客户端组件（邀请只能以它们的名义发出）。 */
export default function TalentBoardPage() {
  return <TalentBoard publishers={samplePublishers()} />;
}
