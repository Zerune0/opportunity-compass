/**
 * `npm run metrics` 的入口（由 lib/metrics/vitest.metrics.config.mts 运行）：
 *   vitest run --config lib/metrics/vitest.metrics.config.mts
 *
 * 对 lib/joint/scenarios 的全部示例场景计算可靠性指标（./reliability），把纯文本表（./format）和 JSON 打到 stdout。
 * 墙钟运行时间只在这里测（纯函数文件不读时钟）：依赖机器，只标注，不做任何断言；第一个场景的时间含预热。
 * 不写任何文件；不做指标断言（性质断言在 ./reliability.test.ts 等，随 npm test 运行）。
 * 输出只含汇总数字，不含学生的姓名、id、学校或年龄。全部为示例 / 模拟结果。
 */
import { it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { SCENARIOS } from '../joint/scenarios';
import { solveJoint } from '../joint';
import { formatReliabilityReport } from './format';
import type { RuntimeEntry } from './format';
import { buildCases, buildReport, measureScenario } from './reliability';
import type { ScenarioMetrics } from './reliability';

it('prints reliability metrics for the sample / simulated scenarios', () => {
  const runtime: RuntimeEntry[] = [];
  const scenarios: ScenarioMetrics[] = [];
  for (const entry of SCENARIOS) {
    const cases = buildCases(entry);
    // 求解器本身的时间：每个用例单独调用一次 solveJoint。
    let solverMs = 0;
    for (const c of cases) {
      const t0 = performance.now();
      solveJoint(c.scenario, c.options);
      solverMs += performance.now() - t0;
    }
    // 整个测量（两次求解、基线对比、复核、穷举对照）的时间。用例由 measureScenario 自己构建（构建出错时会记成一条出错用例）。
    const h0 = performance.now();
    scenarios.push(measureScenario(entry));
    const harnessMs = performance.now() - h0;
    runtime.push({ scenario_id: entry.id, solver_ms: solverMs, solves: cases.length, harness_ms: harnessMs });
  }
  // 与 measureAll 的结果同形（measureAll 本身不计时，这里逐场景计时后用同一个 buildReport 拼装）。
  const report = buildReport(scenarios);

  const text = formatReliabilityReport(report, { runtime });
  // 这里测了运行时间，所以从 not_measured 中去掉 runtime。
  const json = JSON.stringify(
    {
      ...report,
      not_measured: report.not_measured.filter((m) => m.metric !== 'runtime'),
      runtime: {
        note: 'Wall-clock milliseconds on this machine; machine-dependent, not evidence of correctness. The first scenario includes warm-up.',
        by_scenario: runtime,
      },
    },
    null,
    2,
  );
  process.stdout.write(`\n${text}\n\nJSON (same data; sample / simulated scenarios):\n${json}\n`);
});
