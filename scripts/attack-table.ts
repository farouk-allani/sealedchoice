// T15 can generate the README table from the exact data rendered by /attacks.
import { readFileSync } from "node:fs";
import { attackReportSchema } from "@tender/shared";

const report = attackReportSchema.parse(JSON.parse(readFileSync(new URL("../apps/web/src/data/attacks.json", import.meta.url), "utf8")));
console.log("| Attempt | Recorded outcome | Testnet evidence |");
console.log("|---|---|---|");
for (const row of report.records) {
  console.log(`| ${row.id}. ${row.title} | ${row.outcome} | [Transaction](https://testnet.nearblocks.io/txns/${row.tx_hash})${row.request_id ? `, OutLayer request ${row.request_id}` : ""} |`);
}
