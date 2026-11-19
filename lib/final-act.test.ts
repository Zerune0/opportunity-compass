/**
 * 演示最后一幕的「接线」测试：用仓库里真实的场景文件和真实的示例档案，走主办方端的桥要走的那条路。
 *
 *   主办方场景里的示例机会（data/scenarios/device-loan.json，不在学生端机会目录里）
 *     → addUserPostedOpportunity 存到本地，学生端的 Quest Details 才打得开它
 *     → addGrants 写入一条已批准的笔记本借用
 *     → 学生端用 grantsFor 读到它，analyzeReachability 从不可达变为可达
 *     → removeGrants 撤回，回到不可达
 *
 * lib/demo-mainline.test.ts 用的是本文件内的虚构夹具；这里钉住的是「仓库里现有的数据组合确实走得通」：
 * 如果有人改了场景里的机会、示例档案或存储函数，使最后一幕演示不出来，这里会先失败。
 * 机会与支持都是示例 / 模拟数据；可达 ≠ 录取。
 */
import { afterEach, describe, expect, it } from 'vitest';
import scenarioJson from '@/data/scenarios/device-loan.json';
import { catalogOpportunities, sampleProfiles } from './data';
import { checkEligibility } from './eligibility';
import { analyzeGaps } from './gap';
import { explainMatch } from './match';
import { analyzeReachability } from './reachability';
import {
  addGrants,
  addUserPostedOpportunity,
  grantsByIntervention,
  grantsFor,
  loadGrants,
  loadUserPostedOpportunities,
  removeGrants,
} from './store';
import type { Opportunity, ResourceGrant, Scenario } from './types';
import { validateOpportunity } from './validation';

const scenario = scenarioJson as unknown as Scenario;
const OPP = scenario.opportunities[0] as Opportunity;
const MAYA = sampleProfiles().find((p) => p.id === 'sample-maya')!;
const TODAY = { today: '2026-11-19' };

const LOAN: ResourceGrant = {
  id: 'iv-laptop-loan:sample-maya',
  student_id: MAYA.id,
  opportunity_id: OPP.id,
  intervention_id: 'iv-laptop-loan',
  type: 'device',
  device: 'laptop',
  status: 'approved',
  provider: 'Sample organizer (placeholder)',
};

function installFakeWindow(): void {
  const data = new Map<string, string>();
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('演示最后一幕：仓库里现有的场景与示例档案走得通', () => {
  it('前提：场景里的机会是标明的示例，不在学生端的机会目录里，结构合法', () => {
    expect(scenario.is_sample).toBe(true);
    expect(OPP.id).toBe('placeholder-inperson-event');
    expect(OPP.is_sample).toBe(true);
    expect(OPP.official_url).toContain('example.com');
    expect(catalogOpportunities().some((o) => o.id === OPP.id)).toBe(false);
    expect(validateOpportunity(OPP)).toEqual([]);
    expect(scenario.interventions.some((i) => i.id === 'iv-laptop-loan')).toBe(true);
    expect(MAYA.is_sample).toBe(true);
  });

  it('没有支持时：Maya 资格符合，唯一未化解的障碍是设备，结果不可达', () => {
    expect(checkEligibility(MAYA, OPP, TODAY).overall).toBe('eligible');
    const reach = analyzeReachability(MAYA, OPP, [], TODAY);
    expect(reach.reachable).toBe(false);
    expect(reach.barriers.filter((b) => !b.resolved).map((b) => b.type)).toEqual(['device']);
    expect(reach.missing_info).toEqual([]);

    const gaps = analyzeGaps(MAYA, OPP, [], TODAY);
    expect(gaps.counts.time_and_cost).toBe(1);
    expect(gaps.counts.unchangeable_eligibility).toBe(0);
    expect(explainMatch(MAYA, OPP, TODAY).reasons.find((r) => r.kind === 'device')?.positive).toBe(false);
  });

  it('桥的路径：存机会 → 写入支持 → 学生端读到并变为可达 → 撤回后回到不可达', () => {
    installFakeWindow();

    // 学生端只认机会目录和本地存的机会；存进去之后 Quest Details 才打得开。
    addUserPostedOpportunity(OPP);
    const posted = loadUserPostedOpportunities().find((o) => o.id === OPP.id);
    expect(posted).toBeDefined();
    expect(posted!.is_sample).toBe(true);
    expect(posted!.source_tier).toBe('user_posted');

    // 写入：调用方没标 is_sample，存储层一律标上，学生端据此显示 "Simulated support"。
    addGrants([LOAN]);
    const mine = grantsFor(MAYA.id, OPP.id);
    expect(mine.map((g) => g.id)).toEqual([LOAN.id]);
    expect(mine[0].is_sample).toBe(true);

    const after = analyzeReachability(MAYA, posted!, mine, TODAY);
    expect(after.reachable).toBe(true);
    const device = after.barriers.find((b) => b.type === 'device')!;
    expect(device.resolved).toBe(true);
    expect(device.resolved_by_grant_ids).toEqual([LOAN.id]);
    expect(explainMatch(MAYA, posted!, { ...TODAY, grants: mine }).reasons.find((r) => r.kind === 'device')?.positive).toBe(true);
    expect(analyzeGaps(MAYA, posted!, mine, TODAY).counts.time_and_cost).toBe(0);

    // 撤回：刷新页面后按措施找回，再按 id 删除。
    removeGrants(grantsByIntervention('iv-laptop-loan').map((g) => g.id));
    expect(loadGrants()).toEqual([]);
    expect(analyzeReachability(MAYA, posted!, grantsFor(MAYA.id, OPP.id), TODAY).reachable).toBe(false);
  });

  it('待审批的支持、给别的学生的支持，都不会让 Maya 变为可达', () => {
    const pending: ResourceGrant = { ...LOAN, id: 'pending', status: 'pending', is_sample: true };
    const other: ResourceGrant = { ...LOAN, id: 'other', student_id: 'dl-s01', is_sample: true };
    expect(analyzeReachability(MAYA, OPP, [pending], TODAY).reachable).toBe(false);
    expect(analyzeReachability(MAYA, OPP, [other], TODAY).reachable).toBe(false);
  });

  it('其他三名示例学生在这条机会上资格不符：演示这一步只能用 Maya', () => {
    const others = sampleProfiles().filter((p) => p.id !== MAYA.id);
    expect(others.map((p) => checkEligibility(p, OPP, TODAY).overall)).toEqual(others.map(() => 'not_eligible'));
  });
});
