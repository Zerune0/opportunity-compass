/**
 * 是否可以把一条机会的 `official_url` 显示成「官方页面」链接。
 *
 * 底线：示例 / 用户发布的机会不能被说成官方、已核实的。它们的 `official_url` 只是占位
 * （Quest Creator 与主办方页面写入的副本都用保留示例域名 example.com）。
 *
 * 规则：
 * - 用户发布（`source_tier === 'user_posted'`）或示例（`is_sample`）→ 没有官方页面；
 * - URL 的主机是保留示例域名（example.com / example.org / example.net 及其子域）或不是 http(s) 链接 → 没有官方页面
 *   （兜底：机会已不在目录里、只剩 Journal 条目里抄下的链接时也适用）；
 * - 其余 → 有官方页面。
 *
 * 纯函数，不抛异常。
 */
import type { Opportunity } from './types';

/** 判断所需的机会字段。 */
export type OfficialLinkSource = Pick<Opportunity, 'official_url' | 'is_sample' | 'source_tier'>;

const PLACEHOLDER_HOSTS = ['example.com', 'example.org', 'example.net'];

/** URL 不是可打开的真实 http(s) 地址，或主机是保留示例域名。 */
export function isPlaceholderUrl(url: unknown): boolean {
  if (typeof url !== 'string' || url.trim() === '') return true;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return PLACEHOLDER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return true;
  }
}

/** 机会本身（来源等级、示例标记、链接）允许显示「官方页面」链接。 */
export function hasOfficialPage(opportunity: OfficialLinkSource): boolean {
  if (opportunity.source_tier === 'user_posted') return false;
  if (opportunity.is_sample) return false;
  return !isPlaceholderUrl(opportunity.official_url);
}

/**
 * Quest Journal 条目该显示的官方链接；null = 不显示官方链接。
 * - 能找到机会：按 `hasOfficialPage` 判断，用机会上的链接；
 * - 找不到机会（已撤回或不在目录里）：只有条目里抄下的链接不是占位地址时才显示。
 */
export function journalOfficialUrl(
  opportunity: OfficialLinkSource | undefined,
  savedUrl: string | undefined | null,
): string | null {
  if (opportunity) return hasOfficialPage(opportunity) ? opportunity.official_url : null;
  return isPlaceholderUrl(savedUrl) ? null : (savedUrl as string);
}
