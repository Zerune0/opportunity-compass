const destinations = [
  { href: "/quests", label: "Quest Board" },
  { href: "/map", label: "Adventure Map" },
  { href: "/passport", label: "Skill Passport" },
  { href: "/organizer", label: "Organizer" },
];

type NavBarProps = {
  activePath?: string;
  opportunityId?: string;
};

export function NavBar({ activePath = "", opportunityId }: NavBarProps) {
  return (
    <nav className="rpg-nav" aria-label="Main navigation">
      {destinations.map(({ href, label }) => {
        const current = activePath === href || activePath.startsWith(`${href}/`);
        const destination = href === "/map" && opportunityId
          ? `${href}?opp=${encodeURIComponent(opportunityId)}`
          : href;
        return (
          <a key={href} href={destination} aria-current={current ? "page" : undefined}>
            {label}
          </a>
        );
      })}
    </nav>
  );
}
