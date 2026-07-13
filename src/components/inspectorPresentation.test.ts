import { describe, expect, it } from "vitest";
import type { InspectorRow } from "./inspectorPresentation";
import { moveInspectorRowKey, reconcileInspectorActiveRowKey } from "./inspectorPresentation";

const rows: InspectorRow[] = [
  { key: "dependency:parent:a", kind: "dependency", relation: "parent", elementId: "a", label: "A", detail: "親", relatedCount: 0, issues: [] },
  { key: "dependency:child:b", kind: "dependency", relation: "child", elementId: "b", label: "B", detail: "子", relatedCount: 0, issues: [] },
  { key: "parameter:name", kind: "parameter", parameterKey: "name", label: "名前", value: "L" },
  { key: "parameter:variable:old:value", kind: "parameter", parameterKey: "variable:old:value", label: "変数 old", value: "1" }
];

describe("Inspector presentation row reconciliation", () => {
  it("keeps the active section when the selected element changes or a dynamic row disappears", () => {
    expect(reconcileInspectorActiveRowKey("dependency:parent:gone", rows)).toBe("dependency:parent:a");
    expect(reconcileInspectorActiveRowKey("parameter:variable:removed:value", rows)).toBe("parameter:name");
  });

  it("normalizes an invalid active row before applying an arrow movement", () => {
    const parameters = rows.filter((row) => row.kind === "parameter");
    expect(moveInspectorRowKey(parameters, "dependency:child:gone", 1)).toBe("parameter:name");
    expect(moveInspectorRowKey(parameters, "parameter:name", 1)).toBe("parameter:variable:old:value");
    expect(moveInspectorRowKey(parameters, "parameter:name", -1)).toBe("parameter:name");
  });
});
