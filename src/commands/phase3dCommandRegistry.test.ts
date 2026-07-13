import { describe, expect, it } from "vitest";
import { commands, dispatchCommand } from "./commands";
import { shortcutBindings } from "../keyboard/shortcutDefaultBindings";

const retiredCommandIds = [
  "enterParameterEditMode",
  "enterDependencyJumpMode",
  "selectParameterByKey",
  "incrementSelectedParameter",
  "toggleExpressionInsertTray"
];

describe("Phase 3d Inspector command registry", () => {
  it("registers Inspector commands and no retired form commands", () => {
    expect(Object.keys(commands)).toEqual(expect.arrayContaining([
      "focusInspectorParameterRows",
      "focusInspectorDependencyRows",
      "selectNextInspectorRow",
      "selectPreviousInspectorRow",
      "activateInspectorRow",
      "exitInspector",
      "startInspectorParameterPick",
      "toggleInspectorPanel"
    ]));
    for (const id of retiredCommandIds) expect(commands).not.toHaveProperty(id);
  });

  it("uses only Inspector bindings for Inspector navigation and safely ignores retired dispatch", () => {
    expect(shortcutBindings.filter((binding) => binding.scope === "inspector").map((binding) => binding.commandId)).toEqual(expect.arrayContaining([
      "exitInspector",
      "activateInspectorRow",
      "selectNextInspectorRow",
      "selectPreviousInspectorRow",
      "startInspectorParameterPick"
    ]));
    expect(dispatchCommand("enterParameterEditMode" as never)).toBe(false);
  });
});
