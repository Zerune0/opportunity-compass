import type { ComponentPropsWithoutRef } from "react";

type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  variant?: "primary" | "secondary";
};

export function RpgButton({
  type = "button", variant = "primary", className = "", ...props
}: ButtonProps) {
  return <button {...props} type={type} className={`rpg-button rpg-button--${variant} ${className}`} />;
}
