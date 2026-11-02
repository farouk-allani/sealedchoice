// Shared lint rules for packages/* and scripts/. apps/web has its own config (Next.js rules).
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// The real tender key exists only inside the TEE; the testing entry point derives it from a
// published fake secret for the vectors, so nothing but tests may import it.
const testingOnly = {
  name: "@tender/crypto/testing",
  message: "Test-only: the real tender key exists only in the TEE.",
};
const testingOnlyRelative = {
  regex: "(^|/)testing(\\.ts)?$",
  message: "Test-only: the real tender key exists only in the TEE.",
};

export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**", "**/coverage/**", "apps/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: { "no-restricted-imports": ["error", { paths: [testingOnly], patterns: [testingOnlyRelative] }] },
  },
  {
    // Code that runs in the browser (bid encryption, debrief decryption, the verify page).
    files: ["packages/shared/src/**/*.ts", "packages/crypto/src/**/*.ts", "packages/verify/src/**/*.ts"],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            testingOnly,
            ...["fs", "crypto", "buffer", "path", "os", "url", "util", "stream"].map((name) => ({
              name,
              message: "Browser code: no Node built-ins (use @noble/* or Web APIs).",
            })),
          ],
          patterns: [
            testingOnlyRelative,
            { regex: "^node:", message: "Browser code: no Node built-ins (use @noble/* or Web APIs)." },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        { name: "Buffer", message: "Browser code: use Uint8Array." },
        { name: "process", message: "Browser code: no process; pass configuration in." },
        { name: "require", message: "ESM only." },
      ],
    },
  },
);
