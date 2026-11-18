import type { ComponentPropsWithoutRef } from "react";

type StatusTagProps = ComponentPropsWithoutRef<"span"> & {
  tone?: "neutral" | "success" | "warning" | "danger";
};

export function StatusTag({ tone = "neutral", className = "", ...props }: StatusTagProps) {
  return <span {...props} className={`rpg-tag rpg-tag--${tone} ${className}`} />;
}
