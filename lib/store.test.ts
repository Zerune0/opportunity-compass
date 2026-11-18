import { afterEach, describe, expect, it } from 'vitest';
import {
  addEvidence,
  clearAll,
  grantsFor,
  loadGrants,
  saveGrants,
  loadProfile,
  loadSavedOpportunityIds,
  saveProfile,
  storageKey,
  toggleSavedOpportunity,
  STORE_KEYS,
} from './store';
import {
  addInvitation,
  addUserPostedOpportunity,
  blockedPublisherIds,
  buildSharedProfileView,
  clearInvitations,
  clearJournal,
  clearPlanSnapshots,
  clearShareSettings,
  clearUserPostedOpportunities,
  createEmptyProfile,
  defaultShareSettings,
  getJournalEntry,
  latestPlanSnapshot,
  linkEvidenceToPrep,
  loadInvitations,
  loadJournal,
  loadPlanSnapshots,
  loadShareSettings,
  loadUserPostedOpportunities,
  pushPlanSnapshot,
  removeJournalEntry,
  removeUserPostedOpportunity,
  saveInvitations,
  saveJournal,
  saveShareSettings,
  setInvitationStatus,
  setJournalStatus,
  toggleJournalTask,
  unlinkEvidenceFromPrep,
  updateEvidence,
  updateProfile,
  upsertJournalEntry,
} from './store';
import type {
  EvidenceItem,
  Invitation,
  JournalEntry,
  Opportunity,
  PlanSnapshot,
  ResourceGrant,
  StudentProfile,
} from './types';

const PROFILE: StudentProfile = { id: 'p1', is_sample: true, display_name: '测试学生', evidence: [] };

/** 内存版 localStorage，用来模拟浏览器。 */
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

describe('store：无 window（SSR）', () => {
  it('读返回默认值，写不崩', () => {
    expect(typeof window).toBe('undefined');
    expect(loadProfile()).toBeNull();
    expect(loadSavedOpportunityIds()).toEqual([]);
    expect(loadGrants()).toEqual([]);
    expect(saveProfile(PROFILE)).toBe(false);
    expect(addEvidence({ id: 'e', title: 't', kind: 'project', skills: [], status: 'self_reported', added_on: '2026-11-17' })).toBeNull();
    expect(() => clearAll()).not.toThrow();
  });
});

describe('store：有 localStorage', () => {
  it('键名带前缀和版本', () => {
    expect(storageKey(STORE_KEYS.profile)).toBe('oc:v1:profile');
  });

  it('档案与证据读写', () => {
    installFakeWindow();
    expect(saveProfile(PROFILE)).toBe(true);
    expect(loadProfile()).toEqual(PROFILE);
    const updated = addEvidence({ id: 'e1', title: '作品', kind: 'project', skills: ['python'], status: 'self_reported', added_on: '2026-11-17' });
    expect(updated?.evidence).toHaveLength(1);
    expect(loadProfile()?.evidence[0].id).toBe('e1');
  });

  it('收藏切换', () => {
    installFakeWindow();
    expect(toggleSavedOpportunity('a')).toEqual(['a']);
    expect(toggleSavedOpportunity('b')).toEqual(['a', 'b']);
    expect(toggleSavedOpportunity('a')).toEqual(['b']);
  });

  it('grants：opportunity_id 为 null 的 grant 能存取，grantsFor 对该学生的任何机会都返回它', () => {
    installFakeWindow();
    const base = { type: 'device' as const, device: 'laptop' as const, status: 'approved' as const, provider: 'Example Org（虚构）', is_sample: true };
    const grants: ResourceGrant[] = [
      { ...base, id: 'g-all', student_id: 'p1', opportunity_id: null, intervention_id: 'iv-1' },
      { ...base, id: 'g-a', student_id: 'p1', opportunity_id: 'opp-a' },
      { ...base, id: 'g-other', student_id: 'p2', opportunity_id: null },
    ];
    expect(saveGrants(grants)).toBe(true);
    expect(loadGrants()).toEqual(grants);
    expect(grantsFor('p1', 'opp-a').map((g) => g.id)).toEqual(['g-all', 'g-a']);
    expect(grantsFor('p1', 'opp-b').map((g) => g.id)).toEqual(['g-all']);
    expect(grantsFor('p2', 'opp-a').map((g) => g.id)).toEqual(['g-other']);
  });

  it('grants：一组里混有缺 opportunity_id 的条目时，只丢掉非法条目，保留合法的', () => {
    const data = installFakeWindow();
    const base = { type: 'device', device: 'laptop', status: 'approved', provider: 'Example Org（虚构）', is_sample: true };
    data.set(
      storageKey(STORE_KEYS.grants),
      JSON.stringify([
        { ...base, id: 'g-ok', student_id: 'p1', opportunity_id: 'opp-a' },
        { ...base, id: 'g-missing', student_id: 'p1' },
        { ...base, id: 'g-null', student_id: 'p1', opportunity_id: null },
        'not-an-object',
      ]),
    );
    expect(loadGrants().map((g) => g.id)).toEqual(['g-ok', 'g-null']);
    expect(grantsFor('p1', 'opp-b').map((g) => g.id)).toEqual(['g-null']);
  });

  it('grants：存的不是数组时回退 []', () => {
    const data = installFakeWindow();
    data.set(storageKey(STORE_KEYS.grants), JSON.stringify({ id: 'g' }));
    expect(loadGrants()).toEqual([]);
  });

  it('损坏的 JSON 回退默认值', () => {
    const data = installFakeWindow();
    data.set(storageKey(STORE_KEYS.profile), '{not json');
    data.set(storageKey(STORE_KEYS.grants), '{"oops":1}');
    expect(loadProfile()).toBeNull();
    expect(loadGrants()).toEqual([]);
  });
});

