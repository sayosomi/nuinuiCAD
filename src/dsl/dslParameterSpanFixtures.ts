import type { CadElement } from "../types/geometry";

/** Canonical dependency-valid coverage document shared by Phase 3 editor tests. */
export const phase3aCanonicalParameterSpanSource = [
  "point EvalA = (0, 0)",
  "point EvalB = (20, 0)",
  "line EvalAB = EvalA -> EvalB",
  "element G type=group locked=true visible=false enabled=false color=accent printEnabled=true printAnchor=(1, 2)",
  "element Cond type=conditionalGroup locked=true visible=false enabled=false color=accent condition=1",
  "element Loop type=forGroup locked=true visible=false enabled=false color=accent variableName=i start=0 count=2 step=1 showGenerated=true",
  "var V = 2 scope=group locked=true enabled=false",
  "point A = (0, 0) locked=true visible=false enabled=false color=accent",
  "point B = (100, 0) locked=true visible=false enabled=false color=accent",
  "point C = (50, 50) locked=true visible=false enabled=false color=accent",
  "point Off = offset A dx=3 dy=4 locked=true visible=false enabled=false color=accent",
  "point Polar = polar A angle=30 distance=5 locked=true visible=false enabled=false color=accent",
  "point Div = between A B ratio=0.25 locked=true visible=false enabled=false color=accent",
  "line AB = A -> B locked=true visible=false enabled=false color=accent",
  "point On = on AB.end distance=10 locked=true visible=false enabled=false color=accent",
  "line CD = C -> B locked=true visible=false enabled=false color=accent",
  "point Cross = intersection AB CD index=0 extensions=true locked=true visible=false enabled=false color=accent",
  "line Angle = from A angle=45 length=30 locked=true visible=false enabled=false color=accent",
  "arc Arc center=A radius=20 start=0 end=90 locked=true visible=false enabled=false color=accent",
  "point Tangent = tangentOffset Arc base=A angle=10 distance=2 locked=true visible=false enabled=false color=accent",
  "arc Through = through A C B start=0 end=180 locked=true visible=false enabled=false color=accent",
  "arc Corner = corner AB.end Angle.start radius=5 index=0 locked=true visible=false enabled=false color=accent",
  "element Edge type=edge locked=true visible=false enabled=false endpoint1=AB.end endpoint2=Angle.start intersectionIndex=0",
  "line Extend = extend AB.end to=C locked=true visible=false enabled=false",
  "curve Curve = A -> B startAngle=0 startLength=10 endAngle=180 endLength=20 vars=[local:1 + 2] intermediates=[(4, 5):45:6:7] locked=true visible=false enabled=false color=accent",
  "line Seam = offset [AB] distance=4 side=left closed=true suppressTrimWarnings=true locked=true visible=false enabled=false color=accent",
  "line Split = split AB at=C locked=true visible=false enabled=false color=accent",
  "element Copy type=copyLine locked=true visible=false enabled=false color=accent startPoint=A endPoint=B scale=1.5 angleDeg=5 mirrorX=true baseLineIds=[AB]",
  "element SymCopy type=symmetricCopyLine locked=true visible=false enabled=false color=accent axisPoint1=A axisPoint2=B baseLineIds=[AB]",
  "element Move type=move locked=true visible=false enabled=false startPoint=A endPoint=B scale=2 angleDeg=10 mirrorX=false baseLineIds=[AB]",
  "element SymMove type=symmetricMove locked=true visible=false enabled=false axisPoint1=A axisPoint2=B baseLineIds=[AB]",
  "element Img type=image locked=true visible=false enabled=false color=accent sourcePath=\"ref.png\" originPoint=(8, 9) naturalWidthPx=100 naturalHeightPx=200 sourceDpi=300 targetPixelsPerMm=2 scale=1.25 angleDeg=15 mirrorX=true",
  "text Label = \"hello\" at=A size=4 locked=true visible=false enabled=false color=accent"
].join("\n");

export const phase3aFixtureElementNameByType: Record<CadElement["type"], string> = {
  group: "G", conditionalGroup: "Cond", forGroup: "Loop", variable: "V", freePoint: "A",
  offsetPoint: "Off", polarOffsetPoint: "Polar", divisionPoint: "Div", lineDivisionPoint: "On",
  intersectionPoint: "Cross", lineTangentOffsetPoint: "Tangent", line: "AB", angleLengthLine: "Angle",
  arcLine: "Arc", threePointArcLine: "Through", cornerRadiusArcLine: "Corner", edge: "Edge",
  extendTrim: "Extend", bezierCurve: "Curve", offsetLine: "Seam", splitLine: "Split", copyLine: "Copy",
  symmetricCopyLine: "SymCopy", move: "Move", symmetricMove: "SymMove", image: "Img", text: "Label"
};
