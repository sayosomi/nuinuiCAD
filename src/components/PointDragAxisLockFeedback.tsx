import { canvasThemeCssVariables, type CanvasTheme } from "./canvasTheme";
import type { ScreenPoint } from "./DrawingCanvasHitTest";
import { pointDragAxisForScreenDelta, type ViewportSize } from "./canvasViewport";

export type PointDragAxisLockFeedbackState = {
  origin: ScreenPoint;
  current: ScreenPoint;
  shiftKey: boolean;
};

type PointDragAxisLockFeedbackProps = {
  feedback: PointDragAxisLockFeedbackState;
  viewportSize: ViewportSize;
  canvasTheme: CanvasTheme;
};

export const PointDragAxisLockFeedback = ({
  feedback,
  viewportSize,
  canvasTheme
}: PointDragAxisLockFeedbackProps) => {
  const activeAxis = pointDragAxisForScreenDelta({
    screenDx: feedback.current.x - feedback.origin.x,
    screenDy: feedback.current.y - feedback.origin.y,
    shiftKey: feedback.shiftKey
  });

  return (
    <div
      className="point-drag-axis-lock-feedback"
      data-point-drag-axis-lock-feedback="true"
      aria-hidden="true"
      style={{
        ...canvasThemeCssVariables(canvasTheme),
        pointerEvents: "none"
      }}
    >
      {activeAxis ? (
        <svg
          className="point-drag-axis-lock-guides"
          width={viewportSize.width}
          height={viewportSize.height}
          viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
        >
          {activeAxis === "horizontal" ? (
            <line
              data-point-drag-axis-guide="x"
              x1={0}
              y1={feedback.origin.y}
              x2={viewportSize.width}
              y2={feedback.origin.y}
            />
          ) : (
            <line
              data-point-drag-axis-guide="y"
              x1={feedback.origin.x}
              y1={0}
              x2={feedback.origin.x}
              y2={viewportSize.height}
            />
          )}
        </svg>
      ) : null}
      <div
        className="point-drag-axis-lock-hint"
        data-point-drag-axis-lock-hint="true"
        data-point-drag-axis-lock-hint-position="bottom-right"
        style={{ right: 0, bottom: 0 }}
      >
        {"Hold Shift for "}
        <span
          className={`point-drag-axis-lock-action ${activeAxis === "horizontal" ? "is-active" : ""}`.trim()}
          data-axis="x"
        >Horizontal</span>
        {" / "}
        <span
          className={`point-drag-axis-lock-action ${activeAxis === "vertical" ? "is-active" : ""}`.trim()}
          data-axis="y"
        >Vertical</span>
      </div>
    </div>
  );
};
