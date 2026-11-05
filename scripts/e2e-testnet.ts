// T07: one whole tender on testnet, against the real contract, real OutLayer and real NEAR AI.
//
//   pnpm e2e --network testnet [--bid-window 330]
//
// create_tender -> wait for the TEE-derived tender key -> fund escrow -> three sealed bids ->
// wait out the deadline -> close_and_evaluate -> wait for the result -> fetch the bundle, check
// every hash, open the debriefs and the committee report -> print and save a summary.
//
// Re-runnable: every run creates a new tender and writes its own evidence file. Nothing here
// needs a browser or a wallet; T09 replaces the script's reader keys with real NEP-413 ones.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { z } from "zod";
import { compactResultSchema, debriefSchema, evidenceBundleSchema } from "@tender/shared";
import {
  bytesToHex,
  eciesDecrypt,
  eciesEncrypt,
  fromBase64,
  hexToBytes,
  jcs,
  publicKeyCompressed,
  readerKey,
  sha256Hex,
  toBase64,
  buildBidPlaintext,
} from "@tender/crypto";
import { loadEnv } from "./lib/env.ts";
import { call, provider, signer, until, view, yocto } from "./lib/near.ts";

const REPO = new URL("../", import.meta.url);
const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(rel, REPO), "utf8"));

// What the contract's views return, checked at the boundary rather than trusted (packages rule).
const tenderView = z.object({
  status: z.string(),
  tender_pubkey: z.string().nullish(),
  escrowed: z.string().nullish(),
  evaluator: z.object({ wasm_sha256: z.string() }).nullish(),
});
const configView = z.object({ next_tender_id: z.union([z.string(), z.number()]) });
const frozenView = z.object({ root: z.string() }).nullish();
const attemptsView = z.array(z.record(z.string(), z.unknown()));
const rubricFile = z.object({
  models: z.array(z.string()),
  aggregation: z.object({ min_valid_outputs: z.number() }).loose(),
  currency: z.object({ asset: z.string(), decimals: z.number(), symbol: z.string() }),
  budget_cap_minor: z.string(),
}).loose();
const bidFile = z.object({
  price_minor: z.string(),
  delivery_days: z.number(),
  methodology: z.string(),
  track_record: z.string(),
}).loose();
type Tender = z.infer<typeof tenderView>;

// D-028: the two NEAR AI Cloud models whose responses sign `provider_tee`.
const MODELS = ["Qwen/Qwen3.6-35B-A3B-FP8", "z-ai/glm-5.3-flash"];

/**
 * Reader keys for this script. A real bidder derives these in the browser from a NEP-413 wallet
 * signature (docs/05); here the "signature" is a fixed constant so that a later run, or a judge
 * following the README, can re-open any past demo tender's envelopes. That is deliberate and it
 * is why this is testnet only: these keys are public, so the demo's debriefs are public too.
 */
const TEST_SIGNATURE = new Uint8Array(64).fill(7);

const { cli, env } = loadEnv(process.argv.slice(2), {
  required: [
    "CONTRACT_ID",
    "TOKEN_ID",
    "BUYER_ACCOUNT_ID",
    "BUYER_PRIVATE_KEY",
    "REVIEWER_ACCOUNT_ID",
    "VENDOR_A_ACCOUNT_ID",
    "VENDOR_A_PRIVATE_KEY",
    "VENDOR_B_ACCOUNT_ID",
    "VENDOR_B_PRIVATE_KEY",
    "VENDOR_C_ACCOUNT_ID",
    "VENDOR_C_PRIVATE_KEY",
    "BUNDLE_STORE_URL",
  ],
});

/** `loadEnv(..., {required})` has already refused a missing key; this narrows the type. */
const must = (key: keyof typeof env): string => {
  const v = env[key];
  if (typeof v !== "string") throw new Error(`${String(key)} is missing from .env`);
  return v;
};

const arg = (name: string, fallback: number): number => {
  const i = cli.args.indexOf(`--${name}`);
  return i >= 0 ? Number(cli.args[i + 1]) : fallback;
};
// The contract refuses a deadline under min_deadline_delay_ns (300 s on this deployment). The
// extra 30 s is for the three bid transactions to land before it passes.
const bidWindowSec = arg("bid-window", 330);

