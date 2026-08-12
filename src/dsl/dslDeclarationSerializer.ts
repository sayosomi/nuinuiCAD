import type { ScalarType } from "../scalars/types";
import type { DslStatement } from "./dslTypes";
import { formatDslName } from "./dslTokens";
import { serializeDslNumericType } from "./dslNumericTypeOptions";

// Canonical, statement-level serializer for the typed declaration statement.
// Only the declaration's outer shape (keyword, spacing, name, type text) is
// canonicalized here. The initializer is re-emitted byte-for-byte from its
// raw source text: no re-quoting, re-escaping, or whitespace normalization
// is performed, because Task 10 never parses the initializer as an
// expression (see docs/typed-variables/tasks/10-typed-declaration-syntax.md).
//
// This statement only exists in nui 3 - there is no v2 form - so no
// majorVersion branching is needed here.

const typeText = (type: ScalarType, numericTypeOptions?: Extract<DslStatement, { kind: "typedDeclaration" }>["numericTypeOptions"]): string => {
  if (type.kind === "number") return serializeDslNumericType(numericTypeOptions);
  if (type.kind === "choice") return `choice(${type.options.join(", ")})`;
  return type.kind;
};

export const serializeTypedDeclaration = (
  statement: Extract<DslStatement, { kind: "typedDeclaration" }>
): string => {
  const declaredType = statement.declaredType;
  const type = declaredType ? typeText(declaredType, statement.numericTypeOptions) : "";
  const exportPrefix = statement.exported ? "export " : "";
  return `${exportPrefix}${statement.bindingKind} ${formatDslName(statement.name)}: ${type} = ${statement.initializer}`;
};
