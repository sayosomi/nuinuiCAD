// Frozen before first execution. Numbers are analytic Y-up millimeter oracles,
// not values copied from either evaluator. Sources adapt the existing Extract,
// Inline, Coordinate Conversion and Source Value Step fixtures.
export type Oracle = Record<string, Record<string, unknown>>;
export type Action =
  | { kind: "extract"; targets: string[]; rejectedCode?: string }
  | { kind: "inline"; target: string; hidden?: boolean; skipped?: string }
  | { kind: "rename"; target: string; name: string; rejectedReason?: string }
  | { kind: "convert"; targets: string[]; base: string; mode: "xy" | "angle-distance"; successes?: number }
  | { kind: "step"; marker: string; token: string; next: string; oracle: Oracle; scalars?: Record<string,number> }
  | { kind: "append"; text: string; oracle: Oracle }
  | { kind: "bake"; target: string; expected: Record<string, unknown>; generatedName?: string }
  | { kind: "staleBake"; target: string; expected: Record<string, unknown> }
  | { kind: "history"; target: string; expected: Record<string, unknown> };
export type Case = { id: string; hypothesis: string; source: string; oracle: Oracle; scalars?: Record<string, number>; actions: Action[]; protected?: string[] };
const source = (...lines: string[]) => ["nui 1", "// untouched mission sentinel", ...lines, "// untouched final sentinel"].join("\n");
const point = (x: number, y: number) => ({ kind: "point", x, y });
const line = (x: number, y: number, ex: number, ey: number) => ({ kind: "line", start: { x, y }, end: { x: ex, y: ey } });
const extract = (...targets: string[]): Action => ({ kind: "extract", targets });
const inline = (target = "Part"): Action => ({ kind: "inline", target });
const rename = (target: string, name: string): Action => ({ kind: "rename", target, name });
const convert = (targets: string[], base = "Base", mode: "xy" | "angle-distance" = "xy", successes?: number): Action => ({ kind: "convert", targets, base, mode, successes });
const bake = (target: string, expected: Record<string, unknown>, generatedName?: string): Action => ({ kind: "bake", target, expected, generatedName });