// ═════════════════════════════ 第二阶段 ═════════════════════════════

const EV1: EvidenceItem = {
  id: 'e1',
  title: 'Weather data analysis',
  kind: 'project',
  skills: ['python'],
  status: 'evidence_attached',
  url: 'https://example.com/secret-portfolio',
  description: 'Private description text',
  added_on: '2026-11-17',
};
const EV2: EvidenceItem = { id: 'e2', title: 'Robotics club', kind: 'volunteer_experience', skills: ['teamwork'], status: 'self_reported', added_on: '2026-11-17' };

const FULL_PROFILE: StudentProfile = {
  id: 'p-full',
  is_sample: true,
  display_name: 'Sample Alex',
  grade: 11,
  age: 16,
  region: { country: 'US', state: 'NM', city: 'Gallupville', locality: 'rural' },
  citizenships: ['US'],
  statuses: ['first_generation', 'low_income'],
  school_name: 'Hidden Valley High School',
  hours_per_week_available: 6,
  budget_usd: 25,
  transport: { level: 'none' },
  devices: ['smartphone'],
  skills: [
    { name: 'python', level: 'beginner' },
    { name: 'public_speaking', level: 'intermediate' },
  ],
  evidence: [EV1, EV2],
  interests: ['climate', 'computer_science'],
};

function journalEntry(oppId: string, over: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: `j-${oppId}`,
    opportunity_id: oppId,
    added_on: '2026-11-01',
    status: 'preparing',
    status_history: [{ status: 'preparing', on: '2026-11-01' }],
    tasks: [
      { id: 't1', title: 'Draft essay', done: false },
      { id: 't2', title: 'Ask for letter', done: false },
    ],
    materials: [],
    official_url: `https://example.org/${oppId}`,
    ...over,
  };
}

function snapshot(id: string, opp: string, profile: string, taken_on: string): PlanSnapshot {
  return {
    id,
    profile_id: profile,
    opportunity_id: opp,
    taken_on,
    plan: { status: 'routes', profile_id: profile, opportunity_id: opp, routes: [], warnings: [] },
    inputs: { evidence_ids: [], hours_per_week_available: null, budget_usd: null, grade: null, today: null },
    trigger: 'manual',
  };
}

function opportunity(id: string, over: Partial<Opportunity> = {}): Opportunity {
  return {
    id,
    title: `Sample ${id}`,
    organizer: 'Sample Lab (fictional)',
    category: 'research',
    fields: ['climate'],
    summary: 'A local sample.',
    official_url: 'https://example.org',
    verified_on: '2026-11-18',
    verified_by: 'pub-1',
    deadline: null,
    location: { format: 'online' },
    cost: { fee_usd: 0, requires_travel_expense: false },
    time_commitment: { hours_per_week: 2, total_weeks: 4 },
    required_devices: [],
    requirements: [],
    preparation: [],
    ...over,
  };
}

