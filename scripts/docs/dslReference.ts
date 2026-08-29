import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DSL_CONTAINER_CATEGORIES,
  DSL_GEOMETRY_DECLARATION_CATEGORIES,
  MUTATION_CATEGORY,
  commonArgSpecs,
  constructionCandidatesFor,
  type DslConstructionCategory,
  type DslConstructionSpec,
} from "../../src/dsl/dslConstructions";
import { compileDslDocument } from "../../src/dsl/dslDocument";
import { dslStatementKeywords } from "../../src/dsl/dslStatementKeywords";
import { createCadElement } from "../../src/model/elementFactory";
import { getParameterDefinitions, type ParameterDefinition } from "../../src/parameters/parameterDefinitions";
import {
  BUILTIN_FUNCTION_DEFINITIONS,
  formatBuiltinFunctionSignatures,
  type BuiltinFunctionDefinition,
  type BuiltinParameterType,
} from "../../src/scalars/builtinFunctions";
import type { CadElement, CadElementType } from "../../src/types/geometry";

export const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export const REFERENCE_DOCUMENTS = [
  "docs/dsl/en/index.md",
  "docs/dsl/en/syntax.md",
  "docs/dsl/en/types.md",
  "docs/dsl/en/expressions.md",
  "docs/dsl/en/declarations.md",
  "docs/dsl/en/constructions.md",
  "docs/dsl/en/control-flow.md",
  "docs/dsl/en/modules.md",
  "docs/dsl/en/records.md",
  "docs/dsl/en/modifiers.md",
  "docs/dsl/en/output.md",
  "docs/dsl/en/builtins.md",
] as const;

const generatedRegionStart = (name: string) => `<!-- dsl-ref:generated:start ${name} -->`;
const generatedRegionEnd = (name: string) => `<!-- dsl-ref:generated:end ${name} -->`;

export type ParameterFact = {
  key: string;
  kind: ParameterDefinition["kind"];
  allowCoordinate: boolean;
  allowNone: boolean;
  choiceOptions: readonly string[];
  stepLevels: readonly number[];
};

export type ArgumentFact = {
  arg: string;
  parameterKey: string | null;
  required: boolean;
  positional: boolean;
  special: string | null;
};

export type ConstructionFact = {
  id: string;
  category: DslConstructionCategory;
  construction: string;
  elementType: CadElementType;
  arguments: readonly ArgumentFact[];
  parameters: readonly ParameterFact[];
};

export type StatementFact = {
  id: string;
  spelling: string;
};

export type BuiltinSignatureFact = {
  callingStyle: "positional" | "named";
  parameterTypes: readonly string[];
  returnType: string;
};

export type BuiltinFact = {
  id: string;
  name: string;
  signatures: readonly BuiltinSignatureFact[];
  formattedSignatures: string;
};

export type DslReferenceFacts = {
  constructions: readonly ConstructionFact[];
  statements: readonly StatementFact[];
  builtins: readonly BuiltinFact[];
};

export type DocumentSourceMap = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

export type DslExampleClassification =
  | { kind: "compile-success" }
  | { kind: "expected-diagnostic"; code: string }
  | { kind: "syntax-fragment" };

export type DslExample = {
  document: string;
  line: number;
  source: string;
  classification: DslExampleClassification | null;
};

export type DslReferenceIssue = {
  document?: string;
  line?: number;
  message: string;
};

const allConstructionCategories: readonly DslConstructionCategory[] = [
  ...DSL_GEOMETRY_DECLARATION_CATEGORIES,
  ...DSL_CONTAINER_CATEGORIES,
  MUTATION_CATEGORY,
];

const sampleElements = new Map<CadElementType, CadElement>();

const sampleElementFor = (type: CadElementType): CadElement => {
  const cached = sampleElements.get(type);
  if (cached) return cached;
  const sample = createCadElement(type, [], {
    createId: (elementType) => `dsl-reference-sample:${elementType}`,
  });
  sampleElements.set(type, sample);
  return sample;
};

