"use client";

import { useRef, useState } from "react";
import { matchesAttackRefusal, type AttackRecord } from "@tender/shared";
import { ATTACKS, attackTransactionUrl } from "../../config/attacks.ts";
import { CONTRACT_ID, NETWORK } from "../../config/demo.ts";
import { prepareAttackReplay } from "../../lib/attacks/replay.ts";
import { WalletTransactionError } from "../../lib/wallet/transaction-error.ts";
import { useWallet } from "../../lib/wallet/wallet-provider.tsx";
import { Button } from "../ui/button.tsx";
import { TextField } from "../ui/field.tsx";

export function AttackReplay({ records }: { records: AttackRecord[] }) {
  const wallet = useWallet();
  const [tenderId, setTenderId] = useState(String(ATTACKS.tender_id));
  const [busy, setBusy] = useState<number | null>(null);
  const pending = useRef(false);
  const [message, setMessage] = useState("Choose an attempt to check its prerequisites before signing.");
  const [hash, setHash] = useState<string | null>(null);
  const [halted, setHalted] = useState(false);
  const enabled = NETWORK === ATTACKS.network && CONTRACT_ID === ATTACKS.contract_id;

  async function run(record: AttackRecord) {
    if (pending.current || halted || !wallet.accountId) return;
    pending.current = true;
    setBusy(record.id);
    setHash(null);
    setMessage("Checking the tender and the connected account");
    try {
      const action = await prepareAttackReplay(record, /^\d+$/.test(tenderId) ? Number(tenderId) : NaN, wallet.accountId);
      setMessage("Waiting for wallet approval. This testnet attempt uses network gas.");
      try {
        const result = await wallet.signAndSend({ receiverId: CONTRACT_ID, actions: [action] });
        setHash(result.hash);
        setHalted(true);
        setMessage("Unexpected success. Stop running attempts and inspect this transaction.");
      } catch (error) {
        if (!(error instanceof WalletTransactionError)) throw error;
        setHash(error.hash);
        setMessage(matchesAttackRefusal(error.failure, record.outcome)
          ? `Confirmed refusal: ${record.outcome}.`
          : `The transaction failed for a different reason. Expected ${record.outcome}; inspect the transaction.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The attempt could not be checked. No refusal has been confirmed.");
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return (
    <section className="panel ui-paper attack-live" aria-labelledby="attack-live-title">
      <h2 id="attack-live-title">Run a contract attempt</h2>
      <p>The recorded tender is complete. Some attempts need an open tender, an evaluated tender, or a pending award. We check the required state and role before asking you to sign.</p>
      <TextField label="Testnet tender number" value={tenderId} onChange={(e) => setTenderId(e.target.value)} inputMode="numeric" disabled={busy !== null} />
      {wallet.status !== "connected" && <p>Connect a testnet wallet to run an attempt. Recorded evidence above is available without one.</p>}
      {!enabled && <p>Select the recorded testnet deployment to enable signed attempts.</p>}
      <div className="attack-replay-actions">
        {records.filter((r) => r.method).map((record) => (
          <Button key={record.id} variant="secondary" size="small" disabled={!enabled || halted || wallet.status !== "connected" || busy !== null} loading={busy === record.id} onClick={() => void run(record)}>
            Run again: {record.title}
          </Button>
        ))}
      </div>
      <p role="status" aria-live="polite">{message}</p>
      {hash && <a className="inline-link mono" href={attackTransactionUrl(hash)} target="_blank" rel="noreferrer">Inspect transaction {hash}</a>}
    </section>
  );
}
