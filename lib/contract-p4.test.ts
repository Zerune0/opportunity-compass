/**
 * 第四阶段契约（2026-11-18）测试：新增的类型常量、存储函数、校验，以及第 1 层实现后仍须守住的「不变」：
 * 不传 options.catalog 时 planRoutes 去掉三个说明字段后与 0905b62 逐字相同；真实目录上 findAlternatives 的旧两类、
 * analyzeGaps 与 0905b62 逐字相同。新功能本身的测试见 lib/engine-p4.test.ts。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { applyBackup, parseBackup } from './backup';
import { catalogOpportunities, sampleProfiles } from './data';
import { analyzeGaps } from './gap';
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
import { ROUTE_STEP_OFFICIAL_KINDS, ROUTE_TYPES, VIEW_PREFERENCES, type PlanResult, type StudentProfile, type ViewPreference } from './types';
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
    ['只有 min', { required: true, min_size: 1, source_text: null }],
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
    ['min_size 为 0', { required: true, min_size: 0, source_text: null }, 'team_requirement.min_size'],
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

  // 「与改动前引擎逐字相同」的基线只对记录时的数据快照有效；数据（data/*.json，归队友 A）变了就跳过，不失败。
  const baseline = lookupBaseline();

  it('基线查找：当前数据指纹是否命中已知基线不影响通过；命中时下面几条必须逐字相等', () => {
    // 哈希函数本身正确（32 位 FNV-1a 的公开测试向量），否则「指纹」与「逐字相同」的对照都没有意义。
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
    // 查找只按当前数据的指纹取表里的那一项：命中时就是那一项，未命中时为 null（不抛错）。
    const fp = fnv1a(JSON.stringify(catalogOpportunities()) + JSON.stringify(sampleProfiles()));
    expect(lookupBaseline()).toBe(BASELINE_HASHES[fp] ?? null);
    // 指纹对数据敏感：改一个字就不再命中（证明跳过条件不是恒真 / 恒假）。
    const edited = fnv1a(JSON.stringify(catalogOpportunities().map((o, i) => (i === 0 ? { ...o, title: `${o.title}!` } : o))) + JSON.stringify(sampleProfiles()));
    expect(edited).not.toBe(fp);
    expect(BASELINE_HASHES[edited]).toBeUndefined();
  });

  it.skipIf(baseline === null)(
    '不传 options.catalog 时，去掉三个说明字段后与改动前引擎（0905b62）逐字相同 (runs only on the data snapshots it was recorded for)',
    () => {
      if (!baseline) return;
      // 摘要：路线类型、步骤 id / 小时 / 费用 / 是否跳过、合计与 feasible（today = 2026-11-19）。
      const digests = profiles.flatMap((p) => catalog.map((o) => `${p.id}|${o.id}|${planDigest(planRoutes(p, o, { today: '2026-11-19' }))}`));
      expect(digests).toEqual(BASELINE_DIGESTS);
      // 全文对照：带 / 不带 today 的完整结果去掉三个说明字段后，序列化哈希与基线相同。
      let all = '';
      for (const options of [{ today: '2026-11-19' }, undefined]) {
        for (const p of profiles) for (const o of catalog) all += JSON.stringify(stripStepNotes(planRoutes(p, o, options)));
      }
      expect(fnv1a(all)).toBe(baseline.plan);
    },
  );

  it.skipIf(baseline === null)(
    '真实目录上 findAlternatives 去掉两种新 kind 后、analyzeGaps 整体，与改动前引擎逐字相同 (runs only on the data snapshots it was recorded for)',
    () => {
      if (!baseline) return;
      let alts = '';
      let gaps = '';
      for (const today of ['2026-11-19', '2027-02-01', undefined]) {
        for (const p of profiles) {
          for (const o of catalog) {
            const opt = today ? { today } : undefined;
            alts += JSON.stringify(findAlternatives(p, o, catalog, opt).filter((a) => a.kind !== 'stepping_stone' && a.kind !== 'remote_option'));
            gaps += JSON.stringify(analyzeGaps(p, o, [], opt));
          }
        }
      }
      expect(fnv1a(alts)).toBe(baseline.alternatives);
      expect(fnv1a(gaps)).toBe(baseline.gaps);
    },
  );

  it.skipIf(baseline === null || baseline.diff == null)(
    '没有 competition 路线的输入上，diffRoutes 与第四阶段修补之前逐字相同 (runs only on the data snapshots it was recorded for)',
    () => {
      let all = '';
      for (const p of profiles) {
        for (const o of catalog) {
          const today = '2026-11-19';
          const variants: StudentProfile[] = [
            { ...p, hours_per_week_available: (p.hours_per_week_available ?? 1) * 3 },
            { ...p, grade: (p.grade ?? 9) + 1 },
            {
              ...p,
              evidence: [
                ...p.evidence,
                ...o.preparation.slice(0, 1).map((pr) => ({ id: 'ev-x', title: 'X', kind: 'project' as const, skills: [], prep_item_ids: [`${o.id}:${pr.id}`], status: 'self_reported' as const, added_on: '2026-11-01' })),
              ],
            },
          ];
          const before = planRoutes(p, o, { today, catalog });
          for (const v of variants) {
            const after = planRoutes(v, o, { today, catalog });
            expect([...before.routes, ...after.routes].some((r) => r.type === 'competition')).toBe(false);
            all += JSON.stringify(diffRoutes(before, after)) + JSON.stringify(diffRoutes(planRoutes(v, o, { today }), before));
          }
        }
      }
      expect(fnv1a(all)).toBe(baseline?.diff);
    },
  );

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
        steps: r.steps.map((s) => ({ ...s, relation: 'Covers an official prep item', official: 'official_requirement' as const, evidence_needed: 'project' as const })),
      })),
    };
    const plain = diffRoutes(before, before);
    const annotated = diffRoutes(before, after);
    expect(annotated).toStrictEqual(plain);
    expect(annotated.route_changes.every((c) => c.change === 'unchanged')).toBe(true);
  });
});

// ───────────── 第四阶段第 1 层：「不传 catalog 时与之前相同」的基线（由改动前的引擎 0905b62 生成） ─────────────

function planDigest(plan: PlanResult): string {
  if (plan.status === 'blocked') return `blocked:${plan.blocking_requirements.map((b) => b.requirement_id).join(',')}`;
  return plan.routes
    .map(
      (r) =>
        `${r.type}[${r.steps.map((s) => `${s.id}/${s.hours}/${s.cost_usd}/${s.skipped ? 's' : '-'}`).join(' ')}] h=${r.total_hours} $=${r.total_cost_usd} f=${r.feasible_by_deadline}`,
    )
    .join(' | ');
}

/** 去掉 RouteStep 的 relation / official / evidence_needed（保持其余键的顺序）。 */
function stripStepNotes(plan: PlanResult): PlanResult {
  if (plan.status !== 'routes') return plan;
  return {
    ...plan,
    routes: plan.routes.map((r) => ({
      ...r,
      steps: r.steps.map((s) => {
        const { relation: _r, official: _o, evidence_needed: _e, ...rest } = s;
        void _r;
        void _o;
        void _e;
        return rest;
      }),
    })),
  };
}

