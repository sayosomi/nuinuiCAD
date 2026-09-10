import type { GeometryValueOccurrence } from "../types/geometry";
import type {
  ScalarExpressionResolvedGeometryTarget,
  TypedScalarExpression
} from "../scalars/typedExpressionAst";
import type { ModuleGeometryInterfaceType } from "./moduleGeometryInterfaces";
import type {
  ModuleGeometryReferenceSemantic,
  ModuleGeometryValueSemantic,
  ModuleGeometryValueExpressionSemantic,
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

export type GeometryValueProgramPath = {
  kind: "target";
  target: ScalarExpressionResolvedGeometryTarget;
};

export type GeometryValueProgramPlacement = {
  kind: "distance" | "ratio";
  value: TypedScalarExpression;
};

export type GeometryValueProgramConstruction =
  | {
      kind: "coordinate";
      x: TypedScalarExpression;
      y: TypedScalarExpression;
    }
  | {
      kind: "offsetPoint";
      from: GeometryValueProgramPoint;
      dx: TypedScalarExpression;
      dy: TypedScalarExpression;
    }
  | {
      kind: "polarPoint";
      from: GeometryValueProgramPoint;
      angleDeg: TypedScalarExpression;
      distance: TypedScalarExpression;
    }
  | {
      kind: "between";
      start: GeometryValueProgramPoint;
      end: GeometryValueProgramPoint;
      placement: GeometryValueProgramPlacement;
    }
  | {
      kind: "onLine";
      line: GeometryValueProgramPath;
      endpointKey: "start" | "end";
      placement: GeometryValueProgramPlacement;
    }
  | {
      kind: "intersection";
      line1: GeometryValueProgramPath;
      line2: GeometryValueProgramPath;
      index: TypedScalarExpression;
      extensions: TypedScalarExpression;
    }
  | {
      kind: "commonTangent";
      first: GeometryValueProgramPath;
      second: GeometryValueProgramPath;
      tangentKind: TypedScalarExpression;
      side: TypedScalarExpression;
    }
  | {
      kind: "tangentOffset";
      line: GeometryValueProgramPath;
      base: GeometryValueProgramPoint;
      angleDeg: TypedScalarExpression | null;
      curveSide: TypedScalarExpression | null;
      distance: TypedScalarExpression;
    }
  | {
      kind: "bezierExtremePoint";
      source: GeometryValueProgramPath;
      segmentIndex: TypedScalarExpression;
      direction: TypedScalarExpression;
    }
  | {
      kind: "bezierBulgePoint";
      source: GeometryValueProgramPath;
      segmentIndex: TypedScalarExpression;
    }
  | {
      kind: "segment";
      start: GeometryValueProgramPoint;
      end: GeometryValueProgramPoint;
    }
  | {
      kind: "polarLine";
      start: GeometryValueProgramPoint;
      angleDeg: TypedScalarExpression;
      length: TypedScalarExpression;
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
    }
  | {
      kind: "polyline";
      points: readonly GeometryValueProgramPoint[];
      closed: TypedScalarExpression;
    }
  | {
      kind: "offsetPath";
      sources: readonly GeometryValueProgramPath[];
      distance: TypedScalarExpression;
      side: TypedScalarExpression;
      closed: TypedScalarExpression;
      suppressTrimWarnings: TypedScalarExpression;
    }
  | {
      kind: "transformCopy";
      startPoint: GeometryValueProgramPoint;
      endPoint: GeometryValueProgramPoint;
      scale: TypedScalarExpression;
      angleDeg: TypedScalarExpression;
      mirrorX: TypedScalarExpression;
      baseLines: readonly GeometryValueProgramPath[];
    }
  | {
      kind: "mirrorCopy";
      axis1: GeometryValueProgramPoint;
      axis2: GeometryValueProgramPoint;
      baseLines: readonly GeometryValueProgramPath[];
    };

export type GeometryValueProgramNode =
  | GeometryValueProgramConstruction
  | {
      kind: "reference";
      target: ScalarExpressionResolvedGeometryTarget;
    }
  | {
      kind: "if";
      condition: TypedScalarExpression;
      thenBranch: GeometryValueProgramNode;
      elseBranch: GeometryValueProgramNode;
    }
  | {
      kind: "match";
      scrutinee: TypedScalarExpression;
      arms: readonly { label: string; expression: GeometryValueProgramNode }[];
    };

/** Host-neutral, already-resolved immutable geometry value execution entry.
 * It contains no source-name lookup contract and no drawable identity. */
export type GeometryValueProgramEntry = {
  sourceStatementId: string;
  sourceStatementIndex: number;
  declaredInterfaceType: ModuleGeometryInterfaceType;
  occurrence: GeometryValueOccurrence;
  executionPosition: number;
  construction: GeometryValueProgramNode;
  /** Collection-map entries are evaluated only when the selected member is
   * materialized; length reads never force these bodies. */
  lazy?: boolean;
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
      case "booleanLiteral": return { kind: "booleanLiteral", span: node.span, value: node.value, type: { kind: "boolean" } };
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

  const pathForReference = (reference: ModuleGeometryReferenceSemantic): GeometryValueProgramPath | undefined => {
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
          geometryType: target.declaredInterfaceType,
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

  const lowerConstruction = (
    sourceValue: ModuleGeometryValueSemantic,
    semanticConstruction: ModuleGeometryValueSemantic["construction"] = sourceValue.construction
  ): GeometryValueProgramConstruction | null => {
    if (!semanticConstruction) return null;
    const value = { ...sourceValue, construction: semanticConstruction } as Omit<ModuleGeometryValueSemantic, "construction"> & {
      construction: NonNullable<ModuleGeometryValueSemantic["construction"]>;
    };
    const construction = value.construction.kind === "coordinate"
      ? (() => {
          const x = literalScalarExpression(value.construction.x);
          const y = literalScalarExpression(value.construction.y);
          return x && y ? { kind: "coordinate" as const, x, y } : null;
        })()
      : value.construction.kind === "offsetPoint"
        ? (() => {
            const from = pointForReference(value.construction.from);
            const dx = literalScalarExpression(value.construction.dx);
            const dy = literalScalarExpression(value.construction.dy);
            return from && dx && dy ? { kind: "offsetPoint" as const, from, dx, dy } : null;
          })()
        : value.construction.kind === "polarPoint"
          ? (() => {
              const from = pointForReference(value.construction.from);
              const angleDeg = literalScalarExpression(value.construction.angle);
              const distance = literalScalarExpression(value.construction.distance);
              return from && angleDeg && distance ? { kind: "polarPoint" as const, from, angleDeg, distance } : null;
            })()
        : value.construction.kind === "between"
          ? (() => {
              const start = pointForReference(value.construction.start);
              const end = pointForReference(value.construction.end);
              const placement = literalScalarExpression(value.construction.placement.value);
              return start && end && placement
                ? { kind: "between" as const, start, end, placement: { kind: value.construction.placement.kind, value: placement } }
                : null;
            })()
        : value.construction.kind === "onLine"
          ? (() => {
              const line = pathForReference(value.construction.line);
              const placement = literalScalarExpression(value.construction.placement.value);
              return line && placement
                ? { kind: "onLine" as const, line, endpointKey: value.construction.endpointKey, placement: { kind: value.construction.placement.kind, value: placement } }
                : null;
            })()
        : value.construction.kind === "intersection"
          ? (() => {
              const line1 = pathForReference(value.construction.line1);
              const line2 = pathForReference(value.construction.line2);
              const index = literalScalarExpression(value.construction.index);
              const extensions = literalScalarExpression(value.construction.extensions);
              return line1 && line2 && index && extensions
                ? { kind: "intersection" as const, line1, line2, index, extensions }
                : null;
            })()
        : value.construction.kind === "commonTangent"
          ? (() => {
              const first = pathForReference(value.construction.first);
              const second = pathForReference(value.construction.second);
              const tangentKind = literalScalarExpression(value.construction.tangentKind);
              const side = literalScalarExpression(value.construction.side);
              return first && second && tangentKind && side
                ? { kind: "commonTangent" as const, first, second, tangentKind, side }
                : null;
            })()
        : value.construction.kind === "tangentOffset"
          ? (() => {
              const line = pathForReference(value.construction.line);
              const base = pointForReference(value.construction.base);
              const angleDeg = literalScalarExpression(value.construction.angle);
              const curveSide = literalScalarExpression(value.construction.curveSide);
              const distance = literalScalarExpression(value.construction.distance);
              return line && base && distance
                ? { kind: "tangentOffset" as const, line, base, angleDeg, curveSide, distance }
                : null;
            })()
        : value.construction.kind === "bezierExtremePoint"
          ? (() => {
              const source = pathForReference(value.construction.source);
              const segmentIndex = literalScalarExpression(value.construction.segmentIndex);
              const direction = literalScalarExpression(value.construction.direction);
              return source && segmentIndex && direction
                ? { kind: "bezierExtremePoint" as const, source, segmentIndex, direction }
                : null;
            })()
        : value.construction.kind === "bezierBulgePoint"
          ? (() => {
              const source = pathForReference(value.construction.source);
              const segmentIndex = literalScalarExpression(value.construction.segmentIndex);
              return source && segmentIndex
                ? { kind: "bezierBulgePoint" as const, source, segmentIndex }
                : null;
            })()
        : value.construction.kind === "segment"
        ? (() => {
            const start = pointForReference(value.construction.start);
            const end = pointForReference(value.construction.end);
            return start && end ? { kind: "segment" as const, start, end } : null;
          })()
        : value.construction.kind === "polarLine"
          ? (() => {
              const start = pointForReference(value.construction.start);
              const angleDeg = literalScalarExpression(value.construction.angle);
              const length = literalScalarExpression(value.construction.length);
              return start && angleDeg && length ? { kind: "polarLine" as const, start, angleDeg, length } : null;
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
            : value.construction.kind === "bezier"
              ? (() => {
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
              })()
              : value.construction.kind === "transformCopy"
                ? (() => {
                    const startPoint = pointForReference(value.construction.startPoint);
                    const endPoint = pointForReference(value.construction.endPoint);
                    const scale = literalScalarExpression(value.construction.scale);
                    const angleDeg = literalScalarExpression(value.construction.angleDeg);
                    const mirrorX = literalScalarExpression(value.construction.mirrorX);
                    const baseLines = value.construction.baseLines.flatMap((source) => {
                      const lowered = pathForReference(source);
                      return lowered ? [lowered] : [];
                    });
                    return startPoint && endPoint && scale && angleDeg && mirrorX && baseLines.length === value.construction.baseLines.length
                      ? { kind: "transformCopy" as const, startPoint, endPoint, scale, angleDeg, mirrorX, baseLines }
                      : null;
                  })()
                : value.construction.kind === "mirrorCopy"
                  ? (() => {
                      const axis1 = pointForReference(value.construction.axis1);
                      const axis2 = pointForReference(value.construction.axis2);
                      const baseLines = value.construction.baseLines.flatMap((source) => {
                        const lowered = pathForReference(source);
                        return lowered ? [lowered] : [];
                      });
                      return axis1 && axis2 && baseLines.length === value.construction.baseLines.length
                        ? { kind: "mirrorCopy" as const, axis1, axis2, baseLines }
                        : null;
                    })()
              : value.construction.kind === "offsetPath"
                ? (() => {
                    const sources = value.construction.sources.flatMap((source) => {
                      const lowered = pathForReference(source);
                      return lowered ? [lowered] : [];
                    });
                    const distance = literalScalarExpression(value.construction.distance);
                    const side = literalScalarExpression(value.construction.side);
                    const closed = literalScalarExpression(value.construction.closed);
                    const suppressTrimWarnings = literalScalarExpression(value.construction.suppressTrimWarnings);
                    return distance && side && closed && suppressTrimWarnings && sources.length === value.construction.sources.length
                      ? { kind: "offsetPath" as const, sources, distance, side, closed, suppressTrimWarnings }
                      : null;
                  })()
                : (() => {
                const points = value.construction.points.flatMap((point) => {
                  const lowered = pointForReference(point);
                  return lowered ? [lowered] : [];
                });
                const closed = literalScalarExpression(value.construction.closed);
                return closed && points.length === value.construction.points.length
                  ? { kind: "polyline" as const, points, closed }
                  : null;
              })();
    return construction;
  };

  const targetForReference = (reference: ModuleGeometryReferenceSemantic): ScalarExpressionResolvedGeometryTarget | undefined => {
    const lowered = reference.expectedGeometryKind === "point" ? pointForReference(reference) : pathForReference(reference);
    return lowered?.kind === "target" ? lowered.target : undefined;
  };

  const lowerExpression = (
    sourceValue: ModuleGeometryValueSemantic,
    expression: ModuleGeometryValueExpressionSemantic
  ): GeometryValueProgramNode | null => {
    if (expression.kind === "reference") {
      const target = targetForReference(expression.reference);
      return target ? { kind: "reference", target } : null;
    }
    if (expression.kind === "construction") return lowerConstruction(sourceValue, expression.construction);
    if (expression.kind === "if") {
      const condition = literalScalarExpression(expression.condition);
      const thenBranch = expression.thenBranch ? lowerExpression(sourceValue, expression.thenBranch) : null;
      const elseBranch = expression.elseBranch ? lowerExpression(sourceValue, expression.elseBranch) : null;
      return condition && thenBranch && elseBranch
        ? { kind: "if", condition, thenBranch, elseBranch }
        : null;
    }
    const scrutinee = literalScalarExpression(expression.scrutinee);
    const arms = expression.arms.flatMap((arm) => {
      const lowered = arm.expression ? lowerExpression(sourceValue, arm.expression) : null;
      return lowered ? [{ label: arm.label, expression: lowered }] : [];
    });
    return scrutinee && arms.length === expression.arms.length ? { kind: "match", scrutinee, arms } : null;
  };

  return values.flatMap((value): GeometryValueProgramEntry[] => {
    if ((!value.construction && !value.valueExpression) || value.ownerModuleDefinitionStatementId !== null) return [];
    const construction = value.valueExpression
      ? lowerExpression(value, value.valueExpression)
      : lowerConstruction(value);
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
