import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Connect (Local demo) · Opportunity Compass",
  description:
    "A local demo of how opportunities could be posted and how students could choose what to share. The publishers are fictional samples and no one is contacted.",
};

/** Connect 首页（server component）：只链接两个本地演示页面。 */
export default function ConnectPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold">Connect</h1>
        <p className="text-gray-700">
          Two local demo pages. Everything you do here stays in this browser, and the publishers are fictional
          samples.
        </p>
      </header>
      <ul className="grid gap-4 sm:grid-cols-2">
        <li className="space-y-2 rounded border border-gray-300 p-3">
          <h2 className="text-lg font-semibold">
            <Link href="/connect/create" className="inline-flex min-h-11 items-center">
              Quest Creator
            </Link>
          </h2>
          <p className="text-sm text-gray-700">
            Post a quest as a sample publisher. On the Quest Board and Quest Details it is labelled Sample and
            User-posted. You can withdraw it at any time.
          </p>
        </li>
        <li className="space-y-2 rounded border border-gray-300 p-3">
          <h2 className="text-lg font-semibold">
            <Link href="/connect/talent" className="inline-flex min-h-11 items-center">
              Talent Board
            </Link>
          </h2>
          <p className="text-sm text-gray-700">
            Choose what a sample publisher could see about your profile. Sharing is off until you turn it on, and you
            can turn it off at any time.
          </p>
        </li>
      </ul>
    </div>
  );
}
