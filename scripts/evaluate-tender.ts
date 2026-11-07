// Close and evaluate a tender that already exists, then print what the run produced.
//
//   pnpm evaluate --tender 4 [--network testnet]
//
// `pnpm e2e` builds its own tender from scratch, which is what T07 needed. This is for a tender
// somebody else created: a bid placed from the browser at T09, a demo tender being carried to the
// award at T11, or an attack tender at T12. It signs nothing except `close_and_evaluate`, which
// anyone may call once the deadline has passed, so it cannot create, fund or bid by accident.
//
// What it does: read the tender, close it if the deadline has passed, wait for the callback, then
// report the ranking with each entry joined to its bidder through `frozen.slots` (D-033: an `rk`
// index is an index into the frozen bid set, never a storage slot) and check the stored bundle's
// bytes against the hash the result committed to.
import { z } from "zod";
import { compactResultSchema, evidenceBundleSchema } from "@tender/shared";
import { jcs, sha256Hex } from "@tender/crypto";
import { loadEnv } from "./lib/env.ts";
import { call, provider, signer, until, view } from "./lib/near.ts";

// Checked at the boundary rather than trusted (packages rule).
const tenderView = z
  .object({
    status: z.string(),
    buyer: z.string(),
    deadline_ns: z.union([z.string(), z.number()]),
    rubric_hash: z.string(),
    evaluator: z.object({ wasm_sha256: z.string() }).nullish(),
  })
  .loose();
const frozenView = z
  .object({ root: z.string(), slots: z.array(z.number()) })
  .nullish();
const bidsView = z.array(
  z
    .object({ slot: z.number(), bidder: z.string(), withdrawn: z.boolean() })
    .loose(),
);
const attemptsView = z.array(z.record(z.string(), z.unknown()));

const { cli, env } = loadEnv(process.argv.slice(2), {
  required: ["CONTRACT_ID", "BUYER_ACCOUNT_ID", "BUYER_PRIVATE_KEY", "BUNDLE_STORE_URL"],
});

const must = (key: keyof typeof env): string => {
  const v = env[key];
  if (typeof v !== "string") throw new Error(`${String(key)} is missing from .env`);
  return v;
};

const flag = (name: string): string | undefined => {
  const i = cli.args.indexOf(`--${name}`);
  return i >= 0 ? cli.args[i + 1] : undefined;
};

const raw = flag("tender") ?? cli.args[0];
const tenderId = Number(raw);
if (!Number.isInteger(tenderId) || tenderId < 0) {
  console.error("usage: pnpm evaluate --tender <id> [--network testnet]");
  process.exit(2);
}

const contractId = must("CONTRACT_ID");
const p = provider(env, cli.network);
const log = (s: string) => console.log(s);
const step = (n: number, s: string) => console.log(`\n[${n}] ${s}`);

const readTender = async () =>
  tenderView.parse(await view(p, contractId, "get_tender", { tender_id: tenderId }));

// ---------------------------------------------------------------- 1. where the tender stands

step(1, `tender ${tenderId} on ${contractId} (${cli.network})`);
let t = await readTender();
const deadlineMs = Number(BigInt(String(t.deadline_ns)) / 1_000_000n);
log(`    status ${t.status}  buyer ${t.buyer}  deadline ${new Date(deadlineMs).toISOString()}`);

const bids = bidsView.parse(await view(p, contractId, "get_bids", { tender_id: tenderId }));
for (const b of bids) {
  log(`    slot ${b.slot}  ${b.bidder}${b.withdrawn ? "  (withdrawn)" : ""}`);
}

// ---------------------------------------------------------------- 2. close, if it is still open

if (t.status === "Open") {
  const waitMs = deadlineMs - Date.now();
  if (waitMs > 0) {
    log(`    the deadline is ${Math.round(waitMs / 1000)} s away; no bid may be closed before it`);
    step(2, `waiting ${Math.round(waitMs / 1000)} s for the deadline`);
    await new Promise((r) => setTimeout(r, waitMs + 5_000));
  }
  const buyer = signer(p, must("BUYER_ACCOUNT_ID"), must("BUYER_PRIVATE_KEY"));
  step(2, `close_and_evaluate as ${must("BUYER_ACCOUNT_ID")}`);
  const closed = await call<unknown>(buyer, {
    contractId,
    methodName: "close_and_evaluate",
    args: { tender_id: tenderId },
    tgas: 300,
  });
  log(`    tx ${closed.txHash}  ${closed.tgasBurnt.toFixed(2)} TGas`);
} else {
  step(2, `not Open (${t.status}), so nothing to close`);
}