const contractId = must("CONTRACT_ID");
const tokenId = must("TOKEN_ID");
const p = provider(env, cli.network);
const buyer = signer(p, must("BUYER_ACCOUNT_ID"), must("BUYER_PRIVATE_KEY"));
const vendors = (["A", "B", "C"] as const).map((v) => ({
  id: must(`VENDOR_${v}_ACCOUNT_ID` as keyof typeof env),
  account: signer(p, must(`VENDOR_${v}_ACCOUNT_ID` as keyof typeof env), must(`VENDOR_${v}_PRIVATE_KEY` as keyof typeof env)),
}));

const out: Record<string, unknown> = { network: cli.network, started: new Date().toISOString() };
const readers: {
  committee: { account: string; sk: string; pk: string }[];
  debrief: { index: number; bidder: string; sk: string; pk: string }[];
} = { committee: [], debrief: [] };
const log = (s: string) => console.log(s);
const step = (n: number, s: string) => console.log(`\n[${n}] ${s}`);

// ---------------------------------------------------------------- 1. create the tender

const rubric = rubricFile.parse(readJson("specs/examples/rubric.example.json"));
rubric.models = MODELS;
rubric.aggregation.min_valid_outputs = 2;
rubric.currency = { asset: `nep141:${tokenId}`, decimals: 6, symbol: "tUSDC" };
const rubricJson = new TextDecoder().decode(jcs(rubric));
const rubricHash = sha256Hex(new TextEncoder().encode(rubricJson));

const committeeAccounts = [must("BUYER_ACCOUNT_ID"), must("REVIEWER_ACCOUNT_ID")];

step(1, `create_tender on ${contractId}  rubric ${rubricHash.slice(0, 12)}…`);
const deadlineNs = (BigInt(Date.now()) + BigInt(bidWindowSec) * 1000n) * 1_000_000n;

// A committee reader key's info is `<contract>:<tender_id>:<account>` (docs/05), but the
// committee's public keys are an argument to create_tender, so the id has to be known before the
// tender exists. The client reads the id the contract will assign and derives for that, then
// checks it got it (D-031). A racing create_tender from someone else shifts the id, and the
// mismatch is caught here rather than discovered when a member cannot open the report.
const predictedId = String(
  configView.parse(await view(p, contractId, "get_config")).next_tender_id,
);
const committee = committeeAccounts.map((account) => {
  const sk = readerKey(TEST_SIGNATURE, "committee", contractId, predictedId, account);
  return { account, sk, pk: bytesToHex(publicKeyCompressed(sk)) };
});

const created = await call<string>(buyer, {
  contractId,
  methodName: "create_tender",
  args: {
    rubric_json: rubricJson,
    deadline_ns: deadlineNs.toString(),
    bond: yocto("0.1").toString(),
    committee: committee.map((c) => ({ account: c.account, report_pubkey: c.pk })),
    evaluator_index: 0,
  },
  // storage + an eval fee the contract splits across 6 budgeted executions. The estimate for this
  // deployment's limits is 0.019 NEAR an execution; the remainder is refunded at settlement.
  deposit: yocto("0.5"),
  tgas: 300,
});
const tenderId = String(created.value);
out.tender_id = tenderId;
out.create = { tx: created.txHash, tgas: created.tgasBurnt };
log(`    tender ${tenderId}  tx ${created.txHash}  ${created.tgasBurnt.toFixed(2)} TGas`);

if (tenderId !== predictedId) {
  throw new Error(
    `another tender was created in between: predicted id ${predictedId}, got ${tenderId}. ` +
      `The committee keys are bound to ${predictedId}, so cancel tender ${tenderId} and re-run.`,
  );
}
for (const c of committee) readers.committee.push({ account: c.account, sk: bytesToHex(c.sk), pk: c.pk });

// ---------------------------------------------------------------- 2. the TEE derives the key

step(2, "waiting for OutLayer to return the tender public key");
const readTender = async (): Promise<Tender> =>
  tenderView.parse(await view(p, contractId, "get_tender", { tender_id: Number(tenderId) }));
const withKey = await until("the tender key", readTender, (t) => Boolean(t.tender_pubkey), {
  timeoutMs: 240_000,
});
const tenderPubkey = withKey.tender_pubkey as string;
out.tender_pubkey = tenderPubkey;
log(`    pk ${tenderPubkey}  status ${withKey.status}`);

// ---------------------------------------------------------------- 3. fund the escrow

