import type { CommonEditorProps } from "./parameterEditorShared";
import { CurveElementFields } from "./CurveElementFields";
import { LineElementFields } from "./LineElementFields";
import { PointElementFields } from "./PointElementFields";

export const ElementSpecificFields = (props: CommonEditorProps) => {
  switch (props.element.type) {
    case "freePoint":
    case "offsetPoint":
    case "polarOffsetPoint":
    case "divisionPoint":
    case "lineDivisionPoint":
    case "intersectionPoint":
    case "lineTangentOffsetPoint":
      return <PointElementFields {...props} />;
    case "line":
    case "arcLine":
    case "threePointArcLine":
    case "cornerRadiusArcLine":
    case "offsetLine":
    case "splitLine":
    case "copyLine":
    case "symmetricCopyLine":
      return <LineElementFields {...props} />;
    case "bezierCurve":
      return <CurveElementFields {...props} />;
    case "group":
      return null;
  }
};
