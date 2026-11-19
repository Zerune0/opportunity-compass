/**
 * lib/data 的测试：把仓库数据钉住（全部通过校验、底线字段齐全），并用注入的坏数据测试分拣逻辑。
 * 注入用的机会与档案都是虚构的（example.com、is_sample: true）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import opportunitiesJson from '@/data/opportunities.json';
import profilesJson from '@/data/profiles.json';
import {
  catalogOpportunities,
  findCatalogOpportunity,
  loadCatalog,
  loadSampleProfiles,
  partitionOpportunities,
  partitionProfiles,
  sampleProfiles,
  type RejectedRecord,
} from './data';
import { isStrictISODate } from './validation';

function describeRejected(rejected: RejectedRecord[]): string {
  return rejected.map((r) => `#${r.index} ${r.id ?? '(no id)'}:\n  ${r.errors.join('\n  ')}`).join('\n');
}

// ───────────────────────────── 仓库当前数据 ─────────────────────────────

describe('data/opportunities.json（仓库当前数据）', () => {
  const { opportunities, rejected } = loadCatalog();

  it('没有被拒绝的记录', () => {
    expect(rejected, `data/opportunities.json 有 ${rejected.length} 条记录未通过校验：\n${describeRejected(rejected)}`).toEqual([]);
    expect(opportunities.length).toBe((opportunitiesJson as unknown[]).length);
  });

  it('机会 id 唯一', () => {
    const ids = opportunities.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每条都有 http(s) 官方链接、合法核实日期、非空核实人', () => {
    for (const o of opportunities) {
      expect(o.official_url, o.id).toMatch(/^https?:\/\/\S+$/);
      expect(isStrictISODate(o.verified_on), `${o.id} verified_on`).toBe(true);
      expect(typeof o.verified_by === 'string' && o.verified_by.trim() !== '', `${o.id} verified_by`).toBe(true);
    }
  });

  it('仓库数据里没有 user_posted 的机会', () => {
    expect(opportunities.filter((o) => o.source_tier === 'user_posted').map((o) => o.id)).toEqual([]);
  });
});

describe('data/profiles.json（仓库当前数据）', () => {
  const { profiles, rejected } = loadSampleProfiles();

  it('没有被拒绝的记录，全部 is_sample: true，id 唯一', () => {
    expect(rejected, `data/profiles.json 有 ${rejected.length} 条记录未通过校验：\n${describeRejected(rejected)}`).toEqual([]);
    expect(profiles.length).toBe((profilesJson as unknown[]).length);
    expect(profiles.every((p) => p.is_sample === true)).toBe(true);
    const ids = profiles.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ───────────────────────────── 注入数据：机会 ─────────────────────────────

function goodOpp(id = 'sample-data-event'): Record<string, unknown> {
  return {
    id,
    title: 'Sample data-loader event',
    organizer: 'Sample organizer',
    category: 'project',
    fields: ['computer_science'],
    summary: 'Fictional opportunity used only to test lib/data.',
    official_url: `https://example.com/${id}`,
    verified_on: '2026-11-17',
    verified_by: 'Sample (fictional)',
    deadline: '2020-01-01', // 已过的截止日期不是数据错误
    recurring_annually: true,
    location: { format: 'online' },
    cost: { fee_usd: null, requires_travel_expense: null }, // null = unknown，合法
    time_commitment: { hours_per_week: null, total_weeks: null },
    required_devices: [],
    requirements: [],
    preparation: [],
    is_sample: true,
  };
}

describe('partitionOpportunities', () => {
  it('非数组：全部拒绝，不抛异常', () => {
    for (const raw of [null, undefined, 42, 'x', { id: 'a' }]) {
      const r = partitionOpportunities(raw);
      expect(r.opportunities).toEqual([]);
      expect(r.rejected).toHaveLength(1);
      expect(r.rejected[0].index).toBe(-1);
    }
  });

  it('合法记录通过；null 字段（unknown）与已过截止日期不导致拒绝', () => {
    const r = partitionOpportunities([goodOpp()]);
    expect(r.rejected).toEqual([]);
    expect(r.opportunities.map((o) => o.id)).toEqual(['sample-data-event']);
  });

  it('元素为 null / 缺 id / 缺 official_url / 日期非法：拒绝，其余照常通过', () => {
    const noId = goodOpp();
    delete noId.id;
    const noUrl = goodOpp('sample-no-url');
    delete noUrl.official_url;
    const badDate = { ...goodOpp('sample-bad-date'), verified_on: '2026-13-40' };
    const badDeadline = { ...goodOpp('sample-bad-deadline'), deadline: '11/20/2026' };
    const r = partitionOpportunities([null, noId, goodOpp('sample-ok'), noUrl, badDate, badDeadline]);
    expect(r.opportunities.map((o) => o.id)).toEqual(['sample-ok']);
    expect(r.rejected.map((x) => [x.index, x.id])).toEqual([
      [0, null],
      [1, null],
      [3, 'sample-no-url'],
      [4, 'sample-bad-date'],
      [5, 'sample-bad-deadline'],
    ]);
    expect(r.rejected[2].errors.join('\n')).toContain('official_url');
    expect(r.rejected[3].errors.join('\n')).toContain('verified_on');
    expect(r.rejected[4].errors.join('\n')).toContain('deadline');
    for (const x of r.rejected) expect(x.errors.length).toBeGreaterThan(0);
  });

  it('重复 id：保留第一条通过校验的，其余拒绝', () => {
    const first = { ...goodOpp('sample-dup'), title: 'First' };
    const second = { ...goodOpp('sample-dup'), title: 'Second' };
    const r = partitionOpportunities([first, second]);
    expect(r.opportunities).toHaveLength(1);
    expect(r.opportunities[0].title).toBe('First');
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0]).toMatchObject({ id: 'sample-dup', index: 1 });
    expect(r.rejected[0].errors[0]).toContain('duplicate id');
  });

  it('第一条同 id 记录不合格时，后面合格的那条保留', () => {
    const broken = { ...goodOpp('sample-dup2'), official_url: 'not a url' };
    const r = partitionOpportunities([broken, goodOpp('sample-dup2')]);
    expect(r.opportunities.map((o) => o.id)).toEqual(['sample-dup2']);
    expect(r.rejected.map((x) => x.index)).toEqual([0]);
  });

  it('多余字段：现有校验不报错，记录原样保留', () => {
    const r = partitionOpportunities([{ ...goodOpp(), extra_note: 'kept' }]);
    expect(r.rejected).toEqual([]);
    expect((r.opportunities[0] as unknown as Record<string, unknown>).extra_note).toBe('kept');
  });

  it('提醒（warnings）只针对通过的记录，不影响通过与否', () => {
    const r = partitionOpportunities([goodOpp('sample-warn'), { ...goodOpp('sample-warn-bad'), category: 'nope' }]);
    expect(r.opportunities.map((o) => o.id)).toEqual(['sample-warn']);
    expect(r.warnings.map((w) => w.id)).toEqual(['sample-warn']);
    expect(r.warnings[0].warnings.join('\n')).toContain('fee_usd');
  });

  it('奇怪的输入不抛异常', () => {
    const cyclic: Record<string, unknown> = { id: 'sample-cyclic' };
    cyclic.self = cyclic;
    expect(() => partitionOpportunities([cyclic, [], 0, 'str', true, undefined])).not.toThrow();
    expect(partitionOpportunities([cyclic, [], 0, 'str', true, undefined]).opportunities).toEqual([]);
  });
});

// ───────────────────────────── 注入数据：示例档案 ─────────────────────────────

function goodProfile(id = 'sample-data-student'): Record<string, unknown> {
  return { id, is_sample: true, display_name: 'Sample student', evidence: [] };
}

describe('partitionProfiles', () => {
  it('非数组：全部拒绝，不抛异常', () => {
    for (const raw of [null, undefined, {}, 'x']) {
      const r = partitionProfiles(raw);
      expect(r.profiles).toEqual([]);
      expect(r.rejected).toHaveLength(1);
    }
  });

  it('只有必需字段、其余缺省（unknown）的档案通过', () => {
    expect(partitionProfiles([goodProfile()]).rejected).toEqual([]);
  });

  it('is_sample 不是 true 的示例档案被拒绝', () => {
    const r = partitionProfiles([{ ...goodProfile('a'), is_sample: false }, { ...goodProfile('b'), is_sample: undefined }, goodProfile('c')]);
    expect(r.profiles.map((p) => p.id)).toEqual(['c']);
    expect(r.rejected.map((x) => x.id)).toEqual(['a', 'b']);
    for (const x of r.rejected) expect(x.errors.join('\n')).toContain('is_sample');
  });

  it('元素为 null、缺 id、日期非法、重复 id', () => {
    const noId = goodProfile();
    delete noId.id;
    const badEv = {
      ...goodProfile('sample-bad-ev'),
      evidence: [{ id: 'e', title: 't', kind: 'project', skills: [], status: 'self_reported', added_on: '2026-02-30' }],
    };
    const r = partitionProfiles([null, noId, badEv, goodProfile('dup'), { ...goodProfile('dup'), display_name: 'Second' }]);
    expect(r.profiles.map((p) => p.id)).toEqual(['dup']);
    expect(r.profiles[0].display_name).toBe('Sample student');
    expect(r.rejected.map((x) => [x.index, x.id])).toEqual([
      [0, null],
      [1, null],
      [2, 'sample-bad-ev'],
      [4, 'dup'],
    ]);
  });
});

// ───────────────────────────── 缓存与不可变 ─────────────────────────────

describe('缓存与不可变', () => {
  afterEach(() => vi.restoreAllMocks());

  it('两次调用结果相等', () => {
    expect(loadCatalog()).toEqual(loadCatalog());
    expect(loadSampleProfiles()).toEqual(loadSampleProfiles());
    expect(catalogOpportunities()).toEqual(catalogOpportunities());
    expect(sampleProfiles()).toEqual(sampleProfiles());
  });

  it('调用方修改返回的数组不影响下一次调用', () => {
    const before = catalogOpportunities().map((o) => o.id);
    const a = catalogOpportunities();
    a.pop();
    a.reverse();
    a.push({ id: 'intruder' } as never);
    const c = loadCatalog();
    c.opportunities.length = 0;
    c.rejected.push({ id: 'x', index: 0, errors: [] });
    expect(catalogOpportunities().map((o) => o.id)).toEqual(before);
    expect(loadCatalog().rejected).toEqual([]);

    const p = sampleProfiles();
    const n = p.length;
    p.length = 0;
    expect(sampleProfiles()).toHaveLength(n);
    expect(loadSampleProfiles().profiles).toHaveLength(n);
  });

  it('findCatalogOpportunity 按 id 查找，找不到返回 null', () => {
    const first = catalogOpportunities()[0];
    expect(findCatalogOpportunity(first.id)).toBe(first);
    expect(findCatalogOpportunity('no-such-opportunity')).toBeNull();
    expect(findCatalogOpportunity(undefined)).toBeNull();
    expect(findCatalogOpportunity(null)).toBeNull();
  });
});
