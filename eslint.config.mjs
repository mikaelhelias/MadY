import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";

export default [
  { ignores: ["**/node_modules/**", "**/dist/**", "**/out/**", "installers/**", "docs/**"] },
  {
    files: ["apps/desktop/src/**/*.{ts,tsx}", "packages/*/src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser, parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } } },
    plugins: { "react-hooks": hooks, "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-explicit-any": "error", "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "error" },
  },
];
