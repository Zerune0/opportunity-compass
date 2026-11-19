/**
 * 第四阶段契约（2026-11-18）测试：只覆盖新增的类型常量、存储函数、校验与「引擎行为不变」。
 * 引擎尚未生成 competition 路线、stepping_stone / remote_option 建议，也尚未填写 RouteStep 的三个说明字段。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { applyBackup, parseBackup } from './backup';
import { catalogOpportunities, sampleProfiles } from './data';
import { findAlternatives } from './match';
import { diffRoutes, planRoutes } from './path';
import {
  DEFAULT_VIEW_PREFERENCE,
  STORE_KEYS,
  loadProfile,
  loadViewPreference,
  saveViewPreference,
  storageKey,
} from './store';
import { ROUTE_STEP_OFFICIAL_KINDS, ROUTE_TYPES, VIEW_PREFERENCES, type PlanResult, type ViewPreference } from './types';
import { validateOpportunities, validateOpportunity } from './validation';
import opportunitiesJson from '@/data/opportunities.json';

function installFakeWindow(): Map<string, string> {
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
  return data;
}

/** localStorage 访问即抛错（如部分隐私模式）。 */
function installThrowingWindow(): void {
  const throwing = () => {
    throw new Error('blocked');
  };
  (globalThis as { window?: unknown }).window = {
    get localStorage() {
      return { getItem: throwing, setItem: throwing, removeItem: throwing };
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('契约 p4：常量', () => {
  it('ROUTE_TYPES 含四项，competition 追加在末尾', () => {
    expect(ROUTE_TYPES).toEqual(['learning_first', 'practice_first', 'community', 'competition']);
  });

  it('ROUTE_STEP_OFFICIAL_KINDS 与 VIEW_PREFERENCES', () => {
    expect(ROUTE_STEP_OFFICIAL_KINDS).toEqual(['official_requirement', 'team_suggestion', 'application_step']);
    expect(VIEW_PREFERENCES).toEqual(['adventure', 'classic']);
  });
});

describe('契约 p4：地图视图偏好', () => {
  it('默认值为 adventure（SSR 与空浏览器）', () => {
    expect(DEFAULT_VIEW_PREFERENCE).toBe('adventure');
    expect(loadViewPreference()).toBe('adventure');
    expect(() => saveViewPreference('classic')).not.toThrow();
    installFakeWindow();
    expect(loadViewPreference()).toBe('adventure');
  });

  it('保存后读取', () => {
    const data = installFakeWindow();
    saveViewPreference('classic');
    expect(data.get(storageKey(STORE_KEYS.viewPreference))).toBe('"classic"');
    expect(loadViewPreference()).toBe('classic');
    saveViewPreference('adventure');
    expect(loadViewPreference()).toBe('adventure');
  });

  it('非法值、损坏 JSON 回退 adventure；保存非法值时不写', () => {
    const data = installFakeWindow();
    data.set(storageKey(STORE_KEYS.viewPreference), '"table"');
    expect(loadViewPreference()).toBe('adventure');
    data.set(storageKey(STORE_KEYS.viewPreference), '{broken');
    expect(loadViewPreference()).toBe('adventure');
    data.set(storageKey(STORE_KEYS.viewPreference), '42');
    expect(loadViewPreference()).toBe('adventure');
    data.delete(storageKey(STORE_KEYS.viewPreference));
    saveViewPreference('grid' as ViewPreference);
    expect(data.has(storageKey(STORE_KEYS.viewPreference))).toBe(false);
  });

  it('localStorage 不可用（访问即抛错）时不抛错', () => {
    installThrowingWindow();
    expect(loadViewPreference()).toBe('adventure');
    expect(() => saveViewPreference('classic')).not.toThrow();
  });
});

describe('契约 p4：备份与视图偏好', () => {
  const PROFILE = { id: 'p1', is_sample: true, display_name: 'Sample', evidence: [] };

  it('旧备份文件（没有 view_preference）照常导入，偏好回到默认', () => {
    const old = JSON.stringify({ app: 'opportunity-compass', format_version: 1, exported_on: '2026-11-10', data: { profile: PROFILE, saved_opportunity_ids: ['a'] } });
    const r = parseBackup(old);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.backup.data.view_preference).toBeNull();
    const data = installFakeWindow();
    saveViewPreference('classic');
    expect(applyBackup(r.backup).ok).toBe(true);
    expect(loadProfile()?.id).toBe('p1');
    expect(data.has(storageKey(STORE_KEYS.viewPreference))).toBe(false);
    expect(loadViewPreference()).toBe('adventure');
  });

  it('新备份带 view_preference 时导入；非法值丢弃并 warning', () => {
    const ok = parseBackup({ app: 'opportunity-compass', format_version: 1, data: { view_preference: 'classic' } });
    expect(ok.ok && ok.backup.data.view_preference).toBe('classic');
    installFakeWindow();
    if (ok.ok) expect(applyBackup(ok.backup).ok).toBe(true);
    expect(loadViewPreference()).toBe('classic');

    const bad = parseBackup({ app: 'opportunity-compass', format_version: 1, data: { view_preference: 'grid' } });
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(bad.backup.data.view_preference).toBeNull();
    expect(bad.warnings.join('\n')).toMatch(/Map view preference: the value in this file is not valid/);
  });
});

describe('契约 p4：validateOpportunity 接受 team_requirement', () => {
  const base = catalogOpportunities()[0];

  it('现有目录机会全部继续通过', () => {
    expect(validateOpportunities(opportunitiesJson)).toEqual([]);
  });

  it.each([
    ['缺失', undefined],
    ['null', null],
    ['未知', { required: null, source_text: null }],
    ['必须组队带人数', { required: true, min_size: 2, max_size: 4, source_text: 'Teams of 2-4 students.' }],
    ['个人参加', { required: false, min_size: null, max_size: null, source_text: 'Individuals may enter.' }],
    ['min = max', { required: true, min_size: 3, max_size: 3, source_text: null }],
    ['只有 min', { required: true, min_size: 0, source_text: null }],
  ])('合法：%s', (_label, team) => {
    const opp = { ...base } as Record<string, unknown>;
    if (team === undefined) delete opp.team_requirement;
    else opp.team_requirement = team;
    expect(validateOpportunity(opp)).toEqual([]);
  });

  it.each([
    ['不是对象', 'yes', 'team_requirement'],
    ['数组', [], 'team_requirement'],
    ['required 是字符串', { required: 'yes', source_text: null }, 'team_requirement.required'],
    ['缺 required', { source_text: null }, 'team_requirement.required'],
    ['min_size 负数', { required: true, min_size: -1, source_text: null }, 'team_requirement.min_size'],
    ['max_size 小数', { required: true, max_size: 2.5, source_text: null }, 'team_requirement.max_size'],
    ['min > max', { required: true, min_size: 5, max_size: 2, source_text: null }, 'team_requirement.min_size'],
    ['source_text 是数字', { required: true, source_text: 3 }, 'team_requirement.source_text'],
    ['缺 source_text', { required: true }, 'team_requirement.source_text'],
  ])('非法：%s', (_label, team, field) => {
    const problems = validateOpportunity({ ...base, team_requirement: team });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toContain(`field ${field}:`);
  });
});

describe('契约 p4：引擎行为不变', () => {
  const profiles = sampleProfiles();
  const catalog = catalogOpportunities();
  const TODAY = '2026-11-18';

  it('contract only: planRoutes 不生成 competition 路线、findAlternatives 不给两种新 kind（下一层实现时有意修改本测试）', () => {
    expect(profiles.length).toBeGreaterThan(0);
    expect(catalog.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      for (const opp of catalog) {
        for (const options of [undefined, { today: TODAY }, { today: TODAY, catalog }]) {
          let plan: PlanResult | null = null;
          try {
            plan = planRoutes(profile, opp, options);
          } catch {
            plan = null;
          }
          if (plan) {
            expect(plan.routes.some((r) => r.type === 'competition')).toBe(false);
            for (const route of plan.routes) {
              for (const step of route.steps) {
                expect(step).not.toHaveProperty('relation');
                expect(step).not.toHaveProperty('official');
                expect(step).not.toHaveProperty('evidence_needed');
              }
            }
          }
          const alts = findAlternatives(profile, opp, catalog, options);
          expect(alts.some((a) => a.kind === 'stepping_stone' || a.kind === 'remote_option')).toBe(false);
        }
      }
    }
  });

  it('contract only: 传入 options.catalog 时 planRoutes 的结果与不传完全相同', () => {
    for (const profile of profiles) {
      for (const opp of catalog) {
        let without: unknown;
        let withCatalog: unknown;
        try {
          without = planRoutes(profile, opp, { today: TODAY });
        } catch (e) {
          without = String(e);
        }
        try {
          withCatalog = planRoutes(profile, opp, { today: TODAY, catalog });
        } catch (e) {
          withCatalog = String(e);
        }
        expect(withCatalog).toStrictEqual(without);
      }
    }
  });

  it('diffRoutes 不比较 RouteStep 的 relation / official / evidence_needed', () => {
    const profile = profiles[0];
    const opp = catalog.find((o) => {
      const p = planRoutes(profile, o, { today: TODAY });
      return p.status === 'routes' && p.routes.length > 0 && p.routes[0].steps.length > 0;
    });
    expect(opp).toBeDefined();
    if (!opp) return;
    const before = planRoutes(profile, opp, { today: TODAY });
    if (before.status !== 'routes') return;
    const after: PlanResult = {
      ...before,
      routes: before.routes.map((r) => ({
        ...r,
        steps: r.steps.map((s) => ({ ...s, relation: 'Covers an official prep item', official: 'official_requirement' as const, evidence_needed: 'A public project link' })),
      })),
    };
    const plain = diffRoutes(before, before);
    const annotated = diffRoutes(before, after);
    expect(annotated).toStrictEqual(plain);
    expect(annotated.route_changes.every((c) => c.change === 'unchanged')).toBe(true);
  });
});
