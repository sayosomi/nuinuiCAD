import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(".");
const rootSourceRoot = path.join(repositoryRoot, "src");

const hostRoots = [
  path.join(repositoryRoot, "vscode-extension", "src"),
  path.join(repositoryRoot, "mcp-server", "src"),
  path.join(repositoryRoot, "mcp-server", "test")
].filter((root) => existsSync(root));

const sourceFilesUnder = (root: string): string[] => {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (/\.tsx?$/.test(entry.name)) files.push(file);
    }
  };
  visit(root);
  return files.sort();
};

const sourceFiles = hostRoots.flatMap(sourceFilesUnder).sort();

const moduleSpecifiersIn = (sourceText: string, fileName: string): string[] => {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      specifiers.push(node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
};

const resolvedModulePath = (importingFile: string, specifier: string): string | undefined => {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(importingFile), specifier);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx")
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
};

const isWithin = (file: string, directory: string): boolean => {
  const relative = path.relative(directory, file);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

const isForwardingOnlyLanguageCoreShim = (file: string): boolean => {
  if (!isWithin(file, rootSourceRoot)) return false;
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const statements = [...sourceFile.statements];
  return statements.length > 0 && statements.every((statement) =>
    ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier !== undefined &&
    ts.isStringLiteral(statement.moduleSpecifier) &&
    statement.moduleSpecifier.text.includes("packages/nui-language/src/")
  );
};

const boundaryViolationFor = (importingFile: string, specifier: string): string | undefined => {
  if (
    specifier.includes("packages/nui-language/src/") ||
    specifier.startsWith("@nuinuicad/nui-language/src/")
  ) {
    return `direct Language Core package-internal import: ${specifier}`;
  }
  const resolved = resolvedModulePath(importingFile, specifier);
  if (resolved && isForwardingOnlyLanguageCoreShim(resolved)) {
    return `forwarding-only Language Core shim: ${specifier} -> ${path.relative(repositoryRoot, resolved)}`;
  }
  return undefined;
};

const violationsIn = (files: readonly string[]): string[] => files.flatMap((file) =>
  moduleSpecifiersIn(readFileSync(file, "utf8"), file).flatMap((specifier) => {
    const violation = boundaryViolationFor(file, specifier);
    return violation ? [`${path.relative(repositoryRoot, file)}: ${violation}`] : [];
  })
);

describe("Language Core host import boundary", () => {
  it("does not let VS Code or MCP hosts reach package internals or forwarding shims", () => {
    expect(violationsIn(sourceFiles)).toEqual([]);
  });

  it("rejects direct package-internal reach-through", () => {
    const hostFile = path.join(repositoryRoot, "vscode-extension", "src", "fixture.ts");
    expect(boundaryViolationFor(hostFile, "../../packages/nui-language/src/dsl/dslDocument")).toContain(
      "package-internal"
    );
  });

  it("rejects a relative fallback through a forwarding-only root shim", () => {
    const hostFile = path.join(repositoryRoot, "vscode-extension", "src", "fixture.ts");
    expect(boundaryViolationFor(hostFile, "../../src/dsl/dslDocument")).toContain(
      "forwarding-only"
    );
  });

  it("allows genuine root runtime implementations", () => {
    const hostFile = path.join(repositoryRoot, "mcp-server", "src", "fixture.ts");
    expect(boundaryViolationFor(hostFile, "../../src/geometry/evaluationPayload")).toBeUndefined();
  });

  it("allows supported Language Core package entries", () => {
    const hostFile = path.join(repositoryRoot, "mcp-server", "src", "fixture.ts");
    expect(boundaryViolationFor(hostFile, "@nuinuicad/nui-language")).toBeUndefined();
    expect(boundaryViolationFor(hostFile, "@nuinuicad/nui-language/document")).toBeUndefined();
    expect(boundaryViolationFor(hostFile, "@nuinuicad/nui-language/workspace")).toBeUndefined();
  });
});
