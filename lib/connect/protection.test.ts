/**
 * 未成年人更严格的默认设置（./protection）与发布者视图（./talent 的 publisherView / sharedProfilePreview）：
 * 判断规则（18 岁、12 年级、年龄未知；birth_date 优先，没有时用 age）；失败时从严；受保护时合作说明不分享（但不删除）；
 * 所有档案：证据不显示标题、证据 id 换成位置编号、像联系方式的字符串不给发布者看；
 * 发布者视图里永远没有年龄、出生日期、年级、身份信息，受保护与否结构完全相同；修改分享前的确认（canChangeSharing）。
 */
import { describe, expect, it } from 'vitest';
import { defaultShareSettings } from '../store';
import type { ShareSettings, StudentProfile } from '../types';
import { invitationReasons } from './invitations';
import {
  EVIDENCE_TITLE_NOTICE,
  GUARDIAN_ADVICE,
  NOTE_REMOVED_NOTICE,
  PROTECTION_EFFECTS,
  canChangeSharing,
  collaborationNoteToClear,
  exactlyAsWrittenWarning,
  isUnprotected,
  protectionFor,
  protectionNotice,
  unprotected,
  type Protection,
} from './protection';
import { NOT_SHARING_TEXT, WITHHELD_DETAIL, applyShareChange, publisherView, shareChoices, sharedProfilePreview } from './talent';

const TODAY = '2026-11-19';
const HANDLE = 'share-protection-test-0001';

function profile(over: Partial<StudentProfile> = {}): StudentProfile {
  return {
    id: 'maya-profile-id-marker',
    is_sample: false,
    display_name: 'Maya DisplayNameMarker',
    school_name: 'SchoolNameMarker',
    grade: null,
    birth_date: null,
    skills: [{ name: 'python', level: 'intermediate' }],
    interests: ['climate_data'],
    evidence: [
      { id: 'ev-maya-1', title: 'Secret Title Marker', kind: 'project', skills: ['python'], status: 'self_reported', added_on: '2025-01-02' },
      { id: 'ev-maya-2', title: 'Other Title Marker', kind: 'course', skills: [], status: 'reviewed', added_on: '2025-02-03' },
    ],
    ...over,
  };
}

const settings = (over: Partial<ShareSettings> = {}): ShareSettings => ({
  ...defaultShareSettings('maya-profile-id-marker', TODAY, HANDLE),
  ...over,
});

const ADULT = profile({ birth_date: '2000-01-01', grade: 16 });
const MINOR = profile({ birth_date: '2010-04-05', grade: 11 });
const PROTECTED: Protection = { protected: true, reasons: ['under_18'] };
const EVERYTHING = settings({
  evidence_ids: ['ev-maya-1', 'ev-maya-2'],
  skills: ['python'],
  share_interests: true,
  collaboration_note: 'Free on weekends.',
});

