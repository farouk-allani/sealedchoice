// Reports which `.env` keys are present, without reading any value out loud.
//
// Claude Code never opens `.env` with its tools (CLAUDE.md); this is how a
// session finds out what it can use. Every row is key -> state, never a value,
// and the only thing said about an unknown key is its name.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse as parseDotenv } from "dotenv";
import { DEFAULT_ENV_FILE, ENV_KEYS, type EnvKey, type Network, validateEnv } from "./env.ts";

/**
 * What a name has to look like before the report repeats it: the UPPER_SNAKE_CASE
 * this project uses, and short. Base64 and hex tokens are mixed case or long, so
 * they fall outside it and are only counted — a line like `dGVzdHNlY3JldA==` is
 * read by dotenv as the key `dGVzdHNlY3JldA`, and echoing that would print the
 * very thing this script exists not to print.
 */
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,39}$/;

/** `ok`: present and valid · `invalid`: present but malformed · `missing`: unset or empty. */
export type KeyState = "ok" | "invalid" | "missing";

export interface KeyStatus {
  key: EnvKey;
  state: KeyState;
  /** Why it is invalid (zod's message, which names no value). Only set when `state` is `invalid`. */
  reason?: string;
}

export interface EnvStatus {
  file: string;
  fileExists: boolean;
  keys: KeyStatus[];
  /** Keys in the file that no script knows about, by name only. */
  unknown: string[];
  /** Lines whose "key" is not a plausible variable name: counted, never printed. */
  unprintable: number;
  /** Problems that are not about one key: a NETWORK mismatch, accounts from the other network. */
  problems: string[];
}

/** Keys grouped the way the tasks need them, for the printed report. */
export const ENV_GROUPS: ReadonlyArray<{ title: string; keys: readonly EnvKey[] }> = [
  { title: "Network and contracts", keys: ["NETWORK", "NEAR_RPC_URL", "CONTRACT_ID", "OUTLAYER_CONTRACT_ID", "TOKEN_ID"] },
  {
    title: "Accounts",
    keys: [
      "DEPLOYER_ACCOUNT_ID",
      "DEPLOYER_PRIVATE_KEY",
      "BUYER_ACCOUNT_ID",
      "BUYER_PRIVATE_KEY",
      "REVIEWER_ACCOUNT_ID",
      "REVIEWER_PRIVATE_KEY",
      "VENDOR_A_ACCOUNT_ID",
      "VENDOR_A_PRIVATE_KEY",
      "VENDOR_B_ACCOUNT_ID",
      "VENDOR_B_PRIVATE_KEY",
      "VENDOR_C_ACCOUNT_ID",
      "VENDOR_C_PRIVATE_KEY",
      "ATTACKER_ACCOUNT_ID",
      "ATTACKER_PRIVATE_KEY",
    ],
  },
  {
    title: "OutLayer (G1)",
    keys: ["OUTLAYER_SECRETS_PROFILE", "OUTLAYER_SECRETS_ACCOUNT_ID", "EVALUATOR_WASM_URL", "EVALUATOR_WASM_SHA256"],
  },
  { title: "NEAR AI Cloud (G3)", keys: ["NEARAI_API_KEY"] },
  { title: "Bundle store (T06)", keys: ["BUNDLE_STORE_URL", "BUNDLE_STORE_TOKEN", "BLOB_READ_WRITE_TOKEN"] },
  { title: "1Click (G4, T13)", keys: ["ONECLICK_JWT"] },
];

/**
 * Builds the report from raw variables. Values go in, only names and states come out.
 * Keys are validated one at a time, so one bad key does not hide the rest.
 */
