import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "site/dist/**", "node_modules/**", "coverage/**", ".forge/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^(_|ForgeUI)$" },
      ],
    },
  },
);