describe('protectionFor：任一成立即受保护', () => {
  it.each<[string, Partial<StudentProfile>, string, string[]]>([
    ['未满 18 且 11 年级', { birth_date: '2010-04-05', grade: 11 }, TODAY, ['under_18', 'grade_12_or_below']],
    ['今天刚满 18、年级为 null → 不受保护', { birth_date: '2008-11-19', grade: null }, TODAY, []],
    ['明天才满 18', { birth_date: '2008-11-20', grade: null }, TODAY, ['under_18']],
    ['成年但 12 年级', { birth_date: '2000-01-01', grade: 12 }, TODAY, ['grade_12_or_below']],
    ['成年、本科第一年（13）', { birth_date: '2000-01-01', grade: 13 }, TODAY, []],
    ['没有出生日期时用 age：age 25、研究生 → 不受保护', { birth_date: null, grade: 16, age: 25 }, TODAY, []],
    ['只有 age 18 + 年级 13 → 不受保护', { birth_date: null, grade: 13, age: 18 }, TODAY, []],
    ['只有 age 17 + 年级 13 → 受保护', { birth_date: null, grade: 13, age: 17 }, TODAY, ['under_18']],
    ['年级 11 + age 18 → 受保护（年级始终适用）', { birth_date: null, grade: 11, age: 18 }, TODAY, ['grade_12_or_below']],
    ['age 与 birth_date 都没有、年级为 null → 年龄未知', { birth_date: null, grade: null, age: null }, TODAY, ['age_unknown']],
    ['全空（没有 grade / age / birth_date 字段）→ 年龄未知', { birth_date: undefined, grade: undefined, age: undefined }, TODAY, ['age_unknown']],
    ['birth_date 成年 + age 16 → 以 birth_date 为准，不受保护', { birth_date: '2000-01-01', grade: null, age: 16 }, TODAY, []],
    ['birth_date 未成年 + age 25 → 以 birth_date 为准，受保护', { birth_date: '2010-04-05', grade: null, age: 25 }, TODAY, ['under_18']],
    ['birth_date 空白字符串时用 age', { birth_date: '  ', grade: null, age: 30 }, TODAY, []],
    ['birth_date 不合法时不退回 age → 年龄未知', { birth_date: '2008-02-30', grade: null, age: 30 }, TODAY, ['age_unknown']],
    ['age 不是有限非负数 → 年龄未知', { birth_date: null, grade: null, age: Number.NaN }, TODAY, ['age_unknown']],
    ['age 为负数 → 年龄未知', { birth_date: null, grade: null, age: -3 }, TODAY, ['age_unknown']],
    ['出生日期不存在', { birth_date: '2008-02-30', grade: null }, TODAY, ['age_unknown']],
    ['出生日期格式不对', { birth_date: '01/02/2000', grade: null }, TODAY, ['age_unknown']],
    ['出生日期晚于今天', { birth_date: '2030-01-01', grade: null }, TODAY, ['age_unknown']],
    ['今天不合法 → 年龄未知', { birth_date: '2000-01-01', grade: null }, 'not-a-date', ['age_unknown']],
    ['2 月 29 日出生，非闰年 2 月 28 日还差一天', { birth_date: '2008-02-29', grade: null }, '2026-02-28', ['under_18']],
    ['2 月 29 日出生，非闰年 3 月 1 日满岁', { birth_date: '2008-02-29', grade: null }, '2026-03-01', []],
    ['年级是数字字符串 "11" → 算 12 年级以下', { birth_date: '2000-01-01', grade: '11' as unknown as number }, TODAY, ['grade_12_or_below']],
    ['年级是数字字符串 " 13 " → 不算', { birth_date: '2000-01-01', grade: ' 13 ' as unknown as number }, TODAY, []],
    ['年级是非数字字符串不算理由', { birth_date: '2000-01-01', grade: 'eleven' as unknown as number }, TODAY, []],
    ['年级 0 也算 12 年级以下', { birth_date: '2000-01-01', grade: 0 }, TODAY, ['grade_12_or_below']],
  ])('%s', (_label, over, today, reasons) => {
    expect(protectionFor(profile(over), today)).toEqual({ protected: reasons.length > 0, reasons });
  });

  it('档案不是对象时按年龄未知处理', () => {
    expect(protectionFor(null, TODAY)).toEqual({ protected: true, reasons: ['age_unknown'] });
    expect(protectionFor('x' as unknown as StudentProfile, TODAY).protected).toBe(true);
  });

  it('isUnprotected 只认显式的 protected === false', () => {
    expect(isUnprotected(unprotected())).toBe(true);
    for (const bad of [undefined, null, {}, { protected: 'no' }, { protected: 0 }, PROTECTED]) {
      expect(isUnprotected(bad as unknown as Protection)).toBe(false);
    }
  });
});

