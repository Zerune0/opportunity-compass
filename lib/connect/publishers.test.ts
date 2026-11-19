/**
 * 示例发布者加载与校验（./publishers）。仓库数据在 data/connect/publishers.json，全部是虚构账户。
 */
import { describe, expect, it } from 'vitest';
import publishersJson from '@/data/connect/publishers.json';
import { PUBLISHER_KINDS, findSamplePublisher, partitionPublishers, samplePublishers } from './publishers';

const good = (over: Record<string, unknown> = {}) => ({
  id: 'sample-test-club',
  name: 'Sample Test Club',
  kind: 'student_club',
  is_sample: true,
  description: 'Fictional.',
  ...over,
});

describe('仓库里的示例发布者', () => {
  it('3–5 个，全部通过校验、is_sample、名字带 Sample、id 唯一，至少覆盖 3 种 kind', () => {
    const { publishers, rejected } = partitionPublishers(publishersJson);
    expect(rejected).toEqual([]);
    expect(publishers.length).toBeGreaterThanOrEqual(3);
    expect(publishers.length).toBeLessThanOrEqual(5);
    expect(publishers.every((p) => p.is_sample === true && /\bSample\b/.test(p.name))).toBe(true);
    expect(new Set(publishers.map((p) => p.id)).size).toBe(publishers.length);
    expect(new Set(publishers.map((p) => p.kind)).size).toBeGreaterThanOrEqual(3);
    expect(samplePublishers()).toEqual(publishers);
  });

  it('samplePublishers 每次返回拷贝；findSamplePublisher 按 id 找，找不到为 null', () => {
    const a = samplePublishers();
    a[0].name = 'changed';
    a.pop();
    expect(samplePublishers()[0].name).not.toBe('changed');
    const first = samplePublishers()[0];
    expect(findSamplePublisher(first.id)).toEqual(first);
    expect(findSamplePublisher('nope')).toBeNull();
    expect(findSamplePublisher('')).toBeNull();
    expect(findSamplePublisher(null)).toBeNull();
    expect(findSamplePublisher(undefined)).toBeNull();
  });
});

describe('partitionPublishers 丢弃格式不对的记录', () => {
  it('合格记录原样保留（缺 description 记为 null）', () => {
    const { publishers, rejected } = partitionPublishers([good(), good({ id: 'sample-two', description: undefined })]);
    expect(rejected).toEqual([]);
    expect(publishers).toEqual([
      { id: 'sample-test-club', name: 'Sample Test Club', kind: 'student_club', is_sample: true, description: 'Fictional.' },
      { id: 'sample-two', name: 'Sample Test Club', kind: 'student_club', is_sample: true, description: null },
    ]);
  });

  it.each([
    ['不是对象', 'oops'],
    ['null', null],
    ['缺 id', good({ id: undefined })],
    ['id 不是 kebab-case', good({ id: 'Sample Club' })],
    ['名字为空', good({ name: '  ' })],
    ['名字不含 Sample', good({ name: 'Real Robotics Club' })],
    ['kind 不在枚举内', good({ kind: 'company' })],
    ['is_sample 为 false', good({ is_sample: false })],
    ['缺 is_sample', good({ is_sample: undefined })],
    ['description 不是字符串', good({ description: 42 })],
  ])('%s → 丢弃', (_label, entry) => {
    const { publishers, rejected } = partitionPublishers([entry, good({ id: 'sample-ok' })]);
    expect(publishers.map((p) => p.id)).toEqual(['sample-ok']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].index).toBe(0);
    expect(rejected[0].errors.length).toBeGreaterThan(0);
  });

  it('id 重复时保留第一条', () => {
    const { publishers, rejected } = partitionPublishers([good({ name: 'Sample First' }), good({ name: 'Sample Second' })]);
    expect(publishers.map((p) => p.name)).toEqual(['Sample First']);
    expect(rejected).toEqual([{ id: 'sample-test-club', index: 1, errors: ['id: duplicate (the first one is kept)'] }]);
  });

  it('整个输入不是数组 → 空列表，不抛异常；不修改输入', () => {
    expect(partitionPublishers({}).publishers).toEqual([]);
    expect(partitionPublishers(undefined).rejected[0].index).toBe(-1);
    const input = [good()];
    const before = JSON.stringify(input);
    partitionPublishers(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('PUBLISHER_KINDS 每一种都能通过', () => {
    const { publishers } = partitionPublishers(PUBLISHER_KINDS.map((kind, i) => good({ id: `sample-${i}`, kind })));
    expect(publishers.map((p) => p.kind)).toEqual([...PUBLISHER_KINDS]);
  });
});
