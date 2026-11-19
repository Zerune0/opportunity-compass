/**
 * Talent Board 的纯逻辑（./talent）：默认什么都不分享；每个开关只放出自己那一类；撤回立即变空；
 * 未授权的字段永远不出现在发布者预览里。撤回流程用内存版浏览器存储模拟。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { clearShareSettings, defaultShareSettings, loadShareSettings, saveShareSettings } from '../store';
import type { ShareSettings, StudentProfile } from '../types';
import { EVIDENCE_KIND_LABELS, EVIDENCE_STATUS_LABELS, SKILL_LEVEL_LABELS } from './labels';
import {
  NOT_SHARING_TEXT,
  TALENT_NOTE_MAX,
  applyShareChange,
  checkCollaborationNote,
  shareChoices,
  sharedProfilePreview,
  type SharedPreview,
} from './talent';

const HANDLE = 'share-test-handle-0001';
const TODAY = '2026-11-19';

/** 每个敏感值都用独一无二的标记，便于在 JSON 里查找。 */
const PROFILE: StudentProfile = {
  id: 'profile-id-marker',
  is_sample: true,
  display_name: 'DisplayNameMarker',
  grade: 11,
  age: 16,
  birth_date: '2010-04-05',
  region: { country: 'US', state: 'StateMarker', city: 'CityMarker', locality: 'urban' },
  citizenships: ['CitizenMarker'],
  statuses: ['low_income', 'first_generation'],
  school_name: 'SchoolNameMarker',
  hours_per_week_available: 7,
  budget_usd: 4321,
  transport: { level: 'limited', note: 'TransportNoteMarker' },
  devices: ['smartphone'],
  skills: [
    { name: 'skill-alpha', level: 'beginner' },
    { name: 'skill-beta', level: 'advanced' },
  ],
  interests: ['interest_gamma', 'interest_delta'],
  evidence: [
    {
      id: 'ev-1',
      title: 'Evidence One Title',
      kind: 'project',
      skills: ['evskill-one'],
      status: 'self_reported',
      url: 'https://example.com/UrlMarker',
      description: 'DescriptionMarker',
      prep_item_ids: ['PrepMarker'],
      added_on: '2025-01-02',
    },
    { id: 'ev-2', title: 'Evidence Two Title', kind: 'course', skills: [], status: 'evidence_attached', added_on: '2025-03-04' },
  ],
};

const NEVER = [
  'profile-id-marker',
  'DisplayNameMarker',
  'StateMarker',
  'CityMarker',
  'CitizenMarker',
  'low_income',
  'first_generation',
  'SchoolNameMarker',
  '4321',
  '2010-04-05',
  'TransportNoteMarker',
  'smartphone',
  'UrlMarker',
  'DescriptionMarker',
  'PrepMarker',
  '2025-01-02',
  'ev-1',
  'ev-2',
];

const base = (over: Partial<ShareSettings> = {}): ShareSettings => ({ ...defaultShareSettings(PROFILE.id, TODAY, HANDLE), ...over });

function sections(p: SharedPreview) {
  if (p.empty) throw new Error('expected a non-empty preview');
  return Object.fromEntries(p.sections.map((s) => [s.category, s.items]));
}

describe('默认什么都不分享', () => {
  it('没有设置 / 默认设置 → 发布者预览为空，学生端全部不勾', () => {
    for (const settings of [null, base()]) {
      expect(sharedProfilePreview(PROFILE, settings)).toEqual({ empty: true, message: NOT_SHARING_TEXT });
      const c = shareChoices(PROFILE, settings);
      expect(c.anything_shared).toBe(false);
      expect([...c.evidence, ...c.skills].some((x) => x.checked)).toBe(false);
      expect(c.interests.checked).toBe(false);
      expect(c.note).toBeNull();
    }
    expect(NOT_SHARING_TEXT).toBe('This student is not sharing anything.');
  });

  it('学生端列出档案里的每条证据与技能（原顺序），兴趣原写法', () => {
    const c = shareChoices(PROFILE, null);
    expect(c.evidence.map((e) => [e.key, e.label, e.detail])).toEqual([
      ['ev-1', 'Evidence One Title', 'Project · Self-reported'],
      ['ev-2', 'Evidence Two Title', 'Course · Evidence attached'],
    ]);
    expect(c.skills.map((s) => [s.key, s.detail])).toEqual([
      ['skill-alpha', 'Beginner'],
      ['skill-beta', 'Advanced'],
    ]);
    expect(c.interests.values).toEqual(['interest_gamma', 'interest_delta']);
  });
});

