# 01 — Product

## One sentence

**SealedChoice runs sealed tenders on NEAR: suppliers encrypt bids to a TEE key, the contract requests evaluation after closing against a rubric published in advance, a human committee awards on-chain, and escrow pays the winner.**

Current demo (2026-11-10): three completed tenders on `tenders-v1.sealedchoice.testnet`, two models, one committee approver and NEAR testnet tUSDC payments. Cross-chain delivery is deferred. The contract account has had no access keys since 2026-11-12 (tx `7DcmnScDaQLMJTcviw5u9FdjZhKK1snpREJ2nX5VT1NP`). The secret-row owner keeps its key, an operator power that could bypass the intended confidentiality flow. See `apps/docs/docs/security.md` and `07-threat-model.md`.

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
4. **Evaluation**: decrypt inside the TEE, check eligibility, compute price scores, have the rubric's two or three models on NEAR AI Cloud score the text criteria with quotes, check and combine them in code, rank. The demo uses two. One result is accepted on-chain; failed attempts can be retried up to three total. Details: `04-evaluator.md`.
5. **Debriefs**: each bidder decrypts their own scores and can verify them. The committee decrypts the full report.
6. **Award**: the committee awards on-chain. Deviation from the ranking requires a written rationale, stored on-chain.
7. **Payout**: the winner accepts and names a NEAR payout destination; the contract pays from escrow. Unused budget returns to the buyer; bond settlement follows the contract's rules. Optional NEAR Intents 1Click delivery is deferred.

## What we claim, and what we do not

We claim (and the demo shows):
- The configured evaluator/secret-release flow restricts bid opening to the contract-requested evaluation. The secret-row owner's retained key remains an additional trust assumption; this is not an unconditional early-access exclusion.
- The rubric cannot change after creation.
- No bid can be added, removed or swapped after close (Merkle root).
- The contract accepts only one result. Failed execution attempts are recorded and capped at three. Artifact identity and source reproducibility are separate checks; frozen source tags are published with the public repository.
- Model request/response hashes are signed, quote evidence is checked by code and valid criterion outputs use the lower median. Correlated model failures and score variability remain possible.
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
| Function-call keys | Contract capability for restricted supplier actions; not a demonstrated user flow |
| Named accounts / sub-accounts | `tenders-v1.sealedchoice.testnet`, readable identities for buyers and committees |
| NEAR Intents 1Click | Optional cross-chain delivery, deferred |
| Sputnik DAO / Trezu | Potential future committee integration, not demonstrated |

## Prior art (be upfront in the README)

- **Bicakci et al., arXiv 2604.25200 (Apr 2026)**, "Making AI-Assisted Grant Evaluation Auditable without Exposing the Model": TEE evaluation, attested bundles, injection defences, verifiable execution vs fair judgment. Closest academic work; a design, not a deployed NEAR product. We cite it.
- **BlindProcure** (Zama FHE): confidential lowest-price selection. Price only, no text criteria, no payout.
- **HushBid** (Chainlink confidential compute): sealed auction bids.
- **NEAR AI Agent Market**: agents bid for jobs; not sealed, not rubric-scored.
- **OutLayer private DAO example**: encrypted votes, TEE tally, inclusion proofs. Our key-handling pattern comes from it.

Our demonstrated combination: encrypted multi-criterion procurement, recorded hybrid evaluation, human award and NEAR testnet escrow payment. The attack records show nine refusals and one detected injection, which remained eligible. The linked prior-art comparisons are research background rather than independent benchmarks.

## Business after the hackathon

- **Pricing**: flat fee per tender paid by the buyer (for example $49 for small tenders), plus a hosted plan for organisations running many tenders. No percentage of contract value at first (simpler to sell, no conflict of interest). No token.
- **Go to market**: NEAR ecosystem grant programs and DAOs first (warm network, on-chain treasuries), then Web3 companies hiring auditors, then private procurement.
- **First validation step**: one real buyer runs one real tender during or right after the hackathon. That single fact is worth more than any feature.
- **Moat**: templates of rubrics per service type, a track record of verifiable tenders, integrations (Sputnik/Trezu committees, payout routes).
- **Halal check**: fee for service, escrow without interest, bonds refundable. No yield on escrow, ever.

## Brand

Name: **SealedChoice**. Domain: sealedchoice.com (to register). NEAR: `sealedchoice.near` (to register by the human; free when checked on 2026-10-26). Testnet: `sealedchoice.testnet` and sub-accounts (created by the human). The name lives in one constant (`packages/shared/src/brand.ts`); contracts and crates are named generically (`tender`, `evaluator`) so a rename is cheap.
