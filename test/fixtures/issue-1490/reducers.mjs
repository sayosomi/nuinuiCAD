import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const source=`nui 1
import "./types.nui" as types
import "./module.nui" as pattern
record Wrapper(rows: types::Measure[])
const dimension: types::Measure = types::Measure(x: 7, y: 19)
const wrapped: Wrapper = Wrapper(rows: [@dimension])
const first: types::Measure = types::Measure(x: @wrapped.rows[0].x, y: @wrapped.rows[0].y)
group Left {
  instance piece = pattern::Pocket(measure: @first, shift: 3)
}
`;
const files={'types.nui':'nui 1\nexport record Measure(x: number, y: number)\n',
 'module.nui':'nui 1\nimport "./types.nui" as types\nexport module Pocket(measure: types::Measure, shift: number) {\n point P = coordinate(x: @measure.x + @shift, y: @measure.y - @shift)\n}\n'};
const rows=[{id:'M1',source,files,expected:{x:10,y:16},reason:'R4 alias member of imported-record array field loses its backing values'},
 {id:'X1',source:source.replace('rows: [@dimension]','rows: [types::Measure(x: 7, y: 19)]'),files,expected:{x:10,y:16},reason:'Neighbor inline record array member; identical original nominal type and geometry'}];
rows.push({id:'X2',source:source.replace('rows: types::Measure[]','inner: types::Measure').replace('rows: [@dimension]','inner: @dimension').replaceAll('@wrapped.rows[0]','@wrapped.inner'),files,expected:{x:10,y:16},reason:'Neighbor nested record field without an intervening array'});
rows.push({id:'M2',source:rows[1].source.replace('const dimension: types::Measure = types::Measure(x: 7, y: 19)\n',''),files,expected:{x:10,y:16},reason:'Inline imported record in an array-only wrapper must not reserve an absent scalar slot'});
rows.push({id:'M3',source:source.replace('record Wrapper(rows: types::Measure[])\nconst dimension: types::Measure = types::Measure(x: 7, y: 19)\nconst wrapped: Wrapper = Wrapper(rows: [@dimension])','const values: number[] = [7, 19]').replaceAll('@wrapped.rows[0].x','@values[0]').replaceAll('@wrapped.rows[0].y','@values[1]'),files,expected:{x:10,y:16},reason:'Record constructor scalar collection indices must use runtime source positions'});
for(const row of rows)row.sha256=createHash('sha256').update(JSON.stringify(row)).digest('hex');
writeFileSync(new URL('./reducers.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
