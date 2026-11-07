import { describe, expect, it } from "vitest";
import {
  formatBp,
  formatNear,
  formatRelative,
  formatUnits,
  formatUtc,
  hasPassed,
  nearToYocto,
  nsToDate,
  shortAccount,
  shortHash,
  unitsToMinor,
} from "./format.ts";

describe("formatUnits", () => {
  it("formats the amounts tender 3 actually used", () => {
    expect(formatUnits("15000000000", 6)).toBe("15,000.00");
    expect(formatUnits("12000000000", 6)).toBe("12,000.00");
    expect(formatUnits("3000000000", 6)).toBe("3,000.00");
  });

  it("never rounds a digit away", () => {
    // 1.234567 at 6 decimals keeps every digit even though two are asked for.
    expect(formatUnits("1234567", 6)).toBe("1.234567");
    expect(formatUnits("1500000", 6)).toBe("1.50");
    expect(formatUnits("1000000", 6)).toBe("1.00");
  });

  it("handles amounts far past Number.MAX_SAFE_INTEGER", () => {
    expect(formatUnits("100000000000000000000000", 24)).toBe("0.10");
    expect(formatNear("100000000000000000000000")).toBe("0.10");
    expect(formatNear("296100000000000000000000")).toBe("0.2961");
  });

  it("formats zero and negatives", () => {
    expect(formatUnits(0n, 6)).toBe("0.00");
    expect(formatUnits(-1500000n, 6)).toBe("-1.50");
  });
});

describe("unitsToMinor", () => {
  it("is the inverse of the display amount", () => {
    expect(unitsToMinor("15000", 6)).toBe(15_000_000_000n);
    expect(unitsToMinor("1.5", 6)).toBe(1_500_000n);
    expect(unitsToMinor("0.000001", 6)).toBe(1n);
  });

  it("refuses more precision than the token has", () => {
    expect(() => unitsToMinor("1.0000001", 6)).toThrow(/decimal places/);
  });

  it("refuses anything that is not a positive decimal", () => {
    expect(() => unitsToMinor("-1", 6)).toThrow();
    expect(() => unitsToMinor("1e6", 6)).toThrow();
    expect(() => unitsToMinor("", 6)).toThrow();
  });
});

describe("nearToYocto", () => {
  it("converts whole and fractional NEAR", () => {
    expect(nearToYocto("1")).toBe(10n ** 24n);
    expect(nearToYocto("0.1")).toBe(10n ** 23n);
    expect(nearToYocto("0.0001")).toBe(10n ** 20n);
  });
});

describe("formatBp", () => {
  it("renders tender 3's totals", () => {
    expect(formatBp(8666)).toBe("86.66");
    expect(formatBp(4755)).toBe("47.55");
    expect(formatBp(4500)).toBe("45.00");
    expect(formatBp(10000)).toBe("100.00");
    expect(formatBp(0)).toBe("0.00");
  });
});

describe("timestamps", () => {
  const deadline = "1793905570611000000"; // tender 3's deadline

  it("converts nanoseconds without losing the millisecond", () => {
    expect(nsToDate(deadline).toISOString()).toBe("2026-11-05T19:06:10.611Z");
  });

  it("always prints UTC", () => {
    expect(formatUtc(deadline)).toBe("05 Nov 2026 19:06 UTC");
  });

  it("says how long ago, relative to a fixed now", () => {
    const now = new Date("2026-11-07T19:06:10.611Z");
    expect(formatRelative(deadline, now)).toBe("2 days ago");
    expect(formatRelative("1793905570611000000", new Date("2026-11-05T19:07:10.611Z"))).toBe(
      "1 minute ago",
    );
  });

  it("says how long until, for a deadline still ahead", () => {
    const now = new Date("2026-11-05T16:06:10.611Z");
    expect(formatRelative(deadline, now)).toBe("in 3 hours");
  });

  it("knows whether the deadline has passed", () => {
    expect(hasPassed(deadline, new Date("2026-11-06T00:00:00Z"))).toBe(true);
    expect(hasPassed(deadline, new Date("2026-11-05T00:00:00Z"))).toBe(false);
  });
});

describe("shortening", () => {
  it("keeps both ends of a hash", () => {
    const hash = "5667a8005b1a2e9531366dedfc63ecb031625ff64fbf16fe01a29ab37dd2080c";
    expect(shortHash(hash)).toBe("5667a800…d2080c");
    expect(shortHash("abcd")).toBe("abcd");
  });

  it("shows a testnet account in full", () => {
    expect(shortAccount("vendor-a.sealedchoice.testnet")).toBe("vendor-a.sealedchoice.testnet");
  });

  it("cuts an account too long for a cell at its first label", () => {
    expect(shortAccount("a".repeat(50) + ".testnet")).toBe(`${"a".repeat(50)}…`);
  });
});
