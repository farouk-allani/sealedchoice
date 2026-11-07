import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { bidViewSchema, tenderSchema } from "../near/schemas.ts";
import type { Award, BidView } from "../near/schemas.ts";
import { parseResult, parseRubric, rankedBids, rankingRows, tenderTitle } from "./view-model.ts";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("../near/fixtures/testnet-views.json", import.meta.url)), "utf8"),
) as Record<string, unknown>;

const tender3 = tenderSchema.parse(fixture.get_tender);
const bids3 = z.array(bidViewSchema).parse(fixture.get_bids);

function bid(slot: number, bidder: string): BidView {
  return {
    slot,
    bidder,
    submitted_at_ns: `${1_793_905_282_979_855_059n + BigInt(slot)}`,
    ciphertext_sha256: "a".repeat(64),
    ciphertext_len: 500,
    debrief_pubkey: `02${"b".repeat(64)}`,
    bond: "100000000000000000000000",
    withdrawn: false,
    bond_settled: false,
  };
}

describe("parseRubric", () => {
  it("parses the rubric tender 3 actually stores", () => {
    const { rubric, error } = parseRubric(tender3.rubric_json);
    expect(error).toBeNull();
    expect(rubric?.criteria).toHaveLength(3);
    expect(rubric?.models).toHaveLength(2);
    expect(tenderTitle(rubric, 3)).toContain("Security review");
  });

  it("says so rather than guessing when the rubric is not JSON", () => {
    const { rubric, error } = parseRubric("{not json");
    expect(rubric).toBeNull();
    expect(error).toContain("not JSON");
  });

  it("says so when the rubric does not match the published schema", () => {
    const { rubric, error } = parseRubric(JSON.stringify({ v: 1, title: "x" }));
    expect(rubric).toBeNull();
    expect(error).toContain("published schema");
  });

  it("falls back to a title that does not pretend to be one", () => {
    expect(tenderTitle(null, 7)).toBe("Tender 7");
  });
});

describe("parseResult", () => {
  it("parses the accepted compact result", () => {
    const result = parseResult(tender3.result_json);
    expect(result?.tid).toBe("3");
    expect(result?.attempt).toBe(1);
    expect(result?.rk).toEqual([
      [0, 8666, 0],
      [1, 4755, 0],
      [2, 4500, 8],
    ]);
  });

  it("returns null rather than throwing when there is no result", () => {
    expect(parseResult(null)).toBeNull();
    expect(parseResult("{}")).toBeNull();
  });
});

describe("rankedBids joins the ranking to the bidders", () => {
  it("reproduces tender 3: vendor-a first and awarded, vendor-c flagged", () => {
    const result = parseResult(tender3.result_json);
    const ranked = rankedBids(result, bids3, tender3.frozen?.slots ?? null, tender3.award);

    expect(ranked.map((r) => r.bid?.bidder)).toEqual([
      "vendor-a.sealedchoice.testnet",
      "vendor-b.sealedchoice.testnet",
      "vendor-c.sealedchoice.testnet",
    ]);
    expect(ranked[0]?.awarded).toBe(true);
    expect(ranked[0]?.totalBp).toBe(8666);
    expect(ranked[2]?.flags).toEqual(["INJECTION_SUSPECTED"]);
    expect(ranked[1]?.flags).toEqual([]);
  });

  it("joins through frozen.slots, not through the slot number", () => {
    // Four bids, slot 0 withdrawn before close. The frozen set is [1, 2, 3], so result index 2
    // means slot 3. Reading the index as a slot would credit slot 2's bidder instead, which is
    // the mistake this test exists to catch (see PROGRESS, the accept_award finding).
    const bids = [bid(0, "withdrawn.testnet"), bid(1, "a.testnet"), bid(2, "b.testnet"), bid(3, "c.testnet")];
    bids[0]!.withdrawn = true;
    const frozenSlots = [1, 2, 3];
    const result = {
      v: 1 as const,
      tid: "9",
      root: "0".repeat(64),
      rubric: "1".repeat(64),
      bundle: "2".repeat(64),
      attempt: 1 as const,
      status: "ok" as const,
      rk: [
        [2, 9000, 0],
        [0, 5000, 0],
        [1, 1000, 0],
      ] as [number, number, number][],
    };
    const award: Award = {
      bid_index: 2,
      amount: "1",
      rationale: "top of the ranking",
      deviation: false,
      approvals: ["buyer.testnet"],
      approved_at_ns: "1",
      accept_by_ns: "2",
      lapsed: [],
      payout: null,
      payout_state: "None",
    };

    const ranked = rankedBids(result, bids, frozenSlots, award);
    expect(ranked[0]?.bidIndex).toBe(2);
    expect(ranked[0]?.bid?.bidder).toBe("c.testnet");
    expect(ranked[0]?.bid?.slot).toBe(3);
    expect(ranked[0]?.awarded).toBe(true);
    expect(ranked[1]?.bid?.bidder).toBe("a.testnet");
    expect(ranked[2]?.bid?.bidder).toBe("b.testnet");
  });

  it("shows a rank with no bidder rather than the wrong one when the join fails", () => {
    const result = parseResult(tender3.result_json);
    const ranked = rankedBids(result, bids3, null, null);
    expect(ranked).toHaveLength(3);
    expect(ranked.every((r) => r.bid === null)).toBe(true);
    expect(rankingRows(ranked)[0]?.label).toBe("Bid 1");
  });

  it("is empty when there is no result", () => {
    expect(rankedBids(null, bids3, [0, 1, 2], null)).toEqual([]);
  });

  it("does not call a bid awarded until the committee has approved it", () => {
    const result = parseResult(tender3.result_json);
    const pending: Award = { ...tender3.award!, approvals: [] };
    const ranked = rankedBids(result, bids3, tender3.frozen?.slots ?? null, pending);
    expect(ranked.every((r) => !r.awarded)).toBe(true);
  });
});

describe("rankingRows", () => {
  it("marks the awarded row, the flagged rows and the rest", () => {
    const result = parseResult(tender3.result_json);
    const rows = rankingRows(
      rankedBids(result, bids3, tender3.frozen?.slots ?? null, tender3.award),
    );
    expect(rows.map((r) => r.outcome)).toEqual(["awarded", "ranked", "flagged"]);
    expect(rows[2]?.flags).toEqual(["INJECTION_SUSPECTED"]);
    expect(rows[0]?.label).toBe("vendor-a.sealedchoice.testnet");
  });
});
