import { build } from "esbuild";
import ts from "typescript";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

const output = process.argv[2];
if (!output) throw new Error("Provide task-owned external build directory");
mkdirSync(output, { recursive: true });
const functions = new Set(["parseDslSnapshot", "reconcileStatements", "compileDslDocument", "compileDslToElements", "materializeModuleExecution", "compileMaterializedExecution", "buildModuleGeometryRuntime", "compileModuleScalarRuntime", "buildTypedDependencyGraph", "buildEvaluationOptions", "prepareRustEvaluation"]);
const inputs = {};
for (const instrumented of [false, true]) {
  await build({ entryPoints: ["test/fixtures/issue-1515/benchmark.ts"], bundle: true, platform: "node", format: "esm", target: "node24", sourcemap: "inline", outfile: resolve(output, instrumented ? "staged.mjs" : "normal.mjs"), plugins: instrumented ? [{
    name: "task-only-memory-probes",
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, args => {
        if (!args.path.includes("/packages/nui-language/src/") && !args.path.endsWith("/src/node/rustEvaluationProcess.ts")) return;
        const source = readFileSync(args.path, "utf8");
        inputs[args.path] = createHash("sha256").update(source).digest("hex");
        const ast = ts.createSourceFile(args.path, source, ts.ScriptTarget.Latest, true);
        const edits = [];
        function visit(node) {
          if (ts.isCallExpression(node)) {
            let label;
            if (ts.isIdentifier(node.expression) && functions.has(node.expression.text)) label = node.expression.text;
            if (args.path.endsWith("/src/node/rustEvaluationProcess.ts") && ts.isPropertyAccessExpression(node.expression) && node.expression.expression.getText(ast) === "JSON") label = node.expression.name.text === "stringify" ? "serializeFrame" : "parseResponse";
            if (label) {
              edits.push({ offset: node.getStart(ast), text: `globalThis.__issue1515Probe(${JSON.stringify(label)}, () => ` });
              edits.push({ offset: node.end, text: ")" });
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(ast);
        let contents = source;
        for (const edit of edits.sort((a,b) => b.offset - a.offset)) contents = contents.slice(0, edit.offset) + edit.text + contents.slice(edit.offset);
        return { contents, loader: "ts" };
      });
    }
  }] : [] });
}
writeFileSync(resolve(output, "instrumentation-input-hashes.json"), JSON.stringify(inputs, null, 2) + "\n");
console.log("Built normal and memory-instrumented CLI bundles", output);
