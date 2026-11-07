"use client";

// Submitting a sealed bid. Everything secret happens here, in the page:
//
//   plaintext -> JCS bytes -> ECIES to the tender key -> submit_bid
//
// The debrief key is derived from a NEP-413 signature (docs/05, measured at G5) and its private
// half never leaves this component. The bid text never leaves it either, except as ciphertext.
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import {
  ECIES_OVERHEAD_BYTES,
  MAX_CIPHERTEXT_BYTES,
  TEXT_LIMITS_BYTES,
  utf8Length,
} from "@tender/shared";
import {
  BidValidationError,
  buildBidPlaintext,
  eciesEncrypt,
  isCompressedPublicKeyHex,
  sha256Hex,
  toBase64,
} from "@tender/crypto";
import { Button } from "../ui/button.tsx";
import { TextAreaField, TextField } from "../ui/field.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { Notice } from "./transaction-notice.tsx";
import { FlowSteps } from "./flow-steps.tsx";
import { Icon } from "../ui/icon.tsx";
import {
  CONTRACT_ID,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
} from "../../config/demo.ts";
import { explorerTx } from "../../config/evidence.ts";
import { bidReceiptSchema } from "../../lib/near/schemas.ts";
import {
  formatNear,
  formatUnits,
  shortHash,
  unitsToMinor,
} from "../../lib/tender/format.ts";
import { deriveReaderKeyFromWallet } from "../../lib/wallet/reader-key.ts";
import { TGAS, useWallet } from "../../lib/wallet/wallet-provider.tsx";

export interface BidFormProps {
  tenderId: number;
  tenderPubkey: string;
  budgetCapMinor: string;
  bondYocto: string;
  maxDeliveryDays: number;
  deadlineUtc: string;
}

type Stage = "form" | "sealed" | "submitted";

interface Sealed {
  bidder: string;
  priceMinor: bigint;
  plaintextBytes: number;
  ciphertextB64: string;
  ciphertextBytes: number;
  ciphertextSha256: string;
  debriefPubkey: string;
}

interface Receipt {
  txHash: string;
  slot: number | null;
  ciphertextSha256: string;
  submittedAtNs: string | null;
}

/** Storage the contract will charge, with room to spare. Any excess is refunded by submit_bid. */
function storageMargin(ciphertextBytes: number): bigint {
  const perByte = 10n ** 19n;
  return BigInt(ciphertextBytes + 1024) * perByte;
}