/** 32 位 FNV-1a，只用来比较序列化结果是否逐字相同。 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 序列化哈希依赖 data/*.json 的内容，所以按数据指纹（目录 + 示例档案的序列化哈希）分别记录，
 * 用不含第四阶段第 1 层的引擎（origin/main 8f8b87a）算出；main 上的引擎再变时需重新生成。数据变了（指纹未知）时相关测试跳过，不失败；
 * 想恢复这项对照，需用改动前的引擎在新数据上重新生成（不要直接改成当前输出）。
 * BASELINE_DIGESTS 在这两份数据上相同。
 */
interface Baseline {
  label: string;
  plan: string;
  alternatives: string;
  gaps: string;
  /** diffRoutes 在没有 competition 的输入上的序列化哈希（用评审修补前的 diff.ts，64afaee，生成）；没记录时为缺省。 */
  diff?: string;
}

const BASELINE_HASHES: Record<string, Baseline> = {
  // 由 origin/main 8f8b87a（含「参与形式未知」改动、不含第四阶段第 1 层）的引擎在这份数据上生成。
  aea3ba98: { label: 'data at origin/main 3509d8e–8f8b87a', plan: '09311aab', alternatives: '4a7b4cff', gaps: '13286278', diff: 'f8b41e6e' },
};

