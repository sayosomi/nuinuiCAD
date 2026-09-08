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
    }
  | {
      kind: "through";
      point1: GeometryValueProgramPoint;
      point2: GeometryValueProgramPoint;
      point3: GeometryValueProgramPoint;
      startAngleDeg: TypedScalarExpression;
      endAngleDeg: TypedScalarExpression;
    }
  | {
      kind: "bezier";
      start: GeometryValueProgramPoint;
      end: GeometryValueProgramPoint;
      startAngleDeg: TypedScalarExpression;
      startLength: TypedScalarExpression;
      endAngleDeg: TypedScalarExpression;
      endLength: TypedScalarExpression;
      intermediates: readonly {
        point: GeometryValueProgramPoint;
        angleDeg: TypedScalarExpression;
        incomingLength: TypedScalarExpression;
        outgoingLength: TypedScalarExpression;
      }[];
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
        : value.construction.kind === "arc"
          ? (() => {
            const center = pointForReference(value.construction.center);
            const radius = literalScalarExpression(value.construction.radius);
            const startAngleDeg = literalScalarExpression(value.construction.start);
            const endAngleDeg = literalScalarExpression(value.construction.end);
            const direction = literalScalarExpression(value.construction.direction);
            return center && radius && startAngleDeg && endAngleDeg && direction
              ? { kind: "arc" as const, center, radius, startAngleDeg, endAngleDeg, direction }
              : null;
            })()
          : value.construction.kind === "through"
            ? (() => {
              const point1 = pointForReference(value.construction.point1);
              const point2 = pointForReference(value.construction.point2);
              const point3 = pointForReference(value.construction.point3);
              const startAngleDeg = literalScalarExpression(value.construction.start);
              const endAngleDeg = literalScalarExpression(value.construction.end);
              return point1 && point2 && point3 && startAngleDeg && endAngleDeg
                ? { kind: "through" as const, point1, point2, point3, startAngleDeg, endAngleDeg }
                : null;
            })()
            : (() => {
                const start = pointForReference(value.construction.start);
                const end = pointForReference(value.construction.end);
                const startAngleDeg = literalScalarExpression(value.construction.startAngle);
                const startLength = literalScalarExpression(value.construction.startLength);
                const endAngleDeg = literalScalarExpression(value.construction.endAngle);
                const endLength = literalScalarExpression(value.construction.endLength);
                const intermediates = value.construction.intermediates.flatMap((intermediate) => {
                  const point = pointForReference(intermediate.point);
                  const angleDeg = literalScalarExpression(intermediate.angle);
                  const incomingLength = literalScalarExpression(intermediate.incomingLength);
                  const outgoingLength = literalScalarExpression(intermediate.outgoingLength);
                  return point && angleDeg && incomingLength && outgoingLength
                    ? [{ point, angleDeg, incomingLength, outgoingLength }]
                    : [];
                });
                return start && end && startAngleDeg && startLength && endAngleDeg && endLength && intermediates.length === value.construction.intermediates.length
                  ? { kind: "bezier" as const, start, end, startAngleDeg, startLength, endAngleDeg, endLength, intermediates }
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
