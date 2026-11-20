import Link from "next/link";

const steps = [
  ["/passport", "Load a sample profile", "Choose a fictional student in Skill Passport."],
  ["/quests", "Explore an opportunity", "Check eligibility, missing information and practical barriers."],
  ["/map", "Compare preparation routes", "Add evidence and see what changes, with an explanation."],
  ["/journal", "Plan your applications", "Add two opportunities to coordinate tasks and deadlines."],
];

export default function Home() {
  return (
    <div className="rpg-stack rpg-stack--loose home-refresh">
      <section className="home-hero" aria-labelledby="home-title">
        <p className="home-eyebrow">A bridge between potential and opportunity</p>
        <h1 id="home-title">Find opportunities.<br /><span>Plan your next step.</span></h1>
        <p className="home-description">Explore real opportunities, understand the requirements, and build a practical preparation plan.</p>
        <div className="rpg-row home-actions">
          <Link href="/quests" className="rpg-button rpg-button--primary">Explore opportunities <span aria-hidden="true">→</span></Link>
          <Link href="/passport" className="rpg-button rpg-button--secondary">Try a sample demo</Link>
        </div>
        <p className="rpg-small rpg-muted">No account needed. Your records stay in this browser.</p>
      </section>

      <section aria-labelledby="journey-title" className="rpg-stack">
        <h2 id="journey-title">From discovery to your next step</h2>
        <div className="home-journey">
          <article><span className="home-number" aria-hidden="true">01</span><h3>Discover</h3><p>Find opportunities with source links and verified dates. Sample listings are clearly labelled.</p><Link href="/quests">Browse the Quest Board →</Link></article>
          <article><span className="home-number" aria-hidden="true">02</span><h3>Understand</h3><p>See eligibility, preparation gaps and practical barriers separately. Missing information stays unknown.</p><Link href="/quests">Check an opportunity →</Link></article>
          <article><span className="home-number" aria-hidden="true">03</span><h3>Prepare</h3><p>Compare routes, record skill evidence, and plan your application tasks and deadlines.</p><Link href="/map">Explore growth routes →</Link></article>
        </div>
      </section>

      <details className="home-demo">
        <summary>How the sample demo works <span className="rpg-muted"> · four steps</span></summary>
        <ol className="home-demo-steps">{steps.map(([href, title, note]) => <li key={title}><Link href={href}>{title}</Link><p className="rpg-muted">{note}</p></li>)}</ol>
        <p className="rpg-small rpg-muted">Sample students are fictional. Organizer results are simulations, not real-world impact.</p>
      </details>

      <section className="home-footer-note rpg-stack" aria-labelledby="boundaries-title">
        <h2 id="boundaries-title">Planning support. Your decisions.</h2>
        <p>Eligibility, practical reachability and admission are different. This app does not predict admission or rank students. You can always apply directly on the official page.</p>
        <div className="rpg-row"><Link href="/passport">Skill Passport</Link><Link href="/journal">Quest Journal</Link><Link href="/organizer">Organizer simulation</Link><Link href="/connect">Connect · local sample demo</Link><Link href="/data">Export your data</Link></div>
      </section>
    </div>
  );
}
