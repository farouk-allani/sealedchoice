// Scoring core port and the public verification checks (docs/06-evidence-and-verification.md).
// `runChecks` is pure: `loadEvidence` does the fetching, so the CLI and the verify page run the
// same ten checks over the same object.
export { runChecks, summarise } from "./checks.ts";
export { LoadError, loadEvidence } from "./load.ts";
export type { LoadOptions } from "./load.ts";
export {
  attemptViewSchema,
  bidViewSchema,
  configViewSchema,
  evaluatorRefSchema,
  frozenViewSchema,
  tenderViewSchema,
} from "./evidence.ts";
export type {
  AttemptView,
  BidView,
  CheckLink,
  CheckResult,
  Evidence,
  FrozenView,
  TenderView,
} from "./evidence.ts";
export { NotCanonicalError, isCanonicalJson, sha256OfCanonicalJson } from "./canonical.ts";
export { type Json, JsonFloat, JsonInt, JsonObject, JsonParseError, parseJson } from "./json.ts";
export {
  type BidInput,
  type BidResult,
  type CriterionResult,
  CompactResultError,
  type Evaluation,
  FLAG,
  INJECTION_PATTERNS,
  MAX_SAFE_INT,
  type ModelDetail,
  ScoringInputError,
  asciiFold,
  checkEligibility,
  compactResult,
  evaluate,
  injectionSuspected,
  isInt,
  isPosIntStr,
  modelCriterion,
  norm,
  scoreQualitative,
  textField,
} from "./scoring.ts";
export { FLAG_EXPLANATIONS, explainFlags, runDebriefChecks } from "./debrief.ts";
export type { DebriefEvidence, FrozenBid } from "./debrief.ts";
export { DebriefError, openDebrief } from "./debrief-open.ts";
export type { OpenDebriefOptions, OpenedDebrief } from "./debrief-open.ts";
