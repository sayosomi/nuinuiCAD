import { playwright } from "@vitest/browser-playwright";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      vscode: resolve("vscode-extension/src/vscode-test-module.ts")
    }
  },
  test: {
    globals: true,
    include: ["src/vscode/modulePreviewInvocation.browser.test.ts"],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }]
    }
  }
});
