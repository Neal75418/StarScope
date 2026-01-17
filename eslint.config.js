import js from "@eslint/js";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Ignore patterns
  {
    ignores: [
      "dist/**",
      "src-tauri/**",
      "node_modules/**",
      "e2e/**",
      "*.config.js",
      "*.config.ts",
      "playwright.config.ts",
    ],
  },

  // Base JavaScript rules
  js.configs.recommended,

  // TypeScript rules
  ...tseslint.configs.recommended,

  // React configuration
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // React rules
      "react/jsx-uses-react": "off", // Not needed with React 17+ JSX transform
      "react/react-in-jsx-scope": "off", // Not needed with React 17+ JSX transform
      "react/prop-types": "off", // Using TypeScript for type checking
      "react/jsx-key": "error",
      "react/jsx-no-duplicate-props": "error",
      "react/jsx-no-undef": "error",
      "react/no-children-prop": "error",
      "react/no-danger-with-children": "error",
      "react/no-deprecated": "warn",
      "react/no-direct-mutation-state": "error",
      "react/no-unescaped-entities": "warn",
      "react/no-unknown-property": "error",
      "react/self-closing-comp": "warn",

      // React Hooks rules
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // TypeScript rules
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",

      // General rules
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "warn",
      "prefer-const": "warn",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  // Prettier must be last to override other formatting rules
  prettierConfig
);
