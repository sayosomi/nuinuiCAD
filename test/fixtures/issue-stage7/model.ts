import fc from "fast-check";

export type Cell = {
  id: string; hypothesis: "H1" | "H2"; cell: number; control: boolean; seed: number;
  type: "point" | "line" | "path"; module: boolean; inner: number; match: boolean; ancestor: boolean;
  inputs: { u: number; d: number; f: number }; source: string;
};
const draws = fc.record({ u: fc.integer({ min: 7, max: 29 }), d: fc.integer({ min: 11, max: 37 }), f: fc.integer({ min: 3, max: 9 }) });
export function candidate(hypothesis: Cell["hypothesis"], cell: number, control = false): Cell {
  const seed = 9000 + (hypothesis === "H2" ? 100 : 0) + (control ? 0 : cell);
  const inputs = fc.sample(draws, { seed, numRuns: 1 })[0], { u, d, f } = inputs;
  const type = hypothesis === "H1" ? (cell & 4 ? "path" : "line") : (cell & 4 ? "line" : "point");
  const c: Cell = { id: `${hypothesis}-${String(cell).padStart(2, "0")}${control ? "-control" : ""}`, hypothesis, cell, control, seed,
    type, module: !!(cell & 2), inner: cell & 1 ? 2 : 0, match: !!(cell & 2), ancestor: !!(cell & 1), inputs, source: "" };
  const code = ["nui 1"];
  if (hypothesis === "H1") {
    const origin = c.module ? "@Origin" : String(u);
    if (c.module) code.push("module Box(Origin: number) {");
    code.push("const OuterTicks: number[] = [1,2]", `const InnerTicks: number[] = [${c.inner ? "1,2" : ""}]`);
    const geometry = (start: string, end: string, middle: string) => type === "line" ? `segment(start: ${start}, end: ${end})` : `polyline(points: [${start}, ${middle}, ${end}], closed: false)`;
    code.push(`line SeedA = ${geometry(`(${origin},2)`, `(${origin}+3,6)`, `(${origin}+3,2)`)}`,
      `move SeedA as shifted (from: (0,0), to: (${d},${f}))`, "move SeedA as later (from: (0,0), to: (101,203))",
      `line SeedB = ${geometry(`(${origin}+40,0-8)`, `(${origin}+64,0-1)`, `(${origin}+40,0-1)`)}`,
      "move SeedB as ignored (from: (0,0), to: (211,307))", `const Seeds: ${type}[] = [@SeedA.shifted,@SeedB.base]`,
      `for OuterTick in @OuterTicks carry Outer: ${type}[] = @Seeds {`, `const Outer0: ${type} = @Outer[0]`, `const Outer1: ${type} = @Outer[1]`, "point OuterStart = from(source: @Outer0.start)", "point OuterEnd = from(source: @Outer1.end)");
    if (control) code.push("next Outer = @Outer");
    else code.push(`for InnerTick in @InnerTicks carry Inner: ${type}[] = @Outer {`,
      `const Inner0: ${type} = @Inner[0]`, `const Inner1: ${type} = @Inner[1]`, "point InnerStart = from(source: @Inner0.start)", "point InnerEnd = from(source: @Inner1.end)",
      `line Rebuilt = ${geometry("@Inner0.end", `(${origin}+@OuterTick*11+@InnerTick*3,@OuterTick*7+@InnerTick*5)`, `(${origin}+@OuterTick*11+@InnerTick*3,${c.module ? "0" : "@Inner0.end.y"})`)}`,
      "move Rebuilt as shifted (from: (0,0), to: (2,3))", "move Rebuilt as ignored (from: (0,0), to: (401,503))",
      `const Kept: ${type} = @Inner[1]`, `const Advance: ${type}[] = [@Kept,@Rebuilt.shifted]`, "next Inner = @Advance", "}", "next Outer = @Inner");
    code.push("}");
    for (let i = 0; i < 2; i++) code.push(`const Final${i}: ${type} = @Outer[${i}]`, `${c.module ? "export " : ""}${type} Result${i} = from(source: @Final${i})`,
      `${c.module ? "export " : ""}point Start${i} = from(source: @Final${i}.start)`, `${c.module ? "export " : ""}point End${i} = from(source: @Final${i}.end)`);
    if (c.module) code.push("}", `instance Live = Box(Origin: ${u})`, `point Qualified = from(source: @Live::Result0.end)`);
  } else {
    const point = (x: string, y: number) => `coordinate(x: ${x}, y: ${y})`;
    const member = (x: string, y: number) => type === "point" ? point(x, y) : `segment(start: (${x},${y}), end: (${x}+3,${y}+4))`;
    code.push("module Box(Origin: number, Fail: boolean) {", "export point Prefix = coordinate(x: @Origin, y: 1)");
    if (c.match) code.push("const Side: choice(fail, valid) = if (@Fail) { fail } else { valid }");
    code.push(`const Bad: ${type} = ${member("1 / 0", f)}`, `const Good0: ${type} = ${member("@Origin+2", f)}`, `const Good1: ${type} = ${member("@Origin+17", d)}`, `const Other: ${type} = ${member("@Origin+40", d)}`);
    const bad = "[@Bad,@Other]", good = "[@Good0,@Good1]";
    code.push(`const Chosen: ${type}[] = ${c.match ? `match @Side { fail => ${bad} valid => ${good} }` : `if (@Fail) { ${bad} } else { ${good} }`}`,
      "const Ticks: number[] = [1]", `for Tick in @Ticks carry Carried: ${type}[] = @Chosen {`, `const First: ${type} = @Carried[0]`, `const Second: ${type} = @Carried[1]`, `const Swap: ${type}[] = [@Second,@First]`, "next Carried = @Swap", "}");
    if (type === "point") code.push("export line Mark = segment(start: @Carried[0], end: @Carried[1])");
    else code.push("const Final0: line = @Carried[0]", "const Final1: line = @Carried[1]", "export line Mark = segment(start: @Final0.end, end: @Final1.start)");
    code.push("}");
    if (c.ancestor) code.push("group Sleeping(enabled: false) {", "instance Dormant = Box(Origin: 1 / 0, Fail: true)", "}");
    else code.push("instance Dormant(enabled: false) = Box(Origin: 1 / 0, Fail: true)");
    code.push(`instance One = Box(Origin: ${u}, Fail: ${!control})`, "line UseOne = from(source: @One::Mark)",
      `instance Two = Box(Origin: ${u+d+17}, Fail: false)`, "line UseTwo = from(source: @Two::Mark)", `point Survivor = coordinate(x: ${u+d}, y: ${0-f})`);
  }
  c.source = code.join("\n").replace(/[+*]/g, operator => ` ${operator} `) + "\n";
  return c;
}
export const campaign = () => {
  const all = (["H1", "H2"] as const).flatMap(h => Array.from({ length: 8 }, (_, i) => candidate(h, i)));
  // Both adjacent type controls use the hypothesis cell-00 numeric model.
  for (const h of ["H1", "H2"] as const) for (const index of [0,4]) all.push(candidate(h, index, true));
  const first = ["H1-03", "H1-07", "H2-00", "H2-07"];
  return [...first.map(id => all.find(c => c.id === id)!), ...all.filter(c => !first.includes(c.id))];
};
