import { describe, expect, it } from "vitest";
import type { ModulePreviewInputGroup, ModulePreviewParameterState, ModulePreviewSessionSnapshot } from "../dsl/modulePreviewState";
import { modulePreviewValueSummaryFor } from "./modulePreviewValueProjection";

const parameterFor = (
  definitionStatementId: string,
  parameterIndex: number,
  name: string,
  overrides: Partial<ModulePreviewParameterState> = {}
): ModulePreviewParameterState => ({
  definitionStatementId,
  parameterIndex,
  name,
  type: { kind: "number" },
  optional: true,
  required: false,
  defaultSourceText: null,
  value: "",
  active: false,
  diagnostic: null,
  ...overrides
});

const groupFor = (
  kind: ModulePreviewInputGroup["kind"],
  definitionStatementId: string,
  definitionStatementIndex: number,
  name: string,
  parameters: readonly ModulePreviewParameterState[]
): ModulePreviewInputGroup => ({
  kind,
  definitionStatementId,
  definitionStatementIndex,
  name,
  parameters
});

describe("modulePreviewValueSummaryFor", () => {
  it("returns value and identity data without English presentation labels", () => {
    const snapshot: ModulePreviewSessionSnapshot = {
      sourceRevision: 1,
      target: { definitionStatementId: "module:pocket", definitionStatementIndex: 2, name: "Pocket" },
      ancestorContexts: [groupFor("ancestor", "module:outer", 1, "Outer", [
        parameterFor("module:outer", 0, "width", { value: "@Waist", active: true, defaultSourceText: "10" }),
        parameterFor("module:outer", 1, "ease", { defaultSourceText: "4" }),
        parameterFor("module:outer", 2, "optionalEase")
      ])],
      parameters: groupFor("target", "module:pocket", 2, "Pocket", [
        parameterFor("module:pocket", 0, "depth", { value: "6", active: true })
      ]),
      inputDiagnostics: [],
      preview: { kind: "current", result: {} as never }
    };

    const summary = modulePreviewValueSummaryFor(snapshot);

    expect(summary).toEqual([
      {
        blockKind: "ancestor",
        groupName: "Outer",
        parameterName: "width",
        definitionStatementIndex: 1,
        parameterIndex: 0,
        valueState: "explicit",
        value: "@Waist",
        defaultSourceText: "10"
      },
      {
        blockKind: "ancestor",
        groupName: "Outer",
        parameterName: "ease",
        definitionStatementIndex: 1,
        parameterIndex: 1,
        valueState: "omitted-defaulted",
        value: "",
        defaultSourceText: "4"
      },
      {
        blockKind: "ancestor",
        groupName: "Outer",
        parameterName: "optionalEase",
        definitionStatementIndex: 1,
        parameterIndex: 2,
        valueState: "omitted-optional",
        value: "",
        defaultSourceText: null
      },
      {
        blockKind: "target",
        groupName: "Pocket",
        parameterName: "depth",
        definitionStatementIndex: 2,
        parameterIndex: 0,
        valueState: "explicit",
        value: "6",
        defaultSourceText: null
      }
    ]);
    expect(summary.flatMap((entry) => Object.keys(entry))).not.toContain("groupLabel");
    expect(summary.flatMap((entry) => Object.keys(entry))).not.toContain("valueLabel");
  });

  it("keeps the existing no-summary behavior for non-current or diagnostic snapshots", () => {
    const snapshot: ModulePreviewSessionSnapshot = {
      sourceRevision: 1,
      target: { definitionStatementId: "module:pocket", definitionStatementIndex: 1, name: "Pocket" },
      ancestorContexts: [],
      parameters: groupFor("target", "module:pocket", 1, "Pocket", []),
      inputDiagnostics: [],
      preview: { kind: "lastGood", result: {} as never }
    };

    expect(modulePreviewValueSummaryFor(snapshot)).toEqual([]);
    expect(modulePreviewValueSummaryFor({ ...snapshot, preview: { kind: "current", result: {} as never }, inputDiagnostics: [{
      code: "required-value-missing",
      definitionStatementId: "module:pocket",
      parameterIndex: 0,
      message: "A value is required."
    }] })).toEqual([]);
  });
});
