/**
 * 未成年人更严格的默认设置（./protection）与发布者视图（./talent 的 publisherView / sharedProfilePreview）：
 * 判断规则（18 岁、12 年级、年龄未知）；失败时从严；受保护时合作说明不分享（但不删除）、证据不显示标题；
 * 所有档案：证据 id 换成位置编号、像联系方式的字符串不给发布者看；发布者视图里永远没有年龄、出生日期、年级、身份信息。
 */
import { describe, expect, it } from 'vitest';
import { defaultShareSettings } from '../store';
import type { ShareSettings, StudentProfile } from '../types';
import { invitationReasons } from './invitations';
import {
  GUARDIAN_ADVICE,
  PROTECTION_EFFECTS,
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
    ['没有出生日期（自填 age 不算）', { birth_date: null, grade: 16, age: 25 }, TODAY, ['age_unknown']],
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
      'Stricter defaults apply because this profile does not have a birth date saved.',
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
      'Skill names, interests, your note and evidence titles are shown exactly as written, so do not put contact details, your name or your school in them.';
    expect(exactlyAsWrittenWarning(unprotected())).toBe(broad);
    expect(exactlyAsWrittenWarning(null)).toBe(broad);
  });
});

describe('受保护时的发布者视图', () => {
  it('证据只显示种类、状态、技能，不显示标题；合作说明不出现', () => {
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

  it('不受保护的成年档案：标题与说明都显示', () => {
    const p = sharedProfilePreview(ADULT, EVERYTHING, protectionFor(ADULT, TODAY));
    const json = JSON.stringify(p);
    expect(json).toContain('Secret Title Marker');
    expect(json).toContain('Free on weekends.');
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
    for (const hidden of ['ev-maya', 'maya', 'Maya', 'DisplayNameMarker', 'SchoolNameMarker', p.birth_date ?? 'none']) {
      expect(json, hidden).not.toContain(hidden);
    }
    if (protection.protected) {
      for (const hidden of ['Secret Title Marker', 'Other Title Marker', 'Free on weekends']) expect(json, hidden).not.toContain(hidden);
    }
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
