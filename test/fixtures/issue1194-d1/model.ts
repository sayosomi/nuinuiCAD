import { expectedFor } from "./oracles";
// Seed 1194. Values are authored independently of either evaluator.
export type Cell = {
  id: string;
  axes: [number, number, number];
  source: string;
  saved?: Record<string, string>;
  expected: Record<string, number>;
  expectedIssues?: Record<string, string>;
  expectedNone?: string[];
  expectedCompilerError?: string;
};
const source = (...lines: string[]) => ["nui 1", ...lines].join("\n");
export const cells: Cell[] = [];
for (let i = 0; i < 8; i++) {
  const a = i >> 2, b = (i >> 1) & 1, c = i & 1;
  const axes: Cell["axes"] = [a, b, c];
  const id = (s: string) => `${s}0${i}`;
  cells.push({ id: id("A"), axes, expected: expectedFor("A", axes), source: source(
    "record Packet(xs: number[], tag: number)",
    ...(a ? [] : ["const Input0: Packet = Packet(xs: [7, 19, 31], tag: 101)", ...(c ? ["const Input1: Packet = Packet(xs: [37, 43], tag: 307)"] : [])]),
    "module Forward(packet: Packet) {",
    ...(b ? ["  const local: Packet = @packet"] : []),
    `  export const out: Packet = @${b ? "local" : "packet"}`,
    "}",
    `instance Use0 = Forward(packet: ${a ? "Packet(xs: [7, 19, 31], tag: 101)" : "@Input0"})`,
    ...(c ? [`instance Use1 = Forward(packet: ${a ? "Packet(xs: [37, 43], tag: 307)" : "@Input1"})`] : []),
    ...Array.from({ length: c + 1 }, (_, j) => [
      `const Size${j}: number = @Use${j}::out.xs.length`,
      `const Pick${j}: number = @Use${j}::out.xs[1]`,
      `const Tag${j}: number = @Use${j}::out.tag`
    ]).flat()
  ) });
  const type = a ? "Packet" : "number[]";
  const present = a ? "Packet(xs: [11, 23], tag: 47)" : "[11, 23]";
  const selected = b ? "match @Maybe { none => @Danger some held => @held }" : "@Optional ?? @Danger";
  const absent = b ? "match @Missing { none => @Present some held => @held }" : "if (false) { @Danger }";
  const bbody = [
    "const Zeros: number[] = [0]",
    "const BadMembers: number[] = for zero in @Zeros { 1 / @zero }",
    `const Present: ${type} = ${present}`,
    `const Danger: ${type} = ${a ? "Packet(xs: @BadMembers, tag: 47)" : "@BadMembers"}`,
    `const Maybe: ${type}? = @Present`,
    `const Missing: ${type}? = none`,
    ...(!b ? [`const Optional: ${type}? = if (true) { @Present }`] : []),
    `${c ? "export " : ""}const Chosen: ${type} = ${selected}`,
    `const Absent: ${type}? = ${absent}`,
    `${c ? "export " : ""}const NoneCheck: number = ${b ? (a ? "@Missing?.tag ?? 73" : "@Missing?.length ?? 73") : (a ? "@Absent?.tag ?? 73" : "@Absent?.length ?? 73")}`,
    `${c ? "export " : ""}const Other: ${type} = ${b ? "@Absent ?? @Present" : "@Missing ?? @Present"}`
  ];
  const prefix = c ? "@Use::" : "@";
  cells.push({ id: id("B"), axes, expected: expectedFor("B", axes), source: source(
    ...(a ? ["record Packet(xs: number[], tag: number)"] : []),
    ...(c ? ["module Select() {", ...bbody, "}", "instance Use = Select()"] : bbody),
    `const Size: number = ${prefix}Chosen${a ? ".xs" : ""}.length`,
    `const Pick: number = ${prefix}Chosen${a ? ".xs" : ""}[1]`,
    ...(c ? ["const NoneCheck: number = @Use::NoneCheck"] : []),
    `const OtherPick: number = ${prefix}Other${a ? ".xs" : ""}[0]`,
    ...(a ? [`const Tag: number = ${prefix}Chosen.tag`] : [])
  ) });
  const inputType = a ? "Packet[]" : "Packet";
  const init = a ? "[@First, @Second]" : "Packet(xs: [17, 29, 41], tag: 53)";
  const cbody = [
    "const Index: number = 0",
    ...(b ? (a ? ["const Mapped: Packet[] = for item in @Input { Packet(xs: @item.xs, tag: @item.tag + 10) }"] : ["const Numbers: number[] = @Input.xs", "const Mapped: number[] = for item in @Numbers { @item + 10 }"]) : []),
    `${c ? "export " : ""}const Pick: number = ${a ? `@${b ? "Mapped" : "Input"}[${b ? "@Index + 1" : "1"}].xs[${b ? "@Index + 1" : "1"}]` : b ? "@Mapped[@Index + 1]" : "@Input.xs[1]"}`,
    `${c ? "export " : ""}const Tag: number = ${a ? `@${b ? "Mapped" : "Input"}[${b ? "@Index + 1" : "1"}].tag` : "@Input.tag"}`
  ];
  cells.push({ id: id("C"), axes, expected: expectedFor("C", axes), source: source(
    "record Packet(xs: number[], tag: number)",
    ...(a ? ["const First: Packet = Packet(xs: [3, 5], tag: 13)", "const Second: Packet = Packet(xs: [17, 29, 41], tag: 53)"] : []),
    `const Seed: ${inputType} = ${init}`,
    ...(c ? [`module Observe(Input: ${inputType}) {`, ...cbody, "}", "instance Use = Observe(Input: @Seed)", "const Pick: number = @Use::Pick", "const Tag: number = @Use::Tag"] : [`const Input: ${inputType} = @Seed`, ...cbody])
  ) });
  const dtype = a ? "line" : "point";
  cells.push({ id: id("D"), axes, expected: expectedFor("D", axes), source: source(
    `record Shape(geometry: ${dtype}, tag: number)`,
    `const Target: ${dtype} = ${a ? "segment(start: (3, 4), end: (9, 12))" : "coordinate(x: 9, y: 12)"}`,
    ...(b ? [`const Forward: ${dtype} = @Target`] : []),
    `const Input: Shape = Shape(geometry: @${b ? "Forward" : "Target"}, tag: 17)`,
    ...(c ? ["module Relay(input: Shape) {", "  const local: Shape = @input", "  export const out: Shape = @local", "}", "instance Use = Relay(input: @Input)"] : []),
    `const Geometry: ${dtype} = @${c ? "Use::out" : "Input"}.geometry`,
    `const X: number = @Geometry${a ? ".end" : ""}.x`,
    `const Y: number = @Geometry${a ? ".end" : ""}.y`,
    ...(a ? ["const Length: number = @Geometry.length"] : [])
  ) });
  const library = source(
    ...(b ? ["record Inner(n: number)", "record Packet(inner: Inner, tag: number)"] : ["record Packet(xs: number[], tag: number)"]),
    "export module Factory() {",
    `  const Value: Packet = Packet(${b ? "inner: Inner(n: 61)" : "xs: [13, 31, 59]"}, tag: 83)`,
    ...(c ? ["  const Alias: Packet = @Value"] : []),
    `  export const out: Packet = @${c ? "Alias" : "Value"}`,
    "}"
  );
  const imported = "Use::out";
  cells.push({ id: id("E"), axes, expected: expectedFor("E", axes), saved: { "library.nui": library, ...(a ? { "relay.nui": source('import "./library.nui" as original', "export @original::Factory") } : {}) }, source: source(
    `import "./${a ? "relay" : "library"}.nui" as lib`,
    "instance Use = lib::Factory()",
    `const Pick: number = @${imported}.${b ? "inner.n" : "xs[1]"}`,
    `const Tag: number = @${imported}.tag`,
    ...(b ? [] : [`const Size: number = @${imported}.xs.length`])
  ) });
}
cells.sort((l, r) => l.id.localeCompare(r.id));