describe('学生端提示', () => {
  it('写明原因，不写具体年龄或出生日期；不受保护时没有提示', () => {
    expect(protectionNotice(protectionFor(MINOR, TODAY))).toBe(
      'Stricter defaults apply because this profile is under 18 and is in grade 12 or below.',
    );
    expect(protectionNotice(protectionFor(profile(), TODAY))).toBe(
      'Stricter defaults apply because this profile does not have a usable age or birth date saved.',
    );
    // 只有 age 的档案：不说「没有保存出生日期」
    expect(protectionNotice(protectionFor(profile({ age: 17, grade: 13 }), TODAY))).toBe(
      'Stricter defaults apply because this profile is under 18.',
    );
    expect(protectionNotice(protectionFor(ADULT, TODAY))).toBeNull();
    const all = [protectionNotice(protectionFor(MINOR, TODAY)), PROTECTION_EFFECTS, GUARDIAN_ADVICE].join(' ');
    for (const hidden of ['2010', '04-05', '16', '11']) expect(all).not.toContain(hidden);
    expect(GUARDIAN_ADVICE).toBe('Talk with a parent, guardian or teacher before responding to any invitation.');
  });

  it('「原样显示」的提醒始终有，按档案改写', () => {
    expect(exactlyAsWrittenWarning(PROTECTED)).toBe(
      'Skill names and interests are shown exactly as written, so do not put contact details, your name or your school in them.',
    );
    const broad =
      'Skill names, interests and your note are shown exactly as written, so do not put contact details, your name or your school in them.';
    expect(exactlyAsWrittenWarning(unprotected())).toBe(broad);
    expect(exactlyAsWrittenWarning(null)).toBe(broad);
  });

  it('证据标题的说明对所有档案都一样，不再是受保护专属', () => {
    expect(EVIDENCE_TITLE_NOTICE).toBe('Publishers see the kind and status of your evidence, never its title.');
    expect(PROTECTION_EFFECTS).not.toMatch(/title/i);
  });
});

describe('canChangeSharing：受保护时修改分享前要先确认', () => {
  it('不受保护：始终可以；受保护：只有确认后可以；protection 缺失按受保护处理', () => {
    expect(canChangeSharing(unprotected(), false)).toBe(true);
    expect(canChangeSharing(unprotected(), true)).toBe(true);
    expect(canChangeSharing(PROTECTED, false)).toBe(false);
    expect(canChangeSharing(PROTECTED, true)).toBe(true);
    expect(canChangeSharing(null, false)).toBe(false);
    expect(canChangeSharing(undefined, true)).toBe(true);
    expect(canChangeSharing(protectionFor(MINOR, TODAY), false)).toBe(false);
    expect(canChangeSharing(protectionFor(ADULT, TODAY), false)).toBe(true);
  });
});

describe('受保护时的发布者视图', () => {
  it('证据只显示种类、状态、技能，不显示标题（与所有档案相同）；合作说明不出现', () => {
    const p = sharedProfilePreview(MINOR, EVERYTHING, protectionFor(MINOR, TODAY));
    if (p.empty) throw new Error('expected a non-empty preview');
    const byCategory = Object.fromEntries(p.sections.map((s) => [s.category, s.items]));
    expect(byCategory.evidence).toEqual([
      { primary: 'Project', details: ['Self-reported'], skills: ['python'] },
      { primary: 'Course', details: ['Reviewed'], skills: [] },
    ]);
    expect(byCategory.collaboration).toEqual([]);
    expect(byCategory.skills.map((i) => i.primary)).toEqual(['python']);
    const view = publisherView(MINOR, EVERYTHING, protectionFor(MINOR, TODAY));
    expect(view?.collaboration_note).toBeNull();
    expect(view?.evidence.map((e) => e.title)).toEqual(['', '']);
  });

  it('只分享了合作说明 → 预览为空；说明仍保存在设置里，学生端看得到但标明未分享', () => {
    const noteOnly = settings({ collaboration_note: 'Free on weekends.' });
    expect(sharedProfilePreview(MINOR, noteOnly, PROTECTED)).toEqual({ empty: true, message: NOT_SHARING_TEXT });
    const c = shareChoices(MINOR, noteOnly, PROTECTED);
    expect(c).toMatchObject({ note: 'Free on weekends.', note_allowed: false, note_shared: false, anything_shared: false });
  });

  it('不受保护的成年档案：说明显示，证据标题同样不显示', () => {
    const p = sharedProfilePreview(ADULT, EVERYTHING, protectionFor(ADULT, TODAY));
    const json = JSON.stringify(p);
    expect(json).not.toContain('Secret Title Marker');
    expect(json).not.toContain('Other Title Marker');
    expect(json).toContain('Free on weekends.');
    expect(publisherView(ADULT, EVERYTHING, unprotected())?.evidence.map((e) => e.title)).toEqual(['', '']);
    expect(shareChoices(ADULT, EVERYTHING, unprotected())).toMatchObject({ note_allowed: true, note_shared: true });
  });

  it('失败时从严：protection 缺失或不是显式的 false 时按受保护处理', () => {
    for (const bad of [undefined, null, {}, { protected: 'no' }] as unknown as Protection[]) {
      const json = JSON.stringify(sharedProfilePreview(ADULT, EVERYTHING, bad));
      expect(json).not.toContain('Secret Title Marker');
      expect(json).not.toContain('Free on weekends');
      expect(shareChoices(ADULT, EVERYTHING, bad).note_allowed).toBe(false);
      expect(applyShareChange(settings(), { kind: 'note', note: 'New note.' }, TODAY, bad).collaboration_note).toBeNull();
    }
  });

  it('预览里永远没有年龄、出生日期、年级', () => {
    for (const p of [MINOR, ADULT, profile({ birth_date: '2009-09-09', grade: 10, age: 17 })]) {
      const json = JSON.stringify(sharedProfilePreview(p, EVERYTHING, protectionFor(p, TODAY)));
      for (const hidden of [p.birth_date ?? 'none', 'birth', '"age"', '"grade"', 'Grade ', 'under 18', 'Stricter']) {
        expect(json, hidden).not.toContain(hidden);
      }
    }
  });
});

