import { dispatchCommand } from "../commands/commands";
import { findParameterDefinition } from "../parameters/parameterDefinitions";
import { effectiveElements, useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";

export const PickModeStatus = () => {
  const elements = useCadDocumentStore(effectiveElements);
  const pointTarget = useCadUiStore((state) => state.activePointPickTarget);
  const numericTarget = useCadUiStore((state) => state.activeNumericReferencePickTarget);
  const lineTarget = useCadUiStore((state) => state.activeLinePickTarget);
  const target = pointTarget ?? numericTarget ?? lineTarget;
  if (!target) return null;

  const element = elements.find((candidate) => candidate.id === target.elementId);
  const definition = element
    ? findParameterDefinition(element, target.parameterKey)
    : null;
  const isLineList = Boolean(lineTarget && definition?.kind === "lineReferenceList");
  const selectedCount = lineTarget?.draftLineIds?.length ?? 0;
  const selectedLineNames = (lineTarget?.draftLineIds ?? []).map(
    (id) => elements.find((candidate) => candidate.id === id)?.name ?? id
  );
  const instruction = pointTarget
    ? "Canvasまたは構成リストから点を選択"
    : numericTarget
      ? "線・曲線を選び、使用する値を明示的に選択"
      : isLineList
        ? `線を仮選択中（${selectedCount}件）。Canvas上で追加・解除できます。`
        : "Canvasまたは構成リストから線を選択";
  const finish = () => {
    if (pointTarget) dispatchCommand("cancelPointPick");
    else if (numericTarget) dispatchCommand("cancelNumericReferencePick");
    else if (isLineList) dispatchCommand("finishLinePick");
    else dispatchCommand("cancelLinePick");
  };

  return (
    <aside className="pick-mode-status" role="status" aria-live="polite">
      <span className="pick-mode-status-title" aria-hidden="true">PICK MODE</span>
      <span className="pick-mode-status-copy">
        <strong>{element?.name ?? target.elementId} / {definition?.label ?? target.parameterKey}</strong>
        <small>{instruction}</small>
        {isLineList && selectedLineNames.length > 0 ? (
          <span className="pick-mode-status-selection" aria-label={`選択済み ${selectedCount} 件`}>
            <span>選択済み {selectedCount}件</span>
            {selectedLineNames.slice(0, 4).map((name, index) => (
              <span key={`${name}-${index}`} className="pick-mode-status-chip">{name}</span>
            ))}
            {selectedLineNames.length > 4 ? (
              <span className="pick-mode-status-chip">+{selectedLineNames.length - 4}</span>
            ) : null}
          </span>
        ) : null}
      </span>
      <button type="button" onClick={finish}>
        {isLineList ? "選択を完了" : "選択を終了"}
      </button>
      <kbd>Esc</kbd>
    </aside>
  );
};
