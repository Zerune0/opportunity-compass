import { describe, expect, it } from 'vitest';
import { parseSourceText } from './source-text';

// 从 data/opportunities.json 复制的实际写法（2026-11-19）。
const SULI_LETTERS =
  'Official excerpt: "Two Letters of Support" Human-verified application instructions: At least two support letters submitted directly by referees through the online system. Up to three referees may be invited; only the first two completed letters are used. Source: https://science.osti.gov/wdts/suli/How-to-Apply Verified by Jiale Li on 2026-11-19. Preparation hours and cost are team estimates for this task, not official program commitments or fees.';
const SULI_ESSAYS =
  'Official excerpt: "Essays" Human-verified application instructions: Essays are required fields in the online application. Source: https://science.osti.gov/wdts/suli/How-to-Apply Verified by Jiale Li on 2026-11-19. Preparation hours and cost are team estimates for this task, not official program commitments or fees.';
const JKCF_RECS =
  'Official excerpt: "Two recommendations are required for this application." Human-verified application instructions: Two academic recommendations from advisers, instructors or professors at the current or most recent institution, submitted through Common App for Transfer. Source: https://www.jkcf.org/our-scholarships/undergraduate-transfer-scholarship/faqs/ Verified by Jiale Li on 2026-11-19. Preparation hours and cost are team estimates for this task, not official program commitments or fees.';
const TAS_ESSAY =
  'Official excerpt: "Complete the “Expression of Interest” essay to be shared with state legislators." Human-verified application instructions: The Expression of Interest essay is required and will be shared with state legislators. Source: https://www.nasa.gov/learning-resources/texas-aerospace-scholars/tas-senior-experience/ Verified by Jiale Li on 2026-11-19. Preparation hours and cost are team estimates for this task, not official program commitments or fees.';

describe('parseSourceText', () => {
  it.each([
    [SULI_LETTERS, 'Two Letters of Support', 'Human-verified application instructions: At least two support letters'],
    [SULI_ESSAYS, 'Essays', 'Human-verified application instructions: Essays are required'],
    [JKCF_RECS, 'Two recommendations are required for this application.', 'Human-verified application instructions: Two academic'],
  ])('目录里的 Official excerpt 写法：拆出原文和我们的说明', (text, excerpt, notesStart) => {
    const r = parseSourceText(text);
    expect(r.marked_official).toBe(true);
    expect(r.excerpt).toBe(excerpt);
    expect(r.notes?.startsWith(notesStart)).toBe(true);
    expect(r.notes?.endsWith('not official program commitments or fees.')).toBe(true);
    expect(r.excerpt).not.toMatch(/team/i);
  });

  it('外层直引号、摘录内部含弯引号：取到匹配的外层直引号为止', () => {
    const r = parseSourceText(TAS_ESSAY);
    expect(r.marked_official).toBe(true);
    expect(r.excerpt).toBe('Complete the “Expression of Interest” essay to be shared with state legislators.');
    expect(r.notes?.startsWith('Human-verified application instructions: The Expression of Interest essay')).toBe(true);
  });

  it('外层弯引号（可嵌套）', () => {
    expect(parseSourceText('Official excerpt: “Submit the “Final” report.” Our check.')).toEqual({
      excerpt: 'Submit the “Final” report.',
      notes: 'Our check.',
      marked_official: true,
    });
  });

  it('前缀忽略大小写和前导空白；引号后没有文字时 notes 为 null', () => {
    expect(parseSourceText('  OFFICIAL EXCERPT:"Resume"  ')).toEqual({ excerpt: 'Resume', notes: null, marked_official: true });
  });

  it('Official excerpt: 但没有成对引号：excerpt 为冒号后的全部文字', () => {
    expect(parseSourceText('Official excerpt: Submit two letters.')).toEqual({ excerpt: 'Submit two letters.', notes: null, marked_official: true });
    expect(parseSourceText('Official excerpt: "Submit two letters.')).toEqual({ excerpt: '"Submit two letters.', notes: null, marked_official: true });
    expect(parseSourceText('Official excerpt:   ')).toEqual({ excerpt: null, notes: null, marked_official: true });
  });

  it('团队建议的写法：不是官方标记，原文作为 notes', () => {
    expect(parseSourceText(' Team suggestion — not an official requirement ')).toEqual({
      excerpt: null,
      notes: 'Team suggestion — not an official requirement',
      marked_official: false,
    });
    // 前缀不在开头不算。
    expect(parseSourceText('Note. Official excerpt: "X"').marked_official).toBe(false);
  });

  it('空 / null / undefined', () => {
    const empty = { excerpt: null, notes: null, marked_official: false };
    expect(parseSourceText(null)).toEqual(empty);
    expect(parseSourceText(undefined)).toEqual(empty);
    expect(parseSourceText('')).toEqual(empty);
    expect(parseSourceText('   ')).toEqual(empty);
  });
});