const parameterFactFor = (definition: ParameterDefinition): ParameterFact => ({
  key: definition.key,
  kind: definition.kind,
  allowCoordinate: definition.allowCoordinate === true,
  allowNone: definition.allowNone === true,
  choiceOptions: definition.choiceOptions ?? [],
  stepLevels: definition.stepLevels ?? [],
});

const argumentFactFor = (argument: DslConstructionSpec["args"][number]): ArgumentFact => ({
  arg: argument.arg,
  parameterKey: argument.parameterKey ?? (argument.special ? null : argument.arg),
  required: argument.required === true,
  positional: argument.positional === true,
  special: argument.special ?? null,
});

const constructionIdFor = (spec: DslConstructionSpec): string =>
  spec.construction
    ? `dsl-ref:construction:${spec.category}/${spec.construction}`
    : `dsl-ref:construction:${spec.category}`;

const constructionFacts = (): readonly ConstructionFact[] => allConstructionCategories.flatMap((category) =>
  constructionCandidatesFor(category).map((spec) => {
    const parameters = getParameterDefinitions(sampleElementFor(spec.elementType)).map(parameterFactFor);
    const argumentsForSpec = [...spec.args, ...commonArgSpecs].map(argumentFactFor);
    return {
      id: constructionIdFor(spec),
      category: spec.category,
      construction: spec.construction,
      elementType: spec.elementType,
      arguments: argumentsForSpec,
      parameters,
    } satisfies ConstructionFact;
  }),
);

const statementFacts = (): readonly StatementFact[] => [...new Set(Object.values(dslStatementKeywords))].map((spelling) => ({
  id: `dsl-ref:statement:${spelling}`,
  spelling,
}));

const builtinTypeDisplayName = (type: BuiltinParameterType): string => {
  if (typeof type === "string") return type;
  if (type.kind === "anyChoice") return "choice(...)";
  if (type.kind === "choice") return `choice(${type.options.join(", ")})`;
  return type.kind;
};

const builtinSignatureFactFor = (
  signature: BuiltinFunctionDefinition["signatures"][number],
): BuiltinSignatureFact => {
  const parameterTypes = signature.callingStyle === "named"
    ? signature.parameters.map((parameter) => `${parameter.name}: ${builtinTypeDisplayName(parameter.type)}`)
    : signature.parameters.map((parameter) => builtinTypeDisplayName(parameter.type));
  return {
    callingStyle: signature.callingStyle,
    parameterTypes,
    returnType: builtinTypeDisplayName(signature.returnType),
  };
};

const builtinFacts = (): readonly BuiltinFact[] => BUILTIN_FUNCTION_DEFINITIONS.map((definition) => ({
  id: `dsl-ref:builtin:${definition.name}`,
  name: definition.name,
  signatures: definition.signatures.map((signature) => builtinSignatureFactFor(signature)),
  formattedSignatures: formatBuiltinFunctionSignatures(definition),
}));

export const buildDslReferenceFacts = (): DslReferenceFacts => ({
  constructions: constructionFacts(),
  statements: statementFacts(),
  builtins: builtinFacts(),
});

const markdownCell = (value: string | number | boolean): string => String(value).replaceAll("|", "\\|");

const constructionSyntax = (fact: ConstructionFact): string => {
  if (fact.category === "group") return "group Name { … }";
  if (fact.category === "if") return "if (condition) { … }";
  if (fact.category === "for") return "for variable in range(...) { … }";
  if (fact.category === MUTATION_CATEGORY) return `${fact.construction}(...)`;
  return `${fact.category} Name = ${fact.construction}(...)`;
};

const parameterSummary = (parameter: ParameterFact): string => {
  const details: string[] = [parameter.kind];
  if (parameter.choiceOptions.length > 0) details.push(`choices: ${parameter.choiceOptions.join(", ")}`);
  if (parameter.allowCoordinate) details.push("coordinates allowed");
  if (parameter.allowNone) details.push("none allowed");
  if (parameter.stepLevels.length > 0) details.push(`steps: ${parameter.stepLevels.join(", ")}`);
  return details.join("; ");
};