/** 当前数据命中已知基线时返回它，否则 null（不抛错）。 */
function lookupBaseline(): Baseline | null {
  const fp = fnv1a(JSON.stringify(catalogOpportunities()) + JSON.stringify(sampleProfiles()));
  return BASELINE_HASHES[fp] ?? null;
}

const BASELINE_DIGESTS: string[] = [
  "sample-maya|mlh-open-source-week-2026|learning_first[practice-open-source-pr/1/0/- submit-application/0/0/-] h=1 $=0 f=null | practice_first[practice-open-source-pr/1/0/- submit-application/0/0/-] h=1 $=0 f=null | community[find-partner/2/0/- practice-open-source-pr/1/0/- submit-application/0/0/-] h=3 $=0 f=null",
  "sample-maya|rutgers-newark-summer-research-2027|blocked:undergraduate",
  "sample-maya|doe-suli-summer-2027|blocked:postsecondary-level",
  "sample-maya|cooke-transfer-scholarship-2027|learning_first[outline-transfer-goals/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-transfer-goals/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-maya|noaa-hollings-scholarship-2027|learning_first[outline-noaa-interests/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-noaa-interests/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-maya|doe-cci-summer-2027|learning_first[draft-community-college-resume/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- draft-community-college-resume/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-maya|planet-hunters-tess|learning_first[review-tess-tutorial/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-tess-tutorial/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-maya|nasa-exoplanet-watch|learning_first[review-exoplanet-workflow/1/0/- submit-application/0/0/-] h=1 $=0 f=null | community[find-partner/2/0/- review-exoplanet-workflow/1/0/- submit-application/0/0/-] h=3 $=0 f=null",
  "sample-maya|nasa-aurorasaurus|learning_first[review-aurora-reporting/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-aurora-reporting/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-maya|nasa-texas-aerospace-scholars-senior-2026|blocked:senior-cohort,texas",
  "sample-maya|dan-herbatschek-fellowship-2027|learning_first[outline-fellowship-project/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-fellowship-project/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-maya|nasa-cloudspotting-mars|learning_first[review-cloudspotting-tutorial/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-cloudspotting-tutorial/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-leo|mlh-open-source-week-2026|learning_first[practice-open-source-pr/1/0/- submit-application/0/0/-] h=1 $=0 f=null | practice_first[practice-open-source-pr/1/0/- submit-application/0/0/-] h=1 $=0 f=null | community[find-partner/2/0/- practice-open-source-pr/1/0/- submit-application/0/0/-] h=3 $=0 f=null",
  "sample-leo|rutgers-newark-summer-research-2027|blocked:undergraduate",
  "sample-leo|doe-suli-summer-2027|blocked:postsecondary-level",
  "sample-leo|cooke-transfer-scholarship-2027|learning_first[outline-transfer-goals/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-transfer-goals/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-leo|noaa-hollings-scholarship-2027|learning_first[outline-noaa-interests/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-noaa-interests/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-leo|doe-cci-summer-2027|learning_first[draft-community-college-resume/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- draft-community-college-resume/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-leo|planet-hunters-tess|learning_first[review-tess-tutorial/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-tess-tutorial/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-leo|nasa-exoplanet-watch|learning_first[review-exoplanet-workflow/1/0/- submit-application/0/0/-] h=1 $=0 f=null | community[find-partner/2/0/- review-exoplanet-workflow/1/0/- submit-application/0/0/-] h=3 $=0 f=null",
  "sample-leo|nasa-aurorasaurus|learning_first[review-aurora-reporting/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-aurora-reporting/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-leo|nasa-texas-aerospace-scholars-senior-2026|blocked:senior-cohort,texas",
  "sample-leo|dan-herbatschek-fellowship-2027|learning_first[outline-fellowship-project/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-fellowship-project/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-leo|nasa-cloudspotting-mars|learning_first[review-cloudspotting-tutorial/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-cloudspotting-tutorial/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-ana|mlh-open-source-week-2026|learning_first[practice-open-source-pr/1/0/- submit-application/0/0/-] h=1 $=0 f=null | practice_first[practice-open-source-pr/1/0/- submit-application/0/0/-] h=1 $=0 f=null | community[find-partner/2/0/- practice-open-source-pr/1/0/- submit-application/0/0/-] h=3 $=0 f=null",
  "sample-ana|rutgers-newark-summer-research-2027|blocked:undergraduate",
  "sample-ana|doe-suli-summer-2027|blocked:postsecondary-level",
  "sample-ana|cooke-transfer-scholarship-2027|learning_first[outline-transfer-goals/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-transfer-goals/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-ana|noaa-hollings-scholarship-2027|learning_first[outline-noaa-interests/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-noaa-interests/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-ana|doe-cci-summer-2027|learning_first[draft-community-college-resume/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- draft-community-college-resume/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-ana|planet-hunters-tess|learning_first[review-tess-tutorial/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-tess-tutorial/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-ana|nasa-exoplanet-watch|learning_first[review-exoplanet-workflow/1/0/- submit-application/0/0/-] h=1 $=0 f=null | community[find-partner/2/0/- review-exoplanet-workflow/1/0/- submit-application/0/0/-] h=3 $=0 f=null",
  "sample-ana|nasa-aurorasaurus|learning_first[review-aurora-reporting/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-aurora-reporting/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-ana|nasa-texas-aerospace-scholars-senior-2026|blocked:texas",
  "sample-ana|dan-herbatschek-fellowship-2027|learning_first[outline-fellowship-project/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-fellowship-project/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-ana|nasa-cloudspotting-mars|learning_first[review-cloudspotting-tutorial/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-cloudspotting-tutorial/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-noor|mlh-open-source-week-2026|learning_first[practice-open-source-pr/1/0/- submit-application/0/0/-] h=1 $=0 f=null | practice_first[practice-open-source-pr/1/0/- submit-application/0/0/-] h=1 $=0 f=null | community[find-partner/2/0/- practice-open-source-pr/1/0/- submit-application/0/0/-] h=3 $=0 f=null",
  "sample-noor|rutgers-newark-summer-research-2027|learning_first[review-research-interests/2/0/- review-lab-safety-basics/1/0/- practice-lab-data-cleanup/2/0/s write-research-project-note/1/0/- submit-application/0/0/-] h=4 $=0 f=true | practice_first[practice-lab-data-cleanup/2/0/s write-research-project-note/1/0/- review-research-interests/2/0/- review-lab-safety-basics/1/0/- submit-application/0/0/-] h=4 $=0 f=true | community[find-partner/2/0/- review-research-interests/2/0/- practice-lab-data-cleanup/2/0/s write-research-project-note/1/0/- review-lab-safety-basics/1/0/- submit-application/0/0/-] h=6 $=0 f=true",
  "sample-noor|doe-suli-summer-2027|learning_first[draft-research-resume/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- draft-research-resume/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-noor|cooke-transfer-scholarship-2027|learning_first[outline-transfer-goals/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-transfer-goals/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-noor|noaa-hollings-scholarship-2027|learning_first[outline-noaa-interests/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-noaa-interests/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-noor|doe-cci-summer-2027|learning_first[draft-community-college-resume/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- draft-community-college-resume/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-noor|planet-hunters-tess|learning_first[review-tess-tutorial/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-tess-tutorial/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-noor|nasa-exoplanet-watch|learning_first[review-exoplanet-workflow/1/0/- submit-application/0/0/-] h=1 $=0 f=null | community[find-partner/2/0/- review-exoplanet-workflow/1/0/- submit-application/0/0/-] h=3 $=0 f=null",
  "sample-noor|nasa-aurorasaurus|learning_first[review-aurora-reporting/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-aurora-reporting/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
  "sample-noor|nasa-texas-aerospace-scholars-senior-2026|blocked:senior-cohort,texas",
  "sample-noor|dan-herbatschek-fellowship-2027|learning_first[outline-fellowship-project/2/0/- submit-application/0/0/-] h=2 $=0 f=true | community[find-partner/2/0/- outline-fellowship-project/2/0/- submit-application/0/0/-] h=4 $=0 f=true",
  "sample-noor|nasa-cloudspotting-mars|learning_first[review-cloudspotting-tutorial/0.5/0/- submit-application/0/0/-] h=0.5 $=0 f=null | community[find-partner/2/0/- review-cloudspotting-tutorial/0.5/0/- submit-application/0/0/-] h=2.5 $=0 f=null",
];
