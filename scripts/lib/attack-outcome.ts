import { z } from "zod";
import { matchesAttackRefusal } from "@tender/shared";

export const transactionOutcomeSchema = z.object({
  status: z.union([
    z.object({ Failure: z.unknown() }),
    z.object({ SuccessValue: z.string() }),
  ]),
  transaction_outcome: z.object({ id: z.string() }),
  receipts_outcome: z.array(z.object({ outcome: z.object({
    executor_id: z.string(), logs: z.array(z.string()), status: z.unknown(),
  }) })),
});
export type TransactionOutcome = z.infer<typeof transactionOutcomeSchema>;

/** Refuse transport failures, unrelated panics and successful calls as attack evidence. */
export function requireRefusal(raw: unknown, expected: string): string {
  const out = transactionOutcomeSchema.parse(raw);
  if (!("Failure" in out.status)) throw new Error("ATTACK SUCCEEDED: stop and inspect the tender");
  if (!matchesAttackRefusal(out.status.Failure, expected)) throw new Error(`unexpected refusal; expected ${expected}`);
  return out.transaction_outcome.id;
}

/** Only inspect the OutLayer receipt's own structured events. Never publish raw logs. */
export function outlayerEvents(raw: unknown, outlayer: string) {
  const out = transactionOutcomeSchema.parse(raw);
  const events: { event: string; data: Record<string, unknown> }[] = [];
  for (const receipt of out.receipts_outcome) {
    if (receipt.outcome.executor_id !== outlayer) continue;
    for (const log of receipt.outcome.logs) {
      if (!log.startsWith("EVENT_JSON:")) continue;
      const parsed = z.object({ event: z.string(), data: z.union([
        z.record(z.string(), z.unknown()), z.array(z.record(z.string(), z.unknown())),
      ]) }).safeParse(JSON.parse(log.slice(11)));
      if (parsed.success) {
        const data = Array.isArray(parsed.data.data) ? parsed.data.data : [parsed.data.data];
        events.push(...data.map((d) => ({ event: parsed.data.event, data: d })));
      }
    }
  }
  return events;
}
