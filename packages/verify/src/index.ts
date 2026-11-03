// Scoring core port and verification checks (docs/06-evidence-and-verification.md).
// T10 part 1: the scoring core, pinned by specs/test-vectors. The checks against chain state and
// bundles come with the rest of T10, after T07.
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
