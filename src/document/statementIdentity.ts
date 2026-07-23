// Opaque identities for non-geometry statements. These are allocated only by
// statement reconciliation and are never derived from source text or order.

let nextStatementIdentity = 1;

export type StatementIdentity = string;

export const createStatementIdentity = (kind: string): StatementIdentity => {
  nextStatementIdentity += 1;
  return `statement:${kind}:${Date.now().toString(36)}:${nextStatementIdentity}`;
};
