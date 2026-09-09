import { PickModeStatusView } from "../components/PickModeStatus";
import type { VscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import {
  referencePickModeStatusModelFor,
  type VSCodeReferencePickModeStatusContext
} from "./VSCodeReferencePickModeStatusModel";

export const VSCodeReferencePickModeStatus = ({
  session,
  context,
  onFinish
}: {
  session: VscodeReferencePickCanvasSession;
  context: VSCodeReferencePickModeStatusContext | null;
  onFinish: () => void;
}) => {
  if (!context || session.draft.status !== "active") return null;
  return (
    <div data-reference-pick-ui="true" style={{ display: "contents" }}>
      <PickModeStatusView model={referencePickModeStatusModelFor({ session, context, onFinish })} />
    </div>
  );
};
