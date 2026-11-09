import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { attackReportSchema } from "@tender/shared";

const root = new URL("../../", import.meta.url);
const report = attackReportSchema.parse(JSON.parse(readFileSync(new URL("apps/web/src/data/attacks.json", root), "utf8")));
describe("recorded public attack evidence", () => {
  it("contains all required attempts, with every E_ code documented by the contract", () => {
    expect(report.complete).toBe(true);
    const readme = readFileSync(new URL("contracts/tender/README.md", root), "utf8");
    for (const record of report.records) {
      if (record.outcome.startsWith("E_")) expect(readme).toContain(`\`${record.outcome}\``);
    }
  });
  it("rejects an incomplete or duplicate complete report and private fields", () => {
    expect(attackReportSchema.safeParse({ ...report, records: [] }).success).toBe(false);
    expect(attackReportSchema.safeParse({ ...report, records: [...report.records, report.records[0]] }).success).toBe(false);
    expect(attackReportSchema.safeParse({ ...report, reader_key: "secret" }).success).toBe(false);
    expect(attackReportSchema.safeParse({ ...report, records: [{ ...report.records[0], raw_logs: ["secret"] }, ...report.records.slice(1)] }).success).toBe(false);
  });
});