export const renderConstructionRegion = (facts: DslReferenceFacts): string => {
  const lines = [
    generatedRegionStart("constructions"),
    "<!-- This region is generated from src/dsl/dslConstructions.ts and src/parameters/parameterDefinitions.ts. -->",
  ];
  for (const fact of facts.constructions) {
    lines.push(
      `<!-- ${fact.id} -->`,
      `### \`${fact.category}${fact.construction ? ` / ${fact.construction}` : ""}\``,
      "",
      `**Syntax**: \`${constructionSyntax(fact)}\``,
      "",
      "**Parameters**:",
      "",
      "| Name | Kind and constraints |",
      "| --- | --- |",
    );
    for (const parameter of fact.parameters) {
      lines.push(`| \`${markdownCell(parameter.key)}\` | ${markdownCell(parameterSummary(parameter))} |`);
    }
    if (fact.parameters.length === 0) lines.push("| *(none)* | — |");
    lines.push(
      "",
      "**Arguments**:",
      "",
      "| Spelling | Parameter key | Required | Positional | Special |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const argument of fact.arguments) {
      lines.push(`| \`${markdownCell(argument.arg)}\` | ${argument.parameterKey ? `\`${markdownCell(argument.parameterKey)}\`` : "—"} | ${argument.required ? "yes" : "no"} | ${argument.positional ? "yes" : "no"} | ${argument.special ?? "—"} |`);
    }
    lines.push("");
  }
  lines.push(generatedRegionEnd("constructions"));
  return lines.join("\n");
};

export const renderStatementRegion = (facts: DslReferenceFacts): string => {
  const lines = [
    generatedRegionStart("statements"),
    "<!-- This region is generated from src/dsl/dslStatementKeywords.ts. -->",
    "| Parser spelling | Reference identity |",
    "| --- | --- |",
  ];
  for (const fact of facts.statements) {
    lines.push(`<!-- ${fact.id} -->`, `| \`${markdownCell(fact.spelling)}\` | \`${fact.id}\` |`);
  }
  lines.push(generatedRegionEnd("statements"));
  return lines.join("\n");
};

export const renderBuiltinRegion = (facts: DslReferenceFacts): string => {
  const lines = [
    generatedRegionStart("builtins"),
    "<!-- This region is generated from src/scalars/builtinFunctions.ts. -->",
    "| Builtin | Signatures | Reference identity |",
    "| --- | --- | --- |",
  ];
  for (const fact of facts.builtins) {
    lines.push(
      `<!-- ${fact.id} -->`,
      `| \`${fact.name}\` | ${markdownCell(fact.formattedSignatures)} | \`${fact.id}\` |`,
    );
  }
  lines.push(generatedRegionEnd("builtins"));
  return lines.join("\n");
};

export const generatedRegionsFor = (facts: DslReferenceFacts): ReadonlyMap<string, string> => new Map([
  ["docs/dsl/en/constructions.md", renderConstructionRegion(facts)],
  ["docs/dsl/en/syntax.md", renderStatementRegion(facts)],
  ["docs/dsl/en/builtins.md", renderBuiltinRegion(facts)],
]);

const generatedRegionEntries = (facts: DslReferenceFacts) => [
  { document: "docs/dsl/en/constructions.md", name: "constructions", rendered: renderConstructionRegion(facts) },
  { document: "docs/dsl/en/syntax.md", name: "statements", rendered: renderStatementRegion(facts) },
  { document: "docs/dsl/en/builtins.md", name: "builtins", rendered: renderBuiltinRegion(facts) },
] as const;

const replaceGeneratedRegion = (source: string, name: string, rendered: string): string => {
  const normalized = source.replace(/\r\n/g, "\n");
  const start = normalized.indexOf(generatedRegionStart(name));
  const end = normalized.indexOf(generatedRegionEnd(name));
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`Missing generated region markers for ${name}.`);
  }
  const endOfMarker = end + generatedRegionEnd(name).length;
  return `${normalized.slice(0, start)}${rendered}${normalized.slice(endOfMarker)}`;
};

