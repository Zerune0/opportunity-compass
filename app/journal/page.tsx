import type { Metadata } from "next";
import { JournalPage } from "./JournalPage";

export const metadata: Metadata = {
  title: "Quest Journal · Opportunity Compass",
  description:
    "Your own record of the opportunities you are working on: application, organizer eligibility confirmation, admission decision and participation kept apart, your materials, and a joint plan across your quests. Stored only in this browser.",
};

export default function Page() {
  return <JournalPage />;
}
