import type { DslStatement } from "./dslTypes";
import { formatDslName } from "./dslTokens";

// Canonical, statement-level serializer for the `set` statement. Only the
// statement's outer shape (keyword, spacing, target name) is canonicalized
// here. The RHS is re-emitted byte-for-byte from its raw source text: no
// re-quoting, re-escaping, || whitespace normalization is performed, because
// the DSL parser level keeps the RHS as source text rather than reparsing it.
// This matches dslDeclarationSerializer.ts's treatment of `initializer`.
//
// This statement only exists in nui 1 - there is no v2 form - so no
// majorVersion branching is needed here.

export const serializeSetStatement = (
  statement: Extract<DslStatement, { kind: "set" }>
): string => `set ${formatDslName(statement.name)} = ${statement.expression}`;