// ---------------------------------------------------------------- 3. wait for the callback

if (t.status === "Open" || t.status === "Evaluating") {
  step(3, "waiting for the evaluation (OutLayer, NEAR AI, bundle store, callback)");
  t = await until(
    "an evaluation result",
    readTender,
    (v) => v.status !== "Open" && v.status !== "Evaluating",
    { timeoutMs: 420_000, everyMs: 5_000 },
  );
}

const attempts = attemptsView.parse(
  await view(p, contractId, "get_attempts", { tender_id: tenderId }),
);
log(`    status ${t.status} after ${attempts.length} attempt(s)`);
for (const a of attempts) log(`      attempt ${String(a.n)}: ${JSON.stringify(a).slice(0, 220)}`);

if (!["Evaluated", "Awarded", "PayingOut", "Paid", "ClosedNoAward"].includes(t.status)) {
  console.error(`\ntender ${tenderId} ended ${t.status}; see the attempts above and docs/04 section 7`);
  process.exit(1);
}

// ---------------------------------------------------------------- 4. the ranking, by bidder

const resultText = await view<string>(p, contractId, "get_result", { tender_id: tenderId });
const result = compactResultSchema.parse(JSON.parse(resultText));
const frozen = frozenView.parse(await view(p, contractId, "get_frozen", { tender_id: tenderId }));
if (!frozen) throw new Error("the tender has a result but no frozen bid set");

step(4, "ranking");
const bidderOfSlot = new Map(bids.map((b) => [b.slot, b.bidder]));
log(`    frozen slots [${frozen.slots.join(", ")}]`);
result.rk.forEach(([index, total, flags], place) => {
  // D-033: resolve the frozen-set index to a slot before naming a bidder.
  const slot = frozen.slots[index];
  const who = slot === undefined ? "unknown slot" : (bidderOfSlot.get(slot) ?? "unknown bidder");
  log(
    `    ${place + 1}.  index ${index} -> slot ${slot}  ${who}  ${total} bp` +
      (flags ? `  flags 0x${flags.toString(16)}` : ""),
  );
});

// ---------------------------------------------------------------- 5. the evidence it committed to

step(5, "checking the published bundle");
const url = `${must("BUNDLE_STORE_URL")}/api/bundles/${result.bundle}`;
const checks: [string, boolean, string][] = [];
const ok = (what: string, pass: boolean, detail = "") => checks.push([what, pass, detail]);

const res = await fetch(url, { headers: { "accept-encoding": "identity" } });
ok(`bundle is in the store (GET ${result.bundle.slice(0, 12)}…)`, res.ok, `HTTP ${res.status}`);
if (res.ok) {
  const bytes = new Uint8Array(await res.arrayBuffer());
  ok("stored bytes hash to the result's bundle hash", sha256Hex(bytes) === result.bundle);
  const parsed = evidenceBundleSchema.safeParse(
    JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)),
  );
  ok("bundle validates against evidence-bundle.schema.json", parsed.success);
  if (parsed.success) {
    ok("bundle_hash = sha256(JCS(bundle))", sha256Hex(jcs(parsed.data)) === result.bundle);
    ok(
      "bundle names the pinned evaluator",
      parsed.data.evaluator?.wasm_sha256 === t.evaluator?.wasm_sha256,
      `${parsed.data.evaluator?.wasm_sha256?.slice(0, 12)}…`,
    );
  }
}
ok("result echoes the frozen root", result.root === frozen.root);
ok("result echoes the rubric hash", result.rubric === t.rubric_hash);
ok("result names this tender", String(result.tid) === String(tenderId));

for (const [what, pass, detail] of checks) {
  log(`    ${pass ? "ok  " : "FAIL"}  ${what}${detail ? `  (${detail})` : ""}`);
}
const failed = checks.filter(([, pass]) => !pass).length;
log(`\n${checks.length - failed}/${checks.length} checks passed`);
log(`result ${resultText}`);
if (failed > 0) process.exit(1);