step(3, `funding escrow: ${rubric.budget_cap_minor} minor units of ${tokenId}`);
const funded = await call<string>(buyer, {
  contractId: tokenId,
  methodName: "ft_transfer_call",
  args: {
    receiver_id: contractId,
    amount: rubric.budget_cap_minor,
    msg: JSON.stringify({ fund_tender: tenderId }),
  },
  deposit: 1n,
  tgas: 100,
});
// ft_on_transfer reports a refusal as a log and refunds, so a "successful" transaction can still
// mean the escrow never landed. Read the status rather than trusting the call.
const refusal = funded.logs.find((l) => /^E_[A-Z_]+$/.test(l.trim()));
if (refusal) throw new Error(`escrow refused: ${refusal}`);
out.fund = { tx: funded.txHash, tgas: funded.tgasBurnt };
log(`    tx ${funded.txHash}  ${funded.tgasBurnt.toFixed(2)} TGas`);

const open = await readTender();
if (open.status !== "Open") throw new Error(`expected Open after funding, got ${open.status}`);
log(`    status ${open.status}  escrowed ${open.escrowed}`);

// ---------------------------------------------------------------- 4. three sealed bids

step(4, "encrypting and submitting three bids");
const bidFiles = ["bid-a.json", "bid-b.json", "bid-c-malicious.json"];
const bidRecords: { bidder: string; tx: string; tgas: number; bytes: number }[] = [];
const bidPrices: string[] = [];
for (const [i, v] of vendors.entries()) {
  const example = bidFile.parse(readJson(`specs/examples/bids/${bidFiles[i]}`));
  const { plaintext, bytes } = buildBidPlaintext({
    tender_id: tenderId,
    bidder: v.id,
    price_minor: example.price_minor,
    delivery_days: example.delivery_days,
    methodology: example.methodology,
    track_record: example.track_record,
  });
  bidPrices[i] = plaintext.price_minor;
  const ciphertext = eciesEncrypt(hexToBytes(tenderPubkey), bytes);
  const dk = readerKey(TEST_SIGNATURE, "debrief", contractId, tenderId, v.id);
  const dkPub = bytesToHex(publicKeyCompressed(dk));
  readers.debrief.push({ index: i, bidder: v.id, sk: bytesToHex(dk), pk: dkPub });

  const r = await call<unknown>(v.account, {
    contractId,
    methodName: "submit_bid",
    args: {
      tender_id: Number(tenderId),
      ciphertext_b64: toBase64(ciphertext),
      debrief_pubkey: dkPub,
    },
    deposit: yocto("0.15"),
    tgas: 100,
  });
  bidRecords.push({ bidder: v.id, tx: r.txHash, tgas: r.tgasBurnt, bytes: ciphertext.length });
  log(
    `    ${v.id}  price ${plaintext.price_minor}  ciphertext ${ciphertext.length} B  tx ${r.txHash}`,
  );
}

// ---------------------------------------------------------------- 5. close and evaluate

out.bids = bidRecords;

const waitMs = Number(deadlineNs / 1_000_000n) - Date.now() + 5_000;
step(5, `waiting ${Math.max(0, Math.round(waitMs / 1000))} s for the deadline`);
if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));

log("    close_and_evaluate");
const closed = await call<unknown>(buyer, {
  contractId,
  methodName: "close_and_evaluate",
  args: { tender_id: Number(tenderId) },
  tgas: 300,
});
out.close = { tx: closed.txHash, tgas: closed.tgasBurnt };
log(`    tx ${closed.txHash}  ${closed.tgasBurnt.toFixed(2)} TGas`);

step(6, "waiting for the evaluation (OutLayer -> NEAR AI -> bundle store -> callback)");
const settled = await until(
  "an evaluation result",
  readTender,
  (t) => t.status === "Evaluated" || t.status === "EvalFailed",
  { timeoutMs: 420_000, everyMs: 5_000 },
);
out.status = settled.status;
out.cost = {
  tgas_burnt: Number(
    (
      (out.create as { tgas: number }).tgas +
      (out.fund as { tgas: number }).tgas +
      bidRecords.reduce((n, b) => n + b.tgas, 0) +
      (out.close as { tgas: number }).tgas
    ).toFixed(2),
  ),
  near_attached_create: "0.5 (eval fee + storage; the remainder is refunded at settlement)",
  bond_each_near: "0.1",
};
const attempts = attemptsView.parse(
  await view(p, contractId, "get_attempts", { tender_id: Number(tenderId) }),
);
out.attempts = attempts;
log(`    status ${settled.status} after ${attempts.length} attempt(s)`);
// An Attempt is {n, started_at_ns, outcome, ...}: the counter is `n`, not `attempt`.
for (const a of attempts) log(`      attempt ${String(a.n)}: ${JSON.stringify(a).slice(0, 220)}`);
if (settled.status !== "Evaluated") {
  writeEvidence();
  throw new Error(`tender ended ${settled.status}; see the attempts above and docs/04 §7`);
}

