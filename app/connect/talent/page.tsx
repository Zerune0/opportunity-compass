import type { Metadata } from "next";
import { TalentBoard } from "./TalentBoard";

export const metadata: Metadata = {
  title: "Talent Board (Local demo) · Opportunity Compass",
  description:
    "Choose what a fictional sample publisher could see about your profile. Sharing is off by default and can be turned off at any time. Nothing leaves this browser.",
};

export default function TalentBoardPage() {
  return <TalentBoard />;
}
