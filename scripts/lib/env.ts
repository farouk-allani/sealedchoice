// Loads and validates the environment for scripts.
//
// - `--network testnet|mainnet` (default testnet). Mainnet also needs `--confirm`,
//   otherwise the script refuses to start.
// - Reads the repository's `.env` with dotenv (values already in the process
//   environment win), keeps only the keys below and validates them with zod.
// - Error messages name keys, never values: nothing here prints a secret.
import { existsSync, readFileSync } from "node:fs";
import { parse as parseDotenv } from "dotenv";
import { z } from "zod";

export const NETWORKS = ["testnet", "mainnet"] as const;
export type Network = (typeof NETWORKS)[number];

export class EnvError extends Error {
  override name = "EnvError";
}

export interface CliOptions {
  network: Network;
  confirm: boolean;
  /** Arguments left after removing `--network <n>` and `--confirm`. */
  args: string[];
}

/** Parses `--network` and `--confirm`; refuses mainnet without `--confirm`. */
export function parseNetworkArgs(argv: readonly string[]): CliOptions {
  let network: string = "testnet";
  let confirm = false;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--confirm") {
      confirm = true;
    } else if (a === "--network") {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("--")) throw new EnvError("--network needs a value: testnet or mainnet");
      network = v;
      i++;
    } else if (a.startsWith("--network=")) {
      network = a.slice("--network=".length);
    } else {
      args.push(a);
    }
  }
  if (!isNetwork(network)) throw new EnvError(`unknown network "${network}": use testnet or mainnet`);
  if (network === "mainnet" && !confirm) {
    throw new EnvError("refusing to run on mainnet without --confirm (pass --network mainnet --confirm)");
  }
  return { network, confirm, args };
}

function isNetwork(v: string): v is Network {
  return (NETWORKS as readonly string[]).includes(v);
}

// NEAR account id rules (nomicon: account ids), plus 64-hex implicit accounts.
const ACCOUNT_ID = /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const IMPLICIT_ACCOUNT = /^[0-9a-f]{64}$/;
const PRIVATE_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,90}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

const accountId = z.string().regex(ACCOUNT_ID, "not a valid NEAR account id");
const privateKey = z.string().regex(PRIVATE_KEY, "not an ed25519: private key");
const secret = z.string().min(1);

const envSchema = z.object({
  NETWORK: z.enum(NETWORKS).optional(),
  NEAR_RPC_URL: z.url().optional(),

  CONTRACT_ID: accountId.optional(),
  OUTLAYER_CONTRACT_ID: accountId.optional(),
  TOKEN_ID: accountId.optional(),

  DEPLOYER_ACCOUNT_ID: accountId.optional(),
  DEPLOYER_PRIVATE_KEY: privateKey.optional(),
  BUYER_ACCOUNT_ID: accountId.optional(),
  BUYER_PRIVATE_KEY: privateKey.optional(),
  REVIEWER_ACCOUNT_ID: accountId.optional(),
  REVIEWER_PRIVATE_KEY: privateKey.optional(),
  VENDOR_A_ACCOUNT_ID: accountId.optional(),
  VENDOR_A_PRIVATE_KEY: privateKey.optional(),
  VENDOR_B_ACCOUNT_ID: accountId.optional(),
  VENDOR_B_PRIVATE_KEY: privateKey.optional(),
  VENDOR_C_ACCOUNT_ID: accountId.optional(),
  VENDOR_C_PRIVATE_KEY: privateKey.optional(),
  ATTACKER_ACCOUNT_ID: accountId.optional(),
  ATTACKER_PRIVATE_KEY: privateKey.optional(),

  OUTLAYER_SECRETS_PROFILE: z.string().min(1).optional(),
  OUTLAYER_SECRETS_ACCOUNT_ID: accountId.optional(),
  EVALUATOR_WASM_URL: z.url().optional(),
  EVALUATOR_WASM_SHA256: z.string().regex(SHA256_HEX, "not a lowercase sha256 hex").optional(),

  NEARAI_API_KEY: secret.optional(),
  BUNDLE_STORE_URL: z.url().optional(),
  BUNDLE_STORE_TOKEN: secret.optional(),
  BLOB_READ_WRITE_TOKEN: secret.optional(),
  ONECLICK_JWT: secret.optional(),
});

export type Env = z.infer<typeof envSchema>;
export type EnvKey = keyof Env;
export const ENV_KEYS = Object.keys(envSchema.shape) as EnvKey[];

/**
 * Validates raw variables for `network`. Empty strings count as unset.
 * Throws EnvError naming the offending keys (never their values).
 */
export function validateEnv(
  raw: Readonly<Record<string, string | undefined>>,
  network: Network,
  required: readonly EnvKey[] = [],
): Env {
  const picked: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const v = raw[key];
    if (v !== undefined && v.trim() !== "") picked[key] = v.trim();
  }

  const result = envSchema.safeParse(picked);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new EnvError(`invalid environment:\n  ${lines.join("\n  ")}`);
  }
  const env = result.data;

  const missing = required.filter((k) => env[k] === undefined);
  if (missing.length > 0) throw new EnvError(`missing in .env: ${missing.join(", ")}`);

  if (env.NETWORK !== undefined && env.NETWORK !== network) {
    throw new EnvError(`.env says NETWORK=${env.NETWORK} but the command asked for --network ${network}`);
  }

  // Every named account must belong to the chosen network; implicit (64-hex) ids exist on both.
  const suffix = network === "testnet" ? ".testnet" : ".near";
  const wrong = ENV_KEYS.filter((k) => k.endsWith("_ACCOUNT_ID") || k === "CONTRACT_ID" || k === "TOKEN_ID").filter(
    (k) => {
      const v = env[k];
      return v !== undefined && !IMPLICIT_ACCOUNT.test(v) && !v.endsWith(suffix);
    },
  );
  if (wrong.length > 0) throw new EnvError(`not ${network} accounts: ${wrong.join(", ")}`);

  return env;
}

export interface LoadedEnv {
  cli: CliOptions;
  env: Env;
}

/** Default `.env` location: the repository root. */
export const DEFAULT_ENV_FILE = new URL("../../.env", import.meta.url);

/** Parses argv, reads `.env` (if present) and validates. Process env wins over the file. */
export function loadEnv(
  argv: readonly string[] = process.argv.slice(2),
  options: { required?: readonly EnvKey[]; envFile?: URL | string; processEnv?: NodeJS.ProcessEnv } = {},
): LoadedEnv {
  const cli = parseNetworkArgs(argv);
  const file = options.envFile ?? DEFAULT_ENV_FILE;
  const fromFile = existsSync(file) ? parseDotenv(readFileSync(file)) : {};
  const merged = { ...fromFile, ...pickDefined(options.processEnv ?? process.env) };
  const env = validateEnv(merged, cli.network, options.required);
  if (cli.network === "mainnet") {
    console.error("MAINNET: every transaction is printed before it is sent.");
  }
  return { cli, env };
}

function pickDefined(source: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const v = source[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}
