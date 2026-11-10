import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AwardPanel, type AwardPanelProps } from "./award-panel.tsx";

vi.mock("../../lib/wallet/wallet-provider.tsx", () => ({
  useWallet: () => ({ accountId: null }),
}));

const approved: AwardPanelProps = {
  tenderId: 1,
  winner: "winner.testnet",
  amountMinor: "12000000000",
  rationale: "Recorded committee note.",
  deviation: false,
  approvals: ["buyer.testnet"],
  approvalsRequired: 1,
  approvedAtNs: "1",
  acceptByNs: "4102444800000000000",
  payoutState: "None",
  payoutAccount: null,
  status: "Awarded",
};

function render(overrides: Partial<AwardPanelProps>) {
  return renderToStaticMarkup(createElement(AwardPanel, { ...approved, ...overrides }));
}

describe("award instructions follow the recorded payment state", () => {
  it("does not ask a paid winner to accept, even when the original deadline is in the future", () => {
    const html = render({ status: "Paid", payoutState: "Paid", payoutAccount: "recipient.testnet" });
    expect(html).toContain("Payment complete");
    expect(html).toContain("recipient.testnet");
    expect(html).not.toContain("Accept by");
    expect(html).not.toContain("Connect that wallet");
  });

  it("does not call a paid award expired after its original acceptance deadline", () => {
    const html = render({ status: "Paid", payoutState: "Paid", acceptByNs: "1" });
    expect(html).toContain("Payment complete");
    expect(html).not.toContain("Acceptance window expired");
  });

  it("shows the deadline and required wallet only for an approved pending award", () => {
    const html = render({});
    expect(html).toContain("Accept by");
    expect(html).toContain("Only winner.testnet can accept");
  });

  it("does not prompt wallet connection after the acceptance window expires", () => {
    const html = render({ acceptByNs: "1" });
    expect(html).toContain("Acceptance window expired");
    expect(html).not.toContain("Connect that wallet");
  });

  it("distinguishes a proposal without enough approvals from an award ready to accept", () => {
    const html = render({ approvedAtNs: null, approvals: [], acceptByNs: null, status: "Evaluated" });
    expect(html).toContain("Awaiting committee approval");
    expect(html).not.toContain("Accept by");
  });

  it("keeps a deviation and the committee's published rationale visible after payment", () => {
    const html = render({ status: "Paid", payoutState: "Paid", deviation: true });
    expect(html).toContain("Deviation from ranking");
    expect(html).toContain("Recorded committee note.");
  });

  it("explains a transfer failure without offering a second acceptance", () => {
    const html = render({ status: "PayingOut", payoutState: { PayoutFailed: { reason: "E_TRANSFER" } } });
    expect(html).toContain("Payment needs attention");
    expect(html).toContain("E_TRANSFER");
    expect(html).not.toContain("Accept by");
  });

  it("keeps an unawarded tender useful without a wallet", () => {
    const html = render({ winner: null });
    expect(html).toContain("No award yet");
    expect(html).toContain('href="/tenders/1"');
  });
});
