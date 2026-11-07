"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import { TEXT_LIMITS_BYTES, utf8Length } from "@tender/shared";
import { Button } from "../ui/button.tsx";
import { SelectField, TextAreaField, TextField } from "../ui/field.tsx";

export type PreviewBid = {
  price: string;
  deliveryDays: string;
  methodology: string;
};

const deliveryOptions = [
  { value: "14", label: "14 days" },
  { value: "21", label: "21 days" },
  { value: "30", label: "30 days" },
] as const;

export function PreviewBidForm({
  onReview,
}: {
  onReview: (bid: PreviewBid) => void;
}) {
  const [price, setPrice] = useState("12000");
  const [deliveryDays, setDeliveryDays] = useState("21");
  const [methodology, setMethodology] = useState(
    "We will review cross-contract calls and callback permissions, test failure paths, and deliver a written report with one retest of fixes.",
  );
  const [submitted, setSubmitted] = useState(false);
  const bytes = utf8Length(methodology);
  const parts = price.split(".");
  const priceMinor = /^\d+(\.\d{1,6})?$/.test(price)
    ? BigInt(parts[0] ?? "0") * 1_000_000n +
      BigInt((parts[1] ?? "").padEnd(6, "0"))
    : null;
  const priceError =
    priceMinor === null || priceMinor === 0n
      ? "Enter a positive price with up to 6 decimal places."
      : priceMinor > 15_000_000_000n
        ? "Your price exceeds the 15,000 tUSDC budget cap."
        : undefined;
  const methodologyError = !methodology.trim()
    ? "Describe how you will complete the review."
    : bytes > TEXT_LIMITS_BYTES.methodology
      ? `Remove ${bytes - TEXT_LIMITS_BYTES.methodology} bytes to fit the limit.`
      : undefined;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    if (priceError || methodologyError) {
      const invalid = priceError
        ? event.currentTarget.querySelector<HTMLInputElement>(
            'input[inputmode="decimal"]',
          )
        : event.currentTarget.querySelector<HTMLTextAreaElement>("textarea");
      invalid?.focus();
      return;
    }
    onReview({ price, deliveryDays, methodology });
  }

  return (
    <form className="review-bid-form ui-paper" onSubmit={submit}>
      <div className="review-form-heading">
        <div>
          <h3>Bid details</h3>
          <p>Price, delivery and review methodology.</p>
        </div>
      </div>
      <div className="review-form-pair">
        <TextField
          label="Bid price"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          trailing="tUSDC"
          hint="Budget cap: 15,000 tUSDC"
          error={submitted ? priceError : undefined}
          required
        />
        <SelectField
          label="Delivery time"
          name="delivery_days"
          value={deliveryDays}
          onValueChange={setDeliveryDays}
          options={deliveryOptions}
          hint="Maximum: 30 days"
        />
      </div>
      <TextAreaField
        label="Methodology"
        rows={4}
        value={methodology}
        onChange={(event) => setMethodology(event.target.value)}
        hint={`${bytes.toLocaleString("en-US")} / ${TEXT_LIMITS_BYTES.methodology.toLocaleString("en-US")} bytes`}
        error={
          submitted || bytes > TEXT_LIMITS_BYTES.methodology
            ? methodologyError
            : undefined
        }
        required
      />
      <label className="ui-checkbox">
        <input type="checkbox" required defaultChecked />
        <span>I have read the published rubric.</span>
      </label>
      <div className="review-form-footer">
        <span>Preview form. Nothing is submitted.</span>
        <Button type="submit">Review bid</Button>
      </div>
    </form>
  );
}
