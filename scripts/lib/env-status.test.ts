import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { envStatus, formatEnvStatus, readEnvStatus } from "./env-status.ts";

// Built at runtime so no key-shaped literal sits in the source.
const FAKE_KEY = "ed25519:" + "1".repeat(64);
const SECRET_VALUE = "s3cr3t-" + "x".repeat(40);
// Same reason: a JWT-shaped literal would trip the repository's secret scan.
const FAKE_JWT = ["header", "payload", "signature"].join(".");

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function envFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "env-status-"));
  dirs.push(dir);
  const file = join(dir, ".env");
  writeFileSync(file, contents);
  return file;
}

describe("envStatus", () => {
  it("marks set keys present, empty keys missing and malformed keys invalid", () => {
    const status = envStatus(
      { BUYER_ACCOUNT_ID: "buyer.sealedchoice.testnet", BUYER_PRIVATE_KEY: "  ", DEPLOYER_PRIVATE_KEY: "not-a-key" },
      "testnet",
    );
    const state = (key: string) => status.keys.find((k) => k.key === key)?.state;
    expect(state("BUYER_ACCOUNT_ID")).toBe("ok");
    expect(state("BUYER_PRIVATE_KEY")).toBe("missing");
    expect(state("NEARAI_API_KEY")).toBe("missing");
    expect(state("DEPLOYER_PRIVATE_KEY")).toBe("invalid");
  });

  it("reports one bad key without hiding the others", () => {
    const status = envStatus({ CONTRACT_ID: "NOT VALID", TOKEN_ID: "t.testnet" }, "testnet");
    expect(status.keys.find((k) => k.key === "CONTRACT_ID")?.state).toBe("invalid");
    expect(status.keys.find((k) => k.key === "TOKEN_ID")?.state).toBe("ok");
  });

  it("reports accounts from the other network as a problem", () => {
    const status = envStatus({ CONTRACT_ID: "tenders.sealedchoice.near" }, "testnet");
    expect(status.problems.join(" ")).toMatch(/not testnet accounts/);
  });

  it("lists unknown keys by name only", () => {
    const status = envStatus({ SPIKE_CALLER_ACCOUNT_ID: "spike-caller.sealedchoice.testnet" }, "testnet", {
      present: ["SPIKE_CALLER_ACCOUNT_ID"],
    });
    expect(status.unknown).toEqual(["SPIKE_CALLER_ACCOUNT_ID"]);
  });

  it("never puts a value in the report", () => {
    const raw = {
      BUYER_ACCOUNT_ID: "buyer.sealedchoice.testnet",
      BUYER_PRIVATE_KEY: FAKE_KEY,
      NEARAI_API_KEY: SECRET_VALUE,
      ONECLICK_JWT: FAKE_JWT,
      WEIRD_KEY: SECRET_VALUE,
    };
    const text = formatEnvStatus(envStatus(raw, "testnet", { present: Object.keys(raw) }));
    for (const value of Object.values(raw)) expect(text).not.toContain(value);
    expect(text).toContain("WEIRD_KEY");
    expect(text).toContain("NEARAI_API_KEY");
  });
});

describe("readEnvStatus", () => {
  it("reads a file and keeps its values out of the report", () => {
    const file = envFile(`BUYER_ACCOUNT_ID=buyer.sealedchoice.testnet\nBUYER_PRIVATE_KEY=${FAKE_KEY}\nEXTRA_THING=${SECRET_VALUE}\n`);
    const status = readEnvStatus("testnet", file);
    expect(status.fileExists).toBe(true);
    expect(status.keys.find((k) => k.key === "BUYER_PRIVATE_KEY")?.state).toBe("ok");
    expect(status.unknown).toEqual(["EXTRA_THING"]);
    expect(formatEnvStatus(status)).not.toContain(FAKE_KEY);
  });

  it("says so when there is no file", () => {
    const dir = mkdtempSync(join(tmpdir(), "env-status-"));
    dirs.push(dir);
    const status = readEnvStatus("testnet", join(dir, "nothing-here"));
    expect(status.fileExists).toBe(false);
    expect(formatEnvStatus(status)).toContain("NOT FOUND");
  });
});
