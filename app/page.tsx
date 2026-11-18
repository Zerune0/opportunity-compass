import Link from "next/link";

const pages = [
  { href: "/quests", label: "Quests", note: "Find real opportunities and understand eligibility" },
  { href: "/map", label: "Map", note: "Pick a growth route that works" },
  { href: "/passport", label: "Passport", note: "Record evidence of your skills" },
  { href: "/organizer", label: "Organizer", note: "Resource allocation and simulation (support module)" },
];

export default function Home() {
  return (
    <div className="home crt">
      <div className="rpg-stack">
        <h1>Opportunity Compass</h1>
        <p className="home__lead">
          For students without resources or connections: find real opportunities,
          understand eligibility and real-world barriers, pick a route that works,
          then apply.
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
