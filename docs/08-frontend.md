# 08 — Web app

`apps/web`: Next.js (App Router) + TypeScript strict + Tailwind. Deployed on Vercel at sealedchoice.com (domain to be registered by the human) or a Vercel preview URL until then. Reads chain state through NEAR RPC (testnet / mainnet by env). No backend database: the chain and the bundle store are the data.

Wallet: **`@hot-labs/near-connect` 0.12.0** (NEAR Connect), chosen at G5. Hard requirement: supports `signMessage` (NEP-413) for reader keys and works with Meteor on testnet, which G5 measured. **Not** MyNearWallet: the connector drops every wallet whose shared-manifest entry lacks `features.testnet`, which on testnet leaves Meteor, Intear, Ledger, Nightly and NEAR CLI (G5, docs/references.md). Optional: an any-wallet path (e.g. Aurora Intent Connect) if time allows; not required.

Design: load the `frontend-design` skill before building pages. Tone: calm, institutional, legible. Think "public notice board", not "crypto casino". Show hashes shortened with copy buttons and explorer links; never make the user read hex to understand a status.

## Pages

| Route | Who | What |
|---|---|---|
| `/` | everyone | One-paragraph explanation, link to the live demo tender, "how it works" in 4 steps, link to verify |
| `/tenders` | everyone | List with status chips |
| `/tenders/new` | buyer | Rubric builder (from templates in `specs/examples/`), deadline, bond, committee members (each registers a report pubkey by signing), evaluator version; shows the exact rubric JSON and its hash before signing; then the escrow funding step |
| `/tenders/[id]` | everyone | Timeline (created → key set → funded → bids → closed → evaluated → awarded → paid) with tx links; rubric rendered as a table; bids as rows of `bidder · time · sha256`; after evaluation the ranking with totals and flag chips; award and payout |
| `/tenders/[id]/bid` | bidder | Form (price, delivery days, methodology, track record), live byte counters vs limits, "Encrypt and submit": derive debrief key via signMessage, encrypt in the browser, submit with bond; shows the receipt (tx, leaf) and how to keep it |
| `/tenders/[id]/verify` | everyone | Runs `packages/verify` checks in the browser, shows PASS/FAIL with the data and links (06-evidence-and-verification.md) |
| `/tenders/[id]/debrief` | bidder | Re-derive key, decrypt, show own scores, quotes highlighted in own text, flags explained, "missing" notes, recomputation PASS |
| `/tenders/[id]/committee` | committee | Decrypt report, compare bids side by side, recommended winner, award form (deviation → rationale required), approvals status |
| `/tenders/[id]/award` | winner | Accept award, choose payout: NEAR account, or another chain/asset via 1Click (list from `/v0/tokens`), see quote and status |
| `/attacks` | everyone | The manipulation attempts (07-threat-model.md "Demo" column): each a button that runs the attempt from a demo account (testnet) and shows the failure and its tx hash; pre-recorded results shown by default so the page works without a wallet |

## Rules

- All crypto in the browser through `packages/crypto`. Private reader keys never leave the page; never stored server-side; not in localStorage unless the user opts in ("remember on this device").
- Every number shown has its source: totals in bp shown as `78.00` with a tooltip "7800 basis points, from the on-chain result".
- Plain-language flag explanations come from one map in `packages/shared` (same text in README).
- Work without a wallet for everything read-only.
- The demo tender id(s) live in one config file `apps/web/src/config/demo.ts` with network, contract id and tender ids.
- Accessibility basics: labels, focus states, contrast, no colour-only status.

## API routes

- `PUT/GET /api/bundles/[sha256]` (06-evidence-and-verification.md).
- `GET /api/intents/tokens` and `POST /api/intents/quote` (dry quotes only) as thin proxies to 1Click when CORS or the JWT requires it. The JWT stays server-side.
