import type { CadElement, DivisionPlacement, NumericValue } from "../types/geometry";

type LegacyDivisionPlacementFields = {
  placement?: DivisionPlacement;
  placementMode?: unknown;
  distance?: NumericValue;
  ratio?: NumericValue;
};

/**
 * Old (pre-Task-05) `.nuinui.json` files store divisionPoint/lineDivisionPoint
 * placement as flat `placementMode`/`distance`/`ratio` sibling fields. Legacy
 * distance-mode maps to distance, everything else (ratio or an unrecognized/
 * missing mode) maps to ratio -- matching the characterized legacy JSON import
 * contract. A missing active value is data loss, not a default to paper over.
 */
const withDivisionPlacement = (element: CadElement): CadElement => {
  if (element.type !== "divisionPoint" && element.type !== "lineDivisionPoint") return element;
  const legacy = element as CadElement & LegacyDivisionPlacementFields;
  if (legacy.placement) return element;

  const kind: DivisionPlacement["kind"] = legacy.placementMode === "distance" ? "distance" : "ratio";
  const value = kind === "distance" ? legacy.distance : legacy.ratio;
  if (value === undefined) {
    throw new Error(
      `${element.name} の${kind === "distance" ? "距離" : "割合"}の値が見つかりません。旧形式のファイルが壊れている可能性があります。`
    );
  }

  const next = { ...legacy, placement: { kind, value } as DivisionPlacement };
  delete next.placementMode;
  delete next.distance;
  delete next.ratio;
  return next as CadElement;
};

export const normalizedElementFields = (element: CadElement): CadElement => {
  if ((element.type === "copyLine" || element.type === "move") && element.scale === undefined) {
    return { ...element, scale: 1 };
  }
  return withDivisionPlacement(element);
};
