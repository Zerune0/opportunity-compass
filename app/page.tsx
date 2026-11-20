import Link from "next/link";

const actions = [
  { title: "Discover", href: "/quests", linkLabel: "Quest Board", note: "Real opportunities, each with an official link and a verification date." },
  { title: "Understand", href: "/quests", linkLabel: "Check an opportunity", note: "Eligibility, gaps and barriers, shown separately. Unclear means unknown." },
  { title: "Grow", href: "/map", linkLabel: "Adventure Map", note: "Two or three routes that update when you add evidence." },
  { title: "Act", href: "/journal", linkLabel: "Quest Journal", note: "Track applications and plan several deadlines together." },
];

const demoSteps = [
  { href: "/passport", title: "Load a sample profile", note: "Skill Passport" },
  { href: "/quests", title: "Open an opportunity", note: "Quest Board" },
  { href: "/quests", title: "Read eligibility, gaps and barriers", note: "Details page" },
  { href: "/map", title: "Compare routes", note: "Adventure Map" },
  { href: "/journal", title: "Add it to your Journal", note: "Quest Journal" },
];

const localOnlyNote = "No accounts or server: your data stays in this browser.";

const notThis = [
  "Not an admission predictor: “within reach” means time, cost, transportation and equipment, not acceptance.",
  "No scores or rankings of students.",
  localOnlyNote,
  "Organizer results are simulations on sample data.",
  "The official application is always one click away. Nothing is locked.",
];

export default function Home() {
  return (
    <div className="rpg-stack rpg-stack--loose">
      <section className="home crt" aria-labelledby="home-title">
        <div className="rpg-stack">
          <h1 id="home-title">Opportunity Compass</h1>
          <p className="rpg-menu__title">A bridge between potential and opportunity</p>
          <p className="home__lead">
            Find <strong className="home__key">real opportunities</strong>, see{" "}
            <strong className="home__key">what stands in your way</strong>, and pick{" "}
            <strong className="home__key">a route that works</strong>.
          </p>
          <div className="rpg-row">
            <Link href="/quests" className="rpg-button rpg-button--primary">
              Browse opportunities
            </Link>
            <Link href="/passport" className="rpg-button rpg-button--secondary">
              Start the demo
            </Link>
          </div>
        </div>

        <section className="rpg-stack" aria-labelledby="demo-title">
          <h2 id="demo-title">Try the demo in 5 steps</h2>
          <ol className="rpg-menu">
            {demoSteps.map((step, index) => (
              <li key={step.title}>
                <Link
                  href={step.href}
                  className={index === 0 ? "rpg-menu__row rpg-menu__row--cursor" : "rpg-menu__row"}
                >
                  <span className="rpg-menu__title">
                    {index + 1}. {step.title}
                  </span>
                  <span className="rpg-menu__note">{step.note}</span>
                </Link>
              </li>
            ))}
          </ol>
          <p className="rpg-small rpg-muted">
            Sample profiles are fictional and labelled &ldquo;Sample&rdquo;.
          </p>
        </section>
      </section>

      <section className="rpg-stack" aria-labelledby="actions-title">
        <h2 id="actions-title">What you can do here</h2>
        <ul className="rpg-route-grid m-0 list-none p-0">
          {actions.map((action) => (
            <li key={action.title} className="rpg-card">
              <h3 className="home__card-title">{action.title}</h3>
              <p>{action.note}</p>
              <Link href={action.href} className="rpg-button rpg-button--secondary">
                {action.linkLabel}
              </Link>
            </li>
          ))}
        </ul>
        <ul className="rpg-row m-0 list-none p-0">
          <li>
            <Link href="/passport">Skill Passport</Link>
            <span className="rpg-small rpg-muted"> &middot; your skills and evidence</span>
          </li>
          <li>
            <Link href="/organizer">Organizer what-if</Link>
            <span className="rpg-small rpg-muted"> &middot; support module &middot; simulated</span>
          </li>
          <li>
            <Link href="/connect">Connect (local demo)</Link>
            <span className="rpg-small rpg-muted">
              {" "}&middot; nothing leaves this browser
            </span>
          </li>
        </ul>
      </section>

      <section className="rpg-stack" aria-labelledby="not-title">
        <h2 id="not-title">What this is not</h2>
        <ul className="rpg-list">
          {notThis.map((item) => (
            <li key={item}>
              {item}
              {item === localOnlyNote && (
                <>
                  {" "}
                  <Link href="/data">Export a backup</Link>.
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