describe('每个开关只放出自己那一类', () => {
  it('证据：只出被勾的那一条，只含标题、种类、状态、技能', () => {
    const s = applyShareChange(base(), { kind: 'evidence', id: 'ev-1', on: true }, TODAY);
    const p = sharedProfilePreview(PROFILE, s);
    expect(sections(p)).toEqual({
      evidence: [{ primary: 'Evidence One Title', details: ['Project', 'Self-reported'], skills: ['evskill-one'] }],
      skills: [],
      interests: [],
      collaboration: [],
    });
    const json = JSON.stringify(p);
    for (const hidden of ['Evidence Two Title', 'skill-alpha', 'skill-beta', 'interest_gamma']) expect(json).not.toContain(hidden);
    expect(shareChoices(PROFILE, s).evidence.map((e) => e.checked)).toEqual([true, false]);
  });

  it('技能：只出被勾的技能', () => {
    const p = sharedProfilePreview(PROFILE, applyShareChange(base(), { kind: 'skill', name: 'skill-beta', on: true }, TODAY));
    expect(sections(p)).toEqual({
      evidence: [],
      skills: [{ primary: 'skill-beta', details: ['Advanced'], skills: [] }],
      interests: [],
      collaboration: [],
    });
    const json = JSON.stringify(p);
    for (const hidden of ['skill-alpha', 'Evidence One Title', 'evskill-one', 'interest_gamma']) expect(json).not.toContain(hidden);
  });

  it('兴趣：只出兴趣', () => {
    const p = sharedProfilePreview(PROFILE, applyShareChange(base(), { kind: 'interests', on: true }, TODAY));
    expect(sections(p)).toEqual({
      evidence: [],
      skills: [],
      interests: [
        { primary: 'interest_gamma', details: [], skills: [] },
        { primary: 'interest_delta', details: [], skills: [] },
      ],
      collaboration: [],
    });
    expect(JSON.stringify(p)).not.toContain('skill-alpha');
  });

  it('合作说明：只出说明；空白说明 = 不分享', () => {
    const p = sharedProfilePreview(PROFILE, applyShareChange(base(), { kind: 'note', note: '  Free on weekends.  ' }, TODAY));
    expect(sections(p)).toEqual({
      evidence: [],
      skills: [],
      interests: [],
      collaboration: [{ primary: 'Free on weekends.', details: [], skills: [] }],
    });
    expect(sharedProfilePreview(PROFILE, applyShareChange(base(), { kind: 'note', note: '   ' }, TODAY)).empty).toBe(true);
  });

  it('预览保持档案原顺序，不按勾选顺序或任何「匹配度」排序', () => {
    let s = applyShareChange(base(), { kind: 'evidence', id: 'ev-2', on: true }, TODAY);
    s = applyShareChange(s, { kind: 'evidence', id: 'ev-1', on: true }, TODAY);
    expect(sections(sharedProfilePreview(PROFILE, s)).evidence.map((i) => i.primary)).toEqual(['Evidence One Title', 'Evidence Two Title']);
  });
});

