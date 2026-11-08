/**
 * The award rules the committee form relies on.
 *
 * These matter more than they look: the form uses them to decide whether to demand a rationale,
 * and the contract decides the same question again in `propose_award`. If the two ever disagree,
 * a member writes a rationale the contract rejects, or omits one it demands, and finds out only
 * after signing. Every case here is read off `contracts/tender/src/award.rs`.
 */
import { describe, expect, it } from "vitest";
import { MIN_DEVIATION_RATIONALE_CHARS, checkAward, recommendedOf } from "./committee.ts";
import { FLAG } from "./scoring.ts";

const CAP = 15_000_000_000n;
/** Bid 0 top, bid 1 next, bid 2 ineligible. */
const RANKING = [
  [0, 8666, 0],
  [1, 4755, 0],
  [2, 0, FLAG.INELIGIBLE],
] as const;

const intent = (bidIndex: number, rationale = "", amountMinor = 11_000_000_000n) => ({
  bidIndex,
  amountMinor,
  rationale,
});
const opts = (lapsed: readonly number[] = []) => ({ ranking: RANKING, budgetCapMinor: CAP, lapsed });

describe("recommendedOf", () => {
  it("is the first eligible entry", () => {
    expect(recommendedOf(RANKING, [])).toBe(0);
  });

  it("skips an ineligible entry even when it ranks first", () => {
    expect(recommendedOf([[2, 9999, FLAG.INELIGIBLE], [1, 10, 0]], [])).toBe(1);
  });

  // After a lapse the next bid is the natural winner, so awarding it is not a deviation.
  it("moves on after a lapse", () => {
    expect(recommendedOf(RANKING, [0])).toBe(1);
  });

  it("is null when every entry is ineligible or lapsed", () => {
    expect(recommendedOf(RANKING, [0, 1])).toBeNull();
  });
});

describe("checkAward", () => {
  it("accepts the top eligible bid with no rationale at all", () => {
    expect(checkAward(intent(0), opts())).toEqual({ deviation: false, errors: [] });
  });

  it("calls anything else a deviation and demands a rationale", () => {
    const r = checkAward(intent(1), opts());
    expect(r.deviation).toBe(true);
    expect(r.errors.join(" ")).toContain("E_RATIONALE_REQUIRED");
  });

  it("accepts a deviation once the rationale is long enough", () => {
    const r = checkAward(intent(1, "x".repeat(MIN_DEVIATION_RATIONALE_CHARS)), opts());
    expect(r).toEqual({ deviation: true, errors: [] });
  });

  it("counts the rationale one character short as too short", () => {
    const r = checkAward(intent(1, "x".repeat(MIN_DEVIATION_RATIONALE_CHARS - 1)), opts());
    expect(r.errors.join(" ")).toContain("E_RATIONALE_REQUIRED");
  });

  // Rust counts chars, not UTF-16 units, so a rationale of 20 emoji is long enough even though
  // `String.length` would say 40. Counting it the other way would let the form accept something
  // the contract refuses, or refuse something it accepts.
  it("counts code points, the way the contract counts chars", () => {
    const emoji = "\u{1F600}".repeat(MIN_DEVIATION_RATIONALE_CHARS);
    expect(emoji.length).toBe(MIN_DEVIATION_RATIONALE_CHARS * 2);
    expect(checkAward(intent(1, emoji), opts()).errors).toEqual([]);
  });

  it("refuses an ineligible bid however good the rationale is", () => {
    const r = checkAward(intent(2, "a very carefully written and quite long rationale"), opts());
    expect(r.errors.join(" ")).toContain("E_BID_INELIGIBLE");
  });

  it("refuses a bid that is not in the result", () => {
    expect(checkAward(intent(9), opts()).errors.join(" ")).toContain("E_NO_SUCH_BID");
  });

  it("refuses a lapsed bid", () => {
    const r = checkAward(intent(0, "a long enough rationale here"), opts([0]));
    expect(r.errors.join(" ")).toContain("E_BID_LAPSED");
  });

  it("stops asking for a rationale once the top bid has lapsed", () => {
    expect(checkAward(intent(1), opts([0]))).toEqual({ deviation: false, errors: [] });
  });

  it("refuses an amount above the budget cap", () => {
    const r = checkAward(intent(0, "", CAP + 1n), opts());
    expect(r.errors.join(" ")).toContain("E_BAD_AMOUNT");
  });

  it("accepts exactly the cap", () => {
    expect(checkAward(intent(0, "", CAP), opts()).errors).toEqual([]);
  });

  it("refuses zero", () => {
    expect(checkAward(intent(0, "", 0n), opts()).errors.join(" ")).toContain("E_BAD_AMOUNT");
  });

  it("reports every problem at once, not just the first", () => {
    const r = checkAward(intent(2, "", CAP + 1n), opts());
    expect(r.errors.length).toBeGreaterThan(1);
  });
});
