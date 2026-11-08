// Display helpers. Every amount and every timestamp arrives as a decimal string, and every one
// of them is wider than a double, so nothing here turns one into a number: bigint in, string out
// (CLAUDE.md, integers only).

/** yoctoNEAR in one NEAR. */
const YOCTO = 10n ** 24n;

/**
 * Minor units to a human amount, by integer arithmetic. `12000000000` at 6 decimals is
 * "12,000.00". Trailing zeros past `maxFraction` are dropped, but the value is never rounded:
 * a digit that would be lost is kept.
 */
export function formatUnits(raw: bigint | string, decimals: number, maxFraction = 2): string {
  const value = typeof raw === "bigint" ? raw : BigInt(raw);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const unit = 10n ** BigInt(decimals);
  const whole = absolute / unit;
  const fraction = absolute % unit;

  let fractionText = fraction.toString().padStart(decimals, "0");
  // Keep every significant digit, but show at least `maxFraction` of them.
  const significant = fractionText.replace(/0+$/, "");
  fractionText = significant.padEnd(Math.min(maxFraction, decimals), "0");

  const wholeText = whole.toLocaleString("en-US");
  const sign = negative ? "-" : "";
  return fractionText === "" ? `${sign}${wholeText}` : `${sign}${wholeText}.${fractionText}`;
}

/**
 * Minor units to a plain decimal with no grouping, for a form field whose value is parsed back.
 * `formatUnits` is for reading; this is for round-tripping.
 */
export function plainUnits(raw: bigint | string, decimals: number, maxFraction = 2): string {
  return formatUnits(raw, decimals, maxFraction).replace(/,/g, "");
}

/** yoctoNEAR to a NEAR amount, for bonds and fees. */
export function formatNear(yocto: bigint | string, maxFraction = 2): string {
  return formatUnits(yocto, 24, maxFraction);
}

/** Whole NEAR as a bigint of yocto, for building a deposit. */
export function nearToYocto(near: string): bigint {
  const [whole = "0", fraction = ""] = near.split(".");
  const padded = fraction.padEnd(24, "0").slice(0, 24);
  return BigInt(whole) * YOCTO + BigInt(padded || "0");
}

/**
 * A decimal amount in a token's display units to its minor units. "1.5" at 6 decimals.
 *
 * Grouping separators are stripped first, because `formatUnits` puts them in ("11,800.00") and
 * anything that pre-fills a field from it, or any person who types an amount the way they read it,
 * would otherwise hand this a string it refuses. T11 hit exactly that: the committee form
 * pre-filled the award amount from `formatUnits` and then called its own amount not a number.
 */
export function unitsToMinor(amount: string, decimals: number): bigint {
  const trimmed = amount.trim().replace(/[,_\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) throw new RangeError(`not a positive decimal: ${amount}`);
  const [whole = "0", fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new RangeError(`more than ${decimals} decimal places: ${amount}`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** Basis points as a percentage string. 8666 is "86.66". */
export function formatBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const fraction = Math.abs(bp % 100);
  return `${whole}.${String(fraction).padStart(2, "0")}`;
}

/** Nanoseconds since the epoch to a Date. Milliseconds fit a double; nanoseconds do not. */
export function nsToDate(ns: bigint | string): Date {
  const value = typeof ns === "bigint" ? ns : BigInt(ns);
  return new Date(Number(value / 1_000_000n));
}

const UTC_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * An absolute UTC timestamp. Always UTC, never the reader's zone: a deadline that looks
 * different on two screens is a deadline someone will miss.
 */
export function formatUtc(ns: bigint | string): string {
  return `${UTC_FORMAT.format(nsToDate(ns)).replace(",", "")} UTC`;
}

/** "in 2 days", "4 hours ago". `now` is injectable so the result can be tested. */
export function formatRelative(ns: bigint | string, now: Date = new Date()): string {
  const target = nsToDate(ns).getTime();
  const deltaSeconds = Math.round((target - now.getTime()) / 1000);
  const past = deltaSeconds < 0;
  const seconds = Math.abs(deltaSeconds);

  const units: [limit: number, size: number, name: string][] = [
    [60, 1, "second"],
    [3600, 60, "minute"],
    [86_400, 3600, "hour"],
    [2_592_000, 86_400, "day"],
    [31_536_000, 2_592_000, "month"],
    [Number.POSITIVE_INFINITY, 31_536_000, "year"],
  ];
  const [, size, name] = units.find(([limit]) => seconds < limit) ?? units[units.length - 1]!;
  const count = Math.max(1, Math.round(seconds / size));
  const plural = count === 1 ? name : `${name}s`;
  return past ? `${count} ${plural} ago` : `in ${count} ${plural}`;
}

/** True once the deadline has passed. */
export function hasPassed(ns: bigint | string, now: Date = new Date()): boolean {
  return nsToDate(ns).getTime() <= now.getTime();
}

/** A hash with its middle removed. The full value stays available to copy. */
export function shortHash(hash: string, head = 8, tail = 6): string {
  return hash.length <= head + tail + 1 ? hash : `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/**
 * An account id short enough for a table cell, cut at the first label. The default fits
 * `vendor-a.sealedchoice.testnet`, which is 29 characters: a shorter cut hid every account
 * the demo uses behind an ellipsis.
 */
export function shortAccount(accountId: string, max = 40): string {
  if (accountId.length <= max) return accountId;
  const [first = accountId] = accountId.split(".");
  return `${first}…`;
}
