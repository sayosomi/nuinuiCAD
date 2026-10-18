import { geometryValueOccurrenceKey } from "../model/geometryValueOccurrence";
import type { DslStatement } from "./dslTypes";
import type { GeometryValueProgram, GeometryValueProgramNode } from "./moduleGeometryValueProgram";

/** Capture loop-local immutable aliases in a next plan, so their conditions and
 * geometry leaves read the iteration-start snapshot at the carry boundary. */
export const captureGeometryCarryProgram = (
  node: GeometryValueProgramNode,
  program: GeometryValueProgram,
  ownerStatementIndex: number,
  instancePath: readonly string[],
  statements: readonly DslStatement[],
  captured: Set<string> = new Set(),
  seen: ReadonlySet<string> = new Set()
): GeometryValueProgramNode => {
  const visit = (child: GeometryValueProgramNode) => captureGeometryCarryProgram(
    child, program, ownerStatementIndex, instancePath, statements, captured, seen
  );
  if (node.kind === "if") return { ...node, thenBranch: visit(node.thenBranch), elseBranch: visit(node.elseBranch) };
  if (node.kind === "match") return { ...node, arms: node.arms.map(arm => ({ ...arm, expression: visit(arm.expression) })) };
  if (node.kind === "coalesce") return { ...node, left: visit(node.left), right: visit(node.right) };
  if (node.kind !== "reference" || node.target.kind !== "geometryValue" || node.target.pointKey || node.target.stagePath) return node;
  const target = node.target;
  const entry = program.find(candidate => candidate.occurrence.sourceStatementId === target.occurrence.sourceStatementId &&
    JSON.stringify(candidate.occurrence.instancePath) === JSON.stringify(instancePath) &&
    JSON.stringify(target.occurrence.instancePath) === JSON.stringify(instancePath));
  if (!entry || seen.has(entry.sourceStatementId)) return node;
  let statement = statements[entry.sourceStatementIndex];
  while (statement && "enclosing" in statement && statement.enclosing) {
    if (statement.enclosing.statementIndex === ownerStatementIndex) {
      captured.add(geometryValueOccurrenceKey(entry.occurrence));
      return captureGeometryCarryProgram(
        entry.construction, program, ownerStatementIndex, instancePath, statements, captured, new Set([...seen, entry.sourceStatementId])
      );
    }
    statement = statements[statement.enclosing.statementIndex];
  }
  return node;
};

/** A loop-local immutable value is a frame template. Carry consumers capture
 * its program; the template itself cannot run globally without that frame. */
export const isLoopLocalGeometryValue = (
  entry: GeometryValueProgram[number], statements: readonly DslStatement[]
): boolean => {
  let statement = statements[entry.sourceStatementIndex];
  while (statement && "enclosing" in statement && statement.enclosing) {
    statement = statements[statement.enclosing.statementIndex];
    if (statement?.kind === "element" && statement.type === "forGroup") return true;
  }
  return false;
};
