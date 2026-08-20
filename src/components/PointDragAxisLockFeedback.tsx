import type { CSSProperties } from "react";
import { canvasThemeCssVariables, type CanvasTheme } from "./canvasTheme";
import type { ViewportSize } from "./canvasViewport";
import {
  pointDragAxisHintPosition,
  type PointDragAxisLockFeedbackState
} from "./pointDragAxisHintGeometry";

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
  const hintPosition = pointDragAxisHintPosition({
    cursor: feedback.cursor,
    viewportSize
  });
  const hintStyle = {
    left: `${hintPosition.x}px`,
    top: `${hintPosition.y}px`
  } satisfies CSSProperties;

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
        style={hintStyle}
      >
        <span
          className={`point-drag-axis-lock-action ${activeAxis === "x" ? "is-active" : ""}`.trim()}
          data-axis="x"
        >
          <kbd>[X]</kbd>
          <span>X軸</span>
        </span>
        <span
          className={`point-drag-axis-lock-action ${activeAxis === "y" ? "is-active" : ""}`.trim()}
          data-axis="y"
        >
          <kbd>[Y]</kbd>
          <span>Y軸</span>
        </span>
      </div>
    </div>
  );
};
