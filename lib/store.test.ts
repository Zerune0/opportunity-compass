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
import type { ResourceGrant, StudentProfile } from './types';

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
