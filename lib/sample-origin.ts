/**
 * 一条机会在学生端该怎么标来源（只用于显示，不改任何判断）。
 *
 * - `catalog`：目录里的机会（`source_tier` 不是 `user_posted`，包括缺省）；
 * - `connect_post`：Quest Creator（/connect/create）由示例发布者发布的任务——`source_tier === 'user_posted'`
 *   且 `posted_by` 是非空字符串；
 * - `organizer_demo`：主办方演示桥（/organizer）写入的示例机会副本——`source_tier === 'user_posted'` 且没有
 *   `posted_by`（null / 缺省 / 空串）。它不是用户发布的，学生端不能标成「User-posted」。
 *
 * 两类本地记录（connect_post、organizer_demo）都没有官方页面、不显示地图路线链接、不进竞赛路线 / 中间任务 /
 * 远程提示的候选——那些逻辑仍按 `source_tier === 'user_posted'` 判断，这里不动。
 *
 * 纯函数，不抛异常。
 */
import type { Opportunity } from './types';

export type SampleOrigin = 'catalog' | 'connect_post' | 'organizer_demo';

export type SampleOriginSource = Partial<Pick<Opportunity, 'source_tier' | 'posted_by'>>;

export function sampleOrigin(opportunity: SampleOriginSource | null | undefined): SampleOrigin {
  if (opportunity == null || typeof opportunity !== 'object') return 'catalog';
  if (opportunity.source_tier !== 'user_posted') return 'catalog';
  const by = opportunity.posted_by;
  return typeof by === 'string' && by.trim() !== '' ? 'connect_post' : 'organizer_demo';
}

/** 主办方演示示例机会：卡片 / 详情 / Journal 上的标记。 */
export const ORGANIZER_DEMO_TAG = 'Sample opportunity from the organizer demo · not a real listing';
/** 主办方演示示例机会：「Source」一栏。 */
export const ORGANIZER_DEMO_SOURCE_LABEL = 'Organizer demo (sample)';
/** 主办方演示示例机会：Journal 卡片上「没有官方页面」的说明。 */
export const ORGANIZER_DEMO_JOURNAL_NOTE = 'This is a sample opportunity saved by the organizer demo in this browser. It has no official page.';
/** 主办方演示示例机会：Quest Details 资格区块的标题。 */
export const ORGANIZER_DEMO_ELIGIBILITY_TITLE = 'Eligibility in the sample scenario';
/** 主办方演示示例机会：Quest Details 资格区块的说明。 */
export const ORGANIZER_DEMO_ELIGIBILITY_NOTE =
  'These requirements belong to a sample scenario used by the organizer demo. They are not from an official site.';

/** Connect 发布的任务在卡片 / 详情 / Journal 上的标记（与改动前逐字相同）。 */
export const CONNECT_POST_TAG = 'User-posted · not verified against an official site · Sample';

/**
 * 本地记录（非目录）的警示标记：organizer_demo → ORGANIZER_DEMO_TAG；connect_post → `postedText`
 * （缺省 CONNECT_POST_TAG；保存对照表用较短的写法时传入）；catalog → null。
 */
export function localRecordTag(opportunity: SampleOriginSource | null | undefined, postedText: string = CONNECT_POST_TAG): string | null {
  const origin = sampleOrigin(opportunity);
  return origin === 'organizer_demo' ? ORGANIZER_DEMO_TAG : origin === 'connect_post' ? postedText : null;
}

/** 「Source」一栏：organizer_demo → ORGANIZER_DEMO_SOURCE_LABEL；其余用调用方按 source_tier 给的文字（不变）。 */
export function sourceLabelFor(opportunity: SampleOriginSource | null | undefined, tierLabel: string): string {
  return sampleOrigin(opportunity) === 'organizer_demo' ? ORGANIZER_DEMO_SOURCE_LABEL : tierLabel;
}