describe('所有档案：发布者视图里没有证据 id 与身份信息', () => {
  it.each<[string, StudentProfile]>([
    ['成年', ADULT],
    ['未成年', MINOR],
  ])('%s：证据 id 换成位置编号，没有档案 id、显示名、学校、出生日期', (_label, p) => {
    const protection = protectionFor(p, TODAY);
    const view = publisherView(p, EVERYTHING, protection);
    expect(view?.evidence.map((e) => e.id)).toEqual(['evidence-1', 'evidence-2']);
    const json = JSON.stringify(view);
    for (const hidden of [
      'ev-maya',
      'maya',
      'Maya',
      'DisplayNameMarker',
      'SchoolNameMarker',
      p.birth_date ?? 'none',
      'Secret Title Marker',
      'Other Title Marker',
    ]) {
      expect(json, hidden).not.toContain(hidden);
    }
    if (protection.protected) expect(json).not.toContain('Free on weekends');
  });
});

describe('所有档案：像联系方式的技能名、兴趣、证据技能不给发布者看', () => {
  const CONTACT = ['maya@example.com', '5551234567', 'https://maya.example.com/portfolio', 'www.maya-site.com', '555 123 4567'];
  const withContacts = (over: Partial<StudentProfile>) =>
    profile({
      ...over,
      skills: [
        { name: 'maya@example.com', level: 'beginner' },
        { name: '5551234567', level: 'beginner' },
        { name: 'python', level: 'intermediate' },
      ],
      interests: ['robotics', 'https://maya.example.com/portfolio', '555 123 4567'],
      evidence: [
        {
          id: 'ev-maya-1',
          title: 'Secret Title Marker',
          kind: 'project',
          skills: ['www.maya-site.com', 'sql'],
          status: 'self_reported',
          added_on: '2025-01-02',
        },
      ],
    });
  const all = settings({ evidence_ids: ['ev-maya-1'], skills: ['maya@example.com', '5551234567', 'python'], share_interests: true });

  it.each<[string, Partial<StudentProfile>]>([
    ['成年', { birth_date: '2000-01-01', grade: 16 }],
    ['未成年', { birth_date: '2010-04-05', grade: 11 }],
  ])('%s：视图、预览、邀请理由里都没有', (_label, over) => {
    const p = withContacts(over);
    const protection = protectionFor(p, TODAY);
    const view = publisherView(p, all, protection);
    expect(view?.skills.map((s) => s.name)).toEqual(['python']);
    expect(view?.interests).toEqual(['robotics']);
    expect(view?.evidence[0].skills).toEqual(['sql']);
    const texts = [JSON.stringify(view), JSON.stringify(sharedProfilePreview(p, all, protection)), invitationReasons(view).join(' ')];
    for (const text of texts) for (const hidden of CONTACT) expect(text, hidden).not.toContain(hidden);
  });

  it('只分享了像联系方式的技能 → 发布者什么都看不到；学生端标明它不会显示', () => {
    const p = withContacts({ birth_date: '2000-01-01', grade: 16 });
    const only = settings({ skills: ['maya@example.com'] });
    expect(publisherView(p, only, unprotected())).toBeNull();
    expect(sharedProfilePreview(p, only, unprotected())).toEqual({ empty: true, message: NOT_SHARING_TEXT });
    const c = shareChoices(p, only, unprotected());
    expect(c.anything_shared).toBe(false);
    expect(c.skills.map((s) => [s.key, s.withheld])).toEqual([
      ['maya@example.com', true],
      ['5551234567', true],
      ['python', false],
    ]);
    expect(c.skills[0].detail).toBe(`Beginner · ${WITHHELD_DETAIL}`);
    expect(c.interests.withheld).toEqual(['https://maya.example.com/portfolio', '555 123 4567']);
  });

  it('不合格的合作说明（例如导入的旧数据）也不显示', () => {
    const p = profile({ birth_date: '2000-01-01', grade: 16 });
    const view = publisherView(p, settings({ skills: ['python'], collaboration_note: 'Mail maya@example.com' }), unprotected());
    expect(view?.collaboration_note).toBeNull();
  });
});