describe('未授权的字段永远不出现', () => {
  it('全部打开时，预览里也没有档案 id、显示名、学校、地区、身份、生日、预算、证据链接 / 描述 / id', () => {
    let s = base();
    for (const e of PROFILE.evidence) s = applyShareChange(s, { kind: 'evidence', id: e.id, on: true }, TODAY);
    for (const k of PROFILE.skills ?? []) s = applyShareChange(s, { kind: 'skill', name: k.name, on: true }, TODAY);
    s = applyShareChange(s, { kind: 'interests', on: true }, TODAY);
    s = applyShareChange(s, { kind: 'note', note: 'Weekends only.' }, TODAY);
    const p = sharedProfilePreview(PROFILE, s);
    expect(p.empty).toBe(false);
    const json = JSON.stringify(p);
    for (const hidden of NEVER) expect(json, hidden).not.toContain(hidden);
    if (!p.empty) {
      expect(p.alias).toBe('Sample student');
      expect(p.share_handle).toBe(HANDLE);
      expect(p.is_sample).toBe(true);
      expect(Object.keys(p).sort()).toEqual(['alias', 'empty', 'is_sample', 'sections', 'share_handle']);
    }
  });

  /** 预览里所有字符串叶子（对象的值，递归；不含键名）。 */
  function stringLeaves(v: unknown): string[] {
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.flatMap(stringLeaves);
    if (typeof v === 'object' && v !== null) return Object.values(v).flatMap(stringLeaves);
    return [];
  }

  /** 白名单：只由「被分享的那些项」和固定的标签 / 标题构成。 */
  function whitelistFor(settings: ShareSettings): Set<string> {
    const shared = PROFILE.evidence.filter((e) => settings.evidence_ids.includes(e.id));
    const skills = (PROFILE.skills ?? []).filter((s) => settings.skills.includes(s.name));
    return new Set<string>([
      'Sample student',
      HANDLE,
      'evidence',
      'skills',
      'interests',
      'collaboration',
      'Evidence',
      'Skills',
      'Interests',
      'Collaboration note',
      ...Object.values(EVIDENCE_KIND_LABELS),
      ...Object.values(EVIDENCE_STATUS_LABELS),
      ...Object.values(SKILL_LEVEL_LABELS),
      ...shared.flatMap((e) => [e.title, ...e.skills]),
      ...skills.map((s) => s.name),
      ...(settings.share_interests ? (PROFILE.interests ?? []) : []),
      ...(settings.collaboration_note ? [settings.collaboration_note] : []),
    ]);
  }

  it('预览的每个字符串都来自白名单（被分享的项 + 固定标签），任意开关组合都成立', () => {
    const variants: ShareSettings[] = [
      base({ evidence_ids: ['ev-1'] }),
      base({ evidence_ids: ['ev-2'], skills: ['skill-alpha'] }),
      base({ share_interests: true }),
      base({ collaboration_note: 'Weekends only.' }),
      base({ evidence_ids: ['ev-1', 'ev-2'], skills: ['skill-alpha', 'skill-beta'], share_interests: true, collaboration_note: 'Weekends only.' }),
    ];
    for (const s of variants) {
      const p = sharedProfilePreview(PROFILE, s);
      expect(p.empty).toBe(false);
      const allowed = whitelistFor(s);
      for (const leaf of stringLeaves(p)) expect(allowed.has(leaf), `unexpected string in preview: ${leaf}`).toBe(true);
    }
  });

  it('设置属于别的档案 → 空，学生端也不勾', () => {
    const other = { ...base({ evidence_ids: ['ev-1'], share_interests: true }), profile_id: 'someone-else' };
    expect(sharedProfilePreview(PROFILE, other).empty).toBe(true);
    const c = shareChoices(PROFILE, other);
    expect(c.evidence.some((e) => e.checked) || c.interests.checked || c.anything_shared).toBe(false);
  });

  it('档案损坏也不抛异常', () => {
    const broken = { id: PROFILE.id, is_sample: false, display_name: 'x', evidence: 'nope', skills: [null, 3], interests: 'x' } as unknown as StudentProfile;
    expect(() => shareChoices(broken, base({ share_interests: true }))).not.toThrow();
    expect(sharedProfilePreview(broken, base({ share_interests: true, evidence_ids: ['ev-1'] }))).toEqual({ empty: true, message: NOT_SHARING_TEXT });
  });
});

