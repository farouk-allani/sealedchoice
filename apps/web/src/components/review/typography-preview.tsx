import { CHAIN, short } from "../../config/evidence.ts";
import { Icon } from "../ui/icon.tsx";

export const TYPOGRAPHY_PRESETS = [
  {
    id: "public",
    name: "Public Sans",
    pairing: "Public Sans + IBM Plex Mono",
    description: "Clear and institutional",
    family: "var(--font-public-sans), sans-serif",
  },
  {
    id: "barlow",
    name: "Barlow",
    pairing: "Barlow + IBM Plex Mono",
    description: "Compact and industrial",
    family: "var(--font-barlow), sans-serif",
  },
  {
    id: "original",
    name: "Original Inter",
    pairing: "Inter + JetBrains Mono",
    description: "The original pairing",
    family: "var(--font-inter), sans-serif",
  },
] as const;

export type TypographyPreset = (typeof TYPOGRAPHY_PRESETS)[number]["id"];

export function TypographyPreview({
  value,
  onChange,
}: {
  value: TypographyPreset;
  onChange: (value: TypographyPreset) => void;
}) {
  const current = TYPOGRAPHY_PRESETS.find((preset) => preset.id === value)!;
  return (
    <section className="review-typography" aria-labelledby="typography-heading">
      <div className="review-typography-heading">
        <h2 id="typography-heading">Try the type.</h2>
        <p id="typography-help">Switch the font across the whole library.</p>
      </div>
      <fieldset
        className="review-font-options"
        aria-describedby="typography-help"
      >
        <legend className="ui-sr-only">Typeface preview</legend>
        {TYPOGRAPHY_PRESETS.map((preset) => (
          <label className="review-font-option" key={preset.id}>
            <input
              type="radio"
              name="typography-preset"
              value={preset.id}
              checked={value === preset.id}
              onChange={() => onChange(preset.id)}
              className="ui-sr-only"
            />
            <span
              className="review-font-letter"
              style={{ fontFamily: preset.family }}
              aria-hidden="true"
            >
              Ag
            </span>
            <span className="review-font-option-copy">
              <strong>{preset.name}</strong>
              <span>{preset.description}</span>
            </span>
            <span className="review-font-check" aria-hidden="true">
              {value === preset.id && <Icon name="check" size={16} />}
            </span>
          </label>
        ))}
      </fieldset>
      <div className="review-font-specimens" aria-label="Typography samples">
        <div>
          <span>Budget and scores</span>
          <strong className="review-number-specimen">
            15,000.00 <span>/ 86.66</span>
          </strong>
        </div>
        <div>
          <span>Letter clarity</span>
          <strong className="review-letter-specimen">
            Il1 <span>/</span> O0
          </strong>
        </div>
        <div>
          <span>Evaluator hash</span>
          <code title={CHAIN.evaluatorBuild}>
            {short(CHAIN.evaluatorBuild)}
          </code>
        </div>
      </div>
      <p className="review-font-selection" role="status">
        {current.pairing} applied to this preview.
      </p>
    </section>
  );
}
