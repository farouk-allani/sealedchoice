// The rubric /tenders/new starts from. It is not an invention: these are the exact values of
// tender 3 on `tenders.sealedchoice.testnet`, the tender that was created, sealed, evaluated,
// awarded and paid (PROGRESS, T07 and T08). So the template is known to be one the contract
// accepts and the evaluator can run (I14).
//
// The models are the two NEAR AI Cloud families whose responses sign `provider_tee`, which is
// what D-028 settled: a `gateway`-signed model would see bid text outside a TEE.
import type { Rubric } from "@tender/shared";

export const RUBRIC_TEMPLATE: Rubric = {
    "aggregation": {
      "disagreement_threshold": 3,
      "evidence_clamp_score": 1,
      "evidence_min_chars": 12,
      "evidence_required_from_score": 2,
      "min_valid_outputs": 2,
      "qualitative": "lower_median"
    },
    "award_policy": {
      "acceptance_window_hours": 72,
      "approvals_required": 1,
      "deviation_requires_rationale": true
    },
    "budget_cap_minor": "15000000000",
    "criteria": [
      {
        "id": "price",
        "type": "price_lowest_ratio",
        "weight_bp": 4000
      },
      {
        "anchors": {
          "0": "No methodology given.",
          "1": "Generic statements only, nothing tied to this scope.",
          "2": "Some specific steps but major gaps, such as no testing or no threat model.",
          "3": "Clear plan covering manual review and testing, few specifics on NEAR async risks.",
          "4": "Specific plan covering manual review, tests or fuzzing, NEAR cross-contract and callback risks, and reporting.",
          "5": "As 4, plus concrete deliverables, a timeline per phase, and a retest of fixes."
        },
        "id": "methodology",
        "question": "How credible and specific is the proposed review methodology for this scope?",
        "source_fields": [
          "methodology"
        ],
        "type": "qualitative",
        "weight_bp": 3500
      },
      {
        "anchors": {
          "0": "No experience given.",
          "1": "Unverifiable claims only.",
          "2": "General smart-contract experience, nothing NEAR-specific or checkable.",
          "3": "Some NEAR or Rust contract experience, partly checkable.",
          "4": "Several relevant NEAR reviews with checkable public reports.",
          "5": "As 4, plus directly comparable work such as DAO treasury or callback-heavy contracts."
        },
        "id": "track_record",
        "question": "How relevant and checkable is the vendor's prior experience for this scope?",
        "source_fields": [
          "track_record"
        ],
        "type": "qualitative",
        "weight_bp": 2500
      }
    ],
    "currency": {
      "asset": "nep141:usdc.sealedchoice.testnet",
      "decimals": 6,
      "symbol": "tUSDC"
    },
    "eligibility": {
      "require_delivery_lte_max": true,
      "require_price_lte_cap": true,
      "required_fields": [
        "price_minor",
        "delivery_days",
        "methodology",
        "track_record"
      ]
    },
    "max_delivery_days": 30,
    "models": [
      "Qwen/Qwen3.6-35B-A3B-FP8",
      "z-ai/glm-5.3-flash"
    ],
    "scope": "Manual security review of about 1,200 lines of Rust (near-sdk 5.x): a treasury module with cross-contract withdrawals, allowances and callbacks. Deliverable: written report with severity ratings and one retest of fixes.",
    "tie_break": [
      "total_desc",
      "price_asc",
      "index_asc"
    ],
    "title": "Security review of a DAO treasury module (near-sdk, Rust)",
    "v": 1
  } as Rubric;

/** The models a tender may pin, from the template rather than typed into a component. */
export const AVAILABLE_MODELS: readonly string[] = RUBRIC_TEMPLATE.models;
