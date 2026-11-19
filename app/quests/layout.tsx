import type { ReactNode } from "react";
import "./quests.css";
export default function QuestsLayout({ children }: {
    children: ReactNode;
}) { return <div className="quest-pages">{children}</div>; }