export const applyGeneratedRegions = (
  documents: DocumentSourceMap,
  facts: DslReferenceFacts,
): ReadonlyMap<string, string> => {
  const current = asDocumentMap(documents);
  const regionsByDocument = new Map<string, ReturnType<typeof generatedRegionEntries>[number]>(
    generatedRegionEntries(facts).map((entry) => [entry.document, entry]),
  );
  return new Map(REFERENCE_DOCUMENTS.map((document) => {
    const source = current.get(document);
    if (source === undefined) throw new Error(`Missing DSL reference document: ${document}`);
    const region = regionsByDocument.get(document);
    return [document, region ? replaceGeneratedRegion(source, region.name, region.rendered) : source] as const;
  }));
};

const asDocumentMap = (documents: DocumentSourceMap): ReadonlyMap<string, string> =>
  documents instanceof Map ? documents : new Map(Object.entries(documents));

const referenceIdPattern = /<!--\s*(dsl-ref:[^>\s]+)\s*-->/g;

const expectedReferenceIds = (facts: DslReferenceFacts): Set<string> => new Set([
  ...facts.constructions.map((fact) => fact.id),
  ...facts.statements.map((fact) => fact.id),
  ...facts.builtins.map((fact) => fact.id),
]);

type GeneratedRegion = { start: number; end: number; content: string };

const generatedRegionFor = (source: string, name: string): GeneratedRegion | null => {
  const startMarker = generatedRegionStart(name);
  const endMarker = generatedRegionEnd(name);
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) return null;
  return { start, end: end + endMarker.length, content: source.slice(start, end + endMarker.length) };
};

const exampleClassificationFor = (line: string): DslExampleClassification | null => {
  const value = line.trim();
  if (value === "<!-- dsl-example: compile-success -->") return { kind: "compile-success" };
  if (value === "<!-- dsl-example: syntax-fragment -->") return { kind: "syntax-fragment" };
  const expected = /^<!-- dsl-example: expected-diagnostic code=([^\s>]+) -->$/.exec(value);
  return expected ? { kind: "expected-diagnostic", code: expected[1]! } : null;
};

export const extractNuiExamples = (document: string, source: string): DslExample[] => {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const examples: DslExample[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*```nui\s*$/.test(lines[index]!)) continue;
    const closing = lines.findIndex((line, candidate) => candidate > index && /^\s*```\s*$/.test(line));
    if (closing < 0) {
      examples.push({ document, line: index + 1, source: lines.slice(index + 1).join("\n"), classification: null });
      break;
    }
    examples.push({
      document,
      line: index + 1,
      source: lines.slice(index + 1, closing).join("\n"),
      classification: exampleClassificationFor(lines[index - 1] ?? ""),
    });
    index = closing;
  }
  return examples;
};

const compileReferenceExample = (source: string): ReturnType<typeof compileDslDocument> => {
  const firstAttempt = compileDslDocument(source);
  const assignedStatementIds = new Map(
    firstAttempt.statements.map((_, index) => [index, `dsl-reference-example:${index}`] as const),
  );
  return compileDslDocument(source, { assignedStatementIds });
};

export const validateDslExamples = (examples: readonly DslExample[]): DslReferenceIssue[] => {
  const issues: DslReferenceIssue[] = [];
  for (const example of examples) {
    if (!example.classification) {
      issues.push({ document: example.document, line: example.line, message: "nui code fence is missing a valid dsl-example classification." });
      continue;
    }
    if (example.classification.kind === "syntax-fragment") continue;
    let compiled: ReturnType<typeof compileDslDocument>;
    try {
      compiled = compileReferenceExample(example.source);
    } catch (error) {
      issues.push({ document: example.document, line: example.line, message: `production document compile facade threw: ${String(error)}` });
      continue;
    }
    const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
    if (example.classification.kind === "compile-success") {
      if (errors.length > 0) {
        issues.push({ document: example.document, line: example.line, message: `compile-success example has errors: ${errors.map((diagnostic) => diagnostic.code ?? diagnostic.message).join(", ")}` });
      }
      continue;
    }
    const expectedCode = example.classification.code;
    if (!errors.some((diagnostic) => diagnostic.code === expectedCode)) {
      issues.push({ document: example.document, line: example.line, message: `expected diagnostic ${expectedCode} was not produced by the production document compile facade.` });
    }
    const unexpected = errors.filter((diagnostic) => diagnostic.code !== expectedCode);
    if (unexpected.length > 0) {
      issues.push({ document: example.document, line: example.line, message: `expected-diagnostic example has unexpected errors: ${unexpected.map((diagnostic) => diagnostic.code ?? diagnostic.message).join(", ")}` });
    }
  }
  return issues;
};

