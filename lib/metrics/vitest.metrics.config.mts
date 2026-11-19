// `npm run metrics` 的 Vitest 配置：只运行 lib/metrics/run.metrics.ts（打印可靠性指标，不写文件、不做断言）。
// 用法：vitest run --config lib/metrics/vitest.metrics.config.mts
// 普通的 `npm test`（根目录 vitest.config.mts，只收 *.test.ts）不会运行这个文件。
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 仓库根目录（本文件在 lib/metrics/ 下）。
const root = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  root,
  resolve: {
    alias: {
      // 与根目录 vitest.config.mts / tsconfig "paths": { "@/*": ["./*"] } 相同
      "@": root,
    },
  },
  test: {
    environment: "node",
    include: ["lib/metrics/run.metrics.ts"],
    // 穷举对照与基线对比可能需要几秒到几十秒（视机器而定），不要按单测的 5 秒超时。
    testTimeout: 600_000,
  },
});
