"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SiteNavProps = {
  items: { href: string; label: string }[];
};

export function SiteNav({ items }: SiteNavProps) {
  const pathname = usePathname() ?? "";
  return (
    <ul className="shell-links">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link href={item.href} className="shell-link" aria-current={current ? "page" : undefined}>
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
