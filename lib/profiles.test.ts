/**
 * 校验 data/profiles.json 符合 StudentProfile 约定。
 */
import { describe, expect, it } from 'vitest';
import profilesJson from '../data/profiles.json';
import type { DeviceType, SkillLevel, StudentProfile, StudentStatus } from './types';

const profiles = profilesJson as unknown as StudentProfile[];

const DEVICES: DeviceType[] = ['laptop', 'desktop', 'smartphone', 'tablet', 'webcam', 'home_internet'];
const LEVELS: SkillLevel[] = ['beginner', 'intermediate', 'advanced'];
const STATUSES: StudentStatus[] = [
  'middle_school_student',
  'high_school_student',
  'undergraduate',
  'graduate_student',
  'not_enrolled',
  'first_generation',
  'low_income',
  'underrepresented_in_stem',
];

describe('data/profiles.json', () => {
  it('恰好 3 个示例档案，id 唯一', () => {
    expect(profiles).toHaveLength(3);
    expect(new Set(profiles.map((p) => p.id)).size).toBe(3);
  });

  it('全部 is_sample 且必填字段齐全', () => {
    for (const p of profiles) {
      expect(p.is_sample).toBe(true);
      expect(typeof p.id).toBe('string');
      expect(p.display_name).toContain('Sample');
      expect(Array.isArray(p.evidence)).toBe(true);
    }
  });

  it('枚举字段取值合法', () => {
    for (const p of profiles) {
      for (const d of p.devices ?? []) expect(DEVICES).toContain(d);
      for (const s of p.skills ?? []) expect(LEVELS).toContain(s.level);
      for (const s of p.statuses ?? []) expect(STATUSES).toContain(s);
      if (p.transport) expect(['reliable', 'limited', 'none']).toContain(p.transport.level);
      for (const e of p.evidence) {
        expect(typeof e.id).toBe('string');
        expect(Array.isArray(e.skills)).toBe(true);
        expect(e.added_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it('至少一个档案故意缺字段（用于触发 unknown）', () => {
    const optional = ['grade', 'age', 'region', 'citizenships', 'statuses', 'hours_per_week_available', 'budget_usd', 'transport', 'devices', 'skills'] as const;
    const hasMissing = profiles.some((p) => optional.some((k) => p[k] == null));
    expect(hasMissing).toBe(true);
  });
});
