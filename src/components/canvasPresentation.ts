import type { NumericMeasurementKey } from "../geometry/numericExpressionTypes";

export type CanvasPresentationParameters = Readonly<Record<string, string | number | boolean>>;

/** Presentation adapter used by the shared Canvas without exposing locale state. */
export type CanvasPresentation = {
  text: (key: string, fallback: string, parameters?: CanvasPresentationParameters) => string;
  undefinedValue?: string;
  numericReferenceLabels?: Partial<Record<NumericMeasurementKey, string>>;
  statusFields?: { zoom: string; x: string; y: string };
  axisLock?: {
    holdShift: string;
    horizontal: string;
    vertical: string;
  };
};
