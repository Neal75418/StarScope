import { fixupPluginRules } from "@eslint/compat";
import js from "@eslint/js";
import globals from "globals";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
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
      // eslint-plugin-react（最後發版 7.37.5，2025-04）與 jsx-a11y（6.10.2，2024-10）的 peer 只到 ESLint 9，
      // 由 package.json 的 overrides 放寬。react 要包 fixupPluginRules，兩個原因：
      // - react.version: "detect" 直接呼叫 ESLint 10 移除的 context.getFilename()，規則一載入就丟 TypeError
      // - 判斷 JSDoc 標註的 class component 時呼叫已移除的 sourceCode.getJSDocComment()，錯誤被它自己的
      //   try/catch 吞掉，相關規則會靜默失效
      // jsx-a11y 只用 context.report／options／settings，不需要包
      react: fixupPluginRules(reactPlugin),
      "react-hooks": reactHooksPlugin,
      "jsx-a11y": jsxA11y,
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
      // tauri-plugin-dialog 會把 window.confirm 換成回傳 Promise 的版本（永遠 truthy）：
      // `if (confirm(...)) remove()` 在 app 裡一定會執行。確認一律用 ConfirmDialog
      "no-alert": "error",
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

      // Accessibility rules
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/anchor-has-content": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-role": "error",
      "jsx-a11y/aria-unsupported-elements": "error",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/role-has-required-aria-props": "error",

      // General rules
      "no-console": "error",
      "no-debugger": "warn",
      "prefer-const": "warn",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },

  // Prettier must be last to override other formatting rules
  prettierConfig
);
