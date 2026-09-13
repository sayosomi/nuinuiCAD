import type { ScalarExpressionAst } from "./expressionAst";

export type ScalarExpressionReference = {
  name: string;
  span: { start: number; end: number };
};

/** Collects scalar `@name` references without binding || runtime knowledge. */
export const collectScalarExpressionReferences = (
  ast: ScalarExpressionAst
): readonly ScalarExpressionReference[] => {
  const references: ScalarExpressionReference[] = [];
  const visit = (node: ScalarExpressionAst, boundNames: ReadonlySet<string> = new Set()): void => {
    switch (node.kind) {
      case "reference":
        if (!boundNames.has(node.name)) references.push({ name: node.name, span: node.span });
        return;
      case "collectionIndex":
        references.push({ name: node.name, span: { start: node.span.start, end: node.nameSpan.end + 1 } });
        visit(node.index, boundNames);
        return;
      case "geometryProperty":
        if (node.occurrenceIndex) visit(node.occurrenceIndex, boundNames);
        return;
      case "optionalMember":
        visit(node.receiver, boundNames);
        return;
      case "unary":
        visit(node.operand, boundNames);
        return;
      case "binary":
        visit(node.left, boundNames);
        visit(node.right, boundNames);
        return;
      case "group":
        visit(node.expression, boundNames);
        return;
      case "valueIf":
        visit(node.condition, boundNames);
        visit(node.thenBranch, boundNames);
        if (node.elseBranch) visit(node.elseBranch, boundNames);
        return;
      case "valueMatch":
        visit(node.scrutinee, boundNames);
        node.arms.forEach((arm) => {
          const armBoundNames = arm.binder ? new Set([...boundNames, arm.binder]) : boundNames;
          visit(arm.expression, armBoundNames);
        });
        return;
      case "call":
        node.args.forEach((argument) => visit(argument.expression, boundNames));
        return;
      default:
        return;
    }
  };
  visit(ast);
  return references;
};
