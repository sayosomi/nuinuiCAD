import { createCadElement } from "../model/elementFactory";
import { getParameterDefinitions, type ParameterDefinition } from "../parameters/parameterDefinitions";
import { setParameterValue } from "../parameters/parameterAccess";
import type { CadElement, CadElementType, LineEndpointReference } from "../types/geometry";
import { resolveParameterValueSpan } from "./dslParameterSpans";
import { documentDslRefs } from "./dslSerializer";
import { serializeElementStatementLogical } from "./dslSerializeElement";
import { isElementDslStatement } from "./dslParser";
import type { DslStatement } from "./dslTypes";
import { NEW_DOCUMENT_DSL_MAJOR_VERSION } from "./dslVersion";

export type DslCompletionParameter = {
  definition: ParameterDefinition;
  /** v2 unifies all element call arguments into `key: value` (no positional/
   * named split), so every non-name parameter maps to "attr". "printLayoutBlock"
   * marks a synthetic parameter for `place`/`layoutVar`/`printLayout` block
   * statements, which have no real CadElement/ParameterDefinition to derive
   * "attr" from. A distinct source value (rather than reusing `key` as the
   * routing marker, the way dslVarsAttributeParameterKey does) avoids
   * colliding with ordinary element attr keys that happen to share the same
   * name (e.g. `angle`, `scale`, `expression`). */
  source: "name" | "attr" | "printLayoutBlock";
  key: string;
};

export type DslCompletionElementMetadata = {
  parameters: readonly DslCompletionParameter[];
  attributes: readonly DslCompletionParameter[];
};

const cache = new Map<CadElementType, DslCompletionElementMetadata>();

const sampleValue = (definition: ParameterDefinition): unknown => {
  switch (definition.kind) {
    case "boolean":
      return definition.key === "visible" || definition.key === "enabled" ? false : true;
    case "number":
      return 1;
    case "reference":
      return "Reference";
    case "lineEndpointReference":
      return { lineId: "ReferenceLine", endpointKey: "start" } satisfies LineEndpointReference;
    case "lineReference":
      return "ReferenceLine";
    case "lineReferenceList":
      return ["ReferenceLine"];
    case "color":
      return "accent";
    case "choice":
      return definition.choiceOptions?.at(-1) ?? "";
    case "text":
      return definition.key === "name" ? undefined : "sample";
  }
};

const populatedTemplate = (type: CadElementType) => {
  let element = createCadElement(type, [], { createId: () => `completion-${type}` });
  for (const definition of getParameterDefinitions(element)) {
    const value = sampleValue(definition);
    if (value !== undefined) element = setParameterValue(element, definition.key, value);
  }
  return element;
};

const metadataFor = (element: CadElement): DslCompletionElementMetadata => {
  const definitions = getParameterDefinitions(element);
  const variants = definitions
    .filter((definition) => definition.kind === "choice" && (definition.choiceOptions?.length ?? 0) > 1)
    .flatMap((definition) => definition.choiceOptions!.map((value) => setParameterValue(element, definition.key, value)));
  const samples = [element, ...variants];
  const parameters = new Map<string, DslCompletionParameter>();
  for (const sample of samples) {
    // v2 is a stable, deterministic form for label derivation; this doesn't reflect
    // any real document's version.
    const line = serializeElementStatementLogical(sample, documentDslRefs([sample], NEW_DOCUMENT_DSL_MAJOR_VERSION));
    for (const definition of definitions) {
      const span = resolveParameterValueSpan(line, sample, definition.key, { committedLineText: line });
      if (!span) continue;
      const source = span.source === "arg" ? "attr" : span.source;
      parameters.set(`${definition.key}:${source}:${span.key}`, { definition, source, key: span.key });
    }
  }
  const all = [...parameters.values()];
  return { parameters: all, attributes: all.filter((parameter) => parameter.source === "attr") };
};

export const dslCompletionMetadataForType = (type: CadElementType): DslCompletionElementMetadata => {
  const existing = cache.get(type);
  if (existing) return existing;
  const metadata = metadataFor(populatedTemplate(type));
  cache.set(type, metadata);
  return metadata;
};

export const dslStatementElementType = (statement: DslStatement): CadElementType | null => {
  if (!isElementDslStatement(statement)) return null;
  return statement.kind === "element" ? statement.type : statement.kind as CadElementType;
};
