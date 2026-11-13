import { PickModeStatusView } from "../components/PickModeStatus";
import type { VscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import {
  referencePickModeStatusModelFor,
  type VSCodeReferencePickModeStatusContext
} from "./VSCodeReferencePickModeStatusModel";

export const VSCodeReferencePickModeStatus = ({
  session,
  context,
  onFinish,
  onMoveDraftEntry,
  onRemoveDraftEntry,
  onBrowse,
  onCopy,
  onInsert,
  onCancel
}: {
  session: VscodeReferencePickCanvasSession;
  context: VSCodeReferencePickModeStatusContext | null;
  onFinish: () => void;
  onBrowse?: () => void;
  onCopy?: () => void;
  onInsert?: () => void;
  onCancel?: () => void;
  onMoveDraftEntry?: (key: string, toIndex: number) => void;
  onRemoveDraftEntry?: (key: string) => void;
}) => {
  if (!context || session.draft.status !== "active") return null;
  const moveDraftEntry = onMoveDraftEntry ?? (() => undefined);
  const removeDraftEntry = onRemoveDraftEntry ?? (() => undefined);
  return (
    <div data-reference-pick-ui="true" style={{ display: "contents" }}>
      <PickModeStatusView model={referencePickModeStatusModelFor({
        session,
        context,
        onFinish,
        onBrowse,
        onCopy,
        onInsert,
        onCancel,
        onMoveDraftEntry: moveDraftEntry,
        onRemoveDraftEntry: removeDraftEntry
      })} />
    </div>
  );
};
