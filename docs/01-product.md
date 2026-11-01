# 01 — Product

## One sentence

**SealedChoice runs sealed tenders on NEAR: suppliers' bids are encrypted to a TEE that nobody can open before the deadline, the contract then has them scored once against a rubric published in advance, a human committee awards on-chain, and the escrowed budget pays the winner.**

## The problem

When an organisation hires a supplier through a tender, everybody has to trust whoever holds the bids:

- **Bids leak before the deadline.** Whoever can open them can tip off a favoured supplier.
- **Rules change after the bids arrive.** Criteria and weights get adjusted once the buyer sees who bid.
- **Scoring is opaque.** Losing bidders get a letter, not their scores, and cannot check how they were computed.
- **Payment is a separate, slow process.** Especially across borders and chains.

Bid rigging and procurement corruption are a large share of public and private procurement losses; the OECD reported that 57 % of foreign bribery cases it examined involved bribes to obtain public procurement contracts (OECD Foreign Bribery Report, 2014; cite carefully, it is old). DAOs and Web3 ecosystems run the same process with grant committees and RFPs, usually on Google Forms and trust.

## Who it is for (first customer)

A small DAO or ecosystem team hiring a digital service provider: a security review, an integration, a design job. One buyer, three to five proposals, one clearly defined service, one payout route. This matches the demo and is a market we can reach after the hackathon (NEAR ecosystem teams, grant programs, DAOs with Sputnik/Trezu treasuries).

Later: private companies' vendor selection, then public-sector pilots (much later, much harder).

## What it does (the demo flow)

1. **Buyer** creates a tender: rubric, deadline, bond size, committee, budget escrowed in USDC. The rubric hash is stored on-chain and cannot change.
2. **Suppliers** bid. The bid (price, delivery time, methodology, track record) is encrypted in their browser to the tender's public key. Only ciphertext goes on-chain. Each bidder gets a receipt (tx hash + Merkle leaf).
3. **Deadline**: anyone calls close. The contract freezes the bid set (Merkle root) and asks OutLayer to run the pinned evaluator inside a TEE.
4. **Evaluation**: decrypt inside the TEE, check eligibility, compute price scores, have three models on NEAR AI Cloud score the text criteria with quotes, check and combine them in code, rank. One result goes on-chain. Details: `04-evaluator.md`.
5. **Debriefs**: each bidder decrypts their own scores and can verify them. The committee decrypts the full report.
6. **Award**: the committee awards on-chain. Deviation from the ranking requires a written rationale, stored on-chain.
7. **Payout**: the winner accepts and names a payout destination; the contract pays from escrow (NEAR account directly, or another chain through NEAR Intents 1Click). Unused budget returns to the buyer, bonds return to bidders.

## What we claim, and what we do not

We claim (and the demo shows):
- Nobody, including the buyer and us, can read a bid before the deadline (key generated in the TEE, released only to the pinned evaluator, only when the tender contract calls it, only after the deadline).
- The rubric cannot change after creation.
- No bid can be added, removed or swapped after close (Merkle root).
- The evaluation is run once, by the contract, with the published code; only one result is accepted.
- Every AI score is recorded, signed by NEAR AI's TEE, checked against the proposal text by code, and combined so a single model cannot swing it.
- The award and any deviation from the ranking are public and justified.
- Payment comes from escrow to the awarded supplier only.

We do not claim: that the rubric is fair, that suppliers' claims are true, that the models judge perfectly, that the committee chooses well, or that collusion outside the platform is impossible. See `07-threat-model.md`. Never use "fair", "unriggable", "trustless" or "tamper-proof" in user-facing text.

## Why NEAR (each item is used, not name-dropped)

| NEAR piece | What it does here |
|---|---|
| OutLayer (TEE, Intel TDX) | Holds the tender keys, runs the pinned evaluator, attests the execution |
| NEAR AI Cloud | Private inference in TEEs, signed responses, attestation reports |
| Smart contract (Rust) | State machine, deadlines, immutability, one-result rule, escrow, award, bonds |
| Yield/resume (via OutLayer) | Contract asks for off-chain compute and gets the result in a callback |
| Function-call keys | Supplier agents can bid with a key restricted to `submit_bid` |
| Named accounts / sub-accounts | `tenders.sealedchoice.near`, readable identities for buyers and committees |
| NEAR Intents 1Click | Pays the winner on the chain and asset they choose |
| Sputnik DAO / Trezu (optional) | A DAO can be the committee and award through a proposal |

## Prior art (be upfront in the README)

- **Bicakci et al., arXiv 2604.25200 (Apr 2026)**, "Making AI-Assisted Grant Evaluation Auditable without Exposing the Model": TEE evaluation, attested bundles, injection defences, verifiable execution vs fair judgment. Closest academic work; a design, not a deployed NEAR product. We cite it.
- **BlindProcure** (Zama FHE): confidential lowest-price selection. Price only, no text criteria, no payout.
- **HushBid** (Chainlink confidential compute): sealed auction bids.
- **NEAR AI Agent Market**: agents bid for jobs; not sealed, not rubric-scored.
- **OutLayer private DAO example**: encrypted votes, TEE tally, inclusion proofs. Our key-handling pattern comes from it.

Our difference: a complete, working procurement flow on NEAR (sealed bids → attested hybrid evaluation with checked AI → human award → escrowed cross-chain payout) with the attacks shown failing.

## Business after the hackathon

- **Pricing**: flat fee per tender paid by the buyer (for example $49 for small tenders), plus a hosted plan for organisations running many tenders. No percentage of contract value at first (simpler to sell, no conflict of interest). No token.
- **Go to market**: NEAR ecosystem grant programs and DAOs first (warm network, on-chain treasuries), then Web3 companies hiring auditors, then private procurement.
- **First validation step**: one real buyer runs one real tender during or right after the hackathon. That single fact is worth more than any feature.
- **Moat**: templates of rubrics per service type, a track record of verifiable tenders, integrations (Sputnik/Trezu committees, payout routes).
- **Halal check**: fee for service, escrow without interest, bonds refundable. No yield on escrow, ever.

## Brand

Name: **SealedChoice**. Domain: sealedchoice.com (to register). NEAR: `sealedchoice.near` (to register by the human; free when checked on 2026-10-26). Testnet: `sealedchoice.testnet` and sub-accounts (created by the human). The name lives in one constant (`packages/shared/src/brand.ts`); contracts and crates are named generically (`tender`, `evaluator`) so a rename is cheap.
