import { subtreeIdsForElement } from "../model/groups";
import type { CadElement, ElementId } from "../types/geometry";
import type {
  DslOutputPreviewRevealRuntimeTarget,
  DslOutputPreviewRevealSourceTarget
} from "../dsl/dslOutputPreviewRevealQuery";
import type { OutputDrawable, OutputPlan } from "./outputCore";

export type OutputPreviewRevealTarget =
  | Extract<DslOutputPreviewRevealSourceTarget, { kind: "output" | "layout" | "place" }>
  | DslOutputPreviewRevealRuntimeTarget;

export type OutputPreviewRevealInput = {
  target: OutputPreviewRevealTarget;
  elements: readonly CadElement[];
  /** Plans must already be in current authored Output source order. */
  plans: readonly OutputPlan[];
  selectedOutputKey: string | null;
};

export type OutputPreviewRevealResolved = {
  status: "resolved";
  outputKey: string;
  plan: OutputPlan;
  /** Actual OutputPlan occurrences, kept in plan/drawable order. */
  highlightedDrawables: readonly OutputDrawable[];
};

export type OutputPreviewRevealResult =
  | OutputPreviewRevealResolved
  | { status: "failed"; reason: "no-containing-output" };

export const outputPreviewRevealOutputKeyFor = (plan: Pick<OutputPlan, "kind" | "outputId">) =>
  `${plan.kind}:${plan.outputId}`;

const runtimeElementIdsForGroup = (
  elements: readonly CadElement[],
  runtimeElementIds: readonly ElementId[]
): ReadonlySet<ElementId> => {
  const subtreeIds = new Set<ElementId>();
  for (const runtimeElementId of runtimeElementIds) {
    for (const subtreeId of subtreeIdsForElement([...elements], runtimeElementId)) subtreeIds.add(subtreeId);
  }
  return subtreeIds;
};

const targetDrawablesFor = (
  target: OutputPreviewRevealTarget,
  plan: OutputPlan,
  elements: readonly CadElement[]
): readonly OutputDrawable[] | null => {
  if (target.kind === "output") {
    return target.outputId === plan.outputId && target.outputKind === plan.kind
      ? plan.drawables
      : null;
  }
  if (target.kind === "layout") {
    return target.layoutId === plan.layoutId ? plan.drawables : null;
  }
  if (target.kind === "place") {
    if (target.layoutId !== plan.layoutId) return null;
    return plan.placements.find((placement) => placement.id === target.placementId)?.drawables ?? null;
  }
  if (target.kind === "group") {
    const subtreeIds = runtimeElementIdsForGroup(elements, target.runtimeElementIds);
    const drawables = plan.drawables.filter((drawable) => subtreeIds.has(drawable.elementId));
    return drawables.length > 0 ? drawables : null;
  }
  const runtimeElementIds = new Set(target.runtimeElementIds);
  const drawables = plan.drawables.filter((drawable) => runtimeElementIds.has(drawable.elementId));
  return drawables.length > 0 ? drawables : null;
};

/**
 * Resolve Output Preview containment and highlight occurrences without any
 * viewport state. Plans are consumed in the caller's authored source order;
 * filtering deliberately preserves repeated visible drawable occurrences.
 */
export const resolveOutputPreviewReveal = ({
  target,
  elements,
  plans,
  selectedOutputKey
}: OutputPreviewRevealInput): OutputPreviewRevealResult => {
  const containing = plans.flatMap((plan) => {
    const drawables = targetDrawablesFor(target, plan, elements);
    return drawables === null
      ? []
      : [{ plan, drawables }];
  });
  if (containing.length === 0) return { status: "failed", reason: "no-containing-output" };

  const selected = containing.find(({ plan }) => outputPreviewRevealOutputKeyFor(plan) === selectedOutputKey) ?? containing[0]!;
  return {
    status: "resolved",
    outputKey: outputPreviewRevealOutputKeyFor(selected.plan),
    plan: selected.plan,
    highlightedDrawables: selected.drawables
  };
};
