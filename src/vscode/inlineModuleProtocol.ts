/**
 * The Inline Module command has a deliberately private Canvas projection.
 * Generic canvasObservation is an ordinary-element observation surface and
 * must not become an authority for module-instance ownership.
 */

export type VscodeInlineModuleCanvasTargetProof = {
  /** Runtime token is useful only to identify the selected Canvas item. */
  runtimeElementId: string;
  /** Canvas-local StatementMap identity; the host re-proves it structurally. */
  sourceStatementId: string;
  sourceStatementIndex: number;
  /** Authored instance-call path, expressed as current source indexes. */
  sourceStatementPath: readonly number[];
  sourceRange: { from: number; to: number };
};

export type VscodeInlineModuleCanvasTargetsPublication = {
  type: "inlineModuleCanvasTargetsPublication";
  documentVersion: number;
  normalizedSource: string;
  targets: readonly VscodeInlineModuleCanvasTargetProof[];
};

export type VscodeInlineModuleGeneratedGroupProof = {
  sourceStatementIndex: number;
  sourceRange: { from: number; to: number };
  generatedGroupName: string;
};

export type VscodeInlineModuleSelectionRequest = {
  type: "inlineModuleSelectionRequest";
  requestId: number;
  documentVersion: number;
  normalizedSource: string;
  generatedGroups: readonly VscodeInlineModuleGeneratedGroupProof[];
};

export type VscodeInlineModuleSelectionResult = {
  type: "inlineModuleSelectionResult";
  requestId: number;
  documentVersion: number;
  status: "selected" | "rejected";
  selectedRuntimeElementIds?: readonly string[];
};
