"use client";

import { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export type TabItem = {
  id: string;
  label: string;
  count?: number;
  content: ReactNode;
};

export function Tabs({
  label,
  items,
  value,
  onChange,
}: {
  label: string;
  items: readonly TabItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const selected = items.find((item) => item.id === value) ?? items[0];

  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % items.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + items.length) % items.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = items[next];
    if (target) {
      onChange(target.id);
      list.current
        ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
        [next]?.focus();
    }
  }

  if (!selected) return null;

  return (
    <div className="ui-tabs">
      <div ref={list} className="ui-tab-list" role="tablist" aria-label={label}>
        {items.map((item, index) => (
          <button
            key={item.id}
            id={`${id}-${item.id}-tab`}
            type="button"
            role="tab"
            aria-selected={selected.id === item.id}
            aria-controls={`${id}-${item.id}-panel`}
            tabIndex={selected.id === item.id ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => navigate(event, index)}
          >
            {item.label}
            {item.count !== undefined && (
              <span className="ui-tab-count">{item.count}</span>
            )}
          </button>
        ))}
      </div>
      {items.map((item) => (
        <div
          key={item.id}
          id={`${id}-${item.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-${item.id}-tab`}
          tabIndex={0}
          hidden={selected.id !== item.id}
          className="ui-tab-panel"
        >
          {item.content}
        </div>
      ))}
    </div>
  );
}
