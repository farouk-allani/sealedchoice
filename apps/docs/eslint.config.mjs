import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["build/**", ".docusaurus/**", "node_modules/**"] },
  ...tseslint.configs.strict,
  { rules: { "@typescript-eslint/consistent-type-imports": "error" } },
);
