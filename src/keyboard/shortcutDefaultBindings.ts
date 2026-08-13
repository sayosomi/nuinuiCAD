import { commands, paletteCommandIds, type CommandId } from "../commands/commands";
import { legacyCreationCommandIds } from "../commands/legacyCreationRecipes";
import type { KeyChord, ShortcutBinding, ShortcutScope } from "./shortcutTypes";

const ch = (
  key: string,
  modifiers: Pick<KeyChord, "mod" | "alt" | "shift"> = {}
): KeyChord => ({
  key,
  mod: false,
  alt: false,
  shift: false,
  ...modifiers
});

const commandLabel = (commandId: CommandId, fallback?: string) =>
  fallback ?? commands[commandId].shortcuts?.[0]?.label ?? commands[commandId].label;

const binding = (
  scope: ShortcutScope,
  commandId: CommandId,
  defaultChords: KeyChord[],
  options: Omit<Partial<ShortcutBinding>, "id" | "scope" | "commandId" | "defaultChords"> = {}
): ShortcutBinding => ({
  id: `${scope}.${commandId}`,
  scope,
  commandId,
  label: commandLabel(commandId, options.label),
  defaultChords,
  configurable: true,
  ...options
});

const defaultBindings: ShortcutBinding[] = [
  binding("crossFocus", "newDocument", [ch("n", { mod: true })]),
  binding("crossFocus", "openDocument", [ch("o", { mod: true })]),
  binding("crossFocus", "saveDocument", [ch("s", { mod: true })]),
  binding("crossFocus", "saveDocumentAs", [ch("s", { mod: true, shift: true })]),
  binding("crossFocus", "openCommandPalette", [ch("k", { mod: true })]),
  binding("crossFocus", "openShortcutSettings", [ch(",", { mod: true })]),
  binding("crossFocus", "toggleShortcutHelp", [ch("h", { mod: true, shift: true })]),
  binding("crossFocus", "focusElementSearch", [ch("f", { mod: true })]),
  binding("normal", "undo", [ch("z", { mod: true })]),
  binding("normal", "redo", [ch("y", { mod: true })]),
  binding("normal", "renameSelectedElement", [ch("F2")]),
  binding("normal", "focusSourceEditor", [ch("g")]),
  binding("normal", "toggleInspectorPanel", [ch("i")]),
  binding("normal", "groupSelectedElements", [ch("g", { mod: true })]),
  binding("normal", "addConditionalGroup", [ch("i", { alt: true })]),
  binding("normal", "wrapSelectedElementsInConditionalGroup", [ch("i", { alt: true, shift: true })]),
  binding("normal", "addForGroup", [ch("f", { alt: true })]),
  binding("normal", "wrapSelectedElementsInForGroup", [ch("f", { alt: true, shift: true })]),
  binding("normal", "ungroupSelectedGroup", [ch("g", { mod: true, shift: true })]),
  binding("normal", "moveSelectedElementUp", [ch("ArrowUp", { mod: true })], { label: "選択要素を上へ移動" }),
  binding("normal", "moveSelectedElementDown", [ch("ArrowDown", { mod: true })], { label: "選択要素を下へ移動" }),
  binding("normal", "moveEvaluationDividerUp", []),
  binding("normal", "moveEvaluationDividerDown", []),
  binding("normal", "moveEvaluationDividerToEnd", []),
  binding("normal", "selectPreviousElement", [ch("ArrowUp")]),
  binding("normal", "selectNextElement", [ch("ArrowDown")]),
  binding("normal", "extendSelectionToPreviousElement", [ch("ArrowUp", { shift: true })]),
  binding("normal", "extendSelectionToNextElement", [ch("ArrowDown", { shift: true })]),
  binding("normal", "toggleGroupExpanded", [ch("ArrowRight")]),
  binding("normal", "selectParentGroup", [ch("ArrowLeft")]),
  binding("normal", "outdentSelectedElements", []),
  binding("normal", "indentSelectedElements", []),
  binding("normal", "deleteSelectedElement", [ch("d"), ch("Delete"), ch("Backspace")]),
  binding("normal", "duplicateSelectedElement", [ch("d", { mod: true })]),
  binding("normal", "zoomInCanvas", [ch("+"), ch("=")]),
  binding("normal", "zoomOutCanvas", [ch("-")]),
  binding("normal", "resetCanvasView", [ch("0")]),
  binding("normal", "addIntersectionPoint", [ch("x")]),
  binding("normal", "addBezierCurve", [ch("c")], { label: "曲線を追加" }),
  binding("normal", "addCornerRadiusArcLine", [ch("r", { shift: true })]),
  binding("normal", "addOffsetLine", [ch("o", { shift: true })]),
  binding("normal", "addCopyLine", [ch("c", { shift: true })]),
  binding("pick", "selectPreviousPickCandidate", [ch("ArrowUp")]),
  binding("pick", "selectNextPickCandidate", [ch("ArrowDown")]),
  binding("pick", "selectPreviousPickOption", [ch("ArrowLeft")]),
  binding("pick", "selectNextPickOption", [ch("ArrowRight")]),
  binding("pick", "applySelectedPickCandidate", [ch("Enter")]),
  binding("pick", "finishLinePick", [ch("Enter", { mod: true })]),
  // Source Editor structural-edit bindings.
  // `[` / `]` stay available for DSL text; Mod variants are the intentional Phase 2e migration.
  binding("sourceEditor", "moveSelectedElementUp", [ch("ArrowUp", { mod: true }), ch("ArrowUp", { mod: true, alt: true })], {
    label: "選択要素を上へ移動"
  }),
  binding("sourceEditor", "moveSelectedElementDown", [ch("ArrowDown", { mod: true }), ch("ArrowDown", { mod: true, alt: true })], {
    label: "選択要素を下へ移動"
  }),
  binding("sourceEditor", "moveEvaluationDividerUp", [ch("ArrowUp", { mod: true, alt: true, shift: true })]),
  binding("sourceEditor", "moveEvaluationDividerDown", [ch("ArrowDown", { mod: true, alt: true, shift: true })]),
  binding("sourceEditor", "moveEvaluationDividerToEnd", [ch("End", { mod: true, alt: true, shift: true })]),
  binding("sourceEditor", "outdentSelectedElements", [ch("[", { mod: true })], {
    label: "選択要素をアウトデント (Source Editor: Mod+[)"
  }),
  binding("sourceEditor", "indentSelectedElements", [ch("]", { mod: true })], {
    label: "選択要素をインデント (Source Editor: Mod+])"
  }),
  binding("sourceEditor", "stepSourceValueForward", [ch("ArrowRight", { alt: true })], {
    label: "Source Editorの値を次へ (Alt+→)",
    owner: "editorTransaction"
  }),
  binding("sourceEditor", "stepSourceValueBackward", [ch("ArrowLeft", { alt: true })], {
    label: "Source Editorの値を前へ (Alt+←)",
    owner: "editorTransaction"
  }),
  // F2 is a non-text function key. It is a narrow exception to the Source
  // Editor's Mod-key policy, && falls through when no single element is selected.
  binding("sourceEditor", "renameSelectedElement", [ch("F2")], {
    label: "Source Editor / 選択要素の名前を変更",
    owner: "editorTransaction"
  }),
  binding("sourceEditor", "startCanvasPickFromSourceSelection", [ch("p", { mod: true, shift: true })], {
    label: "選択中の値をCanvasで選択"
  }),
  ...legacyCreationCommandIds.map((commandId) =>
    binding("sourceEditor", commandId as CommandId, [], {
      label: `Source Editor / ${commandLabel(commandId as CommandId)}`
    })
  )
];

