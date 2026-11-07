// The fixture is a real capture, not a hand-written sample: every view of tender 3 on
// `tenders.sealedchoice.testnet`, fetched 2026-11-07. If the contract's JSON ever stops matching
// these schemas, this test is what says so.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  attemptFailureReason,
  attemptOutcomeName,
  attemptSchema,
  acceptsBids,
  awardSchema,
  bidViewSchema,
  configViewSchema,
  evaluatorRefSchema,
  frozenSchema,
  isFinal,
  payoutStateName,
  tenderSchema,
} from "./schemas.ts";

const fixture = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/testnet-views.json", import.meta.url)), "utf8"),
) as Record<string, unknown>;

describe("contract view schemas against a real testnet capture", () => {
  it("parses get_config", () => {
    const config = configViewSchema.parse(fixture.get_config);
    expect(config.owner).toBe("sealedchoice.testnet");
    expect(config.secrets_ref.profile).toBe("sealedchoice");
    // A nanosecond value must survive as a string: 3e11 fits a double, but 1.79e18 does not.
    expect(config.min_deadline_delay_ns).toBe("300000000000");
  });

  it("parses get_evaluators", () => {
    const evaluators = z.array(evaluatorRefSchema).parse(fixture.get_evaluators);
    expect(evaluators.length).toBeGreaterThan(0);
    expect(evaluators[0]?.build_target).toBe("wasm32-wasip2");
  });

  it("parses a paid tender whole", () => {
    const tender = tenderSchema.parse(fixture.get_tender);
    expect(tender.id).toBe(3);
    expect(tender.status).toBe("Paid");
    expect(tender.deadline_ns).toBe("1793905570611000000");
    expect(BigInt(tender.deadline_ns)).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));
    expect(tender.tender_pubkey).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(tender.committee.map((m) => m.account)).toEqual([
      "buyer.sealedchoice.testnet",
      "reviewer.sealedchoice.testnet",
    ]);
    expect(tender.approvals_required).toBe(1);
    expect(tender.active_slots).toEqual([0, 1, 2]);
    expect(isFinal(tender)).toBe(true);
    expect(acceptsBids(tender)).toBe(false);
  });

  it("parses the bid list without ciphertexts", () => {
    const bids = z.array(bidViewSchema).parse(fixture.get_bids);
    expect(bids).toHaveLength(3);
    expect(bids.every((b) => !b.withdrawn && b.bond_settled)).toBe(true);
    expect(bids.every((b) => /^0[23][0-9a-f]{64}$/.test(b.debrief_pubkey))).toBe(true);
    expect(bids.map((b) => b.slot)).toEqual([0, 1, 2]);
  });

  it("parses the frozen bid set and its root", () => {
    const frozen = frozenSchema.parse(fixture.get_frozen);
    expect(frozen.slots).toEqual([0, 1, 2]);
    expect(frozen.leaves).toHaveLength(3);
    expect(frozen.root).toBe("0ff749f8542722171ccc14a1ecf2fa44c56bb039260a830539f23631eeb073ba");
  });

  it("parses an accepted attempt, whose outcome is a bare string", () => {
    const attempts = z.array(attemptSchema).parse(fixture.get_attempts);
    expect(attempts).toHaveLength(1);
    expect(attemptOutcomeName(attempts[0]!.outcome)).toBe("Accepted");
    expect(attemptFailureReason(attempts[0]!.outcome)).toBeNull();
  });

  it("parses an award that was paid out to a NEAR account", () => {
    const award = awardSchema.parse(fixture.get_award);
    expect(award.bid_index).toBe(0);
    expect(award.deviation).toBe(false);
    expect(award.approvals).toEqual(["buyer.sealedchoice.testnet"]);
    expect(payoutStateName(award.payout_state)).toBe("Paid");
    expect(award.payout).toEqual({ Near: { account: "vendor-a.sealedchoice.testnet" } });
  });

  it("parses the whole tender list", () => {
    const tenders = z.array(tenderSchema).parse(fixture.list_tenders);
    expect(tenders.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(tenders.map((t) => t.status)).toEqual(["Evaluated", "Evaluated", "Paid"]);
  });

  it("keeps the result as the exact string the contract stored", () => {
    const result = z.string().parse(fixture.get_result);
    // The hash of these bytes is what a verifier checks, so the app must not re-serialise it.
    expect(result).toContain('"tid":"3"');
    expect(JSON.parse(result).root).toBe(
      "0ff749f8542722171ccc14a1ecf2fa44c56bb039260a830539f23631eeb073ba",
    );
  });
});

describe("variant helpers", () => {
  it("reads a failed attempt's reason", () => {
    const attempt = attemptSchema.parse({
      n: 2,
      started_at_ns: "1793905581946878761",
      outcome: { Failed: { reason: "E_RESULT_REJECTED" } },
    });
    expect(attemptOutcomeName(attempt.outcome)).toBe("Failed");
    expect(attemptFailureReason(attempt.outcome)).toBe("E_RESULT_REJECTED");
  });

  it("names every payout state", () => {
    expect(payoutStateName("None")).toBe("None");
    expect(payoutStateName("PayoutRefunded")).toBe("PayoutRefunded");
    expect(payoutStateName({ PayingOut: { deposit_address: null } })).toBe("PayingOut");
    expect(payoutStateName({ PayoutFailed: { reason: "no storage" } })).toBe("PayoutFailed");
  });

  it("treats an open tender as biddable and not final", () => {
    const open = { status: "Open" } as const;
    expect(acceptsBids(open)).toBe(true);
    expect(isFinal(open)).toBe(false);
  });
});

describe("schemas refuse malformed chain data", () => {
  it("rejects an amount that arrived as a number", () => {
    const broken = { ...(fixture.get_tender as Record<string, unknown>), budget_cap: 15_000_000_000 };
    expect(tenderSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects a reader key that is not a compressed point", () => {
    const bids = fixture.get_bids as Record<string, unknown>[];
    const broken = { ...bids[0]!, debrief_pubkey: "04" + "ab".repeat(32) };
    expect(bidViewSchema.safeParse(broken).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    const broken = { ...(fixture.get_tender as Record<string, unknown>), status: "Refunded" };
    expect(tenderSchema.safeParse(broken).success).toBe(false);
  });
});
