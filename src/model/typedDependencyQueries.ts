// Adapter between Task 36's compiler-built graph and dependency consumers.
// Unlike geometry dependencies, endpoints need not be CAD elements.
import {
  typedDependencyEndpointId,
  type TypedDependencyEdge,
  type TypedDependencyEndpoint,
  type TypedDependencyGraph
} from "../scalars/typedDependencyGraph";

export const directTypedDependencies = (
  graph: TypedDependencyGraph | undefined,
  endpoint: TypedDependencyEndpoint
): readonly TypedDependencyEdge[] => graph?.directByEndpointId.get(typedDependencyEndpointId(endpoint)) ?? [];

export const recursiveTypedDependencies = (
  graph: TypedDependencyGraph | undefined,
  endpoint: TypedDependencyEndpoint
): readonly TypedDependencyEdge[] => {
  if (!graph) return [];
  const result: TypedDependencyEdge[] = [];
  const visited = new Set<string>([typedDependencyEndpointId(endpoint)]);
  const walk = (current: TypedDependencyEndpoint): void => {
    for (const edge of directTypedDependencies(graph, current)) {
      result.push(edge);
      const targetId = typedDependencyEndpointId(edge.to);
      if (visited.has(targetId)) continue;
      visited.add(targetId);
      walk(edge.to);
    }
  };
  walk(endpoint);
  return result;
};
