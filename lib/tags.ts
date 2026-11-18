/**
 * 领域 / 兴趣标签的写法归一化（纯函数）。
 *
 * 机会数据的 fields 多用连字符（`biomedical-research`），档案的 interests 多用下划线（`data_science`），
 * 学生手填时还可能有空格和大写。比较标签前一律先归一化：去首尾空格、转小写，
 * 连续的空白 / 下划线 / 连字符合并成一个下划线。
 *
 * 只用于比较；输出给学生看的标签保留数据原本的写法。
 */

/** `' Data-Science '` → `'data_science'`；`'biomedical research'` → `'biomedical_research'`。 */
export function normalizeTag(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_-]+/g, '_');
}

/** 把一组标签归一化成集合（跳过非字符串与归一化后为空的项）。 */
export function normalizedTagSet(tags: readonly unknown[]): Set<string> {
  const out = new Set<string>();
  for (const t of tags) {
    if (typeof t !== 'string') continue;
    const n = normalizeTag(t);
    if (n !== '' && n !== '_') out.add(n);
  }
  return out;
}

/**
 * `tags` 中归一化后出现在 `against` 里的那些，保留 `tags` 原本的写法与顺序；
 * 归一化后相同的重复项只留第一个。
 */
export function sharedTags(tags: readonly string[], against: ReadonlySet<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (!against.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push(t);
  }
  return out;
}
