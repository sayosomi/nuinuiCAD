/**
 * Regression source matching the SAY-69 Manual E2E document shape.
 * Blank lines are intentional: they expose the distinction between semantic
 * statement indexes and the source map's logical-line projection.
 */
export const outputPreviewManualE2eSource = [
  "nui 1",
  "",
  "const scale: number = 1",
  "const overlap: number = 5",
  "",
  "layer finished",
  "",
  "group 前身頃 {",
  "  point 基準点 = coordinate(x: 0, y: 0)",
  "  line 輪郭 in @finished = segment(start: (0, 0), end: (30, 0))",
  "}",
  "",
  "group 後身頃 {",
  "  point 基準点 = coordinate(x: 5, y: 5)",
  "  line 輪郭 in @finished = segment(start: (0, 0), end: (20, 0))",
  "}",
  "",
  "layout 型紙(scale: @scale) {",
  "  place @前身頃(origin: @前身頃::基準点, at: (0, 0), scale: @scale, angle: 0, mirror: false)",
  "  place @後身頃(at: (40, 0), mirror: false)",
  "}",
  "",
  "print 家庭用A4(",
  "  layout: @型紙,",
  "  layers: [@finished],",
  "  paper: a4,",
  "  orientation: portrait,",
  "  overlap: @overlap,",
  ")",
  "",
  "svg 型紙SVG(",
  "  layout: @型紙,",
  "  layers: [@finished],",
  "  margin: 0,",
  ")"
].join("\n");
