import { describe, expect, it } from 'vitest';
import {
  CONNECT_POST_TAG,
  ORGANIZER_DEMO_SOURCE_LABEL,
  ORGANIZER_DEMO_TAG,
  localRecordTag,
  sampleOrigin,
  sourceLabelFor,
} from './sample-origin';

describe('sampleOrigin', () => {
  it('目录机会（official / trusted_aggregator / 缺省）→ catalog', () => {
    expect(sampleOrigin({ source_tier: 'official' })).toBe('catalog');
    expect(sampleOrigin({ source_tier: 'trusted_aggregator', posted_by: 'x' })).toBe('catalog');
    expect(sampleOrigin({})).toBe('catalog');
    expect(sampleOrigin(null)).toBe('catalog');
    expect(sampleOrigin(undefined)).toBe('catalog');
  });

  it('user_posted 且 posted_by 非空 → connect_post', () => {
    expect(sampleOrigin({ source_tier: 'user_posted', posted_by: 'sample-publisher' })).toBe('connect_post');
  });

  it('user_posted 且没有 posted_by（null / 缺省 / 空串）→ organizer_demo', () => {
    expect(sampleOrigin({ source_tier: 'user_posted', posted_by: null })).toBe('organizer_demo');
    expect(sampleOrigin({ source_tier: 'user_posted' })).toBe('organizer_demo');
    expect(sampleOrigin({ source_tier: 'user_posted', posted_by: '  ' })).toBe('organizer_demo');
  });
});

describe('标记与来源文字', () => {
  it('localRecordTag：organizer_demo / connect_post / catalog', () => {
    expect(localRecordTag({ source_tier: 'user_posted', posted_by: null })).toBe(ORGANIZER_DEMO_TAG);
    expect(localRecordTag({ source_tier: 'user_posted', posted_by: 'p' })).toBe(CONNECT_POST_TAG);
    expect(localRecordTag({ source_tier: 'user_posted', posted_by: 'p' }, 'short')).toBe('short');
    expect(localRecordTag({ source_tier: 'official' })).toBeNull();
    expect(CONNECT_POST_TAG).toBe('User-posted · not verified against an official site · Sample');
    expect(ORGANIZER_DEMO_TAG).not.toMatch(/user.posted/i);
  });

  it('sourceLabelFor：只有 organizer_demo 换文字', () => {
    expect(sourceLabelFor({ source_tier: 'user_posted' }, 'User posted')).toBe(ORGANIZER_DEMO_SOURCE_LABEL);
    expect(sourceLabelFor({ source_tier: 'user_posted', posted_by: 'p' }, 'User posted')).toBe('User posted');
    expect(sourceLabelFor({ source_tier: 'official' }, 'Official organizer')).toBe('Official organizer');
  });
});