function invitation(id: string, over: Partial<Invitation> = {}): Invitation {
  return {
    id,
    publisher_id: 'pub-1',
    profile_id: 'p-full',
    opportunity_id: null,
    reasons: ['Shared evidence uses python'],
    status: 'pending',
    is_sample: true,
    sent_on: '2026-11-18',
    ...over,
  };
}

describe('store 第二阶段：无 window（SSR）', () => {
  it('每个新读函数返回默认值且不抛错，写函数不崩', () => {
    expect(typeof window).toBe('undefined');
    expect(loadJournal()).toEqual([]);
    expect(getJournalEntry('x')).toBeNull();
    expect(loadPlanSnapshots()).toEqual([]);
    expect(latestPlanSnapshot('x', 'p')).toBeNull();
    expect(loadUserPostedOpportunities()).toEqual([]);
    expect(loadShareSettings('p')).toBeNull();
    expect(loadInvitations()).toEqual([]);
    expect(blockedPublisherIds('p')).toEqual([]);
    expect(updateProfile({ grade: 10 })).toBeNull();
    expect(updateEvidence('e1', { title: 'x' })).toBeNull();
    expect(linkEvidenceToPrep('e1', 'o', 'p')).toBeNull();
    expect(unlinkEvidenceFromPrep('e1', 'o', 'p')).toBeNull();
    expect(saveJournal([journalEntry('a')])).toBe(false);
    expect(upsertJournalEntry(journalEntry('a'))).toHaveLength(1);
    expect(setJournalStatus('a', 'submitted', '2026-11-18')).toBeNull();
    expect(toggleJournalTask('a', 't1', true)).toBeNull();
    expect(pushPlanSnapshot(snapshot('s1', 'o', 'p', '2026-11-18'))).toHaveLength(1);
    expect(addUserPostedOpportunity(opportunity('u1'))).toHaveLength(1);
    expect(saveShareSettings(defaultShareSettings('p', '2026-11-18'))).toBe(false);
    expect(saveInvitations([invitation('i1')])).toBe(false);
    expect(setInvitationStatus('i1', 'blocked', '2026-11-18')).toBeNull();
    expect(() => {
      removeJournalEntry('a');
      clearJournal();
      clearPlanSnapshots();
      clearPlanSnapshots('o');
      removeUserPostedOpportunity('u1');
      clearUserPostedOpportunities();
      clearShareSettings();
      clearShareSettings('p');
      clearInvitations();
      clearAll();
    }).not.toThrow();
  });
});

describe('store 第二阶段：损坏 JSON 与非法条目', () => {
  it('损坏 JSON / 不是数组时全部回退默认值', () => {
    const data = installFakeWindow();
    for (const key of [STORE_KEYS.journal, STORE_KEYS.planSnapshots, STORE_KEYS.userPostedOpportunities, STORE_KEYS.shareSettings, STORE_KEYS.invitations]) {
      data.set(storageKey(key), '{broken');
    }
    expect(loadJournal()).toEqual([]);
    expect(loadPlanSnapshots()).toEqual([]);
    expect(loadUserPostedOpportunities()).toEqual([]);
    expect(loadShareSettings('p')).toBeNull();
    expect(loadInvitations()).toEqual([]);
    for (const key of [STORE_KEYS.journal, STORE_KEYS.planSnapshots, STORE_KEYS.userPostedOpportunities, STORE_KEYS.shareSettings, STORE_KEYS.invitations]) {
      data.set(storageKey(key), JSON.stringify({ id: 'not-a-list' }));
    }
    expect(loadJournal()).toEqual([]);
    expect(loadPlanSnapshots()).toEqual([]);
    expect(loadUserPostedOpportunities()).toEqual([]);
    expect(loadInvitations()).toEqual([]);
  });

  it('列表混有非法条目时只留合法的', () => {
    const data = installFakeWindow();
    data.set(
      storageKey(STORE_KEYS.journal),
      JSON.stringify([
        journalEntry('a', { tasks: [{ id: 't1', title: 'ok', done: false }, { id: 't-bad' }] as JournalEntry['tasks'] }),
        { ...journalEntry('b'), status: 'accepted_somehow' },
        { id: 'j-c', opportunity_id: 'c' },
        42,
      ]),
    );
    const journal = loadJournal();
    expect(journal.map((e) => e.opportunity_id)).toEqual(['a']);
    expect(journal[0].tasks.map((t) => t.id)).toEqual(['t1']);

    data.set(
      storageKey(STORE_KEYS.planSnapshots),
      JSON.stringify([snapshot('s1', 'o', 'p', '2026-11-01'), { ...snapshot('s2', 'o', 'p', '2026-11-02'), trigger: 'magic' }, null]),
    );
    expect(loadPlanSnapshots().map((s) => s.id)).toEqual(['s1']);

    data.set(
      storageKey(STORE_KEYS.shareSettings),
      JSON.stringify([{ profile_id: 'p', evidence_ids: 'e1' }, defaultShareSettings('q', '2026-11-18')]),
    );
    expect(loadShareSettings('p')).toBeNull();
    expect(loadShareSettings('q')).toEqual(defaultShareSettings('q', '2026-11-18'));

    data.set(
      storageKey(STORE_KEYS.invitations),
      JSON.stringify([invitation('i1'), { ...invitation('i2'), is_sample: false }, { ...invitation('i3'), status: 'spam' }]),
    );
    expect(loadInvitations().map((i) => i.id)).toEqual(['i1']);
  });
});

