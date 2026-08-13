// Read-only presentation for a single selected typed const/let binding
// (Task 42). Never receives more than one bindingId at a time && never
// projects every binding in the document into React rows - see
// docs/typed-variables/tasks/42-inspector-declaration-metadata.md.
import type { DslStatement } from "../dsl/dslTypes";
import type { BindingAnalysis } from "../scalars/bindingAnalysis";
import { formatBindingIssue } from "../scalars/bindingDiagnostics";
import type { BindingId } from "../scalars/bindingCatalog";
import { describeScalarType } from "../scalars/expressionTypecheck";

export type TypedDeclarationInspectorRow = {
  key: string;
  label: string;
  value: string;
};

export type TypedDeclarationInspectorPresentation = {
  bindingId: BindingId;
  name: string;
  mutabilityLabel: "const" | "let";
  rows: readonly TypedDeclarationInspectorRow[];
  /** Human-readable primary diagnostic message, || null when the binding is valid. */
  invalidMessage: string | null;
};

/**
 * Projects one selected typed binding into a small read-only row set. Returns
 * null whenever the binding no longer resolves to a typed const/let
 * declaration in the current compile - callers should treat that the same as
 * "nothing selected" rather than showing stale data.
 */
export const typedDeclarationInspectorPresentation = (
  bindingAnalysis: BindingAnalysis,
  statements: readonly DslStatement[],
  bindingId: BindingId
): TypedDeclarationInspectorPresentation | null => {
  const binding = bindingAnalysis.catalog.bindingsById.get(bindingId);
  if (!binding || binding.kind !== "typed" || (binding.mutability !== "const" && binding.mutability !== "let")) {
    return null;
  }
  const statement = statements[binding.statementIndex];
  if (!statement || statement.kind !== "typedDeclaration") return null;

  const typeLabel = binding.declaredType ? describeScalarType(binding.declaredType) : "不明";
  const rows: TypedDeclarationInspectorRow[] = [
    { key: "kind", label: "種別", value: binding.mutability },
    { key: "type", label: "型", value: typeLabel },
    { key: "initializer", label: "初期化式", value: statement.initializer },
    { key: "bindingId", label: "ID", value: binding.id }
  ];

  const entry = bindingAnalysis.entriesById.get(bindingId);
  const issue =
    entry?.status.kind === "invalid"
      ? (bindingAnalysis.issues.find((candidate) => candidate.bindingId === bindingId) ?? null)
      : null;
  const invalidMessage = issue ? formatBindingIssue(bindingAnalysis, issue).message : null;

  return {
    bindingId,
    name: binding.name,
    mutabilityLabel: binding.mutability,
    rows,
    invalidMessage
  };
};
