import type { ReactNode } from "react";
import { Icon, type IconName } from "../ui/icon.tsx";

export type NoticeTone = "info" | "success" | "warning" | "danger";

const icons: Record<NoticeTone, IconName> = {
  info: "info",
  success: "check",
  warning: "warning",
  danger: "close",
};

export function Notice({
  tone = "info",
  title,
  children,
  action,
  live = false,
}: {
  tone?: NoticeTone;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  live?: boolean;
}) {
  return (
    <div
      className={`ui-notice ui-notice--${tone}`}
      role={live ? (tone === "danger" ? "alert" : "status") : undefined}
    >
      <span className="ui-notice-icon">
        <Icon name={icons[tone]} size={18} />
      </span>
      <div className="ui-notice-copy">
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
      {action && <div className="ui-notice-action">{action}</div>}
    </div>
  );
}

export type TransactionState = "idle" | "pending" | "confirmed" | "rejected";

export function TransactionNotice({
  state,
  explorerHref,
  retry,
}: {
  state: Exclude<TransactionState, "idle">;
  explorerHref?: string;
  retry?: ReactNode;
}) {
  if (state === "pending")
    return (
      <Notice live title="Waiting for confirmation">
        Your wallet request is pending. Keep this page open.
      </Notice>
    );
  if (state === "rejected")
    return (
      <Notice live tone="danger" title="Request declined" action={retry}>
        The wallet request was declined. No transaction was sent.
      </Notice>
    );
  return (
    <Notice
      live
      tone="success"
      title="Transaction confirmed"
      action={
        explorerHref ? (
          <a
            className="ui-text-link"
            href={explorerHref}
            target="_blank"
            rel="noreferrer"
          >
            View transaction
            <Icon name="external" size={15} />
          </a>
        ) : undefined
      }
    >
      Your receipt is ready. Save a copy for your records.
    </Notice>
  );
}