describe('受保护时 applyShareChange 不写入新说明，也不删掉旧说明', () => {
  it('新说明被忽略；删除说明可以；改别的项时旧说明原样保留', () => {
    const b = settings({ collaboration_note: 'Old note.' });
    expect(applyShareChange(b, { kind: 'note', note: 'New note.' }, TODAY, PROTECTED).collaboration_note).toBe('Old note.');
    expect(applyShareChange(settings(), { kind: 'note', note: 'New note.' }, TODAY, PROTECTED).collaboration_note).toBeNull();
    expect(applyShareChange(b, { kind: 'note', note: null }, TODAY, PROTECTED).collaboration_note).toBeNull();
    expect(applyShareChange(b, { kind: 'note', note: '   ' }, TODAY, PROTECTED).collaboration_note).toBeNull();
    expect(applyShareChange(b, { kind: 'skill', name: 'python', on: true }, TODAY, PROTECTED).collaboration_note).toBe('Old note.');
    // 不受保护时照旧写入
    expect(applyShareChange(b, { kind: 'note', note: 'New note.' }, TODAY, unprotected()).collaboration_note).toBe('New note.');
  });
});

describe('C2：发布者一侧分辨不出档案是否受保护', () => {
  // 同一份档案内容，只有年龄信息不同：受保护（年级 11、无出生日期）与不受保护（出生日期显示成年）。
  const content: Partial<StudentProfile> = {
    skills: [
      { name: 'python', level: 'intermediate' },
      { name: 'sql', level: 'beginner' },
    ],
    interests: ['climate_data', 'robotics'],
  };
  const PROTECTED_PROFILE = profile({ ...content, grade: 11, birth_date: null, age: 16 });
  const ADULT_PROFILE = profile({ ...content, grade: null, birth_date: '1999-03-14', age: null });
  // 同一组分享开关（不含合作说明）。
  const SAME_SWITCHES = settings({ evidence_ids: ['ev-maya-1', 'ev-maya-2'], skills: ['python', 'sql'], share_interests: true });

  it('两份档案确实一个受保护、一个不受保护', () => {
    expect(protectionFor(PROTECTED_PROFILE, TODAY).protected).toBe(true);
    expect(protectionFor(ADULT_PROFILE, TODAY).protected).toBe(false);
  });

  it('publisherView 与 sharedProfilePreview 的输出深度相等', () => {
    const a = publisherView(PROTECTED_PROFILE, SAME_SWITCHES, protectionFor(PROTECTED_PROFILE, TODAY));
    const b = publisherView(ADULT_PROFILE, SAME_SWITCHES, protectionFor(ADULT_PROFILE, TODAY));
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    const pa = sharedProfilePreview(PROTECTED_PROFILE, SAME_SWITCHES, protectionFor(PROTECTED_PROFILE, TODAY));
    const pb = sharedProfilePreview(ADULT_PROFILE, SAME_SWITCHES, protectionFor(ADULT_PROFILE, TODAY));
    expect(pa.empty).toBe(false);
    expect(pa).toEqual(pb);
    expect(invitationReasons(a)).toEqual(invitationReasons(b));
  });

  it('每一种开关组合（不含合作说明）都深度相等', () => {
    const evidenceChoices = [[], ['ev-maya-1'], ['ev-maya-2'], ['ev-maya-1', 'ev-maya-2']];
    const skillChoices = [[], ['python'], ['sql', 'python']];
    for (const evidence_ids of evidenceChoices) {
      for (const skills of skillChoices) {
        for (const share_interests of [false, true]) {
          const s = settings({ evidence_ids, skills, share_interests });
          expect(sharedProfilePreview(PROTECTED_PROFILE, s, protectionFor(PROTECTED_PROFILE, TODAY))).toEqual(
            sharedProfilePreview(ADULT_PROFILE, s, protectionFor(ADULT_PROFILE, TODAY)),
          );
        }
      }
    }
  });

  it('序列化文本里没有年龄、年级、出生日期的值，也没有暗示保护状态的字样', () => {
    for (const p of [PROTECTED_PROFILE, ADULT_PROFILE]) {
      const protection = protectionFor(p, TODAY);
      const text = [
        JSON.stringify(publisherView(p, SAME_SWITCHES, protection)),
        JSON.stringify(sharedProfilePreview(p, SAME_SWITCHES, protection)),
      ].join(' ');
      for (const hidden of ['1999-03-14', '1999', '"age"', '"grade"', 'birth', 'minor', 'under 18', 'grade', 'stricter', 'protected', 'guardian']) {
        expect(text.toLowerCase(), hidden).not.toContain(hidden.toLowerCase());
      }
      for (const value of ['16', '11']) expect(text, value).not.toMatch(new RegExp(`\\b${value}\\b`));
    }
  });
});

