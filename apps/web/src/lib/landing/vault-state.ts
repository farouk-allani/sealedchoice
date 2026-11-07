/**
 * The vault's whole state is a pure function of one number: how far through the story the
 * reader has scrolled. GSAP's only job is to write that number; nothing about the mechanism
 * lives inside an animation library, so it can be unit tested and reasoned about.
 */

export const ACT_IDS = ["sealed", "closed", "opened", "scored", "awarded", "verified"] as const;
export type ActId = (typeof ACT_IDS)[number];

/** Where each act begins and ends in overall scroll progress (0..1). */
export const ACT_RANGES: ReadonlyArray<{ id: ActId; start: number; end: number }> = [
  { id: "sealed", start: 0.0, end: 0.18 },
  { id: "closed", start: 0.18, end: 0.34 },
  { id: "opened", start: 0.34, end: 0.58 },
  { id: "scored", start: 0.58, end: 0.78 },
  { id: "awarded", start: 0.78, end: 0.92 },
  { id: "verified", start: 0.92, end: 1.0 },
];

export type VaultState = {
  /** Overall story progress, 0..1. */
  progress: number;
  /** Index into ACT_RANGES of the act currently on screen. */
  act: number;
  /** Progress within the current act, 0..1. */
  actProgress: number;
  /** The bid slot: 1 open and accepting, 0 sealed shut at the deadline. */
  slot: number;
  /** Dial rotation in turns (1 = one full revolution). */
  dial: number;
  /** Locking bolts: 0 driven home, 1 fully retracted. */
  bolts: number;
  /** Door swing: 0 closed, 1 fully open. */
  door: number;
  /** Camera travel toward and through the doorway: 0 outside, 1 inside the chamber. */
  dolly: number;
  /** How lit the interior chamber is, 0..1. */
  interior: number;
  /** The frozen Merkle root engraving on the door face, 0..1. */
  engrave: number;
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Progress of `value` across [start, end], clamped to 0..1. */
export const span = (value: number, start: number, end: number): number =>
  end === start ? (value < start ? 0 : 1) : clamp01((value - start) / (end - start));

/** Smooth acceleration and deceleration. Keeps mechanical parts from starting with a jerk. */
export const easeInOut = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** Fast start, long settle: how a heavy part that has been released actually moves. */
export const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);

export const actIndexAt = (progress: number): number => {
  const p = clamp01(progress);
  for (let i = ACT_RANGES.length - 1; i >= 0; i -= 1) {
    if (p >= ACT_RANGES[i]!.start) return i;
  }
  return 0;
};

export function vaultStateAt(progress: number): VaultState {
  const p = clamp01(progress);
  const act = actIndexAt(p);
  const range = ACT_RANGES[act]!;

  // The slot is open while bids come in and seals during the first half of the close act.
  const slot = 1 - easeInOut(span(p, 0.19, 0.26));

  // The root is engraved once the slot is shut.
  const engrave = easeOut(span(p, 0.26, 0.34));

  // The dial turns through the close, then a quarter-turn more as the bolts release.
  const dial = easeInOut(span(p, 0.2, 0.34)) * 1.25 + easeInOut(span(p, 0.36, 0.44)) * 0.35;

  // Bolts retract after the dial has turned, then the door swings, then the camera goes through.
  const bolts = easeOut(span(p, 0.4, 0.5));
  const door = easeInOut(span(p, 0.46, 0.62));
  const dolly = easeInOut(span(p, 0.52, 0.72));
  const interior = easeOut(span(p, 0.5, 0.66));

  return {
    progress: p,
    act,
    actProgress: span(p, range.start, range.end),
    slot,
    dial,
    bolts,
    door,
    dolly,
    interior,
    engrave,
  };
}
