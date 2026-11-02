import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./test/browser-bundle.setup.ts"],
  },
});
