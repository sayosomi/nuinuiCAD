import type { DslStatement } from "./dslTypes";
import { formatDslName } from "./dslTokens";

// Canonical, statement-level serializer for the `set` statement. Only the
// statement's outer shape (keyword, spacing, target name) is canonicalized
// here. The RHS is re-emitted byte-for-byte from its raw source text: no
// re-quoting, re-escaping, or whitespace normalization is performed, because
// this task never parses the RHS as an expression at the DSL-parser level
// (see docs/typed-variables/tasks/29-set-syntax-resolution.md, and
// dslDeclarationSerializer.ts's identical treatment of `initializer`).
//
// This statement only exists in nui 3 - there is no v2 form - so no
// majorVersion branching is needed here.

export const serializeSetStatement = (
  statement: Extract<DslStatement, { kind: "set" }>
): string => `set ${formatDslName(statement.name)} = ${statement.expression}`;
