// Independent source/UTF-16/integer/mm oracle: never imports product code.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const sha = s => createHash('sha256').update(s).digest('hex');
const p = (x, y) => ({ x, y });
const line = (x, y) => ({ kind: 'line', start: p(x,y), end: p(x+13,y-9) });
const provider = (x,y) => `nui 1
export record Measure(x: number, y: number)
export module Provider() {
  export const out: Measure = Measure(x: ${x}, y: ${y})
}
group LibraryOnly {
  line Unauthored = segment(start: (901, 907), end: (911, 919))
}
`;
const moduleSource = `nui 1
// 🧵 Pocket: preserve this UTF-16 distractor and spacing.
import "./types.nui" as types
export module Pocket(measure: types::Measure, shift: number) {
  export const out: types::Measure = types::Measure(x: @measure.x + @shift, y: @measure.y - @shift)
  point Anchor = coordinate(x: @out.x, y: @out.y)
  line Edge = segment(start: @Anchor, end: (@out.x + 13, @out.y - 9))
}
`;
const output = placements => `
group Control [Ink] {
  line Edge = segment(start: (-3, 2), end: (10, 7))
}
group Excluded [Ink] {
  line NotSelected = segment(start: (601, -607), end: (613, -619))
}
layout Sheet {
${placements.map(v=>`  place @${v.group}(at: (${v.at.x}, ${v.at.y}), scale: ${v.scale}, angle: ${v.angle}, mirror: false)`).join('\n')}
}
layout Unselected {
  place @Excluded(at: (0, 0))
}
svg WrongVector(layout: @Unselected, margin: 0)
print WrongPaper(layout: @Unselected, paper: a3, overlap: 0)
svg Vector(layout: @Sheet, margin: 3)
print Paper(layout: @Sheet, paper: a4, overlap: 10)
// End sentinel Pocket.
`;
const rootSource = (r,s,second=false) => {
  const alias=r===2||second?'facade':'module';
  const pre=`nui 1
// 🧵 Pocket must remain unchanged here.
import "./types.nui" as types
import "./${alias}.nui" as pattern
style Ink {
  width: 1px,
  color: #123456,
}
instance provider = types::Provider()
const rootEdit: number = ${s===2?5:0} // independently current, never saved
`;
  let body;
  if(r===4) body=`record Wrapper(inner: types::Measure, rows: types::Measure[])
const dimension: types::Measure = types::Measure(x: @provider::out.x, y: @provider::out.y)
const wrapped: Wrapper = Wrapper(inner: @dimension, rows: [types::Measure(x: 43, y: -47), @dimension])
const first: types::Measure = types::Measure(x: @wrapped.rows[1].x + @rootEdit, y: @wrapped.inner.y)
`;
  else body=`const first: types::Measure = types::Measure(x: @provider::out.x + @rootEdit, y: @provider::out.y)
`;
  body+=`group Left [Ink] {
  instance piece = pattern::${s===0?'Pocket':'PocketRenamed'}(measure: @first, shift: ${second?7:3})
}
`;
  if(r===3) body+=`const second: types::Measure = types::Measure(x: @provider::out.x + 19, y: @provider::out.y - 11)
group Right [Ink] {
  instance piece = pattern::${s===0?'Pocket':'PocketRenamed'}(measure: @second, shift: 7)
}
`;
  return pre+body+output(placements(r));
};
function placements(r) {
  return [...(r===3?[{group:'Right',at:p(-19,31),scale:1,angle:0}]:[]),
    {group:'Left',at:p(7,-11),scale:2,angle:90}, {group:'Control',at:p(260,-40),scale:1,angle:0}];
}
function oracle(r,s,second=false,restore=false) {
  const x=s===2?31:17,y=s===2?-37:-23,edit=s===2&&!restore?5:0,shift=second?7:3;
  const geometry={};
  const add=(name,x,y)=>{geometry[`${name}::piece::Anchor`]={kind:'point',x,y};geometry[`${name}::piece::Edge`]=line(x,y);};
  add('Left',x+edit+shift,y-shift);
  if(r===3)add('Right',x+26,y-18);
  geometry['Control::Edge']={kind:'line',start:p(-3,2),end:p(10,7)};
  geometry['Excluded::NotSelected']={kind:'line',start:p(601,-607),end:p(613,-619)};
  const place=placements(r);
  const drawables=place.flatMap(v=>Object.entries(geometry).filter(([name,g])=>name.startsWith(v.group+'::')&&g.kind==='line').map(([name,g])=>{
    const transform=q=>v.angle===90?p(v.at.x-q.y*v.scale,v.at.y+q.x*v.scale):p(v.at.x+q.x*v.scale,v.at.y+q.y*v.scale);
    return {path:name,name:'Edge',kind:'line',start:transform(g.start),end:transform(g.end)};
  }));
  const points=drawables.flatMap(g=>[g.start,g.end]),half=(25.4/96)/2;
  const minX=Math.min(...points.map(q=>q.x))-half,minY=Math.min(...points.map(q=>q.y))-half;
  const maxX=Math.max(...points.map(q=>q.x))+half,maxY=Math.max(...points.map(q=>q.y))+half;
  const bounds={minX,minY,maxX,maxY,width:maxX-minX,height:maxY-minY};
  const columns=Math.max(1,Math.ceil(bounds.width/190)),rows=Math.max(1,Math.ceil(bounds.height/277));
  const pageOrigins=Array.from({length:rows},(_,row)=>Array.from({length:columns},(_,col)=>p(minX-10+col*190,minY-10+row*277))).flat();
  return {geometry,scalars:{rootEdit:edit},placements:place,drawables,bounds,svgMm:[bounds.width+6,bounds.height+6],columns,rows,pageOrigins,selected:['Vector','Paper'],paperMm:[210,297],overlap:10};
}
const rows=[];
for(let r=1;r<=4;r++) {
  const baseline={'types.nui':provider(17,-23),'module.nui':moduleSource,
    'facade.nui':'nui 1\nimport "./module.nui" as origin\nexport @origin::Pocket\n',
    'root.nui':rootSource(r,0),
    'independent.nui':'nui 1\nconst n: number = 41\ngroup Control {\n line Edge = segment(start: (2, 3), end: (13, -7))\n}\nlayout Sheet {\n place @Control(at: (0, 0))\n}\nsvg Vector(layout: @Sheet, margin: 3)\nprint Paper(layout: @Sheet, paper: a4, overlap: 10)\n'};
  if(r===4) {
    baseline['second.nui']=rootSource(r,0,true);
    baseline['foreign.nui']='nui 1\nexport module Pocket() {\n export point P = coordinate(x: 83, y: -89)\n}\n';
    baseline['foreignRoot.nui']='nui 1\nimport "./foreign.nui" as foreign\ngroup Other {\n instance copy = foreign::Pocket()\n line Edge = segment(start: (3, 5), end: (19, -17))\n}\nlayout Sheet {\n place @Other(at: (0, 0))\n}\nsvg Vector(layout: @Sheet, margin: 3)\nprint Paper(layout: @Sheet, paper: a4, overlap: 10)\n';
  }
  // Exact target markers established from authored grammar, excluding comments/foreign owners.
  const edits=Object.fromEntries(Object.entries(baseline).flatMap(([file,text])=>{
    if(file==='foreign.nui'||file==='foreignRoot.nui')return [];
    const ranges=[...text.matchAll(/(?:export module |pattern::|export @origin::)(Pocket)\b/g)].map(m=>({from:m.index+m[0].length-6,to:m.index+m[0].length,expectedText:'Pocket',newText:'PocketRenamed'}));
    return ranges.length?[[file,ranges]]:[];
  }));
  const after=Object.fromEntries(Object.entries(baseline).map(([file,text])=>[file,(edits[file]??[]).reduceRight((v,e)=>v.slice(0,e.from)+e.newText+v.slice(e.to),text)]));
  for(let s=0;s<=2;s++) {
    const files={...(s===0?baseline:after)};
    if(s===2){files['types.nui']=provider(31,-37);files['root.nui']=rootSource(r,2);if(r===4)files['second.nui']=rootSource(r,2,true);}
    const expected=oracle(r,s),restored=oracle(r,s,false,true);
    const row={id:`R${r}-S${s}`,root:r,state:s,files,expected,restored,secondExpected:r===4?oracle(r,s,true):null,
      baseline,after,edits,dirty:provider(71,-83),restoreSource:rootSource(r,1),
      hashes:{files:Object.fromEntries(Object.entries(files).map(([f,t])=>[f,sha(t)])),oracle:sha(JSON.stringify(expected)),edits:sha(JSON.stringify(edits)),after:sha(JSON.stringify(after))}};
    rows.push(row);
  }
}
writeFileSync(new URL('./matrix.json',import.meta.url),JSON.stringify(rows,null,2)+'\n');
