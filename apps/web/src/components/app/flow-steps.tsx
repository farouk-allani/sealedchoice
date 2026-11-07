import { Icon } from "../ui/icon.tsx";

export function FlowSteps({
  labels,
  current,
  onChange,
}: {
  labels: readonly string[];
  current: number;
  onChange?: (step: number) => void;
}) {
  return (
    <ol className="flow-steps" aria-label="Your progress">
      {labels.map((label, index) => (
        <li
          key={label}
          data-state={
            index < current
              ? "complete"
              : index === current
                ? "current"
                : "upcoming"
          }
          aria-current={index === current ? "step" : undefined}
        >
          <button
            type="button"
            disabled={!onChange || index > current}
            onClick={() => onChange?.(index)}
          >
            <span className="flow-step-number">
              {index < current ? <Icon name="check" size={16} /> : index + 1}
            </span>
            <span>{label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
