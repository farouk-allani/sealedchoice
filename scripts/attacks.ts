// T12: recorded testnet refusals. Scripts load their own credentials; none enter the report.
// pnpm attacks --network testnet [--tender <id> to resume this runner's checkpoint]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { actions, teraToGas, type Account } from "near-api-js";
import { z } from "zod";
import { attackReportSchema, compactResultSchema, evidenceBundleSchema, FLAGS, rubricSchema } from "@tender/shared";
import type { AttackRecord, AttackReport } from "@tender/shared";
import { buildBidPlaintext, bytesToHex, eciesEncrypt, hexToBytes, jcsString,
  publicKeyCompressed, readerKey, sha256Hex, toBase64 } from "@tender/crypto";
import { loadEnv } from "./lib/env.ts";
import { call, provider, signer, until, view, yocto } from "./lib/near.ts";
import { outlayerEvents, requireRefusal, transactionOutcomeSchema } from "./lib/attack-outcome.ts";

const root = new URL("../", import.meta.url);
const json = (path: string): unknown => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const { cli, env } = loadEnv(process.argv.slice(2), { required: [
  "CONTRACT_ID", "TOKEN_ID", "BUYER_ACCOUNT_ID", "BUYER_PRIVATE_KEY",
  "ATTACKER_ACCOUNT_ID", "ATTACKER_PRIVATE_KEY", "VENDOR_A_ACCOUNT_ID", "VENDOR_A_PRIVATE_KEY",
  "VENDOR_B_ACCOUNT_ID", "VENDOR_B_PRIVATE_KEY", "VENDOR_C_ACCOUNT_ID", "VENDOR_C_PRIVATE_KEY", "BUNDLE_STORE_URL",
] });
if (cli.network !== "testnet") throw new Error("attack demo is testnet only");
const must = (key: keyof typeof env): string => {
  const value = env[key];
  if (!value) throw new Error(`missing ${key}`);
  return value;
};
const contractId = must("CONTRACT_ID");
const p = provider(env, cli.network);
const buyer = signer(p, must("BUYER_ACCOUNT_ID"), must("BUYER_PRIVATE_KEY"));
const attacker = signer(p, must("ATTACKER_ACCOUNT_ID"), must("ATTACKER_PRIVATE_KEY"));
const vendors = (["A", "B", "C"] as const).map((v) => ({
  id: must(`VENDOR_${v}_ACCOUNT_ID`),
  account: signer(p, must(`VENDOR_${v}_ACCOUNT_ID`), must(`VENDOR_${v}_PRIVATE_KEY`)),
}));
const config = z.object({ next_tender_id: z.number().int(), min_deadline_delay_ns: z.string(),
  outlayer: z.string(), secrets_ref: z.object({ profile: z.string(), account_id: z.string() }) })
  .parse(await view(p, contractId, "get_config"));
const evaluator = z.array(z.object({ wasm_url: z.url(), wasm_sha256: z.string(), build_target: z.string() }))
  .parse(await view(p, contractId, "get_evaluators"))[0];
if (!evaluator) throw new Error("no evaluator");
const tenderSchema = z.object({ status: z.string(), tender_pubkey: z.string().nullable(),
  deadline_ns: z.string(), bond: z.string(), rubric_hash: z.string() });
const bidsSchema = z.array(z.object({ slot: z.number().int(), bidder: z.string(), withdrawn: z.boolean(),
  debrief_pubkey: z.string() }));
const examples = ["bid-a.json", "bid-b.json", "bid-c-malicious.json"].map((name) =>
  z.object({ price_minor: z.string(), delivery_days: z.number(), methodology: z.string(), track_record: z.string() })
    .parse(json(`specs/examples/bids/${name}`)));
