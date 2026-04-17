import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config([
  {
    files: ["packages/**/*.{ts,tsx}"],
    extends: [tseslint.configs.base],
    plugins: { unicorn },
    rules: {
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
    },
  },
]);
