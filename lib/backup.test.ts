import { afterEach, describe, expect, it } from 'vitest';
import {
  BACKUP_DATA_KEYS,
  BACKUP_FORMAT_VERSION,
  MAX_BACKUP_BYTES,
  applyBackup,
  backupFileName,
  buildBackup,
  collectBackupData,
  parseBackup,
  summarizeBackup,
  type BackupData,
} from './backup';
import {
  STORE_KEYS,
  loadGrants,
  loadInvitations,
  loadJournal,
  loadMaterials,
  loadPlanSnapshots,
  loadProfile,
  loadSavedOpportunityIds,
  loadShareSettings,
  loadUserPostedOpportunities,
  saveGrants,
  saveInvitations,
  saveJournal,
  saveProfile,
  saveSavedOpportunityIds,
  saveShareSettings,
  storageKey,
  writeJSON,
} from './store';
import type {
  Invitation,
  JournalEntry,
  Material,
  Opportunity,
  PlanSnapshot,
  ResourceGrant,
  ShareSettings,
  StudentProfile,
} from './types';

/** 内存版 localStorage（与 store.test.ts 相同的模拟方式）。 */
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

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

const PROFILE: StudentProfile = {
  id: 'p1',
  is_sample: false,
  display_name: 'Me',
  birth_date: '2009-03-04',
  evidence: [{ id: 'e1', title: 'Robot', kind: 'project', skills: ['python'], status: 'self_reported', added_on: '2026-11-01' }],
};
const GRANT = { id: 'g1', student_id: 'p1', opportunity_id: null, is_sample: true } as unknown as ResourceGrant;
const JOURNAL: JournalEntry = {
  id: 'j1',
  profile_id: 'p1',
  opportunity_id: 'o1',
  added_on: '2026-11-01',
  application: 'preparing',
  submitted_on: null,
  eligibility_confirmation: 'unconfirmed',
  decision: 'pending',
  participated: null,
  history: [{ event: 'added', on: '2026-11-01' }],
  tasks: [{ id: 't1', title: 'Essay', done: false }],
  material_ids: ['m1'],
  official_url: 'https://example.org',
};
const MATERIAL: Material = {
  id: 'm1',
  profile_id: 'p1',
  kind: 'essay',
  title: 'Personal statement',
  reusable: true,
  opportunity_id: null,
  estimated_hours: 3,
  status: 'in_progress',
} as Material;
const SNAPSHOT = {
  id: 's1',
  profile_id: 'p1',
  opportunity_id: 'o1',
  taken_on: '2026-11-02',
  plan: { status: 'ok', routes: [] },
  inputs: { evidence_ids: [], hours_per_week_available: null, budget_usd: null, grade: null, today: null },
  trigger: 'initial',
} as unknown as PlanSnapshot;
const USER_OPP = {
  id: 'u1',
  title: 'Club',
  organizer: 'Local',
  requirements: [],
  preparation: [],
  required_devices: [],
  location: {},
  cost: {},
  time_commitment: {},
  source_tier: 'user_posted',
  is_sample: true,
} as unknown as Opportunity;
const SHARE: ShareSettings = {
  profile_id: 'p1',
  share_handle: 'share-abc',
  evidence_ids: ['e1'],
  skills: [],
  share_interests: false,
  collaboration_note: null,
  updated_on: '2026-11-03',
};
const INVITE: Invitation = {
  id: 'i1',
  publisher_id: 'pub1',
  share_handle: 'share-abc',
  opportunity_id: null,
  reasons: ['skills'],
  status: 'pending',
  is_sample: true,
  sent_on: '2026-11-04',
};

function fillStore() {
  saveProfile(PROFILE);
  saveSavedOpportunityIds(['o1', 'o2']);
  saveGrants([GRANT]);
  saveJournal([JOURNAL]);
  writeJSON(STORE_KEYS.materials, [MATERIAL]);
  writeJSON(STORE_KEYS.planSnapshots, [SNAPSHOT]);
  writeJSON(STORE_KEYS.userPostedOpportunities, [USER_OPP]);
  saveShareSettings(SHARE);
  saveInvitations([INVITE]);
}