const rubric = rubricSchema.parse(json("specs/examples/rubric.example.json"));
rubric.models = ["Qwen/Qwen3.6-35B-A3B-FP8", "z-ai/glm-5.3-flash"];
rubric.aggregation.min_valid_outputs = 2;
rubric.currency = { asset: `nep141:${must("TOKEN_ID")}`, decimals: 6, symbol: "tUSDC" };
rubric.award_policy.approvals_required = 1;
const resumeAt = cli.args.indexOf("--tender");
if (cli.args.length && (resumeAt !== 0 || cli.args.length !== 2 || !/^\d+$/.test(cli.args[1] ?? ""))) {
  throw new Error("usage: pnpm attacks --network testnet [--tender <id>]");
}
let tenderId = resumeAt < 0 ? config.next_tender_id : Number(cli.args[resumeAt + 1]);
const checkpoint = () => new URL(`scratch/t12-attacks/tender-${tenderId}.json`, root);
let report: AttackReport = resumeAt < 0 ? {
  version: 1, network: "testnet", contract_id: contractId, tender_id: tenderId,
  recorded_at: new Date().toISOString(), complete: false, setup: {}, records: [],
} : attackReportSchema.parse(JSON.parse(readFileSync(checkpoint(), "utf8")));
if (report.contract_id !== contractId || report.tender_id !== tenderId) throw new Error("checkpoint target mismatch");
const save = () => {
  mkdirSync(new URL("scratch/t12-attacks/", root), { recursive: true });
  writeFileSync(checkpoint(), JSON.stringify(attackReportSchema.parse(report), null, 2) + "\n");
};
const add = (record: AttackRecord) => {
  report.records.push(record);
  save();
  console.log(`  ${record.id}: ${record.outcome}  tx ${record.tx_hash}`);
};
const readTender = async () => tenderSchema.parse(await view(p, contractId, "get_tender", { tender_id: tenderId }));
const readBids = async () => bidsSchema.parse(await view(p, contractId, "get_bids", { tender_id: tenderId }));

// Derive throwaway reader public keys in memory. No private key is written, printed or retained.
function readerPublic(purpose: "committee" | "debrief", account: string) {
  const signature = randomBytes(64);
  const key = readerKey(signature, purpose, contractId, String(tenderId), account);
  try { return bytesToHex(publicKeyCompressed(key)); }
  finally { key.fill(0); signature.fill(0); }
}

async function refused(id: number, title: string, method: NonNullable<AttackRecord["method"]>,
  expected: string, account: Account, args: Record<string, unknown>, detail: string, deposit = 0n) {
  if (report.records.some((r) => r.id === id)) return;
  const raw = await account.signAndSendTransaction({ receiverId: contractId,
    actions: [actions.functionCall(method, args, teraToGas(100), deposit)],
    throwOnFailure: false, waitUntil: "FINAL", retries: 0,
  });
  // Store only the measured code and transaction id, never the SDK object or arbitrary logs.
  const txHash = requireRefusal(raw, expected);
  add({ id, title, method, outcome: expected, layer: expected.startsWith("E_") ? "contract" : "runtime",
    signer: account.accountId, tx_hash: txHash, detail,
    ...(typeof args.bid_index === "number" ? { bid_index: args.bid_index } : {}),
  });
}

