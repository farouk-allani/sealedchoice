"use client";

import { useEffect, useState } from "react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-ink px-5 py-4">
      <span aria-hidden="true" className="font-mono text-[13px] text-faint">
        $
      </span>
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[13px] text-fg">
        {command}
      </code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(command).then(() => setCopied(true));
        }}
        className="shrink-0 rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-muted transition-colors hover:border-line-strong hover:text-fg"
      >
        {copied ? <span className="text-pass">Copied</span> : "Copy"}
      </button>
    </div>
  );
}
