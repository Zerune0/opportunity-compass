import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Connect 的共用布局（server component）：app/connect 下的每个页面都被它包住，
 * 所以每个页面顶部都有本地演示的提示（没有真实发布者，也不联系任何人），没有哪个页面能漏掉。
 * 提示句由 lib/connect/static-guard.test.ts 原样检查，改字时要同时改测试。
 */
export default function ConnectLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div role="note" className="rounded border-2 border-amber-600 bg-amber-50 p-3 text-amber-950">
        <p className="font-semibold">Local demo. There are no real publishers here and no one is contacted.</p>
      </div>
      <nav aria-label="Connect pages" className="text-sm">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          <li>
            <Link href="/connect" className="inline-flex min-h-11 items-center">
              Connect home
            </Link>
          </li>
          <li>
            <Link href="/connect/create" className="inline-flex min-h-11 items-center">
              Quest Creator
            </Link>
          </li>
          <li>
            <Link href="/connect/talent" className="inline-flex min-h-11 items-center">
              Talent Board
            </Link>
          </li>
        </ul>
      </nav>
      {children}
    </div>
  );
}