describe('store 第二阶段：档案编辑', () => {
  it('createEmptyProfile：非示例、空证据、缺省显示名、不写存储、id 唯一', () => {
    const data = installFakeWindow();
    const a = createEmptyProfile();
    const b = createEmptyProfile('Jordan');
    expect(a).toMatchObject({ is_sample: false, display_name: 'My profile', evidence: [] });
    expect(b.display_name).toBe('Jordan');
    expect(a.id).not.toBe(b.id);
    expect(data.size).toBe(0);
  });

  it('无档案时 updateProfile 创建非示例档案再合并', () => {
    installFakeWindow();
    const p = updateProfile({ grade: 10, hours_per_week_available: 5 });
    expect(p).toMatchObject({ is_sample: false, display_name: 'My profile', evidence: [], grade: 10, hours_per_week_available: 5 });
    expect(loadProfile()).toEqual(p);
  });

  it('null = 清空，undefined = 不改；不能改 id 和 evidence；示例标记保留', () => {
    installFakeWindow();
    saveProfile(FULL_PROFILE);
    const p = updateProfile({ grade: null, budget_usd: undefined, display_name: 'Renamed', id: 'hacked', evidence: [] } as Parameters<typeof updateProfile>[0]);
    expect(p?.grade).toBeNull();
    expect(p?.budget_usd).toBe(25);
    expect(p?.display_name).toBe('Renamed');
    expect(p?.id).toBe('p-full');
    expect(p?.evidence).toHaveLength(2);
    expect(p?.is_sample).toBe(true);
    expect(loadProfile()).toEqual(p);
    // 明确给出 is_sample 才会改
    expect(updateProfile({ is_sample: false })?.is_sample).toBe(false);
    // 必填字段不接受 null
    expect(updateProfile({ display_name: null } as unknown as Parameters<typeof updateProfile>[0])?.display_name).toBe('Renamed');
  });
});

describe('store 第二阶段：证据编辑与关联', () => {
  it('updateEvidence 改字段、null 清空可空字段、不能改 id；找不到返回 null 且不写', () => {
    installFakeWindow();
    saveProfile(FULL_PROFILE);
    const p = updateEvidence('e1', { status: 'reviewed', url: null, id: 'zzz' } as Parameters<typeof updateEvidence>[1]);
    const e = p?.evidence.find((x) => x.id === 'e1');
    expect(e?.status).toBe('reviewed');
    expect(e?.url).toBeNull();
    expect(e?.title).toBe(EV1.title);
    expect(p?.evidence.map((x) => x.id)).toEqual(['e1', 'e2']);
    const before = loadProfile();
    expect(updateEvidence('missing', { title: 'x' })).toBeNull();
    expect(loadProfile()).toEqual(before);
  });

  it('linkEvidenceToPrep 去重，unlinkEvidenceFromPrep 解除', () => {
    installFakeWindow();
    saveProfile(FULL_PROFILE);
    linkEvidenceToPrep('e2', 'opp-a', 'prep-1');
    linkEvidenceToPrep('e2', 'opp-a', 'prep-1');
    const p = linkEvidenceToPrep('e2', 'opp-b', 'prep-1');
    expect(p?.evidence.find((x) => x.id === 'e2')?.prep_item_ids).toEqual(['opp-a:prep-1', 'opp-b:prep-1']);
    const q = unlinkEvidenceFromPrep('e2', 'opp-a', 'prep-1');
    expect(q?.evidence.find((x) => x.id === 'e2')?.prep_item_ids).toEqual(['opp-b:prep-1']);
    expect(loadProfile()?.evidence.find((x) => x.id === 'e2')?.prep_item_ids).toEqual(['opp-b:prep-1']);
    expect(linkEvidenceToPrep('missing', 'opp-a', 'prep-1')).toBeNull();
  });
});