describe('受保护时清掉存着的合作说明（保护解除后不自动重新分享）', () => {
  it('受保护 + 有说明 → 需要清除：只把 collaboration_note 设为 null，其他选择不动，不改输入', () => {
    const before = structuredClone(EVERYTHING);
    const cleared = collaborationNoteToClear(EVERYTHING, protectionFor(MINOR, TODAY));
    expect(cleared).toEqual({ ...EVERYTHING, collaboration_note: null });
    expect(EVERYTHING).toEqual(before);
    // 保护状态缺失或损坏按受保护处理
    expect(collaborationNoteToClear(EVERYTHING, null)).toEqual({ ...EVERYTHING, collaboration_note: null });
    expect(collaborationNoteToClear(EVERYTHING, PROTECTED)).not.toBeNull();
  });

  it('受保护 + 无说明（null / 空白）→ 不需要清除', () => {
    expect(collaborationNoteToClear(settings({ collaboration_note: null }), PROTECTED)).toBeNull();
    expect(collaborationNoteToClear(settings({ collaboration_note: '   ' }), PROTECTED)).toBeNull();
    expect(collaborationNoteToClear(null, PROTECTED)).toBeNull();
  });

  it('不受保护 + 有说明 → 不动', () => {
    expect(isUnprotected(protectionFor(ADULT, TODAY))).toBe(true);
    expect(collaborationNoteToClear(EVERYTHING, protectionFor(ADULT, TODAY))).toBeNull();
    expect(collaborationNoteToClear(EVERYTHING, unprotected())).toBeNull();
  });

  it('清掉之后，档案改成成年也不会重新向发布者显示说明', () => {
    const cleared = collaborationNoteToClear(EVERYTHING, protectionFor(MINOR, TODAY));
    expect(cleared).not.toBeNull();
    const view = publisherView(ADULT, cleared, unprotected());
    expect(view?.collaboration_note ?? null).toBeNull();
    // The notice must say plainly that the note was deleted and cannot be restored.
    expect(NOTE_REMOVED_NOTICE).toContain('was deleted from this browser');
    expect(NOTE_REMOVED_NOTICE).toContain('It cannot be restored.');
  });
});

