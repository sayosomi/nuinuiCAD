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
  onRemoveDraftEntry
}: {
  session: VscodeReferencePickCanvasSession;
  context: VSCodeReferencePickModeStatusContext | null;
  onFinish: () => void;
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
        onMoveDraftEntry: moveDraftEntry,
        onRemoveDraftEntry: removeDraftEntry
      })} />
    </div>
  );
};
