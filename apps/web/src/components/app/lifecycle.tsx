import { Icon } from "../ui/icon.tsx";

export type LifecycleStep = {
  label: string;
  detail: string;
  state: "complete" | "current" | "upcoming";
  href?: string;
};

export function Lifecycle({
  steps,
  layout = "horizontal",
}: {
  steps: readonly LifecycleStep[];
  /** "vertical" for a narrow column, where a row of steps has no room to read. */
  layout?: "horizontal" | "vertical";
}) {
  return (
    <ol className="tender-lifecycle" data-layout={layout} aria-label="Tender progress">
      {steps.map((step, index) => (
        <li
          key={step.label}
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
        >
          <span className="lifecycle-marker">
            {step.state === "complete" ? (
              <Icon name="check" size={15} />
            ) : (
              <span>{index + 1}</span>
            )}
          </span>
          <div>
            {step.href ? (
              <a href={step.href}>
                {step.label}
                <Icon name="external" size={13} />
              </a>
            ) : (
              <strong>{step.label}</strong>
            )}
            <span>{step.detail}</span>
            <span className="ui-sr-only">{step.state}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