describe('applyShareChange', () => {
  it('返回新对象：只改一项，句柄不变，updated_on = today，关掉就移除，不修改 base', () => {
    const b = base({ evidence_ids: ['ev-1'], skills: ['skill-alpha'] });
    const before = JSON.stringify(b);
    const off = applyShareChange(b, { kind: 'evidence', id: 'ev-1', on: false }, '2026-12-01');
    expect(off).toEqual({ ...b, evidence_ids: [], updated_on: '2026-12-01' });
    expect(JSON.stringify(b)).toBe(before);
    const twice = applyShareChange(b, { kind: 'skill', name: 'skill-alpha', on: true }, TODAY);
    expect(twice.skills).toEqual(['skill-alpha']);
    expect(applyShareChange(b, { kind: 'note', note: null }, TODAY).collaboration_note).toBeNull();
    expect(applyShareChange(b, { kind: 'interests', on: true }, TODAY).share_handle).toBe(HANDLE);
  });
});

describe('checkCollaborationNote：拒绝像联系方式的内容与过长的说明', () => {
  it.each([
    ['邮箱', 'Reach me at maya.sample@example.org please', /email address/],
    ['网址 https', 'See https://my-site.example for my work', /web address/],
    ['网址 www', 'My page: www.example.net', /web address/],
    ['裸域名', 'portfolio at mysite.com', /web address/],
    ['电话（连字符）', 'Call 555-123-4567 after school', /phone number/],
    ['电话（括号与空格）', 'Text (555) 123 4567', /phone number/],
    ['电话（连续数字）', 'number 5551234567', /phone number/],
    ['太长', 'a'.repeat(TALENT_NOTE_MAX + 1), /under 1000 characters/],
  ])('%s → 拒绝', (_label, note, expected) => {
    const problem = checkCollaborationNote(note);
    expect(problem).toMatch(expected);
    // applyShareChange 也不会把它写进设置
    expect(applyShareChange(base({ collaboration_note: 'Old note.' }), { kind: 'note', note }, TODAY).collaboration_note).toBe('Old note.');
  });

  it.each([
    ['普通说明', 'Free on weekends; I would like to work on climate data.'],
    ['日期不算电话', 'Free after 2026-12-01 and before 2027-01-15.'],
    ['时间不算电话', 'Usually free 10:00-12:00 on Saturdays.'],
    ['短数字', 'Grade 11, about 4 hours a week.'],
    ['空白', '   '],
    ['null', null],
    ['刚好 1000 字', 'a'.repeat(TALENT_NOTE_MAX)],
  ])('%s → 通过', (_label, note) => {
    expect(checkCollaborationNote(note)).toBeNull();
  });
});

describe('撤回（内存版浏览器存储）', () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  function installFakeWindow(): void {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, String(v)),
      removeItem: (k: string) => void data.delete(k),
    };
    (globalThis as { window?: unknown }).window = { localStorage: storage };
  }

  it('clearShareSettings(profileId) 之后预览立即为空，句柄保留', () => {
    installFakeWindow();
    let s = applyShareChange(base(), { kind: 'evidence', id: 'ev-1', on: true }, TODAY);
    s = applyShareChange(s, { kind: 'interests', on: true }, TODAY);
    expect(saveShareSettings(s)).toBe(true);
    expect(sharedProfilePreview(PROFILE, loadShareSettings(PROFILE.id)).empty).toBe(false);
    clearShareSettings(PROFILE.id, '2026-11-20');
    const after = loadShareSettings(PROFILE.id);
    expect(after?.share_handle).toBe(HANDLE);
    expect(sharedProfilePreview(PROFILE, after)).toEqual({ empty: true, message: NOT_SHARING_TEXT });
    expect(shareChoices(PROFILE, after).anything_shared).toBe(false);
  });

  it('只读取不会创建分享设置', () => {
    installFakeWindow();
    expect(loadShareSettings(PROFILE.id)).toBeNull();
    sharedProfilePreview(PROFILE, loadShareSettings(PROFILE.id));
    shareChoices(PROFILE, loadShareSettings(PROFILE.id));
    expect(loadShareSettings(PROFILE.id)).toBeNull();
  });
});
