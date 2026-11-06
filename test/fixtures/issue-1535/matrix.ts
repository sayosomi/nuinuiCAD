export type Cell = { id: string; source: string; control?: string; expected?: number | boolean; rejected?: boolean; eof?: boolean };
type Site = "const" | "next";
type Break = "equals" | "trailing" | "leading";
const sites: Site[] = ["const", "next"];
const breaks: Break[] = ["equals", "trailing", "leading"];
const prefix = "nui 1\n";
const wrap = (site: Site, rhs: string, type = "number", setup = "") => prefix + setup + (site === "const"
  ? `const result: ${type} =${rhs}`
  : `for i in range(min: 0, max: 0, step: 1) carry state: ${type} = ${type === "boolean" ? "false" : "0"} {\n  next state =${rhs}\n}\nconst result: ${type} = @state`);
const split = (position: Break, left: string, op: string, right: string, comment: string, site: Site) => {
  const gap = comment === "direct" ? "\n" : comment === "trailing" ? " // note\n" : comment === "ordinary" ? "\n// note\n" : " /* note */\n";
  return position === "equals" ? `${gap}${left} ${op} ${right}`
    : position === "trailing" ? ` ${left} ${op}${gap}${right}`
    : ` ${left}${gap}${site === "const" ? " " : "   "}${op} ${right}`;
};
export const matrix: Cell[] = [];
// Constants are independently calculated arithmetic oracles, not parser output.
const arithmetic = [["+", 10], ["-", 6], ["*", 16], ["/", 4], ["%", 0], ["^", 64]] as const;
for (const site of sites) for (const position of breaks) for (const [op, expected] of arithmetic) {
  for (const comment of ["direct", "trailing", "ordinary", "block"]) matrix.push({
    id: `P1/${site}/${position}/${op}/${comment}`,
    source: wrap(site, split(position, "8", op, "2", comment, site)),
    control: wrap(site, ` 8 ${op} 2`), expected
  });
}
const families = [
  { name: "geometry", left: "distance(@A, @B)", op: "+", right: "angle(@A, @B)", type: "number", expected: 95,
    setup: "point A = coordinate(x: 0, y: 0)\npoint B = coordinate(x: 0, y: 5)\n" },
  { name: "boolean", left: "(8 > 2)", op: "and", right: "(3 != 4) or false", type: "boolean", expected: true, setup: "" },
  { name: "optional", left: "@maybe", op: "??", right: "7", type: "number", expected: 7, setup: "const maybe: number? = none\n" },
  { name: "precedence", left: "@a", op: "+", right: "(3 * (2 + 1)) ^ 2", type: "number", expected: 83, setup: "const a: number = 2\n" }
];
for (const site of sites) for (const position of breaks) for (const f of families) matrix.push({
  id: `P2/${site}/${position}/${f.name}`, source: wrap(site, split(position, f.left, f.op, f.right, "direct", site), f.type, f.setup),
  control: wrap(site, ` ${f.left} ${f.op} ${f.right}`, f.type, f.setup), expected: f.expected
});
for (const site of sites) for (const boundary of ["indent", "blank", "doc", "declaration", "unknown", "brace", "eof"]) {
  const start = site === "const" ? "const bad: number =" : "  next state =";
  const lead = site === "const" ? prefix : prefix + "for i in range(min: 0, max: 0, step: 1) carry state: number = 0 {\n";
  const tail = boundary === "indent" ? ` 1\n${site === "const" ? "" : "  "}+ 2`
    : boundary === "blank" ? " 1 +\n\n2"
    : boundary === "doc" ? " 1 +\n/// intact documentation"
    : boundary === "unknown" ? " 1 +\nbogus statement"
    : " 1 +";
  const eof = boundary === "eof";
  const source = eof ? lead + start + tail
    : boundary === "brace" ? (site === "const" ? prefix + "group G {\n" + start + tail : lead + start + tail) + "\n}\nconst intact: number = 20"
    : site === "next" ? lead + start + tail + "\n  const intact: number = 20\n}"
    : lead + start + tail + "\nconst intact: number = 20";
  matrix.push({ id: `N1/${site}/${boundary}`, source, rejected: true, eof });
}
const preserved = [
  ["one-line", "nui 1\nconst result: number = 3", 3],
  ["parenthesis", "nui 1\nconst result: number = (\n1 +\n2\n)", 3],
  ["call", "nui 1\nconst result: number = min(\n3,\n4\n)", 3],
  ["if", "nui 1\nconst result: number = if (true) {\n3\n} else {\n4\n}", 3],
  ["match", "nui 1\nconst maybe: number? = none\nconst result: number = match @maybe {\nnone => 3\nsome x => @x\n}", 3],
  ["module", "nui 1\nmodule M() {\nexport const value: number = 3\n}\ninstance item = M()\nconst result: number = @item::value", 3]
] as const;
for (const [name, source, expected] of preserved) matrix.push({ id: `R1/${name}`, source, expected });

// Nearby source-preservation control within the same scalar-reference family.
export const renameSource = "nui 1\nconst base: number = 8\n\nconst result: number = // equals\n  @base + // operand\n  /* keep */ 2\n  + @base\n\nconst intact: number = 20";
export const renamedSource = renameSource.replaceAll("base", "renamed");