function loadEverything() {
  return {
    profile: loadProfile(),
    saved: loadSavedOpportunityIds(),
    grants: loadGrants(),
    journal: loadJournal(),
    materials: loadMaterials(),
    snapshots: loadPlanSnapshots(),
    userPosted: loadUserPostedOpportunities(),
    share: loadShareSettings('p1'),
    invitations: loadInvitations(),
  };
}

function validFile(data: Partial<Record<keyof BackupData, unknown>>, extra: Record<string, unknown> = {}) {
  return JSON.stringify({ app: 'opportunity-compass', format_version: 1, exported_on: '2026-11-18', data, ...extra });
}

describe('backup：键的范围', () => {
  it('备份的数据键与 STORE_KEYS 完全一致（一个不漏，也不多）', () => {
    const keys = Object.keys(buildBackup({}, '2026-11-18').data).sort();
    expect(keys).toEqual(Object.values(STORE_KEYS).slice().sort());
    expect([...BACKUP_DATA_KEYS].sort()).toEqual(keys);
  });

  it('buildBackup 只取白名单键，带 app / 版本 / 日期', () => {
    const b = buildBackup({ grants: [GRANT], evil: 1 } as unknown as Partial<BackupData>, '2026-11-18');
    expect(b.app).toBe('opportunity-compass');
    expect(b.format_version).toBe(BACKUP_FORMAT_VERSION);
    expect(b.exported_on).toBe('2026-11-18');
    expect(b.data).not.toHaveProperty('evil');
    expect(b.data.grants).toEqual([GRANT]);
    expect(b.data.profile).toBeNull();
  });

  it('文件名', () => {
    expect(backupFileName('2026-11-18')).toBe('opportunity-compass-backup-2026-11-18.json');
  });
});

