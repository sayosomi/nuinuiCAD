import { expect, it } from "vitest";
import { typedDependencyControllerCandidates, type TypedDependencyEdge, type TypedDependencyEndpoint, type TypedDependencyGraph } from "@nuinuicad/nui-language";

it("keeps a forwarded Module activation's consumer prerequisites out of its producer controller", () => {
  const producer: TypedDependencyEndpoint = { kind: "geometry-value", id: "chosen", name: "chosen", statementIndex: 2 };
  const consumer: TypedDependencyEndpoint = { kind: "element", id: "outside", name: "outside", statementIndex: 5 };
  const flag: TypedDependencyEndpoint = { kind: "binding", id: "flag", name: "flag", statementIndex: 0, span: null };
  const selected: TypedDependencyEndpoint = { kind: "binding", id: "selected", name: "selected", statementIndex: 1, span: null };
  const activation = { guards: [{ controllerId: "geometry-value:chosen\0choice", branch: "then", controllerExpression: {
    kind: "booleanLiteral" as const, value: true, type: { kind: "boolean" as const }, span: { start: 0, end: 1 }
  } }] };
  const edges: TypedDependencyEdge[] = [
    { kind: "initializer", from: producer, to: flag, span: null, requiredness: "required" },
    { kind: "initializer", from: producer, to: selected, span: null, requiredness: "conditional", activation },
    { kind: "geometry", from: consumer, to: producer, span: null, requiredness: "required" },
    { kind: "initializer", from: consumer, to: selected, span: null, requiredness: "conditional", activation }
  ];
  const graph: TypedDependencyGraph = { edges, directByEndpointId: new Map(), reverseByEndpointId: new Map(), evaluationOrder: [], cycles: [], transformationPlans: [], geometryValueExecutionPositionByOccurrence: new Map() };
  expect(typedDependencyControllerCandidates(graph, new Map())).toMatchObject([{ sourceEndpointId: "geometry-value:chosen", prerequisiteEndpointIds: ["binding:flag"] }]);
});
