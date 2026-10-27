import { blank, point, type Configuration, type Program, type Slot } from "./model";

// All arithmetic/snapshots below belong to the generator. They never inspect a
// compiled document or an evaluation result. Arrays are copied at every step.
export function collectionCase(s: Slot, c: Configuration, alias: boolean): Program {
  const p = blank(), code = ["nui 1", `const Unit: number = ${c.unit}`, `const Delta: number = ${c.delta}`];
  const u = BigInt(c.unit), d = BigInt(c.delta), ticks = Array.from({ length: s.count }, (_, i) => i + 1);
  code.push(`const Ticks: number[] = [${ticks.join(", ")}]`);
  if (alias) code.push("const Padding: number = @Unit + @Delta");
  const observeCollection = (name: string, values: readonly bigint[], prefix: string, at?: number[]) => {
    const target = at ? p.geometry : undefined;
    const expressions = [`@${name}.length`, `@${name}[0]`, `@${name}[1]`, `if (@${name}.length > 2) { @${name}[2] } else { 0 - 101 }`];
    const expected = [BigInt(values.length), values[0], values[1], values[2] ?? -101n];
    for (const [i, expr] of expressions.entries()) {
      if (target) {
        code.push(`const Capture${prefix}${i}: number = ${expr}`, `point ${prefix}${i} = coordinate(x: @Capture${prefix}${i}, y: ${i})`);
        target.push({ name: `${prefix}${i}`, at, value: point(expected[i], i) });
      } else { code.push(`const ${prefix}${i}: number = ${expr}`); p.scalars[`${prefix}${i}`] = expected[i]; }
    }
  };
  if (s.suite === "R" && s.shape === 1) {
    p.templates = ["Left", "Right"].flatMap(name => [0, 1, 2, 3].map(i => `Incoming${name}${i}`));
    let left: readonly bigint[] = [u, u + 3n], right: readonly bigint[] = [u + d, u + 2n * d, u + 5n * d];
    code.push(`const LeftSeed: number[] = [${left.join(", ")}]`, `const RightSeed: number[] = [${right.join(", ")}]`);
    code.push("for Tick in @Ticks carry Left: number[] = @LeftSeed carry Right: number[] = @RightSeed {");
    // Emit templates once; retain expectations for every incoming snapshot.
    const bodyStart = code.length;
    for (let i = 0; i < s.count; i++) {
      const before = code.length;
      observeCollection("Left", left, "IncomingLeft", [i]); observeCollection("Right", right, "IncomingRight", [i]);
      if (i > 0) code.splice(before);
      const nextLeft = [...right], nextRight = [...left];
      p.trace.push({ loop: "Tick", at: [i], incoming: { Left: [...left], Right: [...right] }, next: { Left: nextLeft, Right: nextRight }, final: { Left: nextLeft, Right: nextRight } });
      left = nextLeft; right = nextRight;
    }
    if (!s.count) { observeCollection("Left", left, "IncomingLeft", [0]); observeCollection("Right", right, "IncomingRight", [0]); p.geometry = []; }
    if (code.length === bodyStart) throw new Error("missing R templates");
    code.push(...(alias ? ["const SendLeft: number[] = @Right", "const SendRight: number[] = @Left", "next Left = @SendLeft", "next Right = @SendRight"] : ["next Left = @Right", "next Right = @Left"]), "}");
    if (alias) code.push("const Escaped: number[] = @Left");
    observeCollection(alias ? "Escaped" : "Left", left, "FinalLeft"); observeCollection("Right", right, "FinalRight");
    p.carries = ["Left", "Right"];
  } else if (s.suite === "R") {
    p.templates = ["Left", "Right"].flatMap(name => ["0", "1", "2", "Count"].map(i => `Incoming${name}${i}`));
    const a = [point(u, -d), point(u + 3n, d + 2n)], b = [point(u + d, d * 2n), point(u + 2n * d, -d * 3n), point(u + 5n * d, d * 7n)];
    for (const [i, pt] of [...a, ...b].entries()) code.push(`point Seed${i} = coordinate(x: ${pt.x}, y: ${pt.y})`);
    code.push("const LeftSeed: point[] = [@Seed0, @Seed1]", "const RightSeed: point[] = [@Seed2, @Seed3, @Seed4]");
    if (alias) code.push("const LeftForward: point[] = @LeftSeed", "const RightForward: point[] = @RightSeed");
    code.push(`for Tick in @Ticks carry Left: point[] = @${alias ? "LeftForward" : "LeftSeed"} carry Right: point[] = @${alias ? "RightForward" : "RightSeed"} {`);
    let left = a, right = b;
    const body = (l: typeof a, r: typeof a, at: number[]) => {
      for (const [name, values] of [["Left", l], ["Right", r]] as const) {
        for (const index of [0, 1]) {
          code.push(`point Incoming${name}${index} = from(source: @${name}[${index}])`);
          p.geometry.push({ name: `Incoming${name}${index}`, at, value: values[index] });
        }
        code.push(`const Count${name}: number = @${name}.length`, `const Extra${name}: point = if (@Count${name} > 2) { @${name}[2] } else { @Seed0 }`, `point Incoming${name}2 = from(source: @Extra${name})`, `point Incoming${name}Count = coordinate(x: @Count${name}, y: 0)`);
        p.geometry.push({ name: `Incoming${name}2`, at, value: values[2] ?? a[0] }, { name: `Incoming${name}Count`, at, value: point(values.length, 0) });
      }
    };
    for (let i = 0; i < s.count; i++) {
      const before = code.length; body(left, right, [i]); if (i > 0) code.splice(before);
      const nl = [...right], nr = [...left];
      p.trace.push({ loop: "Tick", at: [i], incoming: { Left: [...left], Right: [...right] }, next: { Left: nl, Right: nr }, final: { Left: nl, Right: nr } });
      left = nl; right = nr;
    }
    if (!s.count) { body(left, right, [0]); p.geometry = []; }
    code.push("next Left = @Right", "next Right = @Left", "}");
    for (const [name, values] of [["Left", left], ["Right", right]] as const) {
      code.push(`const Final${name}Count: number = @${name}.length`); p.scalars[`Final${name}Count`] = BigInt(values.length);
      for (let i = 0; i < values.length; i++) {
        if (alias) code.push(`const Final${name}${i}Alias: point = @${name}[${i}]`);
        code.push(`point Final${name}${i} = from(source: @${alias ? `Final${name}${i}Alias` : `${name}[${i}]`})`);
        p.geometry.push({ name: `Final${name}${i}`, value: values[i] });
      }
    }
    p.carries = ["Left", "Right"];
  } else {
    const nestedCollection = s.shape === 2;
    p.templates = nestedCollection ? ["InnerFirst", "InnerCount", "OuterTrace"] : ["InnerTrace", "OuterTrace"];
    code.push(`const Initial: ${nestedCollection ? "number[]" : "number"} = ${nestedCollection ? `[${u}, ${u + 3n}]` : u}`);
    code.push(`for OuterTick in @Ticks carry Outer: ${nestedCollection ? "number[]" : "number"} = @Initial {`, "const InnerTicks: number[] = if (@OuterTick % 2 == 0) { [] } else { [2, 5, 9] }");
    code.push(`for InnerTick in @InnerTicks carry Inner: ${nestedCollection ? "number[]" : "number"} = ${nestedCollection ? "@Outer" : "@Outer + @OuterTick"} {`);
    if (nestedCollection) {
      code.push("const InFirst: number = @Inner[0]", "const InSecond: number = @Inner[1]", "const InCount: number = @Inner.length", "const InThird: number = if (@Inner.length > 2) { @Inner[2] } else { 0 - 101 }", "point InnerFirst = coordinate(x: @InFirst, y: @InSecond)", "point InnerCount = coordinate(x: @InCount, y: @InThird)", "const NewFirst: number = @Inner[0] + @InnerTick + @OuterTick", "const OuterMember: number = @OuterTick", "const InnerMember: number = @InnerTick", "const Replacement: number[] = [@NewFirst, @OuterMember, @InnerMember]", ...(alias ? ["const InnerForward: number[] = @Replacement", "next Inner = @InnerForward"] : ["next Inner = @Replacement"]));
    } else code.push("point InnerTrace = coordinate(x: @Inner, y: @InnerTick)", ...(alias ? ["const InnerForward: number = @Inner * 2 + @InnerTick", "next Inner = @InnerForward"] : ["next Inner = @Inner * 2 + @InnerTick"]));
    code.push("}");
    if (nestedCollection) code.push("const AfterInner: number = @Inner[0]", "const BeforeOuter: number = @Outer[0]", "point OuterTrace = coordinate(x: @AfterInner, y: @BeforeOuter)", ...(alias ? ["const OuterForward: number[] = @Inner", "next Outer = @OuterForward"] : ["next Outer = @Inner"]));
    else code.push("point OuterTrace = coordinate(x: @Inner, y: @Outer)", ...(alias ? ["const OuterForward: number = @Inner - @OuterTick", "next Outer = @OuterForward"] : ["next Outer = @Inner - @OuterTick"]));
    code.push("}");
    let scalar = u, collection: readonly bigint[] = [u, u + 3n];
    for (let i = 0; i < s.count; i++) {
      const tick = BigInt(i + 1), members = tick % 2n === 0n ? [] : [2n, 5n, 9n];
      let inner = scalar + tick, innerCollection = [...collection];
      for (const [j, item] of members.entries()) {
        const before = nestedCollection ? [...innerCollection] : inner;
        if (nestedCollection) {
          p.geometry.push({ name: "InnerFirst", at: [i, j], value: point(innerCollection[0], innerCollection[1]) }, { name: "InnerCount", at: [i, j], value: point(innerCollection.length, innerCollection[2] ?? -101n) });
          innerCollection = [innerCollection[0] + item + tick, tick, item];
        } else { p.geometry.push({ name: "InnerTrace", at: [i, j], value: point(inner, item) }); inner = inner * 2n + item; }
        const next = nestedCollection ? [...innerCollection] : inner;
        p.trace.push({ loop: "InnerTick", at: [i, j], incoming: { Inner: before }, next: { Inner: next }, final: { Inner: next } });
      }
      p.geometry.push({ name: "OuterTrace", at: [i], value: point(nestedCollection ? innerCollection[0] : inner, nestedCollection ? collection[0] : scalar) });
      const before = nestedCollection ? [...collection] : scalar;
      scalar = inner - tick; collection = [...innerCollection];
      const next = nestedCollection ? [...collection] : scalar;
      p.trace.push({ loop: "OuterTick", at: [i], incoming: { Outer: before }, next: { Outer: next }, final: { Outer: next } });
    }
    if (nestedCollection) { if (alias) code.push("const Escaped: number[] = @Outer"); observeCollection(alias ? "Escaped" : "Outer", collection, "FinalOuter"); }
    else { code.push(`const Result: number = @Outer`); p.scalars.Result = scalar; }
    p.carries = ["Outer", "Inner"];
  }
  p.source = code.join("\n") + "\n";
  p.paths = [s.suite === "R" ? `simultaneous-${s.shape === 1 ? "number" : "point"}-collection-swap` : `nested-${s.shape === 1 ? "number" : "collection"}-incoming-final`, `iterations:${s.count}`, alias ? "typed-alias-forwarding" : "direct-forwarding", ...(s.suite === "N" ? ["inner-empty-on-even-outer", "inner-three-on-odd-outer"] : [])];
  return p;
}