try {
  if (resumeAt < 0) {
    console.log(`Creating dedicated attack tender on ${contractId}`);
    const deadline = BigInt(Date.now()) * 1_000_000n + BigInt(config.min_deadline_delay_ns) + 90_000_000_000n;
    const created = await call<number>(buyer, { contractId, methodName: "create_tender", args: {
      rubric_json: jcsString(rubric), deadline_ns: String(deadline), bond: String(yocto("0.1")),
      committee: [{ account: buyer.accountId, report_pubkey: readerPublic("committee", buyer.accountId) }], evaluator_index: 0,
    }, deposit: yocto("0.5"), tgas: 300 });
    tenderId = z.number().int().nonnegative().parse(created.value);
    report.tender_id = tenderId;
    report.setup.create = created.txHash;
    save();
    console.log(`Tender ${tenderId}; resume with --tender ${tenderId}`);
  }
  let tender = await until("tender key", readTender, (t) => t.status !== "PendingKey", { timeoutMs: 240_000 });
  if (tender.status === "AwaitingFunds") {
    const funded = await call(buyer, { contractId: must("TOKEN_ID"), methodName: "ft_transfer_call", args: {
      receiver_id: contractId, amount: rubric.budget_cap_minor, msg: JSON.stringify({ fund_tender: String(tenderId) }),
    }, deposit: 1n });
    report.setup.fund = funded.txHash;
    save();
    tender = await readTender();
    if (tender.status !== "Open") throw new Error("escrow was not accepted");
  }
  const args = { tender_id: tenderId };
  if (tender.status === "Open" && BigInt(Date.now()) * 1_000_000n < BigInt(tender.deadline_ns)) {
    await refused(4, "Close before the deadline", "close_and_evaluate", "E_DEADLINE_NOT_REACHED", attacker, args,
      "The open tender stayed open before its published deadline.");
    for (const [i, vendor] of vendors.entries()) {
      if ((await readBids()).some((b) => b.bidder === vendor.id && !b.withdrawn)) continue;
      const example = examples[i];
      if (!example || !tender.tender_pubkey) throw new Error("missing bid example or tender key");
      const { bytes } = buildBidPlaintext({ ...example, tender_id: String(tenderId), bidder: vendor.id });
      const ciphertext = eciesEncrypt(hexToBytes(tender.tender_pubkey), bytes);
      const bid = await call(vendor.account, { contractId, methodName: "submit_bid", args: {
        ...args, ciphertext_b64: toBase64(ciphertext), debrief_pubkey: readerPublic("debrief", vendor.id),
      }, deposit: yocto("0.15") });
      report.setup[`bid_${i}`] = bid.txHash;
      save();
    }
    const a = (await readBids()).find((b) => b.bidder === vendors[0]?.id && !b.withdrawn);
    if (!a) throw new Error("vendor A bid missing");
    const ciphertext = z.string().parse(await view(p, contractId, "get_bid_ciphertext", { ...args, slot: a.slot }));
    await refused(5, "Copy a sealed bid", "submit_bid", "E_DUPLICATE_CIPHERTEXT", attacker,
      { ...args, ciphertext_b64: ciphertext, debrief_pubkey: a.debrief_pubkey },
      "An identical ciphertext submitted from another account was refused before evaluation.", yocto("0.15"));
  }
  await refused(3, "Change the published rubric", "update_rubric", "MethodNotFound", buyer,
    { ...args, rubric_json: jcsString(rubric) }, "The deployed contract exports no rubric setter.");
  await refused(6, "Deliver a fake evaluation", "on_evaluate", "Private callback", attacker,
    { ...args, attempt: 1 }, "The callback refuses external callers before reading a result.");

  if (!report.records.some((r) => r.id === 1)) {
    console.log("Trying a direct OutLayer request as the attacker");
    const raw = transactionOutcomeSchema.parse(report.setup.peek
      ? await p.viewTransactionStatus({ txHash: report.setup.peek, accountId: attacker.accountId, waitUntil: "FINAL" })
      : await attacker.signAndSendTransaction({
      receiverId: config.outlayer, actions: [actions.functionCall("request_execution", {
        source: { WasmUrl: { url: evaluator.wasm_url, hash: evaluator.wasm_sha256, build_target: evaluator.build_target } },
        resource_limits: { max_instructions: 10_000_000_000, max_memory_mb: 128, max_execution_seconds: 30 },
        input_data: JSON.stringify({ action: "derive_pubkey", contract_id: contractId, tender_id: String(tenderId) }),
        secrets_ref: config.secrets_ref, response_format: "Text", payer_account_id: attacker.accountId,
      }, teraToGas(200), yocto("0.02"))], throwOnFailure: false, waitUntil: "FINAL", retries: 0,
    }));
    const events = outlayerEvents(raw, config.outlayer);
    report.setup.peek = raw.transaction_outcome.id;
    save();
    console.log(`Direct request tx ${raw.transaction_outcome.id}; events: ${events.map((e) => `${e.event}(${Object.keys(e.data).join(",")})`).join(" ")}`);
    const denied = events.find((e) => e.event === "execution_completed" && e.data.success === false
      && /Access denied by access condition/i.test(String(e.data.error_message)));
    // execution_requested nests the request as a JSON string; completion has no request id.
    const requestData = events.find((e) => e.event === "execution_requested")?.data.request_data;
    const requestId = z.object({ request_id: z.number().int().positive() })
      .parse(JSON.parse(z.string().parse(requestData))).request_id;
    if (!denied) {
      // Print event names/field names only for diagnostics; no worker output or secret values.
      console.error(events.map((e) => ({ event: e.event, fields: Object.keys(e.data) })));
      throw new Error("direct request did not provide an access-denial event; stop and inspect");
    }
    z.object({ instructions: z.literal(0) }).parse(denied.data.resources_used);
    add({ id: 1, title: "Read bids through a direct request", layer: "outlayer", outcome: "Access denied",
      signer: attacker.accountId, tx_hash: raw.transaction_outcome.id, request_id: requestId,
      detail: "OutLayer refused the caller's access to the evaluator's secret row. The guest did not run." });
  }
  tender = await readTender();
  if (tender.status === "Open") {
    console.log("Waiting for the published deadline");
    while (BigInt(Date.now()) * 1_000_000n <= BigInt(tender.deadline_ns) + 5_000_000_000n) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    const closed = await call(attacker, { contractId, methodName: "close_and_evaluate", args, tgas: 300 });
    report.setup.evaluate = closed.txHash;
    save();
  }
  tender = await until("accepted evaluation", readTender, (t) => t.status !== "Evaluating", { timeoutMs: 420_000 });
  if (!["Evaluated", "Awarded", "Paid"].includes(tender.status)) throw new Error(`evaluation ended ${tender.status}`);
  const result = compactResultSchema.parse(JSON.parse(z.string().parse(await view(p, contractId, "get_result", args))));
  const frozen = z.object({ root: z.string(), slots: z.array(z.number().int()) }).parse(await view(p, contractId, "get_frozen", args));
  if (result.root !== frozen.root || result.rubric !== tender.rubric_hash || result.tid !== String(tenderId)) throw new Error("result binding mismatch");
  // Check the injection outcome before any award or payout, so an unexpected result stops here.
  if (!report.records.some((r) => r.id === 11)) {
    const cSlot = (await readBids()).find((b) => b.bidder === vendors[2]?.id)?.slot;
    const index = frozen.slots.findIndex((slot) => slot === cSlot);
    const row = result.rk.find((r) => r[0] === index);
    if (!row || !(row[2] & FLAGS.INJECTION_SUSPECTED.value)) throw new Error("prompt injection was not flagged; stop and inspect");
    const response = await fetch(`${must("BUNDLE_STORE_URL")}/api/bundles/${result.bundle}`);
    if (!response.ok) throw new Error("bundle unavailable");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (sha256Hex(bytes) !== result.bundle) throw new Error("bundle hash mismatch");
    const bundle = evidenceBundleSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    add({ id: 11, title: "Inject instructions into a proposal", layer: "evaluator", outcome: "INJECTION_SUSPECTED",
      signer: vendors[2]?.id ?? "", tx_hash: report.setup.evaluate ?? "", request_id: z.coerce.number().int().positive().parse(bundle.evaluator.outlayer_request_id),
      detail: `Vendor C's published example was flagged. Its actual total was ${row[1]} basis points, rank ${result.rk.indexOf(row) + 1} of ${result.rk.length}. A flag does not prove that every model resisted the text.` });
  }
  const eligible = result.rk.filter((r) => !(r[2] & FLAGS.INELIGIBLE.value));
  const first = eligible[0];
  const other = eligible[1];
  if (!first || !other) throw new Error("need two eligible bids for the deviation attempt");
  await refused(7, "Evaluate a second time", "retry_evaluate", "E_BAD_STATUS", attacker, args,
    "A second evaluation was refused after the accepted result. This method uses E_BAD_STATUS.");
  await refused(8, "Award as an outsider", "propose_award", "E_NOT_COMMITTEE", attacker,
    { ...args, bid_index: first[0], amount: "1", rationale: "" }, "The signer is outside the published committee.");
  if (tender.status === "Evaluated") {
    await refused(9, "Deviate without a rationale", "propose_award", "E_RATIONALE_REQUIRED", buyer,
      { ...args, bid_index: other[0], amount: "1", rationale: "" },
      "A real committee member tried to select an eligible bid below the first ranked bid with an empty rationale.");
    const award = await call(buyer, { contractId, methodName: "propose_award", args: {
      ...args, bid_index: first[0], amount: "1", rationale: "",
    } });
    report.setup.award = award.txHash;
    save();
    tender = await readTender();
  }
  if (tender.status === "Awarded") {
    await refused(10, "Accept and redirect another bidder's award", "accept_award", "E_NOT_WINNER", attacker,
      { ...args, payout: { Near: { account: attacker.accountId } } },
      "The attacker requested a transfer to their own account. Only the awarded bidder may accept.");
    const winnerSlot = frozen.slots[first[0]];
    const winnerId = (await readBids()).find((b) => b.slot === winnerSlot)?.bidder;
    const winner = vendors.find((v) => v.id === winnerId);
    if (!winner) throw new Error("winner is not a configured test vendor");
    const paid = await call(winner.account, { contractId, methodName: "accept_award", args: {
      ...args, payout: { Near: { account: winner.id } },
    } });
    report.setup.pay = paid.txHash;
    save();
    await until("payout", readTender, (t) => t.status === "Paid");
  }
  report = attackReportSchema.parse({ ...report, records: report.records.sort((a, b) => a.id - b.id), complete: true });
  save();
  mkdirSync(new URL("apps/web/src/data/", root), { recursive: true });
  writeFileSync(new URL("apps/web/src/data/attacks.json", root), JSON.stringify(report, null, 2) + "\n");
  console.log(`${report.records.length} measured attempts saved to apps/web/src/data/attacks.json`);
} catch (error) {
  save();
  console.error(error instanceof Error ? error.message : "attack runner failed");
  console.error(`Stopped. Checkpoint: scratch/t12-attacks/tender-${tenderId}.json. No failure is counted without its specific evidence.`);
  process.exitCode = 1;
}
