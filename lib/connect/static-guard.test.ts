/**
 * 静态守卫（参照 lib/joint/bridge.test.ts 末尾的做法，只读源码文本）：
 * 1. app/connect/ 与 lib/connect/ 的源码不直接碰浏览器存储，一律经过 lib/store 导出的函数；
 *    也不用 lib/store 的底层工具（readJSON / writeJSON / removeKey / storageKey / STORE_KEYS / STORE_VALIDATORS）。
 *    测试文件（*.test.ts）要用内存版存储模拟浏览器，不在检查范围内。
 * 2. 每个 app/connect/**\/page.tsx 都在 app/connect/layout.tsx 之下，而这个 layout 原样写着本地演示的那句话，
 *    所以没有哪个 Connect 页面能漏掉它。
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const rel = (p: string) => relative(ROOT, p).split('\\').join('/');
const DEMO_SENTENCE = 'Local demo. There are no real publishers here and no one is contacted.';

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const SOURCE_FILES = ['app/connect', 'lib/connect']
  .flatMap((d) => walk(resolve(ROOT, d)))
  .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\.ts$/.test(p));

const isFile = (p: string) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

/** import 说明符 → 仓库里的文件（包名返回 null）。 */
function resolveSpecifier(from: string, spec: string): string | null {
  let b: string;
  if (spec.startsWith('@/')) b = resolve(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) b = resolve(dirname(from), spec);
  else return null;
  for (const p of [b, `${b}.ts`, `${b}.tsx`, resolve(b, 'index.ts'), resolve(b, 'index.tsx')]) if (isFile(p)) return p;
  throw new Error(`cannot resolve ${spec} from ${from}`);
}

/** 全部 `import … from '…'`：返回说明符与花括号里的名字（没有花括号时为 null）。 */
function importsOf(file: string): { spec: string; names: string[] | null; star: boolean }[] {
  const text = readFileSync(file, 'utf8');
  const out: { spec: string; names: string[] | null; star: boolean }[] = [];
  const re = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) {
    const clause = m[1];
    const braces = /\{([\s\S]*)\}/.exec(clause);
    const names = braces
      ? braces[1]
          .split(',')
          .map((s) => s.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim())
          .filter((s) => s !== '')
      : null;
    out.push({ spec: m[2], names, star: /\*\s+as\s+/.test(clause) });
  }
  for (const m of text.matchAll(/(?:import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) out.push({ spec: m[1], names: null, star: true });
  return out;
}

const LOW_LEVEL = new Set(['readJSON', 'writeJSON', 'removeKey', 'storageKey', 'STORE_KEYS', 'STORE_VALIDATORS', 'STORE_PREFIX', 'STORE_VERSION']);

describe('静态守卫：Connect 的源码只经 lib/store 读写浏览器存储', () => {
  it('确实扫描到了 Connect 的页面与逻辑文件', () => {
    const files = SOURCE_FILES.map(rel);
    for (const f of ['app/connect/layout.tsx', 'app/connect/page.tsx', 'lib/connect/quest-form.ts', 'lib/connect/talent.ts']) {
      expect(files).toContain(f);
    }
  });

  for (const file of SOURCE_FILES) {
    const name = rel(file);
    it(`${name} 不直接碰浏览器存储`, () => {
      const text = readFileSync(file, 'utf8');
      expect(text).not.toMatch(/\blocalStorage\b/);
      expect(text).not.toMatch(/\bsessionStorage\b/);
      expect(text).not.toMatch(/\bindexedDB\b/);
      expect(text).not.toMatch(/document\.cookie/);
      for (const imp of importsOf(file)) {
        const target = resolveSpecifier(file, imp.spec);
        if (target === null || rel(target) !== 'lib/store.ts') continue;
        expect(imp.star, `${name} must import named functions from lib/store`).toBe(false);
        for (const n of imp.names ?? []) expect(LOW_LEVEL.has(n), `${name} imports ${n} from lib/store`).toBe(false);
      }
    });
  }

  it('页面确实用 lib/store 读写（守卫本身有效）', () => {
    const users = SOURCE_FILES.filter((f) =>
      importsOf(f).some((imp) => {
        const t = resolveSpecifier(f, imp.spec);
        return t !== null && rel(t) === 'lib/store.ts';
      }),
    ).map(rel);
    expect(users).toEqual(expect.arrayContaining(['app/connect/create/QuestCreator.tsx', 'app/connect/talent/TalentBoard.tsx']));
  });
});

describe('静态守卫：每个 Connect 页面都带本地演示提示', () => {
  const pages = walk(resolve(ROOT, 'app/connect'))
    .filter((p) => /[\\/]page\.tsx$/.test(p))
    .map(rel)
    .sort();

  it('Connect 的页面都在 app/connect 之下（被 app/connect/layout.tsx 包住）', () => {
    expect(pages).toEqual(expect.arrayContaining(['app/connect/create/page.tsx', 'app/connect/page.tsx', 'app/connect/talent/page.tsx']));
    // 以后新增的页面只要放在 app/connect 下，同样被这个 layout 包住。
    for (const p of pages) expect(p.startsWith('app/connect/')).toBe(true);
  });

  it('layout 原样写着那句话并渲染 children', () => {
    const layout = readFileSync(resolve(ROOT, 'app/connect/layout.tsx'), 'utf8');
    expect(layout).toContain(DEMO_SENTENCE);
    expect(layout).toMatch(/\{children\}/);
    expect(layout).toMatch(/export default function/);
  });

  it('app/connect 下没有别的 layout / template 能绕开它', () => {
    const others = walk(resolve(ROOT, 'app/connect'))
      .map(rel)
      .filter((p) => /\/(layout|template)\.(tsx|ts|jsx|js)$/.test(p) && p !== 'app/connect/layout.tsx');
    expect(others).toEqual([]);
  });
});
