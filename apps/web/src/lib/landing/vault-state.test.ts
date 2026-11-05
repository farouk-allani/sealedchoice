import { describe, expect, it } from "vitest";
import { ACT_RANGES, actIndexAt, easeInOut, easeOut, span, vaultStateAt } from "./vault-state.ts";

describe("act ranges", () => {
  it("covers 0..1 with no gap and no overlap", () => {
    expect(ACT_RANGES[0]!.start).toBe(0);
    expect(ACT_RANGES.at(-1)!.end).toBe(1);
    for (let i = 1; i < ACT_RANGES.length; i += 1) {
      expect(ACT_RANGES[i]!.start).toBe(ACT_RANGES[i - 1]!.end);
    }
  });

  it("puts every progress value in exactly one act", () => {
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const i = actIndexAt(p);
      expect(ACT_RANGES[i]!.start).toBeLessThanOrEqual(p);
    }
  });
});

describe("span and easing", () => {
  it("clamps outside the window", () => {
    expect(span(0, 0.4, 0.6)).toBe(0);
    expect(span(1, 0.4, 0.6)).toBe(1);
    expect(span(0.5, 0.4, 0.6)).toBeCloseTo(0.5, 10);
  });

  it("keeps easings inside 0..1 and anchored at the ends", () => {
    for (const ease of [easeInOut, easeOut]) {
      expect(ease(0)).toBeCloseTo(0, 10);
      expect(ease(1)).toBeCloseTo(1, 10);
      for (let t = 0; t <= 1.0001; t += 0.05) {
        const v = ease(t);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("vaultStateAt", () => {
  it("starts sealed: slot open, bolts home, door shut, camera outside", () => {
    const s = vaultStateAt(0);
    expect(s.slot).toBe(1);
    expect(s.bolts).toBe(0);
    expect(s.door).toBe(0);
    expect(s.dolly).toBe(0);
    expect(s.engrave).toBe(0);
  });

  it("ends fully open with the camera inside", () => {
    const s = vaultStateAt(1);
    expect(s.door).toBe(1);
    expect(s.dolly).toBe(1);
    expect(s.interior).toBe(1);
    expect(s.slot).toBe(0);
  });

  it("seals the slot before engraving the root, and engraves before the bolts move", () => {
    // At the moment the root is finished the slot is shut and the bolts have not released.
    const atClose = vaultStateAt(0.34);
    expect(atClose.slot).toBe(0);
    expect(atClose.engrave).toBeCloseTo(1, 6);
    expect(atClose.bolts).toBe(0);
  });

  it("retracts the bolts before the door has swung open", () => {
    const s = vaultStateAt(0.5);
    expect(s.bolts).toBeCloseTo(1, 6);
    expect(s.door).toBeLessThan(0.5);
  });

  it("never moves any part backwards as the reader scrolls forward", () => {
    const monotonic: Array<keyof ReturnType<typeof vaultStateAt>> = [
      "bolts",
      "door",
      "dolly",
      "interior",
      "engrave",
      "dial",
    ];
    let previous = vaultStateAt(0);
    for (let p = 0.005; p <= 1.0001; p += 0.005) {
      const current = vaultStateAt(p);
      for (const key of monotonic) {
        expect(current[key] as number).toBeGreaterThanOrEqual((previous[key] as number) - 1e-9);
      }
      // The slot only ever closes.
      expect(current.slot).toBeLessThanOrEqual(previous.slot + 1e-9);
      previous = current;
    }
  });

  it("clamps out-of-range progress instead of extrapolating", () => {
    expect(vaultStateAt(-5)).toEqual(vaultStateAt(0));
    expect(vaultStateAt(12)).toEqual(vaultStateAt(1));
  });
});
