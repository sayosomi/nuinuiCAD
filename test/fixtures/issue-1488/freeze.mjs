// Independent integer/Y-up model. No product compiler, planner or evaluator.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const sha = value => createHash('sha256').update(value).digest('hex');
const point = (x, y) => ({ x, y });
const edge = (start, end) => ({ kind: 'line', start, end });
const cells = [];
for (let r = 1; r <= 4; r++) for (let s = 0; s <= 2; s++) {
  const x = s === 0 ? 17 : 31, y = s === 0 ? -23 : -37;
  const edit = s === 2 ? 5 : 0;
  const library = (x, y) => `nui 1
// Saved definition and numeric provider; top-level geometry is dependency-only.
export record Dim(x: number, y: number)
export module Data() {
  export const out: Dim = Dim(x: ${x}, y: ${y})
}
group LibraryOnly {
  line Unauthored = segment(start: (901, 907), end: (911, 919))
}
`;
  const saved = { 'lib.nui': library(x, y), 'facade.nui': `nui 1
import "./lib.nui" as original
export @original::Dim
export @original::Data
` };
  const alias = r === 2 ? 'facade' : 'lib';
  const imports = `import "./lib.nui" as direct
import "./${alias}.nui" as types`;
  const prelude = `nui 1
// Keep comments, blank lines and this exact source layout.
${imports}
style Ink {
  width: 1px,
  color: #123456,
}
instance data = types::Data()
const rootEdit: number = ${edit} // current root only
`;
  let body, geometry, scalars, placements;
  if (r === 3) {
    body = `module Panel(value: types::Dim, origin: types::Dim) {
  export const out: types::Dim = types::Dim(x: @value.x + @origin.x, y: @value.y + @origin.y)
  point Anchor = coordinate(x: @out.x, y: @out.y)
  line Edge = segment(start: @Anchor, end: (@out.x + 11, @out.y - 7))
}
const first: types::Dim = types::Dim(x: 3 + @rootEdit, y: 17)
const second: direct::Dim = direct::Dim(x: 13, y: 29)
const firstX: number = @first.x
const secondY: number = @second.y
group Left [Ink] {
  instance panel = Panel(value: @first, origin: @data::out)
}
group Right [Ink] {
  instance panel = Panel(value: @second, origin: @data::out)
}
const leftX: number = @Left::panel::out.x
const rightY: number = @Right::panel::out.y`;
    geometry = {
      'Left::panel::Anchor': { kind: 'point', ...point(x + 3 + edit, y + 17) },
      'Left::panel::Edge': edge(point(x + 3 + edit, y + 17), point(x + 14 + edit, y + 10)),
      'Right::panel::Anchor': { kind: 'point', ...point(x + 13, y + 29) },
      'Right::panel::Edge': edge(point(x + 13, y + 29), point(x + 24, y + 22))
    };
    scalars = { rootEdit: edit, firstX: 3 + edit, secondY: 29, leftX: x + 3 + edit, rightY: y + 29 };
    placements = [{ group: 'Right', at: point(-19, 31), scale: 1, angle: 0 }, { group: 'Left', at: point(7, -11), scale: 2, angle: 90 }];
  } else {
    const record = r === 4 ? `record Wrapper(inner: types::Dim, rows: direct::Dim[])
const dimension: types::Dim = types::Dim(x: @data::out.x, y: @data::out.y)
const wrapped: Wrapper = Wrapper(inner: @dimension, rows: [types::Dim(x: 43, y: -47), @dimension])
const dx: number = @wrapped.rows[1].x + @rootEdit
const dy: number = @wrapped.inner.y` : `const dimension: types::Dim = types::Dim(x: @data::out.x, y: @data::out.y)
const exact: direct::Dim = @dimension
const dx: number = @exact.x + @rootEdit
const dy: number = @dimension.y`;
    body = `${record}
group Pattern [Ink] {
  point Anchor = coordinate(x: @dx, y: @dy)
  line Edge = segment(start: @Anchor, end: (@dx + 11, @dy - 7))
}`;
    geometry = { 'Pattern::Anchor': { kind: 'point', ...point(x + edit, y) }, 'Pattern::Edge': edge(point(x + edit, y), point(x + edit + 11, y - 7)) };
    scalars = { rootEdit: edit, dx: x + edit, dy: y };
    placements = [{ group: 'Pattern', at: point(7, -11), scale: 2, angle: 90 }];
  }
  geometry['Control::Edge'] = edge(point(-3, 2), point(10, 7));
  geometry['Excluded::NotSelected'] = edge(point(601, -607), point(613, -619));
  placements.push({ group: 'Control', at: point(260, -40), scale: 1, angle: 0 });
  const outputs = `
group Control [Ink] {
  line Edge = segment(start: (-3, 2), end: (10, 7))
}
group Excluded [Ink] {
  line NotSelected = segment(start: (601, -607), end: (613, -619))
}
layout Sheet {
${placements.map(p => `  place @${p.group}(at: (${p.at.x}, ${p.at.y}), scale: ${p.scale}, angle: ${p.angle}, mirror: false)`).join('\n')}
}
layout Unselected {
  place @Excluded(at: (0, 0))
}
svg WrongVector(layout: @Unselected, margin: 0)
print WrongPaper(layout: @Unselected, paper: a3, overlap: 0)
svg Vector(layout: @Sheet, margin: 3)
print Paper(layout: @Sheet, paper: a4, overlap: 10)

// End sentinel.
`;
  const source = prelude + body + outputs;
  const drawables = placements.flatMap(p => Object.entries(geometry).filter(([name, g]) => name.startsWith(p.group + '::') && g.kind === 'line').map(([name, g]) => {
    const transform = q => p.angle === 90 ? point(p.at.x - q.y * p.scale, p.at.y + q.x * p.scale) : point(p.at.x + q.x * p.scale, p.at.y + q.y * p.scale);
    return { path: name, name: 'Edge', ...edge(transform(g.start), transform(g.end)) };
  }));
  // Output stroke has fixed physical width, independent of place scale.
  const halfStroke = (25.4 / 96) / 2;
  const points = drawables.flatMap(g => [g.start, g.end]);
  const minX = Math.min(...points.map(p => p.x)) - halfStroke;
  const minY = Math.min(...points.map(p => p.y)) - halfStroke;
  const maxX = Math.max(...points.map(p => p.x)) + halfStroke;
  const maxY = Math.max(...points.map(p => p.y)) + halfStroke;
  const bounds = { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
  const columns = Math.max(1, Math.ceil(bounds.width / 190)), rows = Math.max(1, Math.ceil(bounds.height / 277));
  const pageOrigins = Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, col) => point(minX - 10 + col * 190, minY - 10 + row * 277))).flat();
  const expected = { geometry, scalars, placements, drawables, bounds, svgMm: [bounds.width + 6, bounds.height + 6], columns, rows, pageOrigins, selected: ['Vector', 'Paper'], paperMm: [210, 297], overlap: 10 };
  const hashes = { source: sha(source), saved: Object.fromEntries(Object.entries(saved).map(([k, v]) => [k, sha(v)])), oracle: sha(JSON.stringify(expected)) };
  cells.push({ id: `R${r}-S${s}`, root: r, state: s, sourceRevision: s + 1, source, saved, dirty: library(71, -83), hashes, expected });
}
writeFileSync(new URL('./matrix.json', import.meta.url), JSON.stringify(cells, null, 2) + '\n');
