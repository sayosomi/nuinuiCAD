import type { GeometryValueOccurrence } from "../types/geometry";
import type {
  ScalarExpressionResolvedGeometryTarget,
  TypedScalarExpression
} from "../scalars/typedExpressionAst";
import type { ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type {
  ModuleGeometryReferenceSemantic,
  ModuleGeometryValueSemantic,
  ModuleScalarExpressionSemantic
} from "./moduleSemanticTypes";
import { unwrapModuleGeometrySourceTarget } from "./moduleSemanticTypes";

/** A point input already lowered to either a drawable target, an immutable
 * value occurrence, or a coordinate scalar pair. */
export type GeometryValueProgramPoint =
  | {
      kind: "target";
      target: ScalarExpressionResolvedGeometryTarget;
    }
  | {
      kind: "coordinate";
      x: TypedScalarExpression;
      y: TypedScalarExpression;
    };

export type GeometryValueProgramConstruction =
  | {
      kind: "coordinate";
      x: TypedScalarExpression;
      y: TypedScalarExpression;
    }
  | {
      kind: "segment";
      start: GeometryValueProgramPoint;
      end: GeometryValueProgramPoint;
    }
  | {
      kind: "arc";
      center: GeometryValueProgramPoint;
      radius: TypedScalarExpression;
      startAngleDeg: TypedScalarExpression;
      endAngleDeg: TypedScalarExpression;
      direction: TypedScalarExpression;
    };

/** Host-neutral, already-resolved immutable geometry value execution entry.
 * It contains no source-name lookup contract and no drawable identity. */
export type GeometryValueProgramEntry = {
  sourceStatementId: string;
  sourceStatementIndex: number;
  declaredInterfaceType: ModuleGeometryInterfaceType;
  occurrence: GeometryValueOccurrence;
  executionPosition: number;
  construction: GeometryValueProgramConstruction;
};

export type GeometryValueProgram = readonly GeometryValueProgramEntry[];

/** Small root-document fallback used when no Module scalar runtime pass is
 * needed. It deliberately lowers only already-resolved numeric literal
 * expressions; Module-owned scalar expressions are lowered by the full scalar
 * runtime compiler. */
const literalScalarExpression = (semantic: ModuleScalarExpressionSemantic | null): TypedScalarExpression | null => {
  if (!semantic) return null;
  const lower = (node: ModuleScalarExpressionSemantic["ast"]): TypedScalarExpression | null => {
    switch (node.kind) {
      case "numberLiteral": return { kind: "numberLiteral", span: node.span, value: node.value, type: { kind: "number" } };
      case "unary": {
        const operand = lower(node.operand);
        return operand ? { kind: "unary", span: node.span, operator: node.operator, operand, type: { kind: "number" } } : null;
      }
      case "binary": {
        const left = lower(node.left);
        const right = lower(node.right);
        return left && right ? { kind: "binary", span: node.span, operator: node.operator, left, right, type: { kind: "number" } } : null;
      }
      case "group": {
        const expression = lower(node.expression);
        return expression ? { kind: "group", span: node.span, expression, type: { kind: "number" } } : null;
      }
      case "unresolvedChoiceLiteral":
        return semantic.type?.kind === "choice"
          ? { kind: "choiceLiteral", span: node.span, value: node.raw, type: semantic.type }
          : null;
      default: return null;
    }
  };
  return lower(semantic.ast);
};

export const buildRootGeometryValueProgram = ({
  values,
  elementIdByStatementIndex
}: {
  values: readonly ModuleGeometryValueSemantic[];
  elementIdByStatementIndex: ReadonlyMap<number, string>;
}): GeometryValueProgram => {
  const pointForReference = (reference: ModuleGeometryReferenceSemantic): GeometryValueProgramPoint | undefined => {
    if (reference.coordinate?.x && reference.coordinate.y) {
      const x = literalScalarExpression(reference.coordinate.x);
      const y = literalScalarExpression(reference.coordinate.y);
      return x && y ? { kind: "coordinate", x, y } : undefined;
    }
    if (!reference.target) return undefined;
    const unwrapped = unwrapModuleGeometrySourceTarget(reference.target);
    const target = unwrapped.target;
    if (target.kind === "geometryValue" && !target.backingTarget) {
      return {
        kind: "target",
        target: {
          kind: "geometryValue",
          occurrence: { sourceStatementId: target.statementId, instancePath: [] },
          statementId: target.statementId,
          statementIndex: target.statementIndex,
          geometryType: target.declaredInterfaceType === "point" ? "point" : "line",
          ...(unwrapped.pointKey ? { pointKey: unwrapped.pointKey } : {})
        }
      };
    }
    if (target.kind === "sourceGeometry") {
      const elementId = elementIdByStatementIndex.get(target.statementIndex);
      return elementId
        ? {
            kind: "target",
            target: {
              statementId: elementId,
              statementIndex: target.statementIndex,
              geometryType: target.geometryKind,
              ...(unwrapped.pointKey ? { pointKey: unwrapped.pointKey } : {})
            }
          }
        : undefined;
    }
    return undefined;
  };

  return values.flatMap((value): GeometryValueProgramEntry[] => {
    if (!value.construction || value.ownerModuleDefinitionStatementId !== null) return [];
    const construction = value.construction.kind === "coordinate"
      ? (() => {
          const x = literalScalarExpression(value.construction.x);
          const y = literalScalarExpression(value.construction.y);
          return x && y ? { kind: "coordinate" as const, x, y } : null;
        })()
      : value.construction.kind === "segment"
        ? (() => {
            const start = pointForReference(value.construction.start);
            const end = pointForReference(value.construction.end);
            return start && end ? { kind: "segment" as const, start, end } : null;
          })()
        : (() => {
            const center = pointForReference(value.construction.center);
            const radius = literalScalarExpression(value.construction.radius);
            const startAngleDeg = literalScalarExpression(value.construction.start);
            const endAngleDeg = literalScalarExpression(value.construction.end);
            const direction = literalScalarExpression(value.construction.direction);
            return center && radius && startAngleDeg && endAngleDeg && direction
              ? { kind: "arc" as const, center, radius, startAngleDeg, endAngleDeg, direction }
              : null;
          })();
    return construction
      ? [{
          sourceStatementId: value.statementId,
          sourceStatementIndex: value.statementIndex,
          declaredInterfaceType: value.declaredInterfaceType,
          occurrence: { sourceStatementId: value.statementId, instancePath: [] },
          executionPosition: value.statementIndex,
          construction
        }]
      : [];
  });
};