// ---------------------------------------------------------------- 7. check the evidence

const resultText = await view<string>(p, contractId, "get_result", { tender_id: Number(tenderId) });
const result = compactResultSchema.parse(JSON.parse(resultText));
out.result = result;
log(`    result ${resultText}`);

step(7, "checking the bundle and opening the envelopes");
const url = `${env.BUNDLE_STORE_URL}/api/bundles/${result.bundle}`;
const res = await fetch(url, { headers: { "accept-encoding": "identity" } });
if (!res.ok) throw new Error(`bundle not in the store: GET ${url} -> ${res.status}`);
const bundleBytes = new Uint8Array(await res.arrayBuffer());
const checks: [string, boolean, string][] = [];
const ok = (what: string, pass: boolean, detail = "") => checks.push([what, pass, detail]);

ok("stored bytes hash to the result's bundle hash", sha256Hex(bundleBytes) === result.bundle);
const parsedBundle = evidenceBundleSchema.safeParse(
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bundleBytes)),
);
ok("bundle validates against evidence-bundle.schema.json", parsedBundle.success,
  parsedBundle.success ? "" : JSON.stringify(parsedBundle.error.issues.slice(0, 3)));
if (!parsedBundle.success) { writeEvidence(); process.exit(1); }
const bundle = parsedBundle.data;
ok("bundle_hash = sha256(JCS(bundle))", sha256Hex(jcs(bundle)) === result.bundle);
const frozen = frozenView.parse(await view(p, contractId, "get_frozen", { tender_id: Number(tenderId) }));
ok("result echoes the frozen root", result.root === frozen?.root);
ok("result echoes the rubric hash", result.rubric === rubricHash);
ok("compact result is at most 900 bytes", new TextEncoder().encode(resultText).length <= 900,
  `${new TextEncoder().encode(resultText).length} B`);
ok("bundle names the pinned evaluator", bundle.evaluator?.wasm_sha256 === settled.evaluator?.wasm_sha256,
  `${bundle.evaluator?.wasm_sha256?.slice(0, 12)}…`);
ok("every model call is provider_tee",
  bundle.model_calls.every((c) => c.signature?.signature_kind === "provider_tee"),
  `${bundle.model_calls.length} calls`);
const text = new TextDecoder().decode(bundleBytes);
ok("the public bundle carries no bid text", !text.includes("ignore previous instructions"));

for (const r of readers.debrief) {
  const envlp = bundle.debriefs.find((d) => d.bid_index === r.index);
  if (!envlp) {
    ok(`debrief ${r.index} (${r.bidder}) is in the bundle`, false);
    continue;
  }
  try {
    const plain = eciesDecrypt(hexToBytes(r.sk), fromBase64(envlp.ecies_b64));
    const debrief = debriefSchema.parse(JSON.parse(new TextDecoder().decode(plain)));
    ok(`debrief ${r.index} (${r.bidder}) opens`, sha256Hex(plain) === envlp.plaintext_sha256,
      `rank ${debrief.rank}/${debrief.of} flags ${debrief.flags}`);
  } catch (e) {
    ok(`debrief ${r.index} (${r.bidder}) opens`, false, String(e).slice(0, 120));
  }
}

const report = bundle.committee_report;
for (const m of readers.committee) {
  try {
    const entry = report.keys.find((k) => k.member === m.account);
    if (!entry) throw new Error("no committee key entry for this member");
    const aesKey = eciesDecrypt(hexToBytes(m.sk), fromBase64(entry.ecies_b64));
    const body = fromBase64(report.body_b64);
    const d = createDecipheriv("aes-256-gcm", aesKey, body.subarray(0, 12));
    d.setAuthTag(body.subarray(body.length - 16));
    const plain = Buffer.concat([d.update(body.subarray(12, body.length - 16)), d.final()]);
    ok(`committee report opens for ${m.account}`, sha256Hex(plain) === report.plaintext_sha256);
  } catch (e) {
    ok(`committee report opens for ${m.account}`, false, String(e).slice(0, 120));
  }
}

