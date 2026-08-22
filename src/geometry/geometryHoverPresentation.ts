import { geometryInfoRows, type GeometryInfoRow } from "./geometryDisplay";
import {
  elementTypeLabels,
  type CadElement,
  type EvaluationResult
} from "../types/geometry";

export type GeometryHoverAvailability =
  | { kind: "geometry"; rows: GeometryInfoRow[] }
  | { kind: "not-evaluated" }
  | { kind: "unavailable" };

export type GeometryHoverPresentation = {
  heading: string;
  statuses: string[];
  availability: GeometryHoverAvailability;
};

const headingFor = (element: CadElement): string =>
  `${element.name} · ${elementTypeLabels[element.type]}`;

export const geometryHoverUnavailablePresentation = (
  element: CadElement
): GeometryHoverPresentation => ({
  heading: headingFor(element),
  statuses: [],
  availability: { kind: "unavailable" }
});

const hasIssueFor = (
  issues: readonly { elementId: string }[],
  elementId: string
): boolean => issues.some((issue) => issue.elementId === elementId);

/**
 * Host-neutral runtime-state presentation for native Hover.
 *
 * This deliberately consumes only current EvaluationResult semantics. UI-only
 * visibility profiles, group fold state and diagnostic detail stay out of the
 * Hover contract.
 */
export const geometryHoverPresentation = (
  element: CadElement,
  evaluation: EvaluationResult
): GeometryHoverPresentation => {
  const heading = headingFor(element);
  const inactive = evaluation.conditionInactiveElementIds?.has(element.id) ?? false;
  const enabled = evaluation.effectiveEnabledElementIds
    ? evaluation.effectiveEnabledElementIds.has(element.id)
    : element.activity !== "disabled";
  const evaluated = evaluation.evaluatedElementIds
    ? evaluation.evaluatedElementIds.has(element.id)
    : true;

  if (inactive) {
    return {
      heading,
      statuses: ["Inactive"],
      availability: { kind: "not-evaluated" }
    };
  }

  if (!enabled) {
    return {
      heading,
      statuses: ["Disabled"],
      availability: { kind: "not-evaluated" }
    };
  }

  if (!evaluated) {
    return {
      heading,
      statuses: [],
      availability: { kind: "not-evaluated" }
    };
  }

  const visible = evaluation.effectiveVisibleElementIds
    ? evaluation.effectiveVisibleElementIds.has(element.id)
    : element.activity === "visible";
  const hasError = hasIssueFor(evaluation.errors, element.id);
  const hasWarning = hasIssueFor(evaluation.warnings, element.id);
  const statuses = [
    ...(!visible ? ["Hidden"] : []),
    ...(hasError ? ["Error"] : []),
    ...(hasWarning ? ["Warning"] : [])
  ];
  const geometry = evaluation.computedGeometry.get(element.id);

  return {
    heading,
    statuses,
    availability: geometry
      ? { kind: "geometry", rows: geometryInfoRows(geometry) }
      : { kind: "unavailable" }
  };
};

const escapeMarkdown = (value: string): string =>
  value.replace(/([\\`*_{}\[\]()#+\-.!|>])/g, "\\$1");

export const geometryHoverMarkdown = (
  presentation: GeometryHoverPresentation
): string => {
  const lines = [`**${escapeMarkdown(presentation.heading)}**`];
  if (presentation.statuses.length > 0) {
    lines.push("", `_${presentation.statuses.map(escapeMarkdown).join(" · ")}_`);
  }
  lines.push("", "**Geometry**", "");

  if (presentation.availability.kind === "not-evaluated") {
    lines.push("Not evaluated");
    return lines.join("\n");
  }
  if (presentation.availability.kind === "unavailable") {
    lines.push("Geometry unavailable");
    return lines.join("\n");
  }

  for (const row of presentation.availability.rows) {
    lines.push(`- **${escapeMarkdown(row.label)}:** ${escapeMarkdown(row.value)}`);
  }
  return lines.join("\n");
};