export function BidForm(props: BidFormProps) {
  const wallet = useWallet();
  const [price, setPrice] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("");
  const [methodology, setMethodology] = useState("");
  const [trackRecord, setTrackRecord] = useState("");
  const [touched, setTouched] = useState(false);
  const [stage, setStage] = useState<Stage>("form");
  const [busy, setBusy] = useState<null | "sealing" | "submitting">(null);
  const [error, setError] = useState<string | null>(null);
  const [sealed, setSealed] = useState<Sealed | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const stageHeading = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (stage !== "form") stageHeading.current?.focus();
  }, [stage]);

  const methodologyBytes = utf8Length(methodology);
  const trackRecordBytes = utf8Length(trackRecord);

  const priceMinor = useMemo(() => {
    try {
      return unitsToMinor(price, TOKEN_DECIMALS);
    } catch {
      return null;
    }
  }, [price]);

  const priceError =
    price.trim() === ""
      ? "Enter your price."
      : priceMinor === null
        ? `Enter a positive amount with at most ${TOKEN_DECIMALS} decimal places.`
        : priceMinor === 0n
          ? "Enter a price above zero."
          : priceMinor > BigInt(props.budgetCapMinor)
            ? `Above the budget cap of ${formatUnits(props.budgetCapMinor, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}.`
            : undefined;

  const deliveryNumber = /^\d{1,4}$/.test(deliveryDays.trim())
    ? Number(deliveryDays)
    : null;
  const deliveryError =
    deliveryDays.trim() === ""
      ? "Enter the number of days."
      : deliveryNumber === null || deliveryNumber < 1
        ? "Enter a whole number of days, at least 1."
        : deliveryNumber > props.maxDeliveryDays
          ? `The rubric allows at most ${props.maxDeliveryDays} days.`
          : undefined;

  const methodologyError =
    methodology.trim() === ""
      ? "Describe how you will do the work."
      : methodologyBytes > TEXT_LIMITS_BYTES.methodology
        ? `Remove ${methodologyBytes - TEXT_LIMITS_BYTES.methodology} bytes to fit the limit.`
        : undefined;

  const trackRecordError =
    trackRecord.trim() === ""
      ? "Give at least one piece of relevant experience."
      : trackRecordBytes > TEXT_LIMITS_BYTES.track_record
        ? `Remove ${trackRecordBytes - TEXT_LIMITS_BYTES.track_record} bytes to fit the limit.`
        : undefined;

  /**
   * The size that matters is the JCS bytes plus the ECIES overhead, not the characters typed.
   * JSON escaping of quotes and newlines can push text that looks short over the ciphertext
   * limit, so the counter is built from the real encoding (T01 reviewer finding).
   */
  const projected = useMemo(() => {
    if (!wallet.accountId || priceMinor === null || deliveryNumber === null)
      return null;
    try {
      const built = buildBidPlaintext({
        tender_id: String(props.tenderId),
        bidder: wallet.accountId,
        price_minor: priceMinor.toString(),
        delivery_days: deliveryNumber,
        methodology: methodology || " ",
        track_record: trackRecord || " ",
      });
      return built.bytes.length + ECIES_OVERHEAD_BYTES;
    } catch {
      return null;
    }
  }, [
    wallet.accountId,
    priceMinor,
    deliveryNumber,
    methodology,
    trackRecord,
    props.tenderId,
  ]);

  const formInvalid = Boolean(
    priceError || deliveryError || methodologyError || trackRecordError,
  );

  async function seal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (formInvalid || priceMinor === null || deliveryNumber === null) {
      requestAnimationFrame(() =>
        form.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"]')
          ?.focus(),
      );
      return;
    }
    if (!wallet.accountId) {
      setError(
        "Connect a wallet first. Your bid is encrypted to this tender and signed by you.",
      );
      return;
    }
    // A tender key that is not a point on the curve cannot encrypt anything, and finding that
    // out after the wallet prompt would waste a signature (I15 is the contract's side of this).
    if (!isCompressedPublicKeyHex(props.tenderPubkey)) {
      setError(
        "This tender's key is not a valid secp256k1 point, so a bid cannot be sealed to it.",
      );
      return;
    }

    setBusy("sealing");
    try {
      const built = buildBidPlaintext({
        tender_id: String(props.tenderId),
        bidder: wallet.accountId,
        price_minor: priceMinor.toString(),
        delivery_days: deliveryNumber,
        methodology,
        track_record: trackRecord,
      });

      const key = await deriveReaderKeyFromWallet(wallet.signMessage, {
        purpose: "debrief",
        contractId: CONTRACT_ID,
        tenderId: String(props.tenderId),
        accountId: wallet.accountId,
      });
      key.secretKey.fill(0); // Only the public half is needed to submit.

      const ciphertext = eciesEncrypt(props.tenderPubkey, built.bytes);
      setSealed({
        bidder: wallet.accountId,
        priceMinor,
        plaintextBytes: built.bytes.length,
        ciphertextB64: toBase64(ciphertext),
        ciphertextBytes: ciphertext.length,
        ciphertextSha256: sha256Hex(ciphertext),
        debriefPubkey: key.publicKeyHex,
      });
      setStage("sealed");
    } catch (e) {
      setError(
        e instanceof BidValidationError
          ? e.issues.map((i) => `${i.path}: ${i.message}`).join("; ")
          : e instanceof Error
            ? e.message
            : String(e),
      );
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    if (!sealed) return;
    if (wallet.accountId !== sealed.bidder) {
      setError(
        "Reconnect the wallet that sealed this bid, or return to the form and encrypt it with your current wallet.",
      );
      return;
    }
    setError(null);
    setBusy("submitting");
    try {
      const deposit =
        BigInt(props.bondYocto) + storageMargin(sealed.ciphertextBytes);
      const sent = await wallet.signAndSend({
        receiverId: CONTRACT_ID,
        actions: [
          {
            methodName: "submit_bid",
            args: {
              tender_id: props.tenderId,
              ciphertext_b64: sealed.ciphertextB64,
              debrief_pubkey: sealed.debriefPubkey,
            },
            gas: TGAS(100),
            deposit: deposit.toString(),
          },
        ],
      });
      const parsed = bidReceiptSchema.safeParse(sent.result);
      setReceipt({
        txHash: sent.hash,
        slot: parsed.success ? parsed.data.slot : null,
        ciphertextSha256: parsed.success
          ? parsed.data.ciphertext_sha256
          : sealed.ciphertextSha256,
        submittedAtNs: parsed.success ? parsed.data.submitted_at_ns : null,
      });
      setStage("submitted");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function downloadReceipt() {
    if (!receipt || !sealed) return;
    const body = {
      format: "sealedchoice-bid-receipt",
      v: 1,
      network_contract: CONTRACT_ID,
      tender_id: props.tenderId,
      bidder: sealed.bidder,
      slot: receipt.slot,
      tx_hash: receipt.txHash,
      ciphertext_sha256: receipt.ciphertextSha256,
      ciphertext_bytes: sealed.ciphertextBytes,
      debrief_pubkey: sealed.debriefPubkey,
      submitted_at_ns: receipt.submittedAtNs,
      note:
        "Keep this. It is what you check your bid against once the bid set is frozen: your " +
        "leaf is built from your account, this timestamp and this ciphertext hash.",
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `sealedchoice-bid-${props.tenderId}-${sealed.bidder}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (stage === "submitted" && receipt && sealed) {
    return (
      <div className="panel ui-paper">
        <FlowSteps
          labels={["Write your bid", "Review & submit", "Receipt"]}
          current={2}
        />
        <div className="completion-heading">
          <Icon name="check" size={28} />
          <h2 ref={stageHeading} tabIndex={-1}>
            Your bid has been submitted
          </h2>
        </div>
        <Notice tone="success" title="Your sealed bid is on chain">
          Nobody can read it until the deadline passes and the evaluator opens
          it inside the TEE.
        </Notice>
        <p className="panel-note">
          Save your receipt, then return after the deadline to follow
          evaluation. Use the same wallet to access your private debrief when it
          is available.
        </p>
        <dl className="facts">
          <dt>Transaction</dt>
          <dd>
            <a
              className="inline-link"
              href={explorerTx(receipt.txHash)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {shortHash(receipt.txHash)}
            </a>
          </dd>
          {receipt.slot !== null && (
            <>
              <dt>Slot</dt>
              <dd>{receipt.slot}</dd>
            </>
          )}
          <dt>Ciphertext hash</dt>
          <dd>
            <span className="mono">{shortHash(receipt.ciphertextSha256)}</span>{" "}
            <CopyButton
              value={receipt.ciphertextSha256}
              label="Copy ciphertext hash"
              compact
            />
          </dd>
          <dt>Debrief key</dt>
          <dd>
            <span className="mono">{shortHash(sealed.debriefPubkey)}</span>{" "}
            <CopyButton
              value={sealed.debriefPubkey}
              label="Copy debrief key"
              compact
            />
          </dd>
        </dl>
        <p className="panel-note">
          Your debrief is encrypted to that key. You re-derive its private half
          by signing the same message with the same wallet, so there is nothing
          to store. Keep the receipt to check your leaf against the frozen bid
          set.
        </p>
        <div className="form-actions">
          <Button onClick={downloadReceipt} variant="secondary">
            Save the receipt
          </Button>
          <Link
            className="ui-button ui-button--primary ui-button--medium"
            href={`/tenders/${props.tenderId}`}
          >
            Back to the tender
          </Link>
        </div>
      </div>
    );
  }

  if (stage === "sealed" && sealed) {
    return (
      <div className="panel ui-paper">
        <FlowSteps
          labels={["Write your bid", "Review & submit", "Receipt"]}
          current={1}
        />
        <h2 ref={stageHeading} tabIndex={-1}>
          Review your sealed bid
        </h2>
        <p>
          Your bid is encrypted. What goes on chain is the ciphertext below and
          its hash. The price and your text are not on chain in readable form,
          and nothing is submitted until you press the button.
        </p>
        <dl className="facts">
          <dt>Price</dt>
          <dd>
            {formatUnits(sealed.priceMinor, TOKEN_DECIMALS)} {TOKEN_SYMBOL}
          </dd>
          <dt>Bidder</dt>
          <dd>{sealed.bidder}</dd>
          <dt>Delivery</dt>
          <dd>{deliveryDays} days</dd>
        </dl>
        <details className="record-details">
          <summary>Review your proposal text</summary>
          <h3>Methodology</h3>
          <p className="review-prose">{methodology}</p>
          <h3>Track record</h3>
          <p className="review-prose">{trackRecord}</p>
        </details>
        <Notice tone="info" title="What your wallet will approve">
          A refundable bond of {formatNear(props.bondYocto)} NEAR plus up to{" "}
          {formatNear(storageMargin(sealed.ciphertextBytes))} NEAR for storage,
          and network fees. Excess storage deposit is returned. Your bid price
          is not charged now.
        </Notice>
        <details className="record-details">
          <summary>Encryption details</summary>
          <dl className="facts">
            <dt>Plaintext</dt>
            <dd>{sealed.plaintextBytes} bytes of canonical JSON</dd>
            <dt>Ciphertext</dt>
            <dd>
              {sealed.ciphertextBytes} of {MAX_CIPHERTEXT_BYTES} bytes allowed
            </dd>
            <dt>Ciphertext hash</dt>
            <dd>
              <span className="mono">{shortHash(sealed.ciphertextSha256)}</span>{" "}
              <CopyButton
                value={sealed.ciphertextSha256}
                label="Copy ciphertext hash"
                compact
              />
            </dd>
            <dt>Debrief key</dt>
            <dd>
              <span className="mono">{shortHash(sealed.debriefPubkey)}</span>
            </dd>
            <dt>Bond</dt>
            <dd>
              {formatNear(props.bondYocto)} NEAR, returned unless your bid
              cannot be decrypted or names another account
            </dd>
          </dl>
        </details>
        {error && (
          <Notice tone="danger" title="The bid was not submitted">
            {error}
          </Notice>
        )}
        <div className="form-actions">
          <Button
            variant="secondary"
            onClick={() => {
              setStage("form");
              setSealed(null);
            }}
            disabled={busy !== null}
          >
            Back to the form
          </Button>
          <Button onClick={() => void submit()} loading={busy === "submitting"}>
            Submit the sealed bid
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      ref={form}
      className="panel ui-paper"
      onSubmit={(event) => void seal(event)}
      noValidate
    >
      <FlowSteps
        labels={["Write your bid", "Review & submit", "Receipt"]}
        current={0}
      />
      <h2>Your proposal</h2>
      <p>
        Encrypted in this page to the tender key before anything is sent. The
        deadline is {props.deadlineUtc}.
      </p>

      {wallet.status !== "connected" && (
        <Notice tone="info" title="Prepare first, connect when you are ready">
          You can write your proposal now. Connect a wallet before encrypting
          and reviewing it.
          <div className="wallet-inline">
            <Button
              size="small"
              variant="secondary"
              onClick={() => void wallet.connect()}
            >
              Connect wallet to continue
            </Button>
          </div>
        </Notice>
      )}

      <div className="form-pair">
        <TextField
          label="Price"
          inputMode="decimal"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          trailing={TOKEN_SYMBOL}
          hint={`Budget cap ${formatUnits(props.budgetCapMinor, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`}
          error={touched ? priceError : undefined}
          required
        />
        <TextField
          label="Delivery"
          inputMode="numeric"
          value={deliveryDays}
          onChange={(event) => setDeliveryDays(event.target.value)}
          trailing="days"
          hint={`At most ${props.maxDeliveryDays} days`}
          error={touched ? deliveryError : undefined}
          required
        />
      </div>

      <TextAreaField
        label="Methodology"
        rows={6}
        value={methodology}
        placeholder="Describe your approach, the work you will deliver, and how you will handle risks."
        onChange={(event) => setMethodology(event.target.value)}
        hint={`${methodologyBytes.toLocaleString("en-US")} of ${TEXT_LIMITS_BYTES.methodology.toLocaleString("en-US")} bytes`}
        error={
          touched || methodologyBytes > TEXT_LIMITS_BYTES.methodology
            ? methodologyError
            : undefined
        }
        required
      />

      <TextAreaField
        label="Track record"
        rows={4}
        value={trackRecord}
        placeholder="Share relevant projects, your role, and specific outcomes."
        onChange={(event) => setTrackRecord(event.target.value)}
        hint={`${trackRecordBytes.toLocaleString("en-US")} of ${TEXT_LIMITS_BYTES.track_record.toLocaleString("en-US")} bytes`}
        error={
          touched || trackRecordBytes > TEXT_LIMITS_BYTES.track_record
            ? trackRecordError
            : undefined
        }
        required
      />

      {projected !== null && (
        <p className="panel-note">
          Sealed size {projected} of {MAX_CIPHERTEXT_BYTES} bytes. This counts
          the encoded bid, not the characters typed: quotes and line breaks cost
          more once encoded.
        </p>
      )}

      {error && (
        <Notice tone="danger" title="The bid could not be sealed">
          {error}
        </Notice>
      )}

      <div className="form-actions">
        <Link
          className="ui-button ui-button--ghost ui-button--medium"
          href={`/tenders/${props.tenderId}`}
        >
          Cancel
        </Link>
        <Button
          type="submit"
          loading={busy === "sealing"}
          disabled={wallet.status !== "connected"}
        >
          Encrypt and review
        </Button>
      </div>
      <p className="privacy-note">
        <Icon name="lock" size={15} />
        Your proposal stays in this page until it is encrypted. Keep this tab
        open while drafting.
      </p>
    </form>
  );
}
