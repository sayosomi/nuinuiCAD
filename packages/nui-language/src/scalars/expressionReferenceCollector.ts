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
  const visit = (node: ScalarExpressionAst): void => {
    switch (node.kind) {
      case "reference":
        references.push({ name: node.name, span: node.span });
        return;
      case "collectionIndex":
        references.push({ name: node.name, span: { start: node.span.start, end: node.nameSpan.end + 1 } });
        visit(node.index);
        return;
      case "geometryProperty":
        if (node.occurrenceIndex) visit(node.occurrenceIndex);
        return;
      case "unary":
        visit(node.operand);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "group":
        visit(node.expression);
        return;
      case "valueIf":
        visit(node.condition);
        visit(node.thenBranch);
        visit(node.elseBranch);
        return;
      case "valueMatch":
        visit(node.scrutinee);
        node.arms.forEach((arm) => visit(arm.expression));
        return;
      case "call":
        node.args.forEach((argument) => visit(argument.expression));
        return;
      default:
        return;
    }
  };
  visit(ast);
  return references;
};