describe('backup：往返', () => {
  it('collect → build → JSON → parse → apply 后各 load 结果深度相等', () => {
    installFakeWindow();
    fillStore();
    const before = loadEverything();
    const text = JSON.stringify(buildBackup(collectBackupData(), '2026-11-18'));

    installFakeWindow(); // 换一个空的浏览器
    const parsed = parseBackup(text);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.warnings).toEqual([]);
    expect(applyBackup(parsed.backup)).toEqual({ ok: true, warnings: [] });
    expect(loadEverything()).toEqual(before);
    expect(before.profile?.birth_date).toBe('2009-03-04');
  });

  it('导入是整体替换：导入前已有、文件里没有的数据被清掉', () => {
    installFakeWindow();
    saveSavedOpportunityIds(['old']);
    saveJournal([{ ...JOURNAL, id: 'old', opportunity_id: 'old-opp' }]);
    const parsed = parseBackup(validFile({ profile: PROFILE }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(applyBackup(parsed.backup).ok).toBe(true);
    expect(loadSavedOpportunityIds()).toEqual([]);
    expect(loadJournal()).toEqual([]);
    expect(loadProfile()?.id).toBe('p1');
  });

  it('写入失败时返回失败，并恢复导入前的数据', () => {
    const data = installFakeWindow();
    saveSavedOpportunityIds(['keep']);
    const snapshot = new Map(data);
    const parsed = parseBackup(validFile({ profile: PROFILE, saved_opportunity_ids: ['x'] }));
    if (!parsed.ok) throw new Error('should parse');
    // 导入时第 1 次写入成功、第 2 次抛错（模拟配额满）；恢复时允许写入
    let calls = 0;
    const storage = (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage;
    const realSet = storage.setItem.bind(storage);
    storage.setItem = (k: string, v: string) => {
      calls += 1;
      if (calls === 2) throw new Error('QuotaExceededError');
      realSet(k, v);
    };
    const result = applyBackup(parsed.backup);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/previous data was kept/);
    expect(new Map(data)).toEqual(snapshot);
    expect(loadSavedOpportunityIds()).toEqual(['keep']);
  });

  it('没有 localStorage（SSR）时 applyBackup 返回失败，不抛', () => {
    const parsed = parseBackup(validFile({}));
    if (!parsed.ok) throw new Error('should parse');
    const r = applyBackup(parsed.backup);
    expect(r.ok).toBe(false);
  });
});

describe('backup：坏输入不抛', () => {
  const bad: unknown[] = [
    '',
    'not json',
    '{',
    'null',
    '123',
    '[]',
    '"string"',
    null,
    undefined,
    42,
    [],
    {},
    { app: 'other', format_version: 1, data: {} },
    { app: 'opportunity-compass' },
    { app: 'opportunity-compass', format_version: '1', data: {} },
    { app: 'opportunity-compass', format_version: 0, data: {} },
    { app: 'opportunity-compass', format_version: 1.5, data: {} },
    { app: 'opportunity-compass', format_version: 1 },
    { app: 'opportunity-compass', format_version: 1, data: [] },
    BigInt(1),
    Symbol('x'),
    () => 1,
  ];
  it.each(bad.map((b, i) => [i, b]))('输入 #%i 返回 ok: false 且有英文错误', (_i, input) => {
    let r: ReturnType<typeof parseBackup> | undefined;
    expect(() => {
      r = parseBackup(input);
    }).not.toThrow();
    expect(r?.ok).toBe(false);
    if (r && !r.ok) expect(r.error).toMatch(/^[\x20-\x7E]+$/);
  });

  it('循环引用的对象不抛', () => {
    const o: Record<string, unknown> = { app: 'opportunity-compass', format_version: 1 };
    o.data = o;
    expect(parseBackup(o).ok).toBe(false);
  });

  it('不是 JSON / 不是本应用 → 明确的错误', () => {
    const notJson = parseBackup('hello');
    expect(notJson.ok === false && notJson.error).toBe('This file could not be read as a backup.');
    const other = parseBackup(JSON.stringify({ app: 'x', format_version: 1, data: {} }));
    expect(other.ok === false && other.error).toMatch(/not an Opportunity Compass backup/);
  });

  it('版本比当前新 → 拒绝', () => {
    const r = parseBackup(validFile({}, { format_version: BACKUP_FORMAT_VERSION + 1 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer version/);
  });

  it('超过 2 MB → 拒绝', () => {
    const big = validFile({ saved_opportunity_ids: ['x'.repeat(MAX_BACKUP_BYTES)] });
    const r = parseBackup(big);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/2 MB/);
  });

  it('多字节字符按字节计算大小', () => {
    const chars = Math.ceil(MAX_BACKUP_BYTES / 3) + 10; // 字符数 < 上限，但 UTF-8 字节数 > 上限
    const r = parseBackup(validFile({ saved_opportunity_ids: ['中'.repeat(chars)] }));
    expect(r.ok).toBe(false);
  });
});

describe('backup：逐条过滤与 warnings', () => {
  it('坏条目被丢弃并在 warnings 里说明条数，好条目保留', () => {
    const r = parseBackup(
      validFile({
        profile: PROFILE,
        saved_opportunity_ids: ['o1', 5, 'o1', null],
        grants: [GRANT, { id: 'g2', student_id: 'p1' }],
        journal: [JOURNAL, { id: 'bad' }, { ...JOURNAL, id: 'dup' }],
        materials: [MATERIAL, { ...MATERIAL, status: 'nope' }],
        plan_snapshots: [SNAPSHOT, { ...SNAPSHOT, id: 's2', trigger: 'bogus' }],
        user_posted_opportunities: [USER_OPP, { ...USER_OPP, id: 'u2', source_tier: 'official' }],
        share_settings: [SHARE, { ...SHARE, profile_id: 'p2' }],
        invitations: [INVITE, { ...INVITE, id: 'i2', is_sample: false }],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.backup.data;
    expect(d.saved_opportunity_ids).toEqual(['o1']);
    expect(d.grants).toEqual([GRANT]);
    expect(d.journal.map((e) => e.id)).toEqual(['j1']);
    expect(d.materials).toEqual([MATERIAL]);
    expect(d.plan_snapshots).toEqual([SNAPSHOT]);
    expect(d.user_posted_opportunities).toEqual([USER_OPP]);
    expect(d.share_settings).toEqual([SHARE]); // 句柄重复的第二条被丢
    expect(d.invitations).toEqual([INVITE]);
    const w = r.warnings.join('\n');
    expect(w).toMatch(/Saved opportunities: 2 invalid items were skipped/);
    expect(w).toMatch(/Saved opportunities: 1 duplicate item was skipped/);
    expect(w).toMatch(/Organizer grants: 1 invalid item was skipped/);
    expect(w).toMatch(/Journal entries: 1 invalid item was skipped/);
    expect(w).toMatch(/Journal entries: 1 duplicate item was skipped/);
    expect(w).toMatch(/Invitations: 1 invalid item was skipped/);
    expect(w).toMatch(/Sharing settings: 1 duplicate item was skipped/);
  });

  it('非法档案被跳过；非法出生日期只丢这个值', () => {
    const r1 = parseBackup(validFile({ profile: { id: 'x' } }));
    expect(r1.ok && r1.backup.data.profile).toBeNull();
    expect(r1.ok && r1.warnings.join()).toMatch(/Profile: the profile in this file is not valid/);
    const r2 = parseBackup(validFile({ profile: { ...PROFILE, birth_date: '2009-02-30' } }));
    expect(r2.ok && r2.backup.data.profile?.birth_date).toBeNull();
    expect(r2.ok && r2.warnings.join()).toMatch(/date of birth/);
  });

  it('不是数组的段落整段跳过并 warning；未知段落被忽略', () => {
    const r = parseBackup(validFile({ journal: { a: 1 }, secrets: [1] } as Record<string, unknown>));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data.journal).toEqual([]);
    expect(r.backup.data).not.toHaveProperty('secrets');
    expect(r.warnings.join('\n')).toMatch(/Journal entries: this section is not a list/);
    expect(r.warnings.join('\n')).toMatch(/unknown section "secrets"/);
  });

  it('输出的顶层与 data 只含白名单键', () => {
    const r = parseBackup(validFile({ profile: PROFILE }, { extra: 'x', password: 'y' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.backup).sort()).toEqual(['app', 'data', 'exported_on', 'format_version']);
    expect(Object.keys(r.backup.data).sort()).toEqual([...BACKUP_DATA_KEYS].sort());
  });

  it('缺少 exported_on 时为 null；也接受已解析的对象', () => {
    const r = parseBackup({ app: 'opportunity-compass', format_version: 1, data: {} });
    expect(r.ok && r.backup.exported_on).toBeNull();
  });
});

describe('backup：grants 一律模拟、链接只留 http(s)', () => {
  it('不带 is_sample 的 approved grant 导入后是 is_sample: true，并有 warning', () => {
    const real = { id: 'g9', student_id: 'p1', opportunity_id: 'o1', status: 'approved' };
    const r = parseBackup(validFile({ grants: [real, { ...real, id: 'g10', is_sample: false }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data.grants.every((g) => g.is_sample === true)).toBe(true);
    expect(r.warnings).toContain('2 organizer grants were marked as Sample: this app only has simulated support.');
    installFakeWindow();
    expect(applyBackup(r.backup).ok).toBe(true);
    expect(loadGrants()).toEqual([
      { ...real, is_sample: true },
      { ...real, id: 'g10', is_sample: true },
    ]);
  });

  it('applyBackup 直接收到未标记的 grant 时也强制 is_sample: true', () => {
    installFakeWindow();
    const backup = buildBackup({ grants: [{ id: 'g1', student_id: 'p1', opportunity_id: null } as unknown as ResourceGrant] }, '2026-11-18');
    expect(applyBackup(backup).ok).toBe(true);
    expect(loadGrants()[0].is_sample).toBe(true);
  });

  it('已是 is_sample: true 的 grant 不产生 warning', () => {
    const r = parseBackup(validFile({ grants: [GRANT] }));
    expect(r.ok && r.warnings).toEqual([]);
    expect(r.ok && r.backup.data.grants).toEqual([GRANT]);
  });

  it('Journal 的 official_url 不是 http(s) 时置空并 warning，条目保留', () => {
    const r = parseBackup(
      validFile({
        journal: [
          { ...JOURNAL, official_url: 'javascript:alert(1)' },
          { ...JOURNAL, id: 'j2', opportunity_id: 'o2', official_url: '' },
          { ...JOURNAL, id: 'j3', opportunity_id: 'o3', official_url: 'http://example.org/x' },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.backup.data.journal.map((e) => e.official_url)).toEqual(['', '', 'http://example.org/x']);
    expect(r.warnings).toEqual(['Journal entries: 1 official link was not an http(s) link and was removed.']);
  });

  it('超深嵌套解析失败时给出笼统准确的提示，不抛', () => {
    const deep = '{"app":"opportunity-compass","format_version":1,"data":{"x":' + '['.repeat(200000) + ']'.repeat(200000) + '}}';
    const r = parseBackup(deep);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/could not be read/);
  });
});

describe('backup：原型污染', () => {
  it('__proto__ / constructor 键被忽略，不污染 Object.prototype', () => {
    const text =
      '{"app":"opportunity-compass","format_version":1,"__proto__":{"polluted":true},' +
      '"data":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},' +
      '"profile":{"id":"p1","is_sample":false,"display_name":"Me","evidence":[],"__proto__":{"isAdmin":true}},' +
      '"grants":[{"id":"g1","student_id":"p1","opportunity_id":null,"__proto__":{"polluted":true}}]}}';
    const r = parseBackup(text);
    expect(r.ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    if (!r.ok) return;
    const profile = r.backup.data.profile as unknown as Record<string, unknown>;
    expect(Object.getPrototypeOf(profile)).toBe(Object.prototype);
    expect(profile.isAdmin).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(profile, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(r.backup.data.grants[0], '__proto__')).toBe(false);
    expect(r.warnings.join()).not.toMatch(/__proto__/);
    expect(r.warnings.join()).not.toMatch(/constructor/);

    installFakeWindow();
    expect(applyBackup(r.backup).ok).toBe(true);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(loadProfile()).toEqual({ id: 'p1', is_sample: false, display_name: 'Me', evidence: [] });
  });
});

describe('backup：summarizeBackup', () => {
  it('统计各类条数', () => {
    const b = buildBackup(
      {
        profile: { ...PROFILE, is_sample: true },
        saved_opportunity_ids: ['a', 'b'],
        journal: [JOURNAL],
        materials: [MATERIAL],
        invitations: [INVITE],
      },
      '2026-11-18',
    );
    expect(summarizeBackup(b)).toEqual({
      has_profile: true,
      profile_is_sample: true,
      profile_name: 'Me',
      evidence: 1,
      saved_opportunities: 2,
      grants: 0,
      journal_entries: 1,
      materials: 1,
      plan_snapshots: 0,
      user_posted_opportunities: 0,
      share_settings: 0,
      invitations: 1,
    });
    expect(summarizeBackup(buildBackup({}, '2026-11-18')).has_profile).toBe(false);
  });

  it('collectBackupData 在空浏览器 / SSR 下返回空数据', () => {
    expect(summarizeBackup({ data: collectBackupData() }).has_profile).toBe(false);
    installFakeWindow();
    expect(collectBackupData()).toEqual(buildBackup({}, '2026-11-18').data);
    expect(storageKey(STORE_KEYS.profile)).toBe('oc:v1:profile');
  });
});
