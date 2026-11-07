"use client";

// Creating a tender. Two transactions, in this order:
//
//   create_tender(rubric, deadline, bond, committee, evaluator)  -> the TEE derives the key
//   ft_transfer_call(budget, msg = {"fund_tender": id})          -> bidding opens
//
// The rubric is shown as the exact bytes that will be hashed, with that hash, before anything
// is signed. Nothing here can change after creation, which is the point of showing it first.
import { useMemo, useState } from "react";
import Link from "next/link";
import { isCompressedPublicKeyHex, jcsString, sha256Hex, utf8ToBytes } from "@tender/crypto";
import { rubricSchema, BP } from "@tender/shared";
import type { Rubric } from "@tender/shared";
import { Button } from "../ui/button.tsx";
import { TextAreaField, TextField } from "../ui/field.tsx";
import { CopyButton } from "../ui/copy-button.tsx";
import { Notice } from "./transaction-notice.tsx";
import { CONTRACT_ID, TOKEN_DECIMALS, TOKEN_ID, TOKEN_SYMBOL } from "../../config/demo.ts";
import { explorerTx } from "../../config/evidence.ts";
import { RUBRIC_TEMPLATE } from "../../content/rubric-template.ts";
import { formatBp, formatUnits, nearToYocto, shortHash, unitsToMinor } from "../../lib/tender/format.ts";
import { deriveReaderKeyFromWallet } from "../../lib/wallet/reader-key.ts";
import { TGAS, useWallet } from "../../lib/wallet/wallet-provider.tsx";
import { getConfig } from "../../lib/near/views.ts";

/** The eval fee the contract splits across six budgeted executions, plus storage (D-020). */
const CREATE_DEPOSIT_NEAR = "0.5";

interface CommitteeEntry {
  account: string;
  pubkey: string;
  /** Where the key came from, so the page can say what the user still has to do. */
  source: "signed" | "pasted";
}

