import Link from "next/link";

const pages = [
  { href: "/quests", label: "机会 Quests", note: "发现真实机会，看懂资格" },
  { href: "/map", label: "成长地图 Map", note: "选择走得通的成长路线" },
  { href: "/passport", label: "技能护照 Passport", note: "记录技能证据" },
  { href: "/organizer", label: "主办方 Organizer", note: "资源分配与模拟（支持模块）" },
];

export default function Home() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Opportunity Compass</h1>
      <p className="text-gray-700">
        帮助缺少资源和人脉的学生：发现真实机会 → 看懂资格和现实障碍 →
        选一条走得通的成长路线 → 申请。
      </p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {pages.map((p) => (
          <li key={p.href}>
            <Link
              href={p.href}
              className="block rounded border border-gray-200 p-4 hover:border-gray-400"
            >
              <span className="font-medium">{p.label}</span>
              <span className="mt-1 block text-sm text-gray-600">{p.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
