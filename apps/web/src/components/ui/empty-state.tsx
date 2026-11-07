import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon.tsx";

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="ui-empty-state">
      {icon && (
        <span className="ui-empty-icon">
          <Icon name={icon} size={25} />
        </span>
      )}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function SkeletonRows({
  label = "Loading tenders",
}: {
  label?: string;
}) {
  return (
    <div className="ui-skeleton-rows" role="status">
      <span className="ui-sr-only">{label}</span>
      {[0, 1, 2].map((row) => (
        <div className="ui-skeleton-row" key={row} aria-hidden="true">
          <span />
          <div>
            <span />
            <span />
          </div>
          <span />
        </div>
      ))}
    </div>
  );
}
