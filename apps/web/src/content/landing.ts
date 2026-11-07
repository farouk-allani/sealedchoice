/**
 * Every word on the landing page.
 *
 * Wording rules (CLAUDE.md): allowed: "sealed", "encrypted to a TEE", "recorded", "verifiable",
 * "checked by code", "published before bidding". Banned: "fair", "unriggable", "trustless",
 * "tamper-proof", "impossible to cheat", "first ever", "revolutionary". Limits are stated
 * plainly, not buried (docs/07-threat-model.md).
 *
 * A claim only belongs here if something in `config/evidence.ts` backs it.
 */

/**
 * The six stages the story moves through, in order. This lived in the scroll-choreography
 * module that drove the old CSS vault; the hero renders the Blender frames now, so the ids
 * live with the copy that uses them.
 */
export type ActId =
  | "sealed"
  | "closed"
  | "opened"
  | "scored"
  | "awarded"
  | "verified";

export const HERO = {
  lines: ["Sealed bids.", "Opened once.", "On the record."],
  lead:
    "Suppliers encrypt each bid to a key that exists only inside a TEE. After the deadline the " +
    "tender contract has them opened and scored once, and every step is recorded on NEAR for " +
    "anyone to check.",
  // Until T09 ships /tenders/[id], the primary action opens the story rather than claiming a
  // page that does not exist. The explorer link beside it is real today.
  primary: { label: "Watch it open", href: "#story" },
  secondary: { label: "Check it yourself", href: "#verify" },
  scrollHint: "Scroll to open",
} as const;

export type Act = {
  id: ActId;
  index: string;
  kicker: string;
  title: string;
  body: string;
  /** Short mono facts, each one backed by a value in config/evidence.ts. */
  facts: ReadonlyArray<{ label: string; value: string; kind?: "pass" | "flag" }>;
};

export const ACTS: ReadonlyArray<Act> = [
  {
    id: "sealed",
    index: "01",
    kicker: "Sealed",
    title: "The buyer cannot read a bid before the deadline.",
    body:
      "Each supplier encrypts their bid in their own browser, to a public key the tender contract " +
      "published before bidding opened. The matching private key is derived inside an OutLayer " +
      "TEE and never leaves it. What reaches the chain is ciphertext and a hash. The buyer can " +
      "count the bids, and read none of them.",
    facts: [
      { label: "Tender key", value: "published before bidding" },
      { label: "On chain", value: "ciphertext + sha256" },
      { label: "Bids on tender 3", value: "3 sealed" },
    ],
  },
  {
    id: "closed",
    index: "02",
    kicker: "Closed",
    title: "At the deadline the bid set is frozen.",
    body:
      "No bid is accepted at or after the deadline, and no evaluation can start before it. " +
      "Closing writes a Merkle root over the bid set, so the list that gets evaluated is the " +
      "list that was sealed: nothing added late, nothing quietly dropped.",
    facts: [
      { label: "Frozen with", value: "a Merkle root" },
      { label: "Bids after close", value: "refused" },
      { label: "Evaluation before close", value: "refused" },
    ],
  },
  {
    id: "opened",
    index: "03",
    kicker: "Opened",
    title: "The contract asks. Not a person.",
    body:
      "The tender contract calls the evaluator it pinned at creation. The buyer cannot swap it, " +
      "and neither can we. The run happens inside the TEE, at most three times, and exactly one " +
      "result is ever accepted. That result has to echo the tender id, the frozen root, the " +
      "rubric hash and the attempt number, or the contract rejects it.",
    facts: [
      { label: "Evaluator", value: "pinned at creation" },
      { label: "Attempts allowed", value: "3, all recorded" },
      { label: "Results accepted", value: "exactly 1" },
    ],
  },
  {
    id: "scored",
    index: "04",
    kicker: "Scored",
    title: "Code scores the numbers. Models read the words. Code checks the models.",
    body:
      "Price, eligibility and the ranking are integer arithmetic in basis points: no floats and " +
      "no model anywhere near them. Three NEAR AI Cloud models score the written criteria and " +
      "never see a price. Every passage a model claims to quote is checked against the bid text, " +
      "and a bid whose text tries to instruct the scorer is flagged by code, whatever it scored.",
    facts: [
      { label: "Model calls", value: "6 of 6 signed provider_tee", kind: "pass" },
      { label: "Models see", value: "text, never price" },
      { label: "Ranking by", value: "integers, never a model" },
    ],
  },
  {
    id: "awarded",
    index: "05",
    kicker: "Awarded",
    title: "Humans award. The contract enforces.",
    body:
      "A committee makes the call on chain. Deviating from the ranking requires a written " +
      "rationale, an ineligible bid can never be awarded at all, and the escrowed budget pays " +
      "the winner's target once, with the remainder returning to the buyer in the same " +
      "transaction.",
    facts: [
      { label: "Award", value: "committee only" },
      { label: "Deviation", value: "rationale required" },
      { label: "Payout", value: "once, to the awarded bidder" },
    ],
  },
  {
    id: "verified",
    index: "06",
    kicker: "Recorded",
    title: "Then anyone can check the whole thing.",
    body:
      "The rubric, the sealed bids, the frozen root, the attestation, every signed model call and " +
      "the final scores are all published. A verifier re-runs the arithmetic from those bytes and " +
      "says where it disagrees. It does not have to trust this page, and neither do you.",
    facts: [
      { label: "Evidence checks", value: "14 of 14 pass", kind: "pass" },
      { label: "Bundle", value: "public, no bid text" },
      { label: "Attestation", value: "matches the pinned build", kind: "pass" },
    ],
  },
];

/**
 * The section that decides whether a technical judge believes the rest. Each limit is real and
 * already written down in the repo. Stating them here is the point, not a disclaimer.
 */
export const LIMITS = {
  title: "What this does not claim",
  lead:
    "Three limits, stated here rather than left for a reader to find. All three are in the " +
    "threat model, and the measurements behind them are in the repo.",
  items: [
    {
      title: "Model scores are not reproducible.",
      body:
        "The same rubric and the same bid text, at temperature 0 with a fixed seed, scored 8,166 / " +
        "8,666 / 8,666 basis points across three real runs, and on the third run the ranking " +
        "order moved. What is reproducible is the check: a verifier re-reads what the models " +
        "actually said, from the stored bytes, and recomputes everything code decided.",
    },
    {
      title: "The TEE secret has an owner.",
      body:
        "Whoever controls the evaluator's secret row could bind it to a different build and " +
        "decrypt. That is a real hole, it is written down in the threat model, and the account " +
        "that holds it is locked down after the demo tender. We would rather say it than let a " +
        "reviewer find it.",
    },
    {
      title: "A committee can still award badly.",
      body:
        "Nothing here replaces human judgment, and nothing tries to. What the contract removes is " +
        "doing it quietly: an award off the ranking carries a written rationale, an ineligible " +
        "bid cannot be awarded at all, and all of it is on chain under the committee's own " +
        "accounts.",
    },
  ],
} as const;

export const VERIFY = {
  kicker: "Check it",
  title: "Don't take this page's word for it.",
  lead:
    "Three tenders have run end to end on NEAR testnet against the deployed contract, with a " +
    "real TEE and real models. Everything below is live right now.",
  command: "pnpm verify --tender 3 --network testnet",
} as const;

export const NAV = [
  { label: "How it works", href: "#story" },
  { label: "Limits", href: "#limits" },
  { label: "Check it", href: "#verify" },
] as const;
