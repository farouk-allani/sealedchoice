import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATTACKS } from "../../config/attacks.ts";
import { prepareAttackReplay } from "./replay.ts";
import { viewCall } from "../near/rpc.ts";

vi.mock("../near/rpc.ts", () => ({ viewCall: vi.fn() }));
const rpc = vi.mocked(viewCall);
const outsider = "attacker.sealedchoice.testnet";
const buyer = "buyer.sealedchoice.testnet";
const vendor = "vendor-a.sealedchoice.testnet";
const tender = { status: "Paid", deadline_ns: "1", bond: "100000000000000000000000", committee: [{ account: buyer }] };
const record = (id: number) => {
  const found = ATTACKS.records.find((r) => r.id === id);
  if (!found) throw new Error("missing recorded attack");
  return found;
};
beforeEach(() => { rpc.mockReset(); });

describe("attack replay prerequisites", () => {
  it("requires the original early-close and copy state before offering a transaction", async () => {
    rpc.mockResolvedValue(tender);
    await expect(prepareAttackReplay(record(4), 6, outsider)).rejects.toThrow("open tender");
    await expect(prepareAttackReplay(record(5), 6, outsider)).rejects.toThrow("open tender");
  });
  it("requires an outsider for an outsider award", async () => {
    rpc.mockResolvedValue(tender);
    await expect(prepareAttackReplay(record(8), 6, buyer)).rejects.toThrow("outside");
    expect(await prepareAttackReplay(record(8), 6, outsider)).toMatchObject({ methodName: "propose_award", deposit: "0", args: { amount: "1", rationale: "" } });
  });
  it("requires committee membership and an evaluated tender for a missing rationale", async () => {
    rpc.mockResolvedValue(tender);
    await expect(prepareAttackReplay(record(9), 6, outsider)).rejects.toThrow("committee member");
    await expect(prepareAttackReplay(record(9), 6, buyer)).rejects.toThrow("evaluated tender");
  });
  it("never offers the redirect attempt to the actual winner, including a withdrawn storage slot", async () => {
    rpc.mockResolvedValueOnce({ ...tender, status: "Awarded" })
      .mockResolvedValueOnce({ bid_index: 0, accept_by_ns: "9999999999999999999" })
      .mockResolvedValueOnce({ slots: [2, 3] })
      .mockResolvedValueOnce([{ slot: 2, bidder: vendor, withdrawn: false, debrief_pubkey: "02" }]);
    await expect(prepareAttackReplay(record(10), 6, vendor)).rejects.toThrow("other than the awarded bidder");
  });
  it("copies the exact ciphertext and covers the bond using integer amounts", async () => {
    rpc.mockResolvedValueOnce({ ...tender, status: "Open", deadline_ns: "9999999999999999999" })
      .mockResolvedValueOnce([{ slot: 2, bidder: vendor, withdrawn: false, debrief_pubkey: "02" }])
      .mockResolvedValueOnce("recorded-ciphertext");
    const action = await prepareAttackReplay(record(5), 6, outsider);
    expect(action.args).toEqual({ tender_id: 6, ciphertext_b64: "recorded-ciphertext", debrief_pubkey: "02" });
    expect(BigInt(action.deposit)).toBe(200000000000000000000000n);
  });
  it("does not count an unevaluated failed tender as a second evaluation attempt", async () => {
    rpc.mockResolvedValue({ ...tender, status: "Failed" });
    await expect(prepareAttackReplay(record(7), 6, outsider)).rejects.toThrow("accepted evaluation");
  });
  it("propagates an RPC failure without constructing a transaction", async () => {
    rpc.mockRejectedValue(new Error("RPC unavailable"));
    await expect(prepareAttackReplay(record(8), 6, outsider)).rejects.toThrow("RPC unavailable");
  });
});