const contextRequiredCommandIds = new Set<CommandId>([
  "selectElement",
  "moveElementToInsertionIndex",
  "setEvaluationLimitIndex",
  "movePointElementByDelta",
  "moveBezierHandleByDelta",
  "applyNumericExpressionReference",
  "insertNumericExpressionSnippet",
  "setMeasurementInsertMode",
  "startMeasurementPointPick",
  "startMeasurementLinePick",
  "insertSelectedMeasurement",
  "startNumericReferencePick",
  "startCanvasPickFromSourceSelection",
  "applyPickedNumericReference",
  "startPointPick",
  "applyPickedPoint",
  "startLinePick",
  "applyPickedLine",
  "cycleElementActivity",
  "setElementActivity",
  "deleteNumericVariable",
  "deleteBezierNumericVariable",
  "deleteBezierIntermediatePoint",
  "closeCommandPalette",
  "closeShortcutSettings"
]);

const defaultBindingIds = new Set(defaultBindings.map((item) => item.id));
const paletteBindings: ShortcutBinding[] = paletteCommandIds
  .filter((commandId) => !contextRequiredCommandIds.has(commandId))
  .map((commandId) => binding("normal", commandId, []))
  .filter((item) => !defaultBindingIds.has(item.id));

export const shortcutBindings: ShortcutBinding[] = [...defaultBindings, ...paletteBindings];

export const configurableShortcutBindings = shortcutBindings.filter(
  (item) => item.configurable !== false
);