// ---------------------------------------------------------------- 8. award, accept, pay

step(8, "award, acceptance and payout");
const top = result.rk[0];
if (!top) throw new Error("the result has an empty ranking");
const winnerIndex = top[0];
const winner = vendors[winnerIndex];
if (!winner) throw new Error(`the ranking names bid ${winnerIndex}, which has no vendor`);
const amount = bidPrices[winnerIndex];
if (amount === undefined) throw new Error(`no price recorded for bid ${winnerIndex}`);

const balanceOf = async (account: string): Promise<bigint> =>
  BigInt(await view<string>(p, tokenId, "ft_balance_of", { account_id: account }));
const winnerBefore = await balanceOf(winner.id);
const buyerBefore = await balanceOf(must("BUYER_ACCOUNT_ID"));

// The committee awards at the winner's own bid price, which is what the report showed them.
const proposed = await call<unknown>(buyer, {
  contractId,
  methodName: "propose_award",
  args: { tender_id: Number(tenderId), bid_index: winnerIndex, amount, rationale: "top of the ranking" },
  tgas: 100,
});
log(`    propose_award bid ${winnerIndex} for ${amount}  tx ${proposed.txHash}`);

const accepted = await call<unknown>(winner.account, {
  contractId,
  methodName: "accept_award",
  args: { tender_id: Number(tenderId), payout: { Near: { account: winner.id } } },
  tgas: 150,
});
log(`    accept_award by ${winner.id}  tx ${accepted.txHash}`);

const paid = await until(
  "the payout",
  readTender,
  (t) => t.status === "Paid" || t.status === "PayingOut",
  { timeoutMs: 120_000 },
);
const finalTender = await until("Paid", readTender, (t) => t.status === "Paid", {
  timeoutMs: 120_000,
});
out.award = {
  bid_index: winnerIndex,
  winner: winner.id,
  amount,
  propose_tx: proposed.txHash,
  accept_tx: accepted.txHash,
  status: finalTender.status,
};
const winnerAfter = await balanceOf(winner.id);
const buyerAfter = await balanceOf(must("BUYER_ACCOUNT_ID"));
const remainder = BigInt(rubric.budget_cap_minor) - BigInt(amount);
ok("the winner was paid the award amount", winnerAfter - winnerBefore === BigInt(amount),
  `+${winnerAfter - winnerBefore}`);
ok("the buyer got the remainder back", buyerAfter - buyerBefore === remainder, `+${buyerAfter - buyerBefore}`);
ok("the tender is Paid", finalTender.status === "Paid", paid.status);
log(`    winner ${winner.id} +${winnerAfter - winnerBefore}  buyer +${buyerAfter - buyerBefore} (remainder ${remainder})`);

console.log();
for (const [what, pass, detail] of checks) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${what}${detail ? `  ${detail}` : ""}`);
}
const failed = checks.filter(([, pass]) => !pass).length;
out.checks = checks.map(([what, pass, detail]) => ({ what, pass, detail }));

// ---------------------------------------------------------------- 8. summary

step(9, "ranking");
for (const [index, bp, flags] of result.rk) {
  const b = bundle.bids.find((x) => x.index === index);
  log(`    bid ${index} ${b?.bidder ?? "?"}  ${bp} bp  flags ${flags}${b?.eligible ? "" : "  INELIGIBLE"}`);
}
writeEvidence();
console.log(failed === 0 ? "\nALL CHECKS PASS" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);

function writeEvidence() {
  const dir = new URL("testnet/evidence/", new URL("./", import.meta.url));
  mkdirSync(dir, { recursive: true });
  out.finished = new Date().toISOString();
  out.wall_seconds = Math.round(
    (Date.parse(out.finished as string) - Date.parse(out.started as string)) / 1000,
  );
  // The reader secret keys are written too: they are derived from a published constant, so they
  // are not secrets, and a judge needs them to re-open the demo tender's envelopes.
  out.readers = readers;
  const f = new URL(`e2e-${out.tender_id ?? "failed"}-${Date.now()}.json`, dir);
  writeFileSync(f, JSON.stringify(out, null, 1));
  console.log(`\nevidence: ${f.pathname.replace(/^\//, "")}`);
}
