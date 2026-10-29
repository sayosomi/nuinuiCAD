// Frozen arithmetic model. Run explicitly to regenerate; no compiler/evaluator imports.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const hash = text => createHash('sha256').update(text).digest('hex');
const cells = [];
for (let r = 1; r <= 4; r++) for (let t = 0; t <= 5; t++) for (let e = 0; e <= 1; e++) {
  const gain = e === 0 ? 5 : 11;
  const library = g => `nui 1
export record R(x: number, y: number)
record Private(x: number)
export module Read(value: R) {
  const local: R = @value
  export const out: R = @local
  export const score: number = @local.x * ${g} + @local.y
  export const anchor: point = coordinate(x: @local.x + ${g}, y: @local.y - ${g})
}`;
  let saved = {
    'lib.nui': library(gain),
    'facade.nui': 'nui 1\nimport "./lib.nui" as original\nexport @original::R\nexport @original::Read'
  };
  const imports = ['import "./lib.nui" as a', 'import "./facade.nui" as f'];
  const independent = ['const independentA: number = 89', 'const independentB: number = 97'];
  let body;
  let observations;
  let origins = { first: 'lib.nui' };
  if (r === 1) {
    body = ['const first: a::R = a::R(x: 3, y: 17)', 'instance left = a::Read(value: @first)',
      'const observed: number = @left::score + @first.y',
      'point Result = offset(from: @left::anchor, dx: @first.x, dy: @first.y)'];
    observations = { scalars: { observed: 3 * gain + 34 }, points: { Result: { x: 6 + gain, y: 34 - gain } } };
  } else if (r === 2) {
    body = ['module Relay(value: f::R) {', '  instance inner = a::Read(value: @value)',
      '  export const out: f::R = @inner::out', '  export const score: number = @inner::score',
      '  export const anchor: point = @inner::anchor', '}',
      'const first: a::R = f::R(x: 7, y: 19)', 'const second: f::R = a::R(x: 13, y: 29)',
      'instance left = Relay(value: @first)', 'instance right = Relay(value: @second)',
      'const leftScore: number = @left::score', 'const rightScore: number = @right::score',
      'const observed: number = @left::out.x + @right::out.y',
      'point Result = offset(from: @right::anchor, dx: @left::out.x, dy: @left::out.y)'];
    observations = { scalars: { leftScore: 7 * gain + 19, rightScore: 13 * gain + 29, observed: 36 }, points: { Result: { x: 20 + gain, y: 48 - gain } } };
    origins.second = 'lib.nui';
  } else if (r === 3) {
    body = ['record Wrapped(maybe: a::R?, rows: f::R[])',
      'const first: a::R = f::R(x: 23, y: 31)',
      'const wrapped: Wrapped = Wrapped(maybe: @first, rows: [f::R(x: 37, y: 41), @first])',
      'const selected: a::R = if (true) { @first } else { a::R(x: 43, y: 47) }',
      'const optionalX: number = @wrapped.maybe?.x ?? 101',
      'instance left = f::Read(value: @selected)',
      'const observed: number = @left::score + @optionalX',
      'const unaffected: number = @independentA + @independentB',
      'point Result = offset(from: @left::anchor, dx: @wrapped.rows[0].x, dy: @optionalX)'];
    observations = { scalars: { optionalX: 23, observed: 23 * gain + 54, unaffected: 186 }, points: { Result: { x: 60 + gain, y: 54 - gain } } };
    origins.selected = 'lib.nui';
  } else {
    saved['other.nui'] = library(2);
    imports.push('import "./other.nui" as b');
    body = ['const first: a::R = a::R(x: 17, y: 43)', 'const second: b::R = b::R(x: 29, y: 53)',
      'instance left = a::Read(value: @first)', 'instance right = b::Read(value: @second)',
      'const leftScore: number = @left::score', 'const rightScore: number = @right::score',
      'const observed: number = @left::out.x + @right::out.y',
      'point Result = offset(from: @left::anchor, dx: @right::out.x, dy: @right::out.y)'];
    observations = { scalars: { leftScore: 17 * gain + 43, rightScore: 111, observed: 70 }, points: { Result: { x: 46 + gain, y: 96 - gain } } };
    origins.second = 'other.nui';
  }
  if (t === 1) independent.unshift('const unusedInserted: number = 103');
  if (t === 2) independent.reverse();
  if (t === 4) {
    const at = body.findIndex(line => line.startsWith('const first:'));
    body.splice(at + 1, 0, 'const forwarded: a::R = @first');
    body = body.map(line => line.includes('value: @first') ? line.replace('value: @first', 'value: @forwarded') : line);
    origins.forwarded = 'lib.nui';
  }
  if (t === 5) body = body.map(line => line.replaceAll('a::', 'f::'));
  let source = ['nui 1', ...imports, ...independent, ...body].join('\n');
  if (t === 3) {
    const rename = source => source.replace(/\bas a\b/g, 'as renamedDirect').replace(/\ba::/g, 'renamedDirect::')
      .replace(/\bas f\b/g, 'as renamedFacade').replace(/\bf::/g, 'renamedFacade::')
      .replace(/\bas b\b/g, 'as renamedOther').replace(/\bb::/g, 'renamedOther::')
      .replace(/\bas original\b/g, 'as renamedOrigin').replace(/\boriginal::/g, 'renamedOrigin::');
    source = rename(source);
    saved = Object.fromEntries(Object.entries(saved).map(([name, text]) => [name, rename(text)]));
  }
  const bundle = { source, saved };
  cells.push({ id: `R${r}-T${t}-E${e}`, root: r, transform: t, epoch: e,
    fingerprint: hash(JSON.stringify(bundle)), ...bundle, expected: { ...observations, origins } });
}
writeFileSync(new URL('./matrix.json', import.meta.url), JSON.stringify(cells, null, 2) + '\n');
