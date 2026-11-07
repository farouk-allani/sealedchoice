"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icon.tsx";

export function CopyButton({
  value,
  label = "Copy",
  compact = false,
}: {
  value: string;
  label?: string;
  compact?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
    timer.current = setTimeout(() => setState("idle"), 2500);
  }

  const message =
    state === "copied"
      ? "Copied"
      : state === "failed"
        ? "Copy unavailable"
        : label;
  return (
    <span className="ui-copy">
      <button
        type="button"
        className={
          compact
            ? "ui-icon-button"
            : "ui-button ui-button--ghost ui-button--small"
        }
        onClick={() => void copy()}
        aria-label={compact ? message : undefined}
        title={message}
      >
        <Icon name={state === "copied" ? "check" : "copy"} size={16} />
        {!compact && message}
      </button>
      <span role="status" className="ui-sr-only">
        {state === "idle"
          ? ""
          : state === "failed"
            ? "Clipboard unavailable. Select and copy the value manually."
            : "Copied to clipboard."}
      </span>
    </span>
  );
}
