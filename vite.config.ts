import { configDefaults, defineConfig } from "vitest/config";
import type { VitestPluginContext } from "vitest/node";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

const junitOutputFile = process.env.VITEST_JUNIT_OUTPUT_FILE?.trim();
const runPerformanceSuites = process.env.VITE_RUN_PERFORMANCE_GATES === "1";
const runBenchmarkSuites = process.env.VITE_RUN_BENCHMARK_SUITES === "1";
const performanceSuiteGlobs = ["**/*.performance.test.ts", "**/*.performance.test.tsx"];
const benchmarkSuiteGlobs = ["**/*.benchmark.test.ts", "**/*.benchmark.test.tsx"];
const junitReporterPlugin = junitOutputFile
  ? {
      name: "nuinuicad-junit-reporter",
      configureVitest: ({ project }: VitestPluginContext) => {
        project.config.reporters.push(["junit", {}]);
      }
    }
  : null;

export default defineConfig({
  plugins: [react(), ...(junitReporterPlugin ? [junitReporterPlugin] : [])],
  clearScreen: false,
  resolve: {
    alias: {
      vscode: resolve("vscode-extension/src/vscode-test-module.ts")
    }
  },
  server: {
    port: 5173,
    strictPort: true
  },
  build: {
    target: "es2022",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
              priority: 10
            }
          ]
        }
      }
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    exclude: [
      ...configDefaults.exclude,
      "automation/linear-github-mirror/test/**/*.test.js",
      ...(runPerformanceSuites ? [] : performanceSuiteGlobs),
      ...(runBenchmarkSuites ? [] : benchmarkSuiteGlobs)
    ],
    ...(junitOutputFile
      ? {
          outputFile: { junit: junitOutputFile }
        }
      : {})
  }
});
