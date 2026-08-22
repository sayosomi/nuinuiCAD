import { build } from "esbuild";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outputDirectory = resolve(repositoryRoot, "vscode-extension/dist");
mkdirSync(outputDirectory, { recursive: true });

await build({
  entryPoints: [resolve(repositoryRoot, "vscode-extension/src/extensionEntry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  outfile: resolve(outputDirectory, "extension.js")
});

await build({
  entryPoints: [resolve(repositoryRoot, "src/vscode/main.tsx")],
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  define: {
    "import.meta.env.VITE_EVALUATION_ENGINE": "\"rust\"",
    "import.meta.env.DEV": "false"
  },
  loader: { ".css": "css" },
  outfile: resolve(outputDirectory, "webview.js")
});
