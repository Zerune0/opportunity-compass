/**
 * 服务器端用：把一个演示场景（lib/joint/scenarios 的 ScenarioEntry）整理成交给客户端组件的 ClientScenarioEntry。
 * ./page.tsx 调用它；测试（./client-entry.test.ts）用它检查进入浏览器的内容，保证与页面完全一致。
 *
 * - 场景经 anonymizeScenarioForClient 匿名化（学生 id → s1…sN，按场景人数补零，如 10 人时为 s01…s10；
 *   去掉姓名 / 学校 / 出生日期 / 自由文本）；
 * - 「回到学生端的桥」的信息由 buildClientBridgeInfo 给出：进入浏览器的原始 id 只有「可载入的示例档案」的 id，
 *   而且只有当它们是该场景的学生时才出现（roster）；
 * - 用真实目录机会的场景带上 realOpportunityNote（页面原样显示）；其余为 null。
 * 不 import lib/data 或任何 JSON（目录查找由调用方传入 catalogOpportunityIds）；ScenarioEntry 只是类型导入。
 * 纯函数：不修改输入。
 */
import { buildClientBridgeInfo } from "@/lib/joint/bridge";
import { anonymizeScenarioForClient } from "@/lib/joint/scenario-utils";
import type { ScenarioEntry } from "@/lib/joint/scenarios";
import type { ClientScenarioEntry } from "./what-if";

export function toClientScenarioEntry(
  entry: ScenarioEntry,
  args: {
    /** data/profiles.json 里可载入的示例档案 id。 */
    loadableProfileIds: readonly string[];
    /** 该场景里在已核实目录中的机会 id。 */
    catalogOpportunityIds: readonly string[];
  },
): ClientScenarioEntry {
  const anonymized = anonymizeScenarioForClient(entry.scenario);
  return {
    id: entry.id,
    title: entry.title,
    description: entry.description,
    scenario: anonymized,
    floors: entry.suggestedFairnessFloors.map((f) => ({ ...f, statuses_any_of: [...f.statuses_any_of] })),
    bridge: buildClientBridgeInfo({
      original: entry.scenario,
      anonymized,
      loadableProfileIds: args.loadableProfileIds,
      catalogOpportunityIds: args.catalogOpportunityIds,
      provider: entry.sampleOrganizer,
    }),
    realOpportunityNote: entry.realOpportunityNote ?? null,
  };
}
