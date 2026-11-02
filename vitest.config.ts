// Root config: `pnpm vitest` runs every project at once. `pnpm -r test` runs them one by one.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "scripts", "apps/web"],
  },
});