export const cases: Case[] = [
  { id: "E01", hypothesis: "Moved endpoint and segment retain external consumers after qualified-to-group transition", source: source(
    "point P = coordinate(x: 3, y: 4)", "line L = segment(start: @P, end: (13, 4))", "point User = offset(from: @L.end, dx: 2, dy: 1)"),
    oracle: { P: point(3,4), L: line(3,4,13,4), User: point(15,5) }, actions: [extract("P","L"), inline()] },
  { id: "E02", hypothesis: "Extracted scalar export and parameter lowering preserve scalar-to-point dependencies", source: source(
    "const width: number = 7", "const local: number = @width * 2", "point P = coordinate(x: @local, y: 3)", "const read: number = @local + 5"),
    oracle: { P: point(14,3) }, scalars: { read: 19 }, actions: [extract("local","P"), inline()] },
  { id: "E03", hypothesis: "Second parameterized instance remains independent when only generated first instance is inlined", source: source(
    "const width: number = 6", "point P = coordinate(x: @width, y: 2)", "point User = offset(from: @P, dx: 1, dy: 0)"),
    oracle: { P: point(6,2), User: point(7,2) }, actions: [extract("P"),
      { kind: "append", text: "instance Second = Extracted(width: 17)\npoint Other = offset(from: @Second::P, dx: 2, dy: 3)", oracle: { "Second::P": point(17,2), Other: point(19,5) } }, inline()] },
  { id: "E04", hypothesis: "Nested group extraction and inlining do not capture same-spelled outer names", source: source(
    "point P = coordinate(x: 100, y: 200)", "const width: number = 30", "group G {", "  const width: number = 5", "  point P = coordinate(x: @width, y: 8)", "  point User = offset(from: @P, dx: 1, dy: 2)", "}", "point Outer = offset(from: @P, dx: 2, dy: 3)"),
    oracle: { P: point(100,200), "G::P": point(5,8), "G::User": point(6,10), Outer: point(102,203) }, actions: [extract("G::P"), inline("G::Part")] },
  { id: "E05", hypothesis: "CRLF multiline extraction/inline preserve physical footprints and untouched bytes", source: source(
    "point Base = coordinate(x: 2, y: 3)", "point P = coordinate(", "  x: 11, // x note", "  y: -7,", ") // end note", "// interstitial moved comment", "", "line L = segment(start: @Base, end: @P)", "const read: number = @L.length").replace(/\n/g,"\r\n"),
    oracle: { Base: point(2,3), P: point(11,-7), L: line(2,3,11,-7) }, scalars: { read: Math.sqrt(181) }, actions: [extract("P","L"), inline()] },
  { id: "E06", hypothesis: "Two exported points and typed reads keep their distinct qualified routes", source: source(
    "point A = coordinate(x: -2, y: 3)", "point B = coordinate(x: 10, y: 8)", "line L = segment(start: @A, end: @B)", "const read: number = @A.x + @B.y"),
    oracle: { A: point(-2,3), B: point(10,8), L: line(-2,3,10,8) }, scalars: { read: 6 }, actions: [extract("A","B"), inline()] },
  { id: "I01", hypothesis: "Rename generated authored geometry after inlining keeps external module-style routes", source: source(
    "module Stamp() {", "  export point P = coordinate(x: 4, y: 9)", "}", "instance Copy = Stamp()", "point User = offset(from: @Copy::P, dx: 1, dy: 2)"),
    oracle: { "Copy::P": point(4,9), User: point(5,11) }, actions: [inline("Copy"), rename("Copy::P","Anchor")] },
  { id: "I02", hypothesis: "Rename lowered scalar only in selected inline instance, retaining second instance value", source: source(
    "module Stamp(width: number) {", "  const local: number = @width * 2", "  export point P = coordinate(x: @local, y: 1)", "}", "instance First = Stamp(width: 3)", "instance Second = Stamp(width: 8)", "line L = segment(start: @First::P, end: @Second::P)"),
    oracle: { "First::P": point(6,1), "Second::P": point(16,1), L: line(6,1,16,1) }, actions: [inline("First"), rename("First::local","length")] },
  { id: "I03", hypothesis: "Bake after one inline respects coinciding leaves in independent instance scopes", source: source(
    "module Stamp(dx: number) {", "  export line L = segment(start: (@dx, 0), end: (@dx + 3, 4))", "}", "instance First = Stamp(dx: 2)", "instance Second = Stamp(dx: 20)", "point User = offset(from: @Second::L.end, dx: 1, dy: 0)"),
    oracle: { "First::L": line(2,0,5,4), "Second::L": line(20,0,23,4), User: point(24,4) }, actions: [inline("First"), bake("First::L",line(2,0,5,4))] },
  { id: "I04", hypothesis: "Inlining nested module preserves exported scalar alias and geometry chain for dependent Bake", source: source(
    "module Outer(width: number) {", "  module Inner(v: number) {", "    export point P = coordinate(x: @v, y: 2)", "  }", "  instance Kid = Inner(v: @width)", "  const alias: number = @width + 1", "  export point P = offset(from: @Kid::P, dx: @alias, dy: 1)", "}", "instance Copy = Outer(width: 5)", "line L = segment(start: @Copy::P, end: (20, 9))"),
    oracle: { "Copy::Kid::P": point(5,2), "Copy::P": point(11,3), L: line(11,3,20,9) }, actions: [inline("Copy"), bake("L",line(11,3,20,9))] },
  { id: "I05", hypothesis: "Explicit hidden inline followed by Rename preserves activity; disabled instance stays guarded", source: source(
    "module Stamp() {", "  export point P = coordinate(x: 7, y: -2)", "}", "instance Hidden(visible: false) = Stamp()", "instance Disabled(enabled: false) = Stamp()", "point Other = coordinate(x: 40, y: 50)"),
    oracle: { "Hidden::P": point(7,-2), Other: point(40,50) }, actions: [{ kind: "inline", target: "Disabled", skipped: "disabled-excluded" }, { kind: "inline", target: "Hidden", hidden: true }, rename("Hidden::P","Anchor")] },
  { id: "I06", hypothesis: "Intervening inline revision rejects pre-inline Bake plan; fresh retry and no-op are atomic", source: source(
    "module Stamp() {", "  point P = coordinate(x: 2, y: 3)", "}", "instance Copy = Stamp()", "line L = segment(start: (1, 2), end: (6, 14))"),
    oracle: { "Copy::P": point(2,3), L: line(1,2,6,14) }, actions: [{ kind: "staleBake", target: "L", expected: line(1,2,6,14) }, inline("Copy"), bake("L",line(1,2,6,14))] },
  { id: "C01", hypothesis: "XY conversion base Rename propagates to new relational source without changing world position", source: source(
    "point Base = coordinate(x: 10, y: 20)", "point P = coordinate(x: 30, y: 5)", "line L = segment(start: @Base, end: @P)"),
    oracle: { Base: point(10,20), P: point(30,5), L: line(10,20,30,5) }, actions: [convert(["P"]), rename("Base","Origin")] },
  { id: "C02", hypothesis: "Polar conversion in negative-angle quadrant retains world point through target Rename", source: source(
    "point Base = coordinate(x: 3, y: 7)", "point P = coordinate(x: -1, y: 4)", "point User = offset(from: @P, dx: 1, dy: 0)"),
    oracle: { Base: point(3,7), P: point(-1,4), User: point(0,4) }, actions: [convert(["P"],"Base","angle-distance"), rename("P","Target")] },
  { id: "C03", hypothesis: "Mixed supported and relational target conversion leaves skipped statement byte-identical before Rename", source: source(
    "point Base = coordinate(x: 1, y: 2)", "point P = coordinate(x: 4, y: 6)", "point Skip = offset(from: @Base, dx: 8, dy: 9)"),
    oracle: { Base: point(1,2), P: point(4,6), Skip: point(9,11) }, protected: ["point Skip = offset(from: @Base, dx: 8, dy: 9)"], actions: [convert(["P","Skip"],"Base","xy",1), rename("P","Target")] },
  { id: "C04", hypothesis: "Stepping emitted dx changes only target and downstream endpoint by exactly one millimeter", source: source(
    "point Base = coordinate(x: 10, y: -3)", "point P = coordinate(x: 16, y: 5)", "line L = segment(start: @Base, end: @P)"),
    oracle: { Base: point(10,-3), P: point(16,5), L: line(10,-3,16,5) }, actions: [convert(["P"]), { kind: "step", marker: "dx:", token: "6", next: "7", oracle: { P: point(17,5), L: line(10,-3,17,5) } }] },
  { id: "C05", hypothesis: "Scalar step updates dependent point; fresh conversion rejects binding-dependent target and stale eligible-neighbor plan", source: source(
    "const width: number = 5", "point Base = coordinate(x: 0, y: 0)", "point P = coordinate(x: @width * 2, y: 3)", "point Neighbor = coordinate(x: 8, y: 6)"),
    oracle: { Base: point(0,0), P: point(10,3), Neighbor: point(8,6) }, actions: [{ kind: "step", marker: "const width: number =", token: "5", next: "6", oracle: { P: point(12,3) } }, convert(["P"],"Base","xy",0), convert(["Neighbor"])] },
  { id: "C06", hypothesis: "Conversion then dependent line Bake preserves original authored target/reference identities", source: source(
    "point Base = coordinate(x: -3, y: 2)", "point P = coordinate(x: 5, y: 8)", "line L = segment(start: @Base, end: @P)"),
    oracle: { Base: point(-3,2), P: point(5,8), L: line(-3,2,5,8) }, actions: [convert(["P"]), bake("L",line(-3,2,5,8))] },
  { id: "S01", hypothesis: "Extracted instance Rename keeps qualified external geometry and scalar routes through Inline", source: source(
    "const width: number = 9", "point P = coordinate(x: @width, y: 4)", "const read: number = @P.x + 3", "point User = offset(from: @P, dx: 2, dy: 0)"),
    oracle: { P: point(9,4), User: point(11,4) }, scalars: { read: 12 }, actions: [extract("P"), rename("Part","Renamed"), inline("Renamed")] },
  { id: "S02", hypothesis: "Inline/Rename/Bake avoid ancestor and same-scope suffix capture", source: source(
    "const Seam_bake: number = 30", "module Stamp() {", "  export line L = segment(start: (2, 3), end: (5, 7))", "}", "instance Copy = Stamp()", "point User = coordinate(x: @Seam_bake, y: 0)", "point End = offset(from: @Copy::L.end, dx: 1, dy: 0)"),
    oracle: { "Copy::L": line(2,3,5,7), User: point(30,0), End: point(6,7) }, actions: [inline("Copy"), rename("Copy::L","Seam"), bake("Copy::Seam",line(2,3,5,7),"Seam_bake_2")] },
  { id: "S03", hypothesis: "Polar conversion/length step/Bake predict radial delta and ordered downstream line geometry", source: source(
    "point Base = coordinate(x: 2, y: 3)", "point P = coordinate(x: 5, y: 7)", "line L = segment(start: @Base, end: @P)"),
    oracle: { Base: point(2,3), P: point(5,7), L: line(2,3,5,7) }, actions: [convert(["P"],"Base","angle-distance"), { kind: "step", marker: "distance:", token: "5", next: "6", oracle: { P: point(5.6,7.8), L: line(2,3,5.6,7.8) } }, bake("L",line(2,3,5.6,7.8))] },
  { id: "S04", hypothesis: "Extract/Inline produce authored point ownership usable by Coordinate Conversion", source: source(
    "point Base = coordinate(x: 1, y: 1)", "point P = coordinate(x: 6, y: 13)", "point User = offset(from: @P, dx: 2, dy: 0)"),
    oracle: { Base: point(1,1), P: point(6,13), User: point(8,13) }, actions: [extract("P"), inline(), convert(["Part::P"])] },
  { id: "S05", hypothesis: "Rename/Extract/Bake retain dependent clockwise arc sweep and center route", source: source(
    "point Center = coordinate(x: 4, y: -2)", "arc Arc = arc(center: @Center, radius: 10, start: 20, end: -70, direction: clockwise)", "const read: number = @Arc.length"),
    oracle: { Center: point(4,-2), Arc: { kind: "arcLine", center: { x: 4, y: -2 }, radius: 10, startAngleDeg: 20, sweepAngleDeg: -90 } }, scalars: { read: 5 * Math.PI },
    actions: [rename("Center","Origin"), extract("Origin"), bake("Arc",{ kind: "arcLine", center: { x: 4, y: -2 }, radius: 10, startAngleDeg: 20, sweepAngleDeg: -90 })] },
  { id: "S06", hypothesis: "Committed Extract/Inline/Rename with undo/redo reject stale Bake despite equal restored text", source: source(
    "point P = coordinate(x: 3, y: 6)", "line L = segment(start: @P, end: (9, 14))", "point Unrelated = coordinate(x: 80, y: 90)"),
    oracle: { P: point(3,6), L: line(3,6,9,14), Unrelated: point(80,90) }, actions: [extract("P"), inline(), rename("Part::P","Anchor"), { kind: "history", target: "L", expected: line(3,6,9,14) }] }
];
