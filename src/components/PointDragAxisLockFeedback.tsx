import { canvasThemeCssVariables, type CanvasTheme } from "./canvasTheme";
import type { ScreenPoint } from "./DrawingCanvasHitTest";
import type { AxisLockKeys, ViewportSize } from "./canvasViewport";

export type PointDragAxisLockFeedbackState = {
  origin: ScreenPoint;
  axisLockKeys: AxisLockKeys;
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
  const activeAxis = feedback.axisLockKeys.x ? "x" : feedback.axisLockKeys.y ? "y" : null;

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
          {activeAxis === "x" ? (
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
        data-point-drag-axis-lock-hint-position="bottom-left"
        style={{ left: 0, bottom: 0 }}
      >
        <span className="point-drag-axis-lock-move">Move</span>
        <span className="point-drag-axis-lock-separator"> · </span>
        <span
          className={`point-drag-axis-lock-action ${activeAxis === "x" ? "is-active" : ""}`.trim()}
          data-axis="x"
        >X Horizontal</span>
        <span className="point-drag-axis-lock-separator"> · </span>
        <span
          className={`point-drag-axis-lock-action ${activeAxis === "y" ? "is-active" : ""}`.trim()}
          data-axis="y"
        >Y Vertical</span>
      </div>
    </div>
  );
};
