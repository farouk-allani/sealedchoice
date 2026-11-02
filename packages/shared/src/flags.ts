// Flags bitmap of the on-chain result. Bits and wording follow docs/04-evaluator.md (stage 7)
// and specs/reference/reference.py FLAGS. UI copy reads explanations from here.

export interface FlagInfo {
  readonly bit: number;
  readonly value: number;
  readonly meaning: string;
  readonly effect: string;
}

export const FLAGS = {
  INELIGIBLE: {
    bit: 0,
    value: 1,
    meaning: "Failed an eligibility rule.",
    effect: "Ranked last with 0 and never sent to a model.",
  },
  DECRYPT_FAILED: {
    bit: 1,
    value: 2,
    meaning: "The ciphertext does not decrypt.",
    effect: "Ineligible; the bond is forfeited.",
  },
  ACCOUNT_MISMATCH: {
    bit: 2,
    value: 4,
    meaning: "The bidder named inside the bid is not the account that submitted it (copied ciphertext).",
    effect: "Ineligible; the bond is forfeited.",
  },
  INJECTION_SUSPECTED: {
    bit: 3,
    value: 8,
    meaning: "The proposal matches an instruction-injection pattern.",
    effect: "No score change; the committee is told to read the proposal.",
  },
  DISAGREEMENT: {
    bit: 4,
    value: 16,
    meaning: "The models differ by 3 points or more on a criterion.",
    effect: "No score change; the committee is told.",
  },
  EVIDENCE_MISSING: {
    bit: 5,
    value: 32,
    meaning: "A model's score was clamped because its quotes were not found in the proposal.",
    effect: "Already applied to that model's score before the median.",
  },
  EVAL_INCOMPLETE: {
    bit: 6,
    value: 64,
    meaning: "Fewer than 2 valid model outputs on a criterion.",
    effect: "That criterion counts 0 and the result needs the committee.",
  },
} as const satisfies Record<string, FlagInfo>;

export type FlagName = keyof typeof FLAGS;

export const FLAG_NAMES = Object.keys(FLAGS) as FlagName[];

/** Highest valid bitmap (all seven flags). */
export const ALL_FLAGS_MASK = FLAG_NAMES.reduce((m, n) => m | FLAGS[n].value, 0);

/** Names of the flags set in `bitmap`, in bit order. Throws on unknown bits. */
export function decodeFlags(bitmap: number): FlagName[] {
  if (!Number.isInteger(bitmap) || bitmap < 0 || (bitmap & ~ALL_FLAGS_MASK) !== 0) {
    throw new RangeError(`not a valid flags bitmap: ${bitmap}`);
  }
  return FLAG_NAMES.filter((n) => (bitmap & FLAGS[n].value) !== 0);
}

/** Bitmap for a list of flag names. */
export function encodeFlags(names: readonly FlagName[]): number {
  return names.reduce((m, n) => m | FLAGS[n].value, 0);
}
