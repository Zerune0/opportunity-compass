import type { ComponentPropsWithoutRef } from "react";

export function QuestCard({ className = "", ...props }: ComponentPropsWithoutRef<"article">) {
  return <article {...props} className={`rpg-card ${className}`} />;
}
