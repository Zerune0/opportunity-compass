import { describe, expect, it } from 'vitest';
import { normalizeTag, normalizedTagSet, sharedTags } from './tags';

describe('normalizeTag', () => {
  it('连字符、下划线、空格、大小写四种写法归一化结果相同', () => {
    const forms = ['data-science', 'data_science', 'data science', 'Data-Science', '  DATA   science ', 'data_-_science'];
    for (const f of forms) expect(normalizeTag(f)).toBe('data_science');
  });

  it('单个词不变（只转小写、去首尾空格）', () => {
    expect(normalizeTag(' STEM ')).toBe('stem');
    expect(normalizeTag('biomedical-research')).toBe(normalizeTag('biomedical_research'));
  });
});

describe('normalizedTagSet / sharedTags', () => {
  it('跳过非字符串与空标签', () => {
    expect([...normalizedTagSet(['A-b', 3, null, '', '  ', '-', 'a_b'])]).toEqual(['a_b']);
  });

  it('保留原写法与顺序；归一化后重复的只留第一个', () => {
    const against = normalizedTagSet(['data_science', 'climate']);
    expect(sharedTags(['Climate', 'music', 'data-science', 'data science'], against)).toEqual(['Climate', 'data-science']);
  });
});
