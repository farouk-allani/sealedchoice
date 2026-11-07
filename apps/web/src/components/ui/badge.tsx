import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export type BadgeTone = "neutral" | "violet" | "success" | "warning" | "danger";

export function Badge({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  icon?: IconName;
}) {
  return (
    <span className={`ui-badge ui-badge--${tone}`}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}
