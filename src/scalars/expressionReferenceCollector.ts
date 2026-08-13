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
      default:
        return;
    }
  };
  visit(ast);
  return references;
};
