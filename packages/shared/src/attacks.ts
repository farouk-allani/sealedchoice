import { z } from "zod";

// Public measurements only. No raw logs, signing material, plaintexts or reader keys.
export const attackMethodSchema = z.enum([
  "update_rubric", "close_and_evaluate", "submit_bid", "on_evaluate",
  "retry_evaluate", "propose_award", "accept_award",
]);
export const attackRecordSchema = z.object({
  id: z.number().int().min(1).max(11),
  title: z.string(),
  detail: z.string(),
  layer: z.enum(["contract", "runtime", "outlayer", "evaluator"]),
  outcome: z.string(),
  signer: z.string(),
  tx_hash: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{40,50}$/),
  request_id: z.number().int().positive().optional(),
  method: attackMethodSchema.optional(),
  bid_index: z.number().int().nonnegative().optional(),
}).strict();
export const attackReportSchema = z.object({
  version: z.literal(1),
  network: z.literal("testnet"),
  contract_id: z.string().endsWith(".testnet"),
  tender_id: z.number().int().nonnegative(),
  recorded_at: z.iso.datetime(),
  complete: z.boolean(),
  setup: z.record(z.string(), z.string()),
  records: z.array(attackRecordSchema),
}).strict().superRefine((report, ctx) => {
  const ids = report.records.map((r) => r.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate attack id" });
  if (report.complete && [1, 3, 4, 5, 6, 8, 9, 10, 11].some((id) => !ids.includes(id))) {
    ctx.addIssue({ code: "custom", message: "required evidence is missing" });
  }
});
export type AttackRecord = z.infer<typeof attackRecordSchema>;
export type AttackReport = z.infer<typeof attackReportSchema>;

/** Match a measured execution refusal, never a generic wallet or transport error. */
export function matchesAttackRefusal(failure: unknown, expected: string): boolean {
  const text = JSON.stringify(failure) ?? "";
  if (expected.startsWith("E_")) return text.match(/\bE_[A-Z0-9_]+\b/g)?.includes(expected) ?? false;
  if (expected === "MethodNotFound") return /MethodNotFound/.test(text);
  if (expected === "Private callback") return /Method on_evaluate is private/.test(text);
  return false;
}