export function envStatus(
  raw: Readonly<Record<string, string | undefined>>,
  network: Network,
  options: { file?: string; fileExists?: boolean; present?: readonly string[] } = {},
): EnvStatus {
  const set = (k: string): boolean => {
    const v = raw[k];
    return v !== undefined && v.trim() !== "";
  };

  const keys: KeyStatus[] = ENV_KEYS.map((key) => {
    if (!set(key)) return { key, state: "missing" as const };
    try {
      validateEnv({ [key]: raw[key] }, network);
      return { key, state: "ok" as const };
    } catch (error) {
      // EnvError's message names the key and the rule, never the value.
      const message = error instanceof Error ? error.message : String(error);
      const reason = message.split("\n").at(-1)?.trim().replace(`${key}: `, "") ?? "invalid";
      return { key, state: "invalid" as const, reason };
    }
  });

  const problems: string[] = [];
  try {
    validateEnv(raw, network);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    for (const line of message.split("\n").map((l) => l.trim())) {
      // Per-key messages are already a row above; keep only the whole-file rules.
      if (line.startsWith(".env says NETWORK=") || line.startsWith("not testnet accounts:") || line.startsWith("not mainnet accounts:")) {
        problems.push(line);
      }
    }
  }

  const known = new Set<string>(ENV_KEYS);
  // Only names that look like environment variables are repeated. dotenv reads
  // the left of any `=` as a key, so a stray line holding a pasted token
  // (`dGVzdHNlY3JldA==`) would otherwise arrive here as a "name" and be printed.
  const present = [...(options.present ?? Object.keys(raw))].filter((k) => !known.has(k));
  const unknown = present.filter((k) => ENV_NAME.test(k)).sort();
  const unprintable = present.length - unknown.length;

  return {
    file: options.file ?? "",
    fileExists: options.fileExists ?? false,
    keys,
    unknown,
    unprintable,
    problems,
  };
}

/** Reads the `.env` file (never printing it) and reports on it. */
export function readEnvStatus(network: Network, envFile: URL | string = DEFAULT_ENV_FILE): EnvStatus {
  const fileExists = existsSync(envFile);
  const fromFile = fileExists ? parseDotenv(readFileSync(envFile)) : {};
  const file = envFile instanceof URL ? fileURLToPath(envFile) : envFile;
  // The process environment can override a key, so count it as present too.
  const raw: Record<string, string | undefined> = { ...fromFile };
  for (const key of ENV_KEYS) {
    const v = process.env[key];
    if (v !== undefined) raw[key] = v;
  }
  return envStatus(raw, network, { file, fileExists, present: Object.keys(fromFile) });
}

/** Human-readable report. Contains no value from the file. */
export function formatEnvStatus(status: EnvStatus): string {
  const mark: Record<KeyState, string> = { ok: "present", invalid: "INVALID", missing: "missing" };
  const byKey = new Map(status.keys.map((k) => [k.key, k]));
  const lines: string[] = [];

  lines.push(status.fileExists ? `.env found: ${status.file}` : `.env NOT FOUND at ${status.file}`);
  lines.push("(values are never printed; only key names and whether they are set)");

  for (const group of ENV_GROUPS) {
    lines.push("", group.title);
    for (const key of group.keys) {
      const k = byKey.get(key);
      const state = k ? mark[k.state] : "missing";
      const why = k?.reason ? ` (${k.reason})` : "";
      lines.push(`  ${key.padEnd(28)} ${state}${why}`);
    }
  }

  if (status.unknown.length > 0) {
    lines.push("", `Other keys in the file (names only): ${status.unknown.join(", ")}`);
  }
  if (status.unprintable > 0) {
    lines.push("", `${status.unprintable} line(s) parsed as a key that is not a variable name: not printed, in case the text is itself a secret.`);
  }
  if (status.problems.length > 0) {
    lines.push("", "Problems:");
    for (const p of status.problems) lines.push(`  ${p}`);
  }

  const missing = status.keys.filter((k) => k.state === "missing").map((k) => k.key);
  const invalid = status.keys.filter((k) => k.state === "invalid").map((k) => k.key);
  lines.push("", `Summary: ${status.keys.length - missing.length - invalid.length} present, ${missing.length} missing, ${invalid.length} invalid.`);
  if (missing.length > 0) lines.push(`Missing: ${missing.join(", ")}`);
  if (invalid.length > 0) lines.push(`Invalid: ${invalid.join(", ")}`);
  return lines.join("\n");
}
