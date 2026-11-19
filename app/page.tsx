import Link from "next/link";

const actions = [
  {
    title: "Discover",
    href: "/quests",
    linkLabel: "Open the Quest Board",
    note: "Real opportunities, each with an official link, a verification date and a source label. Opportunities posted in this browser are labelled Sample and not verified.",
  },
  {
    title: "Understand",
    href: "/quests",
    linkLabel: "Check an opportunity",
    note: "Official eligibility, your gaps in five groups, and practical barriers (time, cost, transportation, equipment), shown separately. Anything unclear is marked unknown.",
  },
  {
    title: "Grow",
    href: "/map",
    linkLabel: "Open the Adventure Map",
    note: "Two or three routes toward a real target, re-planned when you add evidence, with a replay of what changed and why.",
  },
  {
    title: "Act",
    href: "/journal",
    linkLabel: "Open the Quest Journal",
    note: "Keep your application, the organizer's eligibility confirmation, the decision and participation as four separate lines, and plan several deadlines together.",
  },
];

const demoSteps = [
  { href: "/passport", title: "Load a sample profile", note: "In Skill Passport, pick one of the sample students." },
  { href: "/quests", title: "Open an opportunity", note: "Choose one on the Quest Board." },
  { href: "/quests", title: "Read eligibility, gaps and barriers", note: "Each is shown on its own; unclear items say unknown." },
  { href: "/map", title: "Compare routes", note: "Add evidence in Skill Passport, then see the routes and the replay on the Adventure Map." },
  { href: "/journal", title: "Add it to your Quest Journal", note: "Then plan it together with a second opportunity." },
];

const localOnlyNote = "No accounts or server. What you enter stays in this browser.";

const notThis = [
  "Not an admission predictor. “Within reach” is about time, cost, transportation and equipment, not acceptance.",
  "No scores or rankings of students.",
  localOnlyNote,
  "Organizer results are simulations on sample data, not real-world impact.",
  "You can always go straight to the official application. Nothing here is locked behind progress.",
];

export default function Home() {
  return (
    <div className="rpg-stack rpg-stack--loose">
      <section className="home crt" aria-labelledby="home-title">
        <div className="rpg-stack">
          <h1 id="home-title">Opportunity Compass</h1>
          <p className="rpg-menu__title">A bridge between potential and opportunity</p>
          <p className="home__lead">
            For students without resources or connections: find real opportunities,
            understand eligibility and real-world barriers, pick a route that works,
            then apply.
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
              <h3>{action.title}</h3>
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
            <span className="rpg-muted"> &middot; record evidence of your skills</span>
          </li>
          <li>
            <Link href="/organizer">Organizer what-if</Link>
            <span className="rpg-small rpg-muted"> &middot; support module &middot; simulated</span>
          </li>
          <li>
            <Link href="/connect">Connect (local demo)</Link>
            <span className="rpg-small rpg-muted">
              {" "}&middot; post a sample quest or choose what a sample publisher could see. No real publishers, nothing leaves this browser.
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
                  <Link href="/data">Export a backup file in Your data</Link> to keep a copy or move to another browser.
                </>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
