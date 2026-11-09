import { describe, expect, it } from "vitest";
import { outlayerEvents, requireRefusal } from "./attack-outcome.ts";

const outcome = (status: unknown) => ({
  status, transaction_outcome: { id: "tx" }, receipts_outcome: [],
});
describe("attack evidence", () => {
  it("requires a real failed outcome and the exact contract code", () => {
    expect(requireRefusal(outcome({ Failure: { panic: "E_NOT_WINNER" } }), "E_NOT_WINNER")).toBe("tx");
    expect(() => requireRefusal(outcome({ SuccessValue: "" }), "E_NOT_WINNER")).toThrow("ATTACK SUCCEEDED");
    expect(() => requireRefusal(outcome({ Failure: "E_BAD_STATUS" }), "E_NOT_WINNER")).toThrow("unexpected refusal");
    expect(() => requireRefusal(outcome({ Failure: "E_NOT_WINNER_EXTRA" }), "E_NOT_WINNER")).toThrow();
    expect(() => requireRefusal(new Error("RPC timeout"), "E_NOT_WINNER")).toThrow();
  });
  it("distinguishes runtime method and private-callback refusals", () => {
    expect(requireRefusal(outcome({ Failure: { MethodResolveError: "MethodNotFound" } }), "MethodNotFound")).toBe("tx");
    expect(requireRefusal(outcome({ Failure: { panic: "Method on_evaluate is private" } }), "Private callback")).toBe("tx");
  });
  it("only accepts structured events emitted by OutLayer", () => {
    const event = 'EVENT_JSON:{"event":"execution_completed","data":{"request_id":42}}';
    const receipts_outcome = ["attacker.testnet", "outlayer.testnet"].map((executor_id) => ({
      outcome: { executor_id, logs: [event], status: {} },
    }));
    expect(outlayerEvents({ ...outcome({ SuccessValue: "bnVsbA==" }), receipts_outcome }, "outlayer.testnet"))
      .toEqual([{ event: "execution_completed", data: { request_id: 42 } }]);
  });
  it("retains the nested request_data used by live execution_requested events", () => {
    const event = 'EVENT_JSON:{"event":"execution_requested","data":[{"request_data":"{\\"request_id\\":42}"}]}';
    const raw = { ...outcome({ SuccessValue: "bnVsbA==" }), receipts_outcome: [{
      outcome: { executor_id: "outlayer.testnet", logs: [event], status: {} },
    }] };
    expect(JSON.parse(String(outlayerEvents(raw, "outlayer.testnet")[0]?.data.request_data))).toEqual({ request_id: 42 });
  });
});