describe('store 第二阶段：Quest Journal', () => {
  it('upsert 按 opportunity_id 唯一（替换保持位置）、get、remove', () => {
    installFakeWindow();
    upsertJournalEntry(journalEntry('a'));
    upsertJournalEntry(journalEntry('b'));
    const list = upsertJournalEntry(journalEntry('a', { id: 'j-a2', notes: 'updated' }));
    expect(list.map((e) => e.id)).toEqual(['j-a2', 'j-b']);
    expect(loadJournal()).toHaveLength(2);
    expect(getJournalEntry('a')?.notes).toBe('updated');
    expect(removeJournalEntry('a').map((e) => e.opportunity_id)).toEqual(['b']);
    expect(getJournalEntry('a')).toBeNull();
  });

  it('saveJournal 去重；setJournalStatus 追加历史、同状态不重复', () => {
    installFakeWindow();
    saveJournal([journalEntry('a'), journalEntry('a', { id: 'j-a-last' })]);
    expect(loadJournal().map((e) => e.id)).toEqual(['j-a-last']);
    setJournalStatus('a', 'submitted', '2026-11-10');
    const e = setJournalStatus('a', 'submitted', '2026-11-11');
    expect(e?.status).toBe('submitted');
    expect(e?.status_history).toEqual([
      { status: 'preparing', on: '2026-11-01' },
      { status: 'submitted', on: '2026-11-10' },
    ]);
    expect(getJournalEntry('a')?.status_history).toHaveLength(2);
    expect(setJournalStatus('missing', 'submitted', '2026-11-11')).toBeNull();
  });

  it('toggleJournalTask 勾选写入日期、取消清空日期', () => {
    installFakeWindow();
    upsertJournalEntry(journalEntry('a'));
    const done = toggleJournalTask('a', 't1', true, '2026-11-12');
    expect(done?.tasks.find((t) => t.id === 't1')).toMatchObject({ done: true, done_on: '2026-11-12' });
    expect(getJournalEntry('a')?.tasks.find((t) => t.id === 't2')?.done).toBe(false);
    const undone = toggleJournalTask('a', 't1', false);
    expect(undone?.tasks.find((t) => t.id === 't1')).toMatchObject({ done: false, done_on: null });
    expect(toggleJournalTask('a', 'nope', true)).toBeNull();
    clearJournal();
    expect(loadJournal()).toEqual([]);
  });
});

