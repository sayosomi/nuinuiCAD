import { commands, paletteCommandIds, type CommandId } from "../commands/commands";
import { keyChordMatchesEvent } from "./shortcutChords";
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

const isElementListTarget = (event: KeyboardEvent) => {
  const target = event.target;
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest("[data-element-list='true'], [data-element-list-row='true']"))
  );
};

const elementListAltArrowMatch = (event: KeyboardEvent, chord: KeyChord) =>
  keyChordMatchesEvent(chord, event) && (!chord.alt || isElementListTarget(event));

const arrowStepContext = (event: KeyboardEvent) => ({
  stepMultiplier: event.shiftKey ? 10 : event.altKey ? 0.1 : 1
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
  binding("global", "newDocument", [ch("n", { mod: true })]),
  binding("global", "openDocument", [ch("o", { mod: true })]),
  binding("global", "saveDocument", [ch("s", { mod: true })]),
  binding("global", "saveDocumentAs", [ch("s", { mod: true, shift: true })]),
  binding("global", "openCommandPalette", [ch("/")]),
  binding("global", "focusElementSearch", [ch("f", { mod: true })]),
  binding("global", "undo", [ch("z", { mod: true })]),
  binding("global", "redo", [ch("y", { mod: true })]),
  binding("global", "enterElementListMode", [ch("g")]),
  binding("global", "enterParameterEditMode", [ch("e")]),
  binding("global", "enterDependencyJumpMode", [ch("j")]),
  binding("modeInvariant", "toggleElementInfoPanel", [ch("i")]),
  binding("modeInvariant", "toggleShortcutHelp", [ch("?", { shift: "any" })]),
  binding("normal", "groupSelectedElements", [ch("g", { mod: true })]),
  binding("normal", "ungroupSelectedGroup", [ch("g", { mod: true, shift: true })]),
  binding(
    "normal",
    "moveSelectedElementUp",
    [ch("ArrowUp", { mod: true }), ch("ArrowUp", { alt: true })],
    { label: "選択要素を上へ移動", defaultChordMatches: elementListAltArrowMatch }
  ),
  binding(
    "normal",
    "moveSelectedElementDown",
    [ch("ArrowDown", { mod: true }), ch("ArrowDown", { alt: true })],
    { label: "選択要素を下へ移動", defaultChordMatches: elementListAltArrowMatch }
  ),
  binding("normal", "moveEvaluationDividerUp", [ch("ArrowUp", { alt: true, shift: true })], {
    defaultChordMatches: elementListAltArrowMatch
  }),
  binding("normal", "moveEvaluationDividerDown", [ch("ArrowDown", { alt: true, shift: true })], {
    defaultChordMatches: elementListAltArrowMatch
  }),
  binding("normal", "selectPreviousElement", [ch("ArrowUp")]),
  binding("normal", "selectNextElement", [ch("ArrowDown")]),
  binding("normal", "extendSelectionToPreviousElement", [ch("ArrowUp", { shift: true })]),
  binding("normal", "extendSelectionToNextElement", [ch("ArrowDown", { shift: true })]),
  binding("normal", "toggleGroupExpanded", [ch("ArrowRight")]),
  binding("normal", "selectParentGroup", [ch("ArrowLeft")]),
  binding("normal", "outdentSelectedElements", [ch("[")], {
    defaultChordMatches: (event, chord) =>
      keyChordMatchesEvent(chord, event) && isElementListTarget(event)
  }),
  binding("normal", "indentSelectedElements", [ch("]")], {
    defaultChordMatches: (event, chord) =>
      keyChordMatchesEvent(chord, event) && isElementListTarget(event)
  }),
  binding("normal", "deleteSelectedElement", [ch("d"), ch("Delete"), ch("Backspace")]),
  binding("normal", "toggleSelectedElementVisibility", [ch("v")]),
  binding("normal", "toggleSelectedElementEnabled", [ch("a")]),
  binding("normal", "duplicateSelectedElement", [ch("d", { mod: true })]),
  binding("normal", "enterParameterEditMode", [ch("Enter")]),
  binding("normal", "zoomInCanvas", [ch("+"), ch("=")]),
  binding("normal", "zoomOutCanvas", [ch("-")]),
  binding("normal", "resetCanvasView", [ch("0")]),
  binding("normal", "addIntersectionPoint", [ch("x")]),
  binding("normal", "addBezierCurve", [ch("c")], { label: "曲線を追加" }),
  binding("normal", "addCornerRadiusArcLine", [ch("r", { shift: true })]),
  binding("normal", "addOffsetLine", [ch("o", { shift: true })]),
  binding("normal", "addCopyLine", [ch("c", { shift: true })]),
  binding("dependencyJump", "exitDependencyJumpMode", [ch("Escape")]),
  binding("dependencyJump", "jumpToSelectedDependencyTarget", [ch("Enter")]),
  binding("dependencyJump", "selectNextDependencyJumpTarget", [ch("ArrowDown")]),
  binding("dependencyJump", "selectPreviousDependencyJumpTarget", [ch("ArrowUp")]),
  binding("dependencyJump", "selectPreviousElement", [ch("ArrowUp", { shift: true })]),
  binding("dependencyJump", "selectNextElement", [ch("ArrowDown", { shift: true })]),
  binding("pick", "selectPreviousPickCandidate", [ch("ArrowUp")]),
  binding("pick", "selectNextPickCandidate", [ch("ArrowDown")]),
  binding("pick", "selectPreviousPickOption", [ch("ArrowLeft")]),
  binding("pick", "selectNextPickOption", [ch("ArrowRight")]),
  binding("pick", "applySelectedPickCandidate", [ch("Enter")]),
  binding("parameter", "exitParameterEditMode", [ch("Escape")]),
  binding("parameter", "activateSelectedParameter", [ch("Enter")]),
  binding("parameter", "selectNextParameter", [ch("ArrowDown")]),
  binding("parameter", "selectPreviousParameter", [ch("ArrowUp")]),
  binding("parameter", "selectPreviousElement", [ch("ArrowUp", { shift: true })]),
  binding("parameter", "selectNextElement", [ch("ArrowDown", { shift: true })]),
  binding("parameter", "incrementSelectedParameter", [ch("ArrowRight", { shift: "any", alt: "any" })], {
    context: arrowStepContext
  }),
  binding("parameter", "decrementSelectedParameter", [ch("ArrowLeft", { shift: "any", alt: "any" })], {
    context: arrowStepContext
  }),
  binding("parameter", "decreaseSelectedParameterStep", [ch("[")]),
  binding("parameter", "increaseSelectedParameterStep", [ch("]")]),
  binding("parameter", "toggleSelectedParameterValue", [ch(" ")]),
  binding("normal", "openShortcutSettings", [], { label: "ショートカット設定" })
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
  "applyPickedNumericReference",
  "startPointPick",
  "applyPickedPoint",
  "startLinePick",
  "applyPickedLine",
  "toggleElementVisibility",
  "toggleElementEnabled",
  "deleteNumericVariable",
  "deleteBezierNumericVariable",
  "deleteBezierIntermediatePoint",
  "selectParameterByKey",
  "toggleBooleanParameterByDirectKey",
  "focusSelectedParameterInput",
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