const generatedRegionChecks = (
  documents: ReadonlyMap<string, string>,
  facts: DslReferenceFacts,
): DslReferenceIssue[] => {
  const issues: DslReferenceIssue[] = [];
  for (const { document, name, rendered } of generatedRegionEntries(facts)) {
    const source = documents.get(document);
    if (source === undefined) {
      issues.push({ document, message: "DSL reference document is missing." });
      continue;
    }
    const startCount = source.split(generatedRegionStart(name)).length - 1;
    const endCount = source.split(generatedRegionEnd(name)).length - 1;
    if (startCount !== 1 || endCount !== 1) {
      issues.push({ document, message: `generated region ${name} must have exactly one deterministic start and end marker.` });
      continue;
    }
    const region = generatedRegionFor(source, name);
    if (!region || region.content !== rendered) {
      issues.push({ document, message: `generated region ${name} is stale or has drifted.` });
    }
  }
  return issues;
};

export const checkDslReference = (
  documents: DocumentSourceMap,
  facts: DslReferenceFacts = buildDslReferenceFacts(),
): readonly DslReferenceIssue[] => {
  const documentMap = asDocumentMap(documents);
  const issues = generatedRegionChecks(documentMap, facts);
  const expectedIds = expectedReferenceIds(facts);
  const foundIds = new Map<string, Array<{ document: string; line: number }>>();
  for (const document of REFERENCE_DOCUMENTS) {
    const source = documentMap.get(document);
    if (source === undefined) continue;
    for (const match of source.matchAll(referenceIdPattern)) {
      const id = match[1]!;
      if (id.startsWith("dsl-ref:generated:")) continue;
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      const locations = foundIds.get(id) ?? [];
      locations.push({ document, line });
      foundIds.set(id, locations);
    }
    issues.push(...validateDslExamples(extractNuiExamples(document, source)));
  }
  for (const [id, locations] of foundIds) {
    if (locations.length > 1) {
      issues.push({ document: locations[0]?.document, line: locations[0]?.line, message: `duplicate DSL reference ID ${id}.` });
    }
    if (!expectedIds.has(id)) {
      issues.push({ document: locations[0]?.document, line: locations[0]?.line, message: `stale or unknown DSL reference ID ${id}.` });
    }
  }
  for (const id of expectedIds) {
    if (!foundIds.has(id)) issues.push({ message: `missing DSL reference ID ${id}.` });
  }
  return issues;
};

export const readReferenceDocuments = (root = REPOSITORY_ROOT): ReadonlyMap<string, string> => new Map(
  REFERENCE_DOCUMENTS.map((document) => [document, readFileSync(resolve(root, document), "utf8")]),
);

const printIssues = (issues: readonly DslReferenceIssue[]) => {
  for (const issue of issues) {
    const location = issue.document ? `${issue.document}${issue.line ? `:${issue.line}` : ""}: ` : "";
    process.stderr.write(`${location}${issue.message}\n`);
  }
};

const runCli = () => {
  const mode = process.argv[2];
  if (mode !== "--generate" && mode !== "--check") {
    process.stderr.write("Usage: tsx scripts/docs/dslReference.ts --generate|--check\n");
    process.exitCode = 2;
    return;
  }
  const facts = buildDslReferenceFacts();
  const documents = readReferenceDocuments();
  if (mode === "--check") {
    const issues = checkDslReference(documents, facts);
    if (issues.length > 0) {
      printIssues(issues);
      process.exitCode = 1;
      return;
    }
    process.stdout.write("DSL reference check passed.\n");
    return;
  }
  const generated = applyGeneratedRegions(documents, facts);
  for (const [document, source] of generated) {
    const path = resolve(REPOSITORY_ROOT, document);
    if (readFileSync(path, "utf8") !== source) writeFileSync(path, source);
  }
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
