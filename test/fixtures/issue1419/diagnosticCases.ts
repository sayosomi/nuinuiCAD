import { blank, point, type Configuration, type Program, type Slot } from "./model";

export function diagnosticCase(s: Slot, c: Configuration, alias: boolean, control = false): Program {
  const p = blank(), code = ["nui 1", `const Unit: number = ${c.unit}`, `const Zero: number = 0`];
  const count = control && s.count === 0 ? 1 : s.count;
  code.push(`const Ticks: number[] = [${Array.from({ length: count }, (_, i) => i + 1).join(", ")}]`);
  if (alias) code.push("const Padding: number = @Unit + 17");
  if (s.shape === 1) {
    p.templates = ["Incoming"];
    const yes = control ? "@Tick / @Zero" : "@Total * 2 + @Tick", no = control ? "@Total * 2 + @Tick" : "@Tick / @Zero";
    code.push("for Tick in @Ticks carry Total: number = @Unit {", "point Incoming = coordinate(x: @Total, y: @Tick)", `const Chosen: number = if (@Tick > 0) { ${yes} } else { ${no} }`, ...(alias ? ["const Forwarded: number = @Chosen", "next Total = @Forwarded"] : ["next Total = @Chosen"]), "}", "const Result: number = @Total");
    let total: bigint | string = BigInt(c.unit);
    for (let i = 0; i < count; i++) {
      if (typeof total === "bigint") p.geometry.push({ name: "Incoming", at: [i], value: point(total, i + 1) });
      else {
        p.failedGeometry.push({ name: "Incoming", at: [i], dependency: "@Total" });
        p.errors.push(`Incoming[${i}]`);
      }
      const next: bigint | string = control ? "evaluation-divide-by-zero" : BigInt(total) * 2n + BigInt(i + 1);
      p.trace.push({ loop: "Tick", at: [i], incoming: { Total: total }, next: { Total: next }, final: { Total: next } });
      total = next;
    }
    p.scalars.Result = control ? "evaluation-divide-by-zero" : total;
    if (control) {
      // Failed loop bodies do not publish partially executed local bindings;
      // the escaped carry and its consumer retain the selected error.
      p.diagnosticBindings = { Total: "evaluation-divide-by-zero", Result: "evaluation-divide-by-zero" };
    }
    p.carries = ["Total"];
  } else {
    p.templates = ["Observed"];
    code.push("module Box(Seed: number) {", "const Selected: point = if (@Seed > 0) { coordinate(x: @Seed + 3, y: 17) } else { coordinate(x: @Seed / 0, y: 29) }", "export point Mark = from(source: @Selected)", "}", `instance Dormant(enabled: ${control ? "true" : "false"}) = Box(Seed: 0)`, ...(alias ? ["const Forwarded: point = @Dormant::Mark", "point Blocked = from(source: @Forwarded)"] : ["point Blocked = from(source: @Dormant::Mark)"]), "for Tick in @Ticks {", "instance Live = Box(Seed: @Tick)", "point Observed = from(source: @Live::Mark)", "}", "const Independent: number = @Unit / @Zero", "const Surviving: number = @Unit + 9");
    for (let i = 0; i < count; i++) p.geometry.push({ name: "Observed", at: [i], value: point(i + 4, 17) });
    p.scalars.Independent = "evaluation-divide-by-zero"; p.scalars.Surviving = BigInt(c.unit) + 9n;
    p.diagnosticBindings = { Independent: "evaluation-divide-by-zero" };
    p.absent = ["Blocked"];
    p.errors = control ? ["Mark"] : ["Blocked"];
    if (control) p.errorInstances.Mark = "Dormant";
    if (alias) p.valueErrors = [{ name: "Forwarded", message: "Geometry value reference is unavailable at runtime." }];
    p.paths = ["disabled-Module-before-invalid-inputs", "dependent-consumer-unavailable", "independent-divide-by-zero-survives", "Module-selected-branch-laziness"];
  }
  p.source = code.join("\n") + "\n";
  p.paths.push(`selected-occurrences:${count}`, alias ? "typed-alias-forwarding" : "direct-forwarding");
  if (!control) p.selectedControl = diagnosticCase(s, c, alias, true);
  return p;
}
