import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnvError, loadEnv, parseNetworkArgs, validateEnv } from "./env.ts";

// Fake key built at runtime so no key-shaped literal sits in the source.
const FAKE_KEY = "ed25519:" + "1".repeat(64);

describe("parseNetworkArgs", () => {
  it("defaults to testnet and keeps the other arguments", () => {
    expect(parseNetworkArgs(["--tender", "7"])).toEqual({ network: "testnet", confirm: false, args: ["--tender", "7"] });
  });

  it("accepts --network testnet and --network=testnet", () => {
    expect(parseNetworkArgs(["--network", "testnet"]).network).toBe("testnet");
    expect(parseNetworkArgs(["--network=testnet"]).network).toBe("testnet");
  });

  it("refuses mainnet without --confirm", () => {
    expect(() => parseNetworkArgs(["--network", "mainnet"])).toThrow(EnvError);
    expect(() => parseNetworkArgs(["--network=mainnet"])).toThrow(/--confirm/);
  });

  it("allows mainnet with --confirm, in any order", () => {
    expect(parseNetworkArgs(["--confirm", "--network", "mainnet"])).toEqual({
      network: "mainnet",
      confirm: true,
      args: [],
    });
  });

  it("rejects unknown networks and a missing value", () => {
    expect(() => parseNetworkArgs(["--network", "localnet"])).toThrow(/unknown network/);
    expect(() => parseNetworkArgs(["--network"])).toThrow(/needs a value/);
    expect(() => parseNetworkArgs(["--network", "--confirm"])).toThrow(/needs a value/);
  });
});

describe("validateEnv", () => {
  it("accepts a testnet configuration and treats empty strings as unset", () => {
    const env = validateEnv(
      { NETWORK: "testnet", CONTRACT_ID: "tenders.sealedchoice.testnet", BUYER_PRIVATE_KEY: FAKE_KEY, NEAR_RPC_URL: "" },
      "testnet",
    );
    expect(env.CONTRACT_ID).toBe("tenders.sealedchoice.testnet");
    expect(env.NEAR_RPC_URL).toBeUndefined();
  });

  it("ignores variables it does not know", () => {
    expect(validateEnv({ HOME: "/root", PATH: "/bin" }, "testnet")).toEqual({});
  });

  it("names missing required keys", () => {
    expect(() => validateEnv({}, "testnet", ["CONTRACT_ID", "BUYER_PRIVATE_KEY"])).toThrow(
      "missing in .env: CONTRACT_ID, BUYER_PRIVATE_KEY",
    );
  });

  it("refuses a NETWORK that disagrees with --network", () => {
    expect(() => validateEnv({ NETWORK: "testnet" }, "mainnet")).toThrow(/NETWORK=testnet/);
  });

  it("refuses accounts from the other network", () => {
    expect(() => validateEnv({ CONTRACT_ID: "tenders.sealedchoice.near" }, "testnet")).toThrow(
      "not testnet accounts: CONTRACT_ID",
    );
    expect(() => validateEnv({ BUYER_ACCOUNT_ID: "buyer.sealedchoice.testnet" }, "mainnet")).toThrow(
      "not mainnet accounts: BUYER_ACCOUNT_ID",
    );
  });

  it("accepts implicit (64-hex) accounts on either network", () => {
    const usdc = "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1";
    expect(validateEnv({ TOKEN_ID: usdc }, "mainnet").TOKEN_ID).toBe(usdc);
  });

  it("never puts a value in the error message", () => {
    const badKey = "ed25519:" + "0OIl".repeat(12); // not base58
    try {
      validateEnv({ VENDOR_A_PRIVATE_KEY: badKey, EVALUATOR_WASM_SHA256: "ABC" }, "testnet");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvError);
      const msg = (e as Error).message;
      expect(msg).toContain("VENDOR_A_PRIVATE_KEY");
      expect(msg).toContain("EVALUATOR_WASM_SHA256");
      expect(msg).not.toContain(badKey);
      expect(msg).not.toContain("0OIl");
    }
  });
});

describe("loadEnv", () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reads the env file and lets the process environment win", () => {
    dir = mkdtempSync(join(tmpdir(), "env-test-"));
    const file = join(dir, "dotenv");
    writeFileSync(file, "CONTRACT_ID=file.sealedchoice.testnet\nBUYER_ACCOUNT_ID=buyer.sealedchoice.testnet\n");
    const { cli, env } = loadEnv(["--network", "testnet"], {
      envFile: file,
      processEnv: { CONTRACT_ID: "proc.sealedchoice.testnet" },
    });
    expect(cli.network).toBe("testnet");
    expect(env.CONTRACT_ID).toBe("proc.sealedchoice.testnet");
    expect(env.BUYER_ACCOUNT_ID).toBe("buyer.sealedchoice.testnet");
  });

  it("works without an env file", () => {
    const { env } = loadEnv([], { envFile: "/nonexistent/.env", processEnv: {} });
    expect(env).toEqual({});
  });

  it("refuses mainnet without --confirm before reading anything", () => {
    expect(() => loadEnv(["--network", "mainnet"], { envFile: "/nonexistent/.env", processEnv: {} })).toThrow(
      /--confirm/,
    );
  });
});
