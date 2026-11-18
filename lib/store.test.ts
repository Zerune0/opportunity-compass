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
  clearMaterials,
  clearPlanSnapshots,
  clearShareSettings,
  clearUserPostedOpportunities,
  createEmptyProfile,
  createJournalEntry,
  defaultShareSettings,
  getJournalEntry,
  getOrCreateShareSettings,
  latestPlanSnapshot,
  linkEvidenceToPrep,
  loadInvitations,
  loadJournal,
  loadMaterials,
  loadPlanSnapshots,
  loadShareSettings,
  loadUserPostedOpportunities,
  profileIdForShareHandle,
  pushPlanSnapshot,
  recordJournalEvent,
  removeJournalEntry,
  removeMaterial,
  removeUserPostedOpportunity,
  saveInvitations,
  saveJournal,
  saveShareSettings,
  setInvitationStatus,
  setMaterialStatus,
  toggleJournalTask,
  unlinkEvidenceFromPrep,
  updateEvidence,
  updateProfile,
  upsertJournalEntry,
  upsertMaterial,
} from './store';
import type {
  EvidenceItem,
  Invitation,
  JournalEntry,
  Material,
  Opportunity,
  PlanSnapshot,
  ResourceGrant,
  ShareSettings,
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

function journalEntry(oppId: string, over: Partial<JournalEntry> = {}, profileId = 'p-full'): JournalEntry {
  return {
    id: `j-${profileId}-${oppId}`,
    profile_id: profileId,
    opportunity_id: oppId,
    added_on: '2026-11-01',
    application: 'preparing',
    submitted_on: null,
    eligibility_confirmation: 'unconfirmed',
    decision: 'pending',
    participated: null,
    history: [{ event: 'added', on: '2026-11-01' }],
    tasks: [
      { id: 't1', title: 'Draft essay', done: false },
      { id: 't2', title: 'Ask for letter', done: false },
    ],
    material_ids: [],
    official_url: `https://example.org/${oppId}`,
    ...over,
  };
}

function material(id: string, over: Partial<Material> = {}): Material {
  return {
    id,
    profile_id: 'p-full',
    kind: 'resume',
    title: `Material ${id}`,
    reusable: true,
    opportunity_id: null,
    estimated_hours: 3,
    status: 'not_started',
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

const HANDLE = 'share-11111111-2222-3333-4444-555555555555';

function invitation(id: string, over: Partial<Invitation> = {}): Invitation {
  return {
    id,
    publisher_id: 'pub-1',
    share_handle: HANDLE,
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
    expect(loadJournal('p')).toEqual([]);
    expect(getJournalEntry('p', 'x')).toBeNull();
    expect(loadMaterials()).toEqual([]);
    expect(loadPlanSnapshots()).toEqual([]);
    expect(latestPlanSnapshot('x', 'p')).toBeNull();
    expect(loadUserPostedOpportunities()).toEqual([]);
    expect(loadShareSettings('p')).toBeNull();
    expect(profileIdForShareHandle(HANDLE)).toBeNull();
    expect(loadInvitations()).toEqual([]);
    expect(blockedPublisherIds(HANDLE)).toEqual([]);
    expect(updateProfile({ grade: 10 })).toBeNull();
    expect(updateEvidence('e1', { title: 'x' })).toBeNull();
    expect(linkEvidenceToPrep('e1', 'o', 'p')).toBeNull();
    expect(unlinkEvidenceFromPrep('e1', 'o', 'p')).toBeNull();
    expect(saveJournal([journalEntry('a')])).toBe(false);
    expect(upsertJournalEntry(journalEntry('a'))).toHaveLength(1);
    expect(recordJournalEvent('p-full', 'a', 'submitted', '2026-11-18')).toBeNull();
    expect(toggleJournalTask('p-full', 'a', 't1', true)).toBeNull();
    expect(upsertMaterial(material('m1'))).toHaveLength(1);
    expect(removeMaterial('m1')).toBe(false);
    expect(setMaterialStatus('m1', 'ready')).toBeNull();
    expect(pushPlanSnapshot(snapshot('s1', 'o', 'p', '2026-11-18'))).toHaveLength(1);
    expect(addUserPostedOpportunity(opportunity('u1'))).toHaveLength(1);
    expect(saveShareSettings(defaultShareSettings('p', '2026-11-18'))).toBe(false);
    expect(getOrCreateShareSettings('p', '2026-11-18').profile_id).toBe('p');
    expect(saveInvitations([invitation('i1')])).toBe(false);
    expect(setInvitationStatus('i1', 'blocked', '2026-11-18')).toBeNull();
    expect(() => {
      removeJournalEntry('p-full', 'a');
      clearJournal();
      clearJournal('p');
      clearMaterials();
      clearMaterials('p');
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
  const LIST_KEYS = [
    STORE_KEYS.journal,
    STORE_KEYS.materials,
    STORE_KEYS.planSnapshots,
    STORE_KEYS.userPostedOpportunities,
    STORE_KEYS.shareSettings,
    STORE_KEYS.invitations,
  ];

  it('损坏 JSON / 不是数组时全部回退默认值', () => {
    const data = installFakeWindow();
    for (const key of LIST_KEYS) data.set(storageKey(key), '{broken');
    expect(loadJournal()).toEqual([]);
    expect(loadMaterials()).toEqual([]);
    expect(loadPlanSnapshots()).toEqual([]);
    expect(loadUserPostedOpportunities()).toEqual([]);
    expect(loadShareSettings('p')).toBeNull();
    expect(loadInvitations()).toEqual([]);
    for (const key of LIST_KEYS) data.set(storageKey(key), JSON.stringify({ id: 'not-a-list' }));
    expect(loadJournal()).toEqual([]);
    expect(loadMaterials()).toEqual([]);
    expect(loadPlanSnapshots()).toEqual([]);
    expect(loadUserPostedOpportunities()).toEqual([]);
    expect(loadInvitations()).toEqual([]);
  });

  it('列表混有非法条目时只留合法的', () => {
    const data = installFakeWindow();
    data.set(
      storageKey(STORE_KEYS.journal),
      JSON.stringify([
        journalEntry('a', {
          tasks: [{ id: 't1', title: 'ok', done: false }, { id: 't-bad' }] as JournalEntry['tasks'],
          history: [{ event: 'added', on: '2026-11-01' }, { event: 'teleported', on: '2026-11-02' }] as JournalEntry['history'],
          material_ids: ['m1', 7, 'm1'] as unknown as string[],
        }),
        { ...journalEntry('b'), application: 'accepted_somehow' },
        { ...journalEntry('c'), profile_id: undefined },
        { id: 'j-d', profile_id: 'p-full', opportunity_id: 'd', added_on: '2026-11-01', status: 'preparing', status_history: [], tasks: [], materials: [], official_url: 'https://example.org/d' }, // 旧形状
        { id: 'j-e', opportunity_id: 'e' },
        42,
      ]),
    );
    const journal = loadJournal();
    expect(journal.map((e) => e.opportunity_id)).toEqual(['a']);
    expect(journal[0].tasks.map((t) => t.id)).toEqual(['t1']);
    expect(journal[0].history).toEqual([{ event: 'added', on: '2026-11-01' }]);
    expect(journal[0].material_ids).toEqual(['m1']);

    data.set(
      storageKey(STORE_KEYS.materials),
      JSON.stringify([material('m1'), { ...material('m2'), status: 'done' }, { ...material('m3'), kind: 'tattoo' }, { ...material('m4'), profile_id: 3 }]),
    );
    expect(loadMaterials().map((m) => m.id)).toEqual(['m1']);

    data.set(
      storageKey(STORE_KEYS.planSnapshots),
      JSON.stringify([snapshot('s1', 'o', 'p', '2026-11-01'), { ...snapshot('s2', 'o', 'p', '2026-11-02'), trigger: 'magic' }, null]),
    );
    expect(loadPlanSnapshots().map((s) => s.id)).toEqual(['s1']);

    const q = defaultShareSettings('q', '2026-11-18');
    data.set(
      storageKey(STORE_KEYS.shareSettings),
      JSON.stringify([{ profile_id: 'p', evidence_ids: 'e1' }, { ...defaultShareSettings('r', '2026-11-18'), share_handle: '' }, q]),
    );
    expect(loadShareSettings('p')).toBeNull();
    expect(loadShareSettings('r')).toBeNull();
    expect(loadShareSettings('q')).toEqual(q);

    data.set(
      storageKey(STORE_KEYS.invitations),
      JSON.stringify([
        invitation('i1'),
        { ...invitation('i2'), is_sample: false },
        { ...invitation('i3'), status: 'spam' },
        { ...invitation('i4'), share_handle: undefined, profile_id: 'p-full' }, // 旧形状：按档案 id 指向
      ]),
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

  it('updateEvidence：清空 prep_item_ids 传空数组', () => {
    installFakeWindow();
    saveProfile(FULL_PROFILE);
    linkEvidenceToPrep('e1', 'opp-a', 'prep-1');
    const p = updateEvidence('e1', { prep_item_ids: [] });
    expect(p?.evidence.find((x) => x.id === 'e1')?.prep_item_ids).toEqual([]);
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
  it('createJournalEntry：四项独立字段的初始值、history 只有 added、不写存储', () => {
    const data = installFakeWindow();
    const e = createJournalEntry('p-full', { id: 'opp-a', official_url: 'https://example.org/a' }, '2026-11-18');
    expect(e).toMatchObject({
      profile_id: 'p-full',
      opportunity_id: 'opp-a',
      added_on: '2026-11-18',
      application: 'preparing',
      submitted_on: null,
      eligibility_confirmation: 'unconfirmed',
      decision: 'pending',
      participated: null,
      history: [{ event: 'added', on: '2026-11-18' }],
      tasks: [],
      material_ids: [],
      official_url: 'https://example.org/a',
    });
    expect(e.id).not.toContain('p-full');
    expect(data.size).toBe(0);
  });

  it('按 (profile_id, opportunity_id) 唯一：两个档案的同一机会互不影响；替换保持位置；get / remove', () => {
    installFakeWindow();
    upsertJournalEntry(journalEntry('a'));
    upsertJournalEntry(journalEntry('b'));
    upsertJournalEntry(journalEntry('a', {}, 'p-other'));
    const list = upsertJournalEntry(journalEntry('a', { id: 'j-a2', notes: 'updated' }));
    expect(list.map((e) => e.id)).toEqual(['j-a2', 'j-p-full-b']);
    expect(loadJournal()).toHaveLength(3);
    expect(loadJournal('p-full')).toHaveLength(2);
    expect(loadJournal('p-other').map((e) => e.opportunity_id)).toEqual(['a']);
    expect(getJournalEntry('p-full', 'a')?.notes).toBe('updated');
    expect(getJournalEntry('p-other', 'a')?.notes).toBeUndefined();
    expect(removeJournalEntry('p-full', 'a').map((e) => e.opportunity_id)).toEqual(['b']);
    expect(getJournalEntry('p-full', 'a')).toBeNull();
    expect(getJournalEntry('p-other', 'a')).not.toBeNull();
    clearJournal('p-other');
    expect(loadJournal().map((e) => e.profile_id)).toEqual(['p-full']);
  });

  it('saveJournal 按 (profile_id, opportunity_id) 去重，保留最后一条', () => {
    installFakeWindow();
    saveJournal([journalEntry('a'), journalEntry('a', { id: 'j-a-last' }), journalEntry('a', {}, 'p-other')]);
    expect(loadJournal().map((e) => e.id)).toEqual(['j-a-last', 'j-p-other-a']);
  });

  it('upsertJournalEntry：形状不对时不写', () => {
    installFakeWindow();
    upsertJournalEntry(journalEntry('a'));
    const bad = { ...journalEntry('b'), decision: 'maybe' } as unknown as JournalEntry;
    expect(upsertJournalEntry(bad).map((e) => e.opportunity_id)).toEqual(['a']);
    expect(upsertJournalEntry(null as unknown as JournalEntry)).toEqual([]);
    expect(loadJournal()).toHaveLength(1);
  });

  it('recordJournalEvent：各事件只改自己那一项，四项互相独立', () => {
    installFakeWindow();
    upsertJournalEntry(journalEntry('a'));
    let e = recordJournalEvent('p-full', 'a', 'submitted', '2026-11-10');
    expect(e).toMatchObject({ application: 'submitted', submitted_on: '2026-11-10', eligibility_confirmation: 'unconfirmed', decision: 'pending', participated: null });
    e = recordJournalEvent('p-full', 'a', 'eligibility_confirmed', '2026-11-12');
    expect(e).toMatchObject({ application: 'submitted', eligibility_confirmation: 'confirmed', decision: 'pending', participated: null });
    e = recordJournalEvent('p-full', 'a', 'not_admitted', '2026-12-01');
    expect(e).toMatchObject({ application: 'submitted', eligibility_confirmation: 'confirmed', decision: 'not_admitted', participated: null });
    e = recordJournalEvent('p-full', 'a', 'did_not_participate', '2026-12-02');
    expect(e?.participated).toBe(false);
    e = recordJournalEvent('p-full', 'a', 'withdrawn', '2026-12-03');
    expect(e).toMatchObject({ application: 'withdrawn', submitted_on: '2026-11-10', decision: 'not_admitted' });
    e = recordJournalEvent('p-full', 'a', 'reopened', '2026-12-04');
    expect(e).toMatchObject({ application: 'preparing', submitted_on: null });
    e = recordJournalEvent('p-full', 'a', 'eligibility_rejected', '2026-12-05');
    expect(e?.eligibility_confirmation).toBe('rejected');
    e = recordJournalEvent('p-full', 'a', 'admitted', '2026-12-06');
    expect(e?.decision).toBe('admitted');
    e = recordJournalEvent('p-full', 'a', 'participated', '2026-12-07');
    expect(e?.participated).toBe(true);
    expect(getJournalEntry('p-full', 'a')?.history.map((h) => h.event)).toEqual([
      'added',
      'submitted',
      'eligibility_confirmed',
      'not_admitted',
      'did_not_participate',
      'withdrawn',
      'reopened',
      'eligibility_rejected',
      'admitted',
      'participated',
    ]);
  });

  it('recordJournalEvent：同一事件同一天不重复追加；不同天照常追加；只影响该档案', () => {
    installFakeWindow();
    upsertJournalEntry(journalEntry('a'));
    upsertJournalEntry(journalEntry('a', {}, 'p-other'));
    recordJournalEvent('p-full', 'a', 'submitted', '2026-11-10');
    recordJournalEvent('p-full', 'a', 'submitted', '2026-11-10');
    expect(getJournalEntry('p-full', 'a')?.history).toEqual([
      { event: 'added', on: '2026-11-01' },
      { event: 'submitted', on: '2026-11-10' },
    ]);
    const again = recordJournalEvent('p-full', 'a', 'submitted', '2026-11-11');
    expect(again?.submitted_on).toBe('2026-11-11');
    expect(again?.history).toHaveLength(3);
    expect(getJournalEntry('p-other', 'a')?.application).toBe('preparing');
    expect(recordJournalEvent('missing', 'a', 'submitted', '2026-11-11')).toBeNull();
    expect(recordJournalEvent('p-full', 'a', 'hacked' as never, '2026-11-11')).toBeNull();
  });

  it('recordJournalEvent：不合常理的顺序（没提交就记 admitted）不拦截，只记录', () => {
    installFakeWindow();
    upsertJournalEntry(journalEntry('a'));
    const e = recordJournalEvent('p-full', 'a', 'admitted', '2026-11-10');
    expect(e).toMatchObject({ application: 'preparing', decision: 'admitted', eligibility_confirmation: 'unconfirmed' });
  });

  it('toggleJournalTask 勾选写入日期、取消清空日期', () => {
    installFakeWindow();
    upsertJournalEntry(journalEntry('a'));
    const done = toggleJournalTask('p-full', 'a', 't1', true, '2026-11-12');
    expect(done?.tasks.find((t) => t.id === 't1')).toMatchObject({ done: true, done_on: '2026-11-12' });
    expect(getJournalEntry('p-full', 'a')?.tasks.find((t) => t.id === 't2')?.done).toBe(false);
    const undone = toggleJournalTask('p-full', 'a', 't1', false);
    expect(undone?.tasks.find((t) => t.id === 't1')).toMatchObject({ done: false, done_on: null });
    expect(toggleJournalTask('p-full', 'a', 'nope', true)).toBeNull();
    expect(toggleJournalTask('p-other', 'a', 't1', true)).toBeNull();
    clearJournal();
    expect(loadJournal()).toEqual([]);
  });
});

describe('store 第二阶段：申请材料', () => {
  it('可复用材料只存一份，被两个条目引用；改状态后两边看到同一条记录', () => {
    installFakeWindow();
    upsertMaterial(material('m-resume'));
    upsertMaterial(material('m-essay-a', { kind: 'essay', reusable: false, opportunity_id: 'a' }));
    upsertJournalEntry(journalEntry('a', { material_ids: ['m-resume', 'm-essay-a'] }));
    upsertJournalEntry(journalEntry('b', { material_ids: ['m-resume'] }));
    expect(loadMaterials('p-full').filter((m) => m.kind === 'resume')).toHaveLength(1);
    const updated = setMaterialStatus('m-resume', 'ready');
    expect(updated?.status).toBe('ready');
    const byId = new Map(loadMaterials('p-full').map((m) => [m.id, m]));
    for (const opp of ['a', 'b']) {
      const ids = getJournalEntry('p-full', opp)?.material_ids ?? [];
      expect(byId.get(ids[0])?.status).toBe('ready');
    }
    expect(setMaterialStatus('m-resume', 'finished' as never)).toBeNull();
    expect(setMaterialStatus('missing', 'ready')).toBeNull();
  });

  it('upsertMaterial 按 id 替换并按档案返回；loadMaterials 按档案过滤', () => {
    installFakeWindow();
    upsertMaterial(material('m1'));
    upsertMaterial(material('m2', { profile_id: 'p-other' }));
    const list = upsertMaterial(material('m1', { title: 'Renamed' }));
    expect(list.map((m) => m.title)).toEqual(['Renamed']);
    expect(loadMaterials().map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(loadMaterials('p-other').map((m) => m.id)).toEqual(['m2']);
    expect(upsertMaterial({ ...material('m3'), status: 'bad' } as unknown as Material).map((m) => m.id)).toEqual(['m1']);
  });

  it('removeMaterial 同时从各条目的 material_ids 中移除', () => {
    installFakeWindow();
    upsertMaterial(material('m1'));
    upsertMaterial(material('m2'));
    upsertJournalEntry(journalEntry('a', { material_ids: ['m1', 'm2'] }));
    upsertJournalEntry(journalEntry('b', { material_ids: ['m1'] }));
    expect(removeMaterial('m1')).toBe(true);
    expect(loadMaterials().map((m) => m.id)).toEqual(['m2']);
    expect(getJournalEntry('p-full', 'a')?.material_ids).toEqual(['m2']);
    expect(getJournalEntry('p-full', 'b')?.material_ids).toEqual([]);
    expect(removeMaterial('m1')).toBe(false);
  });

  it('clearMaterials(profileId) 只清该档案，并清空该档案条目的 material_ids', () => {
    installFakeWindow();
    upsertMaterial(material('m1'));
    upsertMaterial(material('m2', { profile_id: 'p-other' }));
    upsertJournalEntry(journalEntry('a', { material_ids: ['m1'] }));
    upsertJournalEntry(journalEntry('a', { material_ids: ['m2'] }, 'p-other'));
    clearMaterials('p-full');
    expect(loadMaterials().map((m) => m.id)).toEqual(['m2']);
    expect(getJournalEntry('p-full', 'a')?.material_ids).toEqual([]);
    expect(getJournalEntry('p-other', 'a')?.material_ids).toEqual(['m2']);
    clearMaterials();
    expect(loadMaterials()).toEqual([]);
    expect(getJournalEntry('p-other', 'a')?.material_ids).toEqual([]);
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

  it('推入比现有都旧的快照时，按插入顺序保留，刚推入的不会被自己挤掉', () => {
    installFakeWindow();
    pushPlanSnapshot(snapshot('new1', 'o1', 'p1', '2026-11-10'), 2);
    pushPlanSnapshot(snapshot('new2', 'o1', 'p1', '2026-11-11'), 2);
    const kept = pushPlanSnapshot(snapshot('old', 'o1', 'p1', '2026-10-01'), 2);
    expect(kept.map((s) => s.id)).toEqual(['old', 'new2']);
    expect(loadPlanSnapshots('o1', 'p1').map((s) => s.id)).toEqual(['old', 'new2']);
  });

  it('PlanSnapshotInputs.changed_fields 可选，存取不丢', () => {
    installFakeWindow();
    const s = { ...snapshot('s1', 'o1', 'p1', '2026-11-10'), trigger: 'profile_edited' as const };
    s.inputs = { ...s.inputs, changed_fields: ['grade', 'hours_per_week_available'] };
    pushPlanSnapshot(s);
    expect(latestPlanSnapshot('o1', 'p1')?.inputs.changed_fields).toEqual(['grade', 'hours_per_week_available']);
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
  const settingsFor = (over: Partial<ShareSettings> = {}): ShareSettings => ({
    ...defaultShareSettings('p-full', '2026-11-18', HANDLE),
    ...over,
  });

  it('默认设置什么都不分享，并生成不透明句柄（不含档案 id）', () => {
    const d = defaultShareSettings('p-full', '2026-11-18');
    expect(d).toMatchObject({ profile_id: 'p-full', evidence_ids: [], skills: [], share_interests: false, collaboration_note: null, updated_on: '2026-11-18' });
    expect(d.share_handle).toMatch(/^share-/);
    expect(d.share_handle).not.toContain('p-full');
    expect(defaultShareSettings('p-full', '2026-11-18').share_handle).not.toBe(d.share_handle);
    expect(defaultShareSettings('p-full', '2026-11-18', HANDLE).share_handle).toBe(HANDLE);
  });

  it('save / load 按 profile_id；profileIdForShareHandle 对回档案；句柄不能被别的档案占用', () => {
    installFakeWindow();
    const d = settingsFor();
    expect(saveShareSettings({ ...d, skills: ['python'] })).toBe(true);
    expect(saveShareSettings(defaultShareSettings('other', '2026-11-18'))).toBe(true);
    expect(saveShareSettings({ ...d, skills: ['public_speaking'] })).toBe(true);
    expect(loadShareSettings('p-full')?.skills).toEqual(['public_speaking']);
    expect(profileIdForShareHandle(HANDLE)).toBe('p-full');
    expect(profileIdForShareHandle('share-unknown')).toBeNull();
    expect(profileIdForShareHandle('')).toBeNull();
    expect(saveShareSettings({ ...defaultShareSettings('intruder', '2026-11-18'), share_handle: HANDLE })).toBe(false);
  });

  it('getOrCreateShareSettings：没有时新建并保存，之后句柄稳定', () => {
    installFakeWindow();
    const a = getOrCreateShareSettings('p-full', '2026-11-18');
    const b = getOrCreateShareSettings('p-full', '2026-11-19');
    expect(b).toEqual(a);
    expect(profileIdForShareHandle(a.share_handle)).toBe('p-full');
  });

  it('clearShareSettings(profileId) 撤回分享但保留句柄；clearShareSettings() 清空全部', () => {
    installFakeWindow();
    saveShareSettings(settingsFor({ evidence_ids: ['e1'], share_interests: true }));
    saveShareSettings(defaultShareSettings('other', '2026-11-18'));
    clearShareSettings('p-full', '2026-11-20');
    expect(loadShareSettings('p-full')).toEqual(defaultShareSettings('p-full', '2026-11-20', HANDLE));
    expect(buildSharedProfileView(FULL_PROFILE, loadShareSettings('p-full'))).toBeNull();
    expect(loadShareSettings('other')).not.toBeNull();
    clearShareSettings('nobody');
    expect(loadShareSettings('nobody')).toBeNull();
    clearShareSettings();
    expect(loadShareSettings('p-full')).toBeNull();
    expect(loadShareSettings('other')).toBeNull();
  });

  it('settings 为 null、默认设置、属于别的档案、缺句柄时返回 null', () => {
    expect(buildSharedProfileView(FULL_PROFILE, null)).toBeNull();
    expect(buildSharedProfileView(FULL_PROFILE, settingsFor())).toBeNull();
    expect(buildSharedProfileView(FULL_PROFILE, { ...settingsFor({ evidence_ids: ['e1'] }), profile_id: 'someone-else' })).toBeNull();
    expect(buildSharedProfileView(FULL_PROFILE, settingsFor({ evidence_ids: ['e1'], share_handle: '' }))).toBeNull();
    // 勾选了档案里不存在的证据 / 技能 = 什么都没分享
    expect(buildSharedProfileView(FULL_PROFILE, settingsFor({ evidence_ids: ['ghost'], skills: ['ghost'] }))).toBeNull();
  });

  it('只开一条证据时只出这一条，且不含 url / description；不泄露档案 id、学校、地区、身份、年级', () => {
    const view = buildSharedProfileView(FULL_PROFILE, settingsFor({ evidence_ids: ['e1'] }));
    expect(view).toEqual({
      share_handle: HANDLE,
      alias: 'Sample student',
      evidence: [{ id: 'e1', title: EV1.title, kind: 'project', skills: ['python'], status: 'evidence_attached' }],
      skills: [],
      interests: [],
      collaboration_note: null,
      is_sample: true,
    });
    const json = JSON.stringify(view);
    for (const secret of ['p-full', '"profile_id"', 'Hidden Valley', 'Gallupville', 'NM', 'rural', 'first_generation', 'low_income', 'Sample Alex', 'secret-portfolio', 'Private description', '"grade"', 'budget', 'climate']) {
      expect(json).not.toContain(secret);
    }
  });

  it('输出 JSON 在全部分享时也不含档案 id', () => {
    const view = buildSharedProfileView(
      FULL_PROFILE,
      settingsFor({ evidence_ids: ['e1', 'e2'], skills: ['python', 'public_speaking'], share_interests: true, collaboration_note: 'Hi' }),
    );
    expect(view).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain(FULL_PROFILE.id);
    expect(Object.keys(view as object)).not.toContain('profile_id');
  });

  it('技能只出勾选的，兴趣只在开关打开时出；非示例档案 alias 为 Student', () => {
    const view = buildSharedProfileView(
      { ...FULL_PROFILE, is_sample: false },
      settingsFor({ skills: ['python'], share_interests: true, collaboration_note: 'Free on weekends' }),
    );
    expect(view?.alias).toBe('Student');
    expect(view?.is_sample).toBe(false);
    expect(view?.skills).toEqual([{ name: 'python', level: 'beginner' }]);
    expect(view?.interests).toEqual(['climate', 'computer_science']);
    expect(view?.evidence).toEqual([]);
    expect(view?.collaboration_note).toBe('Free on weekends');
  });

  it('损坏的档案不抛异常：evidence / skills / interests 不是数组、证据缺 skills 或 skills 不是数组', () => {
    const all = settingsFor({ evidence_ids: ['e1', 'e2', 'e3'], skills: ['python'], share_interests: true });
    const broken = (over: Record<string, unknown>) => ({ ...FULL_PROFILE, ...over }) as unknown as StudentProfile;
    expect(() => buildSharedProfileView(broken({ evidence: 'oops' }), all)).not.toThrow();
    expect(buildSharedProfileView(broken({ evidence: 'oops' }), all)?.evidence).toEqual([]);
    const v = buildSharedProfileView(
      broken({
        evidence: [{ ...EV1, skills: undefined }, { ...EV2, skills: 'teamwork' }, null, 42, { id: 'e3' }],
        skills: { python: 'beginner' },
        interests: 'climate',
      }),
      all,
    );
    expect(v?.evidence.map((e) => [e.id, e.skills])).toEqual([
      ['e1', []],
      ['e2', []],
    ]);
    expect(v?.skills).toEqual([]);
    expect(v?.interests).toEqual([]);
    expect(buildSharedProfileView(broken({ evidence: null, skills: null, interests: null }), all)).toBeNull();
    expect(buildSharedProfileView(null as unknown as StudentProfile, all)).toBeNull();
  });
});

describe('store 第二阶段：邀请', () => {
  it('add（is_sample 强制）、按分享句柄过滤、状态与屏蔽列表', () => {
    installFakeWindow();
    const OTHER = 'share-other-handle';
    addInvitation({ ...invitation('i1'), is_sample: false } as unknown as Invitation);
    addInvitation(invitation('i2', { publisher_id: 'pub-2' }));
    addInvitation(invitation('i3', { share_handle: OTHER, publisher_id: 'pub-3' }));
    expect(loadInvitations().map((i) => i.id)).toEqual(['i1', 'i2', 'i3']);
    expect(loadInvitations()[0].is_sample).toBe(true);
    expect(loadInvitations(HANDLE).map((i) => i.id)).toEqual(['i1', 'i2']);

    const blocked = setInvitationStatus('i2', 'blocked', '2026-11-18');
    expect(blocked).toMatchObject({ status: 'blocked', responded_on: '2026-11-18' });
    setInvitationStatus('i3', 'blocked', '2026-11-18');
    expect(blockedPublisherIds(HANDLE)).toEqual(['pub-2']);
    expect(blockedPublisherIds(OTHER)).toEqual(['pub-3']);

    expect(setInvitationStatus('i2', 'pending', '2026-11-19')?.responded_on).toBeNull();
    expect(blockedPublisherIds(HANDLE)).toEqual([]);
    expect(setInvitationStatus('missing', 'declined', '2026-11-18')).toBeNull();
    clearInvitations();
    expect(loadInvitations()).toEqual([]);
  });

  it('学生浏览器里：档案 → 句柄 → 邀请；撤回分享后屏蔽仍然生效', () => {
    installFakeWindow();
    const s = getOrCreateShareSettings('p-full', '2026-11-18');
    addInvitation(invitation('i1', { share_handle: s.share_handle, publisher_id: 'pub-9' }));
    setInvitationStatus('i1', 'blocked', '2026-11-18');
    expect(profileIdForShareHandle(loadInvitations()[0].share_handle)).toBe('p-full');
    clearShareSettings('p-full', '2026-11-19');
    const handle = loadShareSettings('p-full')?.share_handle as string;
    expect(handle).toBe(s.share_handle);
    expect(blockedPublisherIds(handle)).toEqual(['pub-9']);
  });
});

describe('store 第二阶段：clearAll', () => {
  it('清空所有新键', () => {
    const data = installFakeWindow();
    saveProfile(FULL_PROFILE);
    upsertJournalEntry(journalEntry('a'));
    upsertMaterial(material('m1'));
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
