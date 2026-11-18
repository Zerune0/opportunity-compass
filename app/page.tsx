import Link from "next/link";

const pages = [
  { href: "/quests", label: "机会 Quests", note: "发现真实机会，看懂资格" },
  { href: "/map", label: "成长地图 Map", note: "选择走得通的成长路线" },
  { href: "/passport", label: "技能护照 Passport", note: "记录技能证据" },
  { href: "/organizer", label: "主办方 Organizer", note: "资源分配与模拟（支持模块）" },
];

export default function Home() {
  return (
    <div className="home crt">
      <div className="rpg-stack">
        <h1>Opportunity Compass</h1>
        <p className="home__lead">
          帮助缺少资源和人脉的学生：发现真实机会 → 看懂资格和现实障碍 →
          选一条走得通的成长路线 → 申请。
        </p>
      </div>
      <ul className="rpg-menu">
        {pages.map((p, index) => (
          <li key={p.href}>
            <Link
              href={p.href}
              className={index === 0 ? "rpg-menu__row rpg-menu__row--cursor" : "rpg-menu__row"}
            >
              <span className="rpg-menu__title">{p.label}</span>
              <span className="rpg-menu__note">{p.note}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
