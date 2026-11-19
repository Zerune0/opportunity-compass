import type { Metadata } from "next";
import { samplePublishers } from "@/lib/connect/publishers";
import { QuestCreator } from "./QuestCreator";

export const metadata: Metadata = {
  title: "Quest Creator (Local demo) · Opportunity Compass",
  description:
    "Post a quest as a fictional sample publisher. It is saved only in this browser. On the Quest Board and Quest Details it is labelled Sample and User-posted.",
};

/** Server component：在服务器端读取并校验示例发布者，作为 props 交给客户端表单（发布者只能从中选择）。 */
export default function QuestCreatorPage() {
  return <QuestCreator publishers={samplePublishers()} />;
}
