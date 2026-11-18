import Link from "next/link";

const actions = [
  { href: "/quests", label: "Discover", note: "Find real opportunities with official sources and application deadlines." },
  { href: "/quests", label: "Understand", note: "Check official eligibility, preparation gaps and practical barriers separately." },
  { href: "/map", label: "Grow", note: "Compare preparation routes and record supporting evidence in your Skill Passport." },
  { href: "/journal", label: "Take Action", note: "Organize applications, track materials and compare your weekly workload." },
];

export default function Home() {
  return (
    <div className="rpg-stack rpg-stack--loose">
      <header className="rpg-head crt">
        <h1>Opportunity Compass</h1>
        <p className="home__lead">
          Find opportunities, understand what you need, and take the next step with the time and resources you have.
        </p>
      </header>
      <section aria-label="Your next steps">
        <ul className="rpg-menu">
          {actions.map((action) => (
            <li key={action.label}>
              <Link href={action.href} className="rpg-menu__row">
                <span className="rpg-menu__title">{action.label}</span>
                <span className="rpg-menu__note">{action.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <p><Link href="/passport">Create your Skill Passport or load a sample profile</Link> to assess opportunities for your situation.</p>
      <p>Preparation quests help you prepare. You can always go directly to the official application.</p>
      <aside className="rpg-stack">
        <h2>Organizer support</h2>
        <p>Organizers can explore how resources affect practical access in sample simulations.</p>
        <Link href="/organizer">Open the supporting organizer module</Link>
      </aside>
    </div>
  );
}
