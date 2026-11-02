// Vitest globalSetup (runs in Node, outside any test environment): bundles the package for
// platform=browser with esbuild and hands the file to src/browser.test.ts via `inject`.
// esbuild itself cannot run inside the jsdom environment.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    browserBundle: { file: string; inputs: string[] };
  }
}

export default async function setup(project: TestProject) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("../src/index.ts", import.meta.url))],
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2022",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  const out = result.outputFiles[0];
  if (out === undefined) throw new Error("esbuild produced no output");
  // Inside the project root (the test runner only loads modules from there); git-ignored.
  const dir = fileURLToPath(new URL("../node_modules/.cache/browser-bundle/", import.meta.url));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "crypto.browser.mjs");
  writeFileSync(file, out.text);
  project.provide("browserBundle", { file, inputs: Object.keys(result.metafile.inputs) });
  return () => rmSync(dir, { recursive: true, force: true });
}
