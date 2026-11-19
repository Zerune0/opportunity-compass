/**
 * Connect 的示例发布者（虚构账户）：读取 `data/connect/publishers.json` 并逐条校验。
 *
 * - 纯同步、无 IO（JSON 由打包器内联）、不读时钟、永不抛异常。
 * - 只保留合格的记录：对象；`id` 为 kebab-case 且不重复（保留第一条）；`name` 是非空字符串且含单词 "Sample"
 *   （一眼就能看出是虚构的）；`kind` 是 `PublisherKind`；`is_sample === true`；`description` 缺省、null 或字符串。
 *   不合格的进 `rejected`，页面拿不到。
 * - 核心逻辑是纯函数 `partitionPublishers(raw)`，可注入任意数据测试；`samplePublishers()` 返回仓库数据的浅拷贝。
 */
import publishersJson from '@/data/connect/publishers.json';
import type { PublisherKind, SamplePublisher } from '../types';
import { PUBLISHER_KIND_LABELS } from './labels';

/**
 * PublisherKind 的全部取值（types.ts 没有导出常量）：取自 labels.ts 的标签表，
 * 那张表是 `Record<PublisherKind, …>`，types.ts 新增种类而这里没跟上时编译报错。
 */
export const PUBLISHER_KINDS = Object.keys(PUBLISHER_KIND_LABELS) as PublisherKind[];

/** 被丢弃的一条记录：`index` 为原数组位置（0 起），整个文件不是数组时为 -1。 */
export type RejectedPublisher = { id: string | null; index: number; errors: string[] };

export type PublishersResult = { publishers: SamplePublisher[]; rejected: RejectedPublisher[] };

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAMPLE_WORD_RE = /\bSample\b/;

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPublisherKind(v: unknown): v is PublisherKind {
  return typeof v === 'string' && (PUBLISHER_KINDS as readonly string[]).includes(v);
}

/** 单条记录的问题列表（英文）；空数组 = 合格。 */
function publisherErrors(v: unknown): string[] {
  if (!isObj(v)) return ['expected an object'];
  const errors: string[] = [];
  if (typeof v.id !== 'string' || !KEBAB_RE.test(v.id)) errors.push('id: expected a kebab-case string');
  if (typeof v.name !== 'string' || v.name.trim() === '') errors.push('name: expected a non-empty string');
  else if (!SAMPLE_WORD_RE.test(v.name)) errors.push('name: expected an obviously fictional name containing "Sample"');
  if (!isPublisherKind(v.kind)) errors.push(`kind: expected one of ${PUBLISHER_KINDS.join(' / ')}`);
  if (v.is_sample !== true) errors.push('is_sample: expected true (sample publishers are fictional)');
  if (v.description !== undefined && v.description !== null && typeof v.description !== 'string') {
    errors.push('description: expected a string, null, or leave it out');
  }
  return errors;
}

/** 纯函数：把任意输入分成合格的示例发布者和被丢弃的记录。永不抛异常，不修改输入。 */
export function partitionPublishers(raw: unknown): PublishersResult {
  if (!Array.isArray(raw)) {
    return { publishers: [], rejected: [{ id: null, index: -1, errors: ['expected an array of publishers'] }] };
  }
  const publishers: SamplePublisher[] = [];
  const rejected: RejectedPublisher[] = [];
  const seen = new Set<string>();
  raw.forEach((entry: unknown, index) => {
    const id = isObj(entry) && typeof entry.id === 'string' ? entry.id : null;
    const errors = publisherErrors(entry);
    if (errors.length === 0 && id !== null && seen.has(id)) errors.push('id: duplicate (the first one is kept)');
    if (errors.length > 0 || id === null) {
      rejected.push({ id, index, errors });
      return;
    }
    seen.add(id);
    const e = entry as Record<string, unknown>;
    publishers.push({
      id,
      name: e.name as string,
      kind: e.kind as PublisherKind,
      is_sample: true,
      description: typeof e.description === 'string' ? e.description : null,
    });
  });
  return { publishers, rejected };
}

let cached: PublishersResult | null = null;

function loaded(): PublishersResult {
  if (cached === null) cached = partitionPublishers(publishersJson as unknown);
  return cached;
}

/** 仓库里的示例发布者（已校验）。每次返回新数组，记录对象也是拷贝，调用方修改不影响下一次调用。 */
export function samplePublishers(): SamplePublisher[] {
  return loaded().publishers.map((p) => ({ ...p }));
}

/** 按 id 找示例发布者；找不到、或 id 不是非空字符串时返回 null。 */
export function findSamplePublisher(id: string | null | undefined): SamplePublisher | null {
  if (typeof id !== 'string' || id === '') return null;
  const found = loaded().publishers.find((p) => p.id === id);
  return found ? { ...found } : null;
}