export function CreateTenderForm({ initialNextId }: { initialNextId: number }) {
  const wallet = useWallet();

  const [title, setTitle] = useState(RUBRIC_TEMPLATE.title);
  const [scope, setScope] = useState(RUBRIC_TEMPLATE.scope);
  const [budget, setBudget] = useState(
    formatUnits(RUBRIC_TEMPLATE.budget_cap_minor, TOKEN_DECIMALS).replace(/,/g, ""),
  );
  const [maxDays, setMaxDays] = useState(String(RUBRIC_TEMPLATE.max_delivery_days));
  const [weights, setWeights] = useState<Record<string, string>>(
    Object.fromEntries(RUBRIC_TEMPLATE.criteria.map((c) => [c.id, String(c.weight_bp)])),
  );
  const [questions, setQuestions] = useState<Record<string, string>>(
    Object.fromEntries(
      RUBRIC_TEMPLATE.criteria
        .filter((c) => c.type === "qualitative")
        .map((c) => [c.id, c.question]),
    ),
  );
  const [bidWindowHours, setBidWindowHours] = useState("24");
  const [bondNear, setBondNear] = useState("0.1");
  const [committee, setCommittee] = useState<CommitteeEntry[]>([]);
  const [memberAccount, setMemberAccount] = useState("");
  const [memberPubkey, setMemberPubkey] = useState("");

  const [busy, setBusy] = useState<null | "key" | "creating" | "funding">(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: number; tx: string } | null>(null);
  const [funded, setFunded] = useState<string | null>(null);
  const [idMismatch, setIdMismatch] = useState<{ expected: number; got: number } | null>(null);

  const weightTotal = Object.values(weights).reduce((sum, w) => sum + (Number(w) || 0), 0);

  const budgetMinor = useMemo(() => {
    try {
      return unitsToMinor(budget, TOKEN_DECIMALS);
    } catch {
      return null;
    }
  }, [budget]);

  /** The rubric as it will be stored: canonical JSON, with its hash. */
  const draft = useMemo(() => {
    if (budgetMinor === null || budgetMinor <= 0n) return null;
    const days = Number(maxDays);
    if (!Number.isInteger(days) || days < 1) return null;

    const rubric: Rubric = {
      ...RUBRIC_TEMPLATE,
      title: title.trim(),
      scope: scope.trim(),
      budget_cap_minor: budgetMinor.toString(),
      max_delivery_days: days,
      criteria: RUBRIC_TEMPLATE.criteria.map((criterion) =>
        criterion.type === "qualitative"
          ? {
              ...criterion,
              weight_bp: Number(weights[criterion.id] ?? criterion.weight_bp),
              question: questions[criterion.id] ?? criterion.question,
            }
          : { ...criterion, weight_bp: Number(weights[criterion.id] ?? criterion.weight_bp) },
      ),
    };

    const parsed = rubricSchema.safeParse(rubric);
    if (!parsed.success) {
      return { json: null, hash: null, error: parsed.error.issues[0]?.message ?? "invalid rubric" };
    }
    const json = jcsString(parsed.data);
    return { json, hash: sha256Hex(utf8ToBytes(json)), error: null };
  }, [title, scope, budgetMinor, maxDays, weights, questions]);

  const windowHours = Number(bidWindowHours);
  const windowValid = Number.isFinite(windowHours) && windowHours > 0;

  /**
   * The deadline is read off the clock when the tender is created, not while typing. Deriving it
   * in a memo would make the rendered value drift from the one actually sent, and the shown
   * deadline has to be the one that lands on chain.
   */
  function deadlineFromNow(): bigint {
    return (BigInt(Date.now()) + BigInt(Math.round(windowHours * 3600)) * 1000n) * 1_000_000n;
  }

  const ready =
    wallet.status === "connected" &&
    draft?.json != null &&
    windowValid &&
    committee.length > 0 &&
    weightTotal === BP;

  async function signMyCommitteeKey() {
    if (!wallet.accountId) return;
    setError(null);
    setBusy("key");
    try {
      // D-031: a committee key's info is `<contract>:<tender_id>:<account>`, and the id has to be
      // known before the tender exists. Read the id the contract will assign next, derive for it,
      // and check after creation that it is the id we got.
      const config = await getConfig();
      const key = await deriveReaderKeyFromWallet(wallet.signMessage, {
        purpose: "committee",
        contractId: CONTRACT_ID,
        tenderId: String(config.next_tender_id),
        accountId: wallet.accountId,
      });
      key.secretKey.fill(0);
      setCommittee((current) => [
        ...current.filter((m) => m.account !== key.accountId),
        { account: key.accountId, pubkey: key.publicKeyHex, source: "signed" },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function addPastedMember() {
    setError(null);
    const account = memberAccount.trim();
    const pubkey = memberPubkey.trim().toLowerCase();
    if (!account) return setError("Enter the member's account id.");
    if (!isCompressedPublicKeyHex(pubkey)) {
      return setError(
        "That is not a compressed secp256k1 point. A member gets theirs from the committee key page and pastes all 66 characters.",
      );
    }
    if (committee.some((m) => m.account === account)) {
      return setError("That account is already on the committee.");
    }
    setCommittee((current) => [...current, { account, pubkey, source: "pasted" }]);
    setMemberAccount("");
    setMemberPubkey("");
  }

  async function create() {
    if (!draft?.json || !windowValid) return;
    const deadlineNs = deadlineFromNow();
    setError(null);
    setBusy("creating");
    try {
      const config = await getConfig();
      const expected = config.next_tender_id;
      const sent = await wallet.signAndSend({
        receiverId: CONTRACT_ID,
        actions: [
          {
            methodName: "create_tender",
            args: {
              rubric_json: draft.json,
              deadline_ns: deadlineNs.toString(),
              bond: nearToYocto(bondNear).toString(),
              committee: committee.map((m) => ({ account: m.account, report_pubkey: m.pubkey })),
              evaluator_index: 0,
            },
            gas: TGAS(300),
            deposit: nearToYocto(CREATE_DEPOSIT_NEAR).toString(),
          },
        ],
      });
      const id = Number(sent.result);
      if (!Number.isInteger(id)) throw new Error("the contract did not return a tender id");
      setCreated({ id, tx: sent.hash });
      if (id !== expected) setIdMismatch({ expected, got: id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function fund() {
    if (!created || budgetMinor === null) return;
    setError(null);
    setBusy("funding");
    try {
      const sent = await wallet.signAndSend({
        receiverId: TOKEN_ID,
        actions: [
          {
            methodName: "ft_transfer_call",
            args: {
              receiver_id: CONTRACT_ID,
              amount: budgetMinor.toString(),
              msg: JSON.stringify({ fund_tender: String(created.id) }),
            },
            gas: TGAS(100),
            deposit: "1",
          },
        ],
      });
      setFunded(sent.hash);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (created) {
    return (
      <div className="panel ui-paper">
        <Notice tone={funded ? "success" : "info"} title={`Tender ${created.id} created`}>
          {funded
            ? "The escrow is funded. Once the TEE returns the tender key, bidding opens."
            : "The tender exists and the TEE has been asked for its key. It takes no bids until the budget is in escrow."}
        </Notice>

        {idMismatch && (
          <Notice tone="danger" title="The committee keys are for the wrong tender">
            Another tender was created between signing and this one landing, so this is tender{" "}
            {idMismatch.got} while the committee keys were derived for {idMismatch.expected}. The
            committee could not open the report. Cancel this tender before funding it and create
            it again.
          </Notice>
        )}

        <dl className="facts">
          <dt>Tender</dt>
          <dd>
            <Link className="inline-link" href={`/tenders/${created.id}`}>
              Tender {created.id}
            </Link>
          </dd>
          <dt>Creation</dt>
          <dd>
            <a
              className="inline-link"
              href={explorerTx(created.tx)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {shortHash(created.tx)}
            </a>
          </dd>
          {funded && (
            <>
              <dt>Funding</dt>
              <dd>
                <a
                  className="inline-link"
                  href={explorerTx(funded)}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  {shortHash(funded)}
                </a>
              </dd>
            </>
          )}
          <dt>Rubric hash</dt>
          <dd>
            <span className="mono">{shortHash(draft?.hash ?? "")}</span>
          </dd>
        </dl>

        {error && (
          <Notice tone="danger" title="The last step failed">
            {error}
          </Notice>
        )}

        <div className="form-actions">
          {!funded && !idMismatch && (
            <Button onClick={() => void fund()} loading={busy === "funding"}>
              Fund {formatUnits(budgetMinor ?? 0n, TOKEN_DECIMALS)} {TOKEN_SYMBOL} into escrow
            </Button>
          )}
          <Link
            className="ui-button ui-button--secondary ui-button--medium"
            href={`/tenders/${created.id}`}
          >
            Open the tender
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="create-columns">
      <div>
        <section className="panel ui-paper">
          <h2>What is being bought</h2>
          <p>
            Both of these are published before bidding and cannot be changed afterwards. Bidders
            read them, and the models score against them.
          </p>
          <TextField
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
          <TextAreaField
            label="Scope"
            rows={5}
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            hint="What the work is, and what gets delivered."
            required
          />
          <div className="form-pair">
            <TextField
              label="Budget cap"
              inputMode="decimal"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              trailing={TOKEN_SYMBOL}
              hint="Escrowed in full. A bid above this is ineligible."
              error={budgetMinor === null || budgetMinor <= 0n ? "Enter a positive amount." : undefined}
              required
            />
            <TextField
              label="Maximum delivery"
              inputMode="numeric"
              value={maxDays}
              onChange={(event) => setMaxDays(event.target.value)}
              trailing="days"
              required
            />
          </div>
        </section>

        <section className="panel ui-paper">
          <h2>Criteria</h2>
          <p>
            Weights are basis points and must come to exactly 100 percent. Price is arithmetic.
            The others are scored by {RUBRIC_TEMPLATE.models.length} models and checked by code.
          </p>
          {RUBRIC_TEMPLATE.criteria.map((criterion) => (
            <div className="criterion-row" key={criterion.id}>
              <div className="form-pair">
                <TextField
                  label={criterion.type === "price_lowest_ratio" ? "Price weight" : `${criterion.id} weight`}
                  inputMode="numeric"
                  value={weights[criterion.id] ?? ""}
                  onChange={(event) =>
                    setWeights((w) => ({ ...w, [criterion.id]: event.target.value }))
                  }
                  trailing="bp"
                  hint={`${formatBp(Number(weights[criterion.id]) || 0)}%`}
                />
                {criterion.type === "qualitative" && (
                  <TextField
                    label="Question the models answer"
                    value={questions[criterion.id] ?? ""}
                    onChange={(event) =>
                      setQuestions((q) => ({ ...q, [criterion.id]: event.target.value }))
                    }
                  />
                )}
              </div>
              {criterion.type === "qualitative" && (
                <details className="anchors-details">
                  <summary>Scoring anchors, 0 to 5</summary>
                  <ul className="criteria-anchors">
                    {Object.entries(criterion.anchors).map(([score, text]) => (
                      <li key={score}>
                        <b>{score}</b>
                        <span>{text}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="panel-note">
                    Anchors come from the template. They are published with the rubric and are
                    what a model is told each score means.
                  </p>
                </details>
              )}
            </div>
          ))}
          <p className={weightTotal === BP ? "panel-note" : "weight-bad"}>
            Weights total {formatBp(weightTotal)}%{" "}
            {weightTotal === BP ? "" : `(must be 100.00%, off by ${formatBp(Math.abs(BP - weightTotal))}%)`}
          </p>
        </section>

        <section className="panel ui-paper">
          <h2>Timing and bond</h2>
          <div className="form-pair">
            <TextField
              label="Bidding window"
              inputMode="decimal"
              value={bidWindowHours}
              onChange={(event) => setBidWindowHours(event.target.value)}
              trailing="hours"
              hint={
                windowValid
                  ? `Bidding closes ${bidWindowHours} hours after the tender is created. At least 5 minutes.`
                  : "Enter a positive number of hours."
              }
              required
            />
            <TextField
              label="Bond per bid"
              inputMode="decimal"
              value={bondNear}
              onChange={(event) => setBondNear(event.target.value)}
              trailing="NEAR"
              hint="Returned unless a bid cannot be decrypted or names another account."
              required
            />
          </div>
        </section>

        <section className="panel ui-paper">
          <h2>Committee</h2>
          <p>
            The committee awards the tender and is the only group that can read the full report.
            Each member registers a key now, derived from their own wallet signature. A member
            who is not here gets their key from the committee key page and sends you the public
            half.
          </p>

          {committee.length === 0 ? (
            <p className="panel-note">No member registered yet. At least one is required.</p>
          ) : (
            <ul className="member-list">
              {committee.map((member) => (
                <li key={member.account}>
                  <div>
                    <strong>{member.account}</strong>
                    <span className="mono">{shortHash(member.pubkey)}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() =>
                      setCommittee((c) => c.filter((m) => m.account !== member.account))
                    }
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="form-actions form-actions--start">
            <Button
              variant="secondary"
              onClick={() => void signMyCommitteeKey()}
              loading={busy === "key"}
              disabled={wallet.status !== "connected"}
            >
              Register my key by signing
            </Button>
          </div>

          <div className="form-pair">
            <TextField
              label="Other member's account"
              value={memberAccount}
              onChange={(event) => setMemberAccount(event.target.value)}
              placeholder="reviewer.testnet"
            />
            <TextField
              label="Their committee public key"
              value={memberPubkey}
              onChange={(event) => setMemberPubkey(event.target.value)}
              placeholder="02…"
            />
          </div>
          <div className="form-actions form-actions--start">
            <Button variant="secondary" size="small" onClick={addPastedMember}>
              Add member
            </Button>
          </div>
        </section>
      </div>

      <aside>
        <section className="panel ui-paper">
          <h2>Exactly what gets hashed</h2>
          <p>
            This is the rubric as the contract will store it: canonical JSON, byte for byte. Its
            hash is what the evaluator has to echo back for a result to be accepted.
          </p>
          {draft?.error ? (
            <Notice tone="warning" title="Not a valid rubric yet">
              {draft.error}
            </Notice>
          ) : (
            <>
              <div className="rubric-preview">
                <pre className="mono">{draft?.json}</pre>
              </div>
              <dl className="facts">
                <dt>Bytes</dt>
                <dd>{draft?.json ? utf8ToBytes(draft.json).length : 0}</dd>
                <dt>sha256</dt>
                <dd>
                  <span className="mono">{shortHash(draft?.hash ?? "")}</span>{" "}
                  {draft?.hash && <CopyButton value={draft.hash} label="Copy rubric hash" compact />}
                </dd>
              </dl>
            </>
          )}

          {wallet.status !== "connected" && (
            <Notice tone="warning" title="Connect a wallet to create a tender">
              Creating costs {CREATE_DEPOSIT_NEAR} NEAR for storage and the evaluation fee, and
              funding moves the budget into escrow.
            </Notice>
          )}

          {error && (
            <Notice tone="danger" title="The tender was not created">
              {error}
            </Notice>
          )}

          <p className="panel-note">
            Creating sends {CREATE_DEPOSIT_NEAR} NEAR for storage and the evaluation fee. The
            unused part comes back to you when the tender settles. The next id the contract will
            assign is {initialNextId}, and the committee keys are bound to it.
          </p>

          <div className="form-actions">
            <Button onClick={() => void create()} loading={busy === "creating"} disabled={!ready}>
              Create the tender
            </Button>
          </div>
        </section>
      </aside>
    </div>
  );
}
