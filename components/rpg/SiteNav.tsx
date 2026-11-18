"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type SiteNavProps = {
  items: { href: string; label: string }[];
};

export function SiteNav({ items }: SiteNavProps) {
  const pathname = usePathname() ?? "";
  const destinations = items.some((item) => item.href === "/journal") ? items : [
    ...items.slice(0, -1),
    { href: "/journal", label: "Journal" },
    ...items.slice(-1),
  ];
  return (
    <ul className="shell-links">
      {destinations.map((item) => {
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