describe('store 第二阶段：规划快照', () => {
  it('按 taken_on 与插入顺序排序，按档案 / 机会过滤，latest', () => {
    installFakeWindow();
    pushPlanSnapshot(snapshot('s2', 'o1', 'p1', '2026-11-02'));
    pushPlanSnapshot(snapshot('s1', 'o1', 'p1', '2026-11-01'));
    pushPlanSnapshot(snapshot('s3', 'o1', 'p1', '2026-11-02'));
    pushPlanSnapshot(snapshot('x1', 'o2', 'p1', '2026-11-05'));
    pushPlanSnapshot(snapshot('y1', 'o1', 'p2', '2026-11-05'));
    expect(loadPlanSnapshots('o1', 'p1').map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(loadPlanSnapshots('o1').map((s) => s.id)).toEqual(['s1', 's2', 's3', 'y1']);
    expect(loadPlanSnapshots(undefined, 'p1').map((s) => s.id)).toEqual(['s1', 's2', 's3', 'x1']);
    expect(latestPlanSnapshot('o1', 'p1')?.id).toBe('s3');
    expect(latestPlanSnapshot('o9', 'p1')).toBeNull();
  });

  it('每个 (profile, opportunity) 只保留最近 keep 条，不影响其他组合', () => {
    installFakeWindow();
    pushPlanSnapshot(snapshot('other', 'o2', 'p1', '2026-11-01'));
    for (let d = 1; d <= 7; d++) pushPlanSnapshot(snapshot(`s${d}`, 'o1', 'p1', `2026-11-0${d}`));
    expect(loadPlanSnapshots('o1', 'p1').map((s) => s.id)).toEqual(['s3', 's4', 's5', 's6', 's7']);
    expect(pushPlanSnapshot(snapshot('s8', 'o1', 'p1', '2026-11-08'), 2).map((s) => s.id)).toEqual(['s7', 's8']);
    expect(loadPlanSnapshots('o2').map((s) => s.id)).toEqual(['other']);
    clearPlanSnapshots('o1');
    expect(loadPlanSnapshots().map((s) => s.id)).toEqual(['other']);
    clearPlanSnapshots();
    expect(loadPlanSnapshots()).toEqual([]);
  });
});

describe('store 第二阶段：用户发布的机会', () => {
  it('传入 official / 非示例也会被存成 user_posted + is_sample: true', () => {
    const data = installFakeWindow();
    const list = addUserPostedOpportunity(opportunity('u1', { source_tier: 'official', is_sample: false }));
    expect(list[0]).toMatchObject({ id: 'u1', source_tier: 'user_posted', is_sample: true });
    const raw = JSON.parse(data.get(storageKey(STORE_KEYS.userPostedOpportunities)) ?? '[]');
    expect(raw[0]).toMatchObject({ source_tier: 'user_posted', is_sample: true });
    expect(loadUserPostedOpportunities()[0].source_tier).toBe('user_posted');
  });

  it('读取时丢弃伪装成官方的条目；同 id 替换；remove / clear', () => {
    const data = installFakeWindow();
    data.set(
      storageKey(STORE_KEYS.userPostedOpportunities),
      JSON.stringify([
        opportunity('fake-official', { source_tier: 'official', is_sample: true }),
        opportunity('fake-real', { source_tier: 'user_posted', is_sample: false }),
        opportunity('ok', { source_tier: 'user_posted', is_sample: true }),
      ]),
    );
    expect(loadUserPostedOpportunities().map((o) => o.id)).toEqual(['ok']);
    const list = addUserPostedOpportunity(opportunity('ok', { title: 'Replaced' }));
    expect(list.map((o) => o.title)).toEqual(['Replaced']);
    addUserPostedOpportunity(opportunity('u2'));
    expect(removeUserPostedOpportunity('ok').map((o) => o.id)).toEqual(['u2']);
    clearUserPostedOpportunities();
    expect(loadUserPostedOpportunities()).toEqual([]);
  });
});

describe('store 第二阶段：分享设置与 buildSharedProfileView', () => {
  it('默认设置什么都不分享；save / load / clear 按 profile_id', () => {
    installFakeWindow();
    const d = defaultShareSettings('p-full', '2026-11-18');
    expect(d).toEqual({ profile_id: 'p-full', evidence_ids: [], skills: [], share_interests: false, collaboration_note: null, updated_on: '2026-11-18' });
    expect(saveShareSettings({ ...d, skills: ['python'] })).toBe(true);
    expect(saveShareSettings(defaultShareSettings('other', '2026-11-18'))).toBe(true);
    expect(saveShareSettings({ ...d, skills: ['public_speaking'] })).toBe(true);
    expect(loadShareSettings('p-full')?.skills).toEqual(['public_speaking']);
    clearShareSettings('p-full');
    expect(loadShareSettings('p-full')).toBeNull();
    expect(loadShareSettings('other')).not.toBeNull();
  });

  it('settings 为 null、默认设置、属于别的档案时返回 null', () => {
    expect(buildSharedProfileView(FULL_PROFILE, null)).toBeNull();
    expect(buildSharedProfileView(FULL_PROFILE, defaultShareSettings('p-full', '2026-11-18'))).toBeNull();
    expect(
      buildSharedProfileView(FULL_PROFILE, { ...defaultShareSettings('someone-else', '2026-11-18'), evidence_ids: ['e1'] }),
    ).toBeNull();
    // 勾选了档案里不存在的证据 / 技能 = 什么都没分享
    expect(
      buildSharedProfileView(FULL_PROFILE, { ...defaultShareSettings('p-full', '2026-11-18'), evidence_ids: ['ghost'], skills: ['ghost'] }),
    ).toBeNull();
  });

  it('只开一条证据时只出这一条，且不含 url / description；不泄露学校、地区、身份、年级', () => {
    const view = buildSharedProfileView(FULL_PROFILE, { ...defaultShareSettings('p-full', '2026-11-18'), evidence_ids: ['e1'] });
    expect(view).toEqual({
      profile_id: 'p-full',
      alias: 'Sample student',
      evidence: [{ id: 'e1', title: EV1.title, kind: 'project', skills: ['python'], status: 'evidence_attached' }],
      skills: [],
      interests: [],
      collaboration_note: null,
      is_sample: true,
    });
    const json = JSON.stringify(view);
    for (const secret of ['Hidden Valley', 'Gallupville', 'NM', 'rural', 'first_generation', 'low_income', 'Sample Alex', 'secret-portfolio', 'Private description', '"grade"', 'budget', 'climate']) {
      expect(json).not.toContain(secret);
    }
  });

  it('技能只出勾选的，兴趣只在开关打开时出；非示例档案 alias 为 Student', () => {
    const view = buildSharedProfileView(
      { ...FULL_PROFILE, is_sample: false },
      { ...defaultShareSettings('p-full', '2026-11-18'), skills: ['python'], share_interests: true, collaboration_note: 'Free on weekends' },
    );
    expect(view?.alias).toBe('Student');
    expect(view?.is_sample).toBe(false);
    expect(view?.skills).toEqual([{ name: 'python', level: 'beginner' }]);
    expect(view?.interests).toEqual(['climate', 'computer_science']);
    expect(view?.evidence).toEqual([]);
    expect(view?.collaboration_note).toBe('Free on weekends');
  });
});

describe('store 第二阶段：邀请', () => {
  it('add（is_sample 强制）、按档案过滤、状态与屏蔽列表', () => {
    installFakeWindow();
    addInvitation({ ...invitation('i1'), is_sample: false } as unknown as Invitation);
    addInvitation(invitation('i2', { publisher_id: 'pub-2' }));
    addInvitation(invitation('i3', { profile_id: 'p-other', publisher_id: 'pub-3' }));
    expect(loadInvitations().map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(loadInvitations()[0].is_sample).toBe(true);
    expect(loadInvitations('p-full').map((i) => i.id)).toEqual(['i1', 'i2']);

    const blocked = setInvitationStatus('i2', 'blocked', '2026-11-18');
    expect(blocked).toMatchObject({ status: 'blocked', responded_on: '2026-11-18' });
    setInvitationStatus('i3', 'blocked', '2026-11-18');
    expect(blockedPublisherIds('p-full')).toEqual(['pub-2']);
    expect(blockedPublisherIds('p-other')).toEqual(['pub-3']);

    expect(setInvitationStatus('i2', 'pending', '2026-11-19')?.responded_on).toBeNull();
    expect(blockedPublisherIds('p-full')).toEqual([]);
    expect(setInvitationStatus('missing', 'declined', '2026-11-18')).toBeNull();
    clearInvitations();
    expect(loadInvitations()).toEqual([]);
  });
});

describe('store 第二阶段：clearAll', () => {
  it('清空所有新键', () => {
    const data = installFakeWindow();
    saveProfile(FULL_PROFILE);
    upsertJournalEntry(journalEntry('a'));
    pushPlanSnapshot(snapshot('s1', 'o', 'p', '2026-11-01'));
    addUserPostedOpportunity(opportunity('u1'));
    saveShareSettings(defaultShareSettings('p', '2026-11-18'));
    addInvitation(invitation('i1'));
    for (const key of Object.values(STORE_KEYS)) {
      if (key === STORE_KEYS.savedOpportunityIds || key === STORE_KEYS.grants) continue;
      expect(data.has(storageKey(key))).toBe(true);
    }
    clearAll();
    expect(data.size).toBe(0);
  });
});
