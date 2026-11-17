import { afterEach, describe, expect, it } from 'vitest';
import {
  addEvidence,
  clearAll,
  loadGrants,
  loadProfile,
  loadSavedOpportunityIds,
  saveProfile,
  storageKey,
  toggleSavedOpportunity,
  STORE_KEYS,
} from './store';
import type { StudentProfile } from './types';

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

  it('损坏的 JSON 回退默认值', () => {
    const data = installFakeWindow();
    data.set(storageKey(STORE_KEYS.profile), '{not json');
    data.set(storageKey(STORE_KEYS.grants), '{"oops":1}');
    expect(loadProfile()).toBeNull();
    expect(loadGrants()).toEqual([]);
  });
});
