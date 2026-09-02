import type { CanvasPresentation } from "../components/canvasPresentation";
import { propertyLabels } from "../geometry/numericExpressionProperties";
import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";
import {
  webviewPresentationTextFor,
  type VscodeWebviewPresentation
} from "./webviewPresentation";

const numericMeasurementKeys: readonly NumericMeasurementKey[] = [
  "length",
  "startAngleDeg",
  "endAngleDeg",
  "radius",
  "sweepAngleDeg",
  "startRadiusAngleDeg",
  "endRadiusAngleDeg",
  "startHandleAngleDeg",
  "startHandleLength",
  "endHandleAngleDeg",
  "endHandleLength"
];

export const webviewCanvasPresentationFor = (
  presentation: VscodeWebviewPresentation | null | undefined
): CanvasPresentation => ({
  text: (key, fallback, parameters) => webviewPresentationTextFor(
    presentation,
    key,
    fallback,
    parameters
  ),
  undefinedValue: webviewPresentationTextFor(presentation, "geometry.undefined", "未定義"),
  numericReferenceLabels: Object.fromEntries(numericMeasurementKeys.map((key) => [
    key,
    webviewPresentationTextFor(presentation, `geometry.property.${key}`, propertyLabels[key])
  ])) as Partial<Record<NumericMeasurementKey, string>>,
  statusFields: {
    zoom: webviewPresentationTextFor(presentation, "viewport.status.zoom", "ZOOM"),
    x: webviewPresentationTextFor(presentation, "viewport.status.x", "X"),
    y: webviewPresentationTextFor(presentation, "viewport.status.y", "Y")
  },
  axisLock: {
    holdShift: webviewPresentationTextFor(presentation, "canvas.axisLock.holdShift", "Hold Shift for "),
    horizontal: webviewPresentationTextFor(presentation, "canvas.axisLock.horizontal", "Horizontal"),
    vertical: webviewPresentationTextFor(presentation, "canvas.axisLock.vertical", "Vertical")
  }
});
