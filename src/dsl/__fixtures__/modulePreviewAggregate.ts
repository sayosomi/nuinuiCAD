/**
 * One valid nui 1 document that exercises Module Preview in the same shape as
 * the production aggregate composition: authored instances, nested modules,
 * scalar defaults, optional values, and root geometry references all coexist.
 */
export const modulePreviewAggregateSource = [
  "nui 1",
  "module Alternate(size: number = 30) {",
  "  point AltStart = coordinate(x: 0, y: 0)",
  "  point AltEnd = coordinate(x: @size, y: @size)",
  "  line AltLine = segment(start: @AltStart, end: @AltEnd)",
  "}",
  "point RootA = coordinate(x: 15, y: 20)",
  "point RootB = coordinate(x: 60, y: 20)",
  "line RootLine = segment(start: @RootA, end: @RootB)",
  "curve RootCurve = bezier(start: @RootA, end: @RootB)",
  "module PreviewTarget(width: number, anchor: point, edge: line, guide: path, label: string = \"default\", note: string?) {",
  "  point PreviewPoint = offset(from: @anchor, dx: @width, dy: 0)",
  "  line PreviewLine = segment(start: @anchor, end: @PreviewPoint)",
  "  const PassedEdge: line = @edge",
  "  const PassedGuide: path = @guide",
  "}",
  "module Inner(offset: number = 2) {",
  "  point InnerPoint = coordinate(x: @offset, y: 0)",
  "}",
  "module Outer(scale: number = 2) {",
  "  instance Nested = Inner(offset: @scale)",
  "  point OuterPoint = coordinate(x: @scale, y: 0)",
  "}",
  "instance AlternateInstance = Alternate()",
  "instance PreviewTargetInstance = PreviewTarget(width: 45, anchor: @RootA, edge: @RootLine, guide: @RootCurve)",
  "instance OuterInstance = Outer()",
  "instance OuterSecond = Outer(scale: 3)",
  "point AfterAggregate = coordinate(x: 100, y: 100)"
].join("\n");
