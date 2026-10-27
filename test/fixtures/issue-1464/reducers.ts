import type { Case } from "./cases";
// Triggered by base-third E02/I02/E05/E06/S01/E03, before reducer execution.
export const reducers: Case[] = [
  { id:"R01",hypothesis:"I02: repeated exported leaf in one preserved statement; remove local alias",source:[
    "nui 1", "// untouched mission sentinel", "module M(v: number) {", "  export point P = coordinate(x: @v, y: 0)", "}",
    "instance A = M(v: 2)", "instance B = M(v: 7)", "line L = segment(start: @A::P, end: @B::P)", "// untouched final sentinel"
  ].join("\n"),oracle:{"A::P":{kind:"point",x:2,y:0},"B::P":{kind:"point",x:7,y:0},L:{kind:"line",start:{x:2,y:0},end:{x:7,y:0}}},actions:[{kind:"inline",target:"A"},{kind:"rename",target:"A::P",name:"Q"}]},
  { id:"R02",hypothesis:"E02: extracted scalar external read survives Inline; remove all geometry",source:[
    "nui 1", "// untouched mission sentinel", "const a: number = 2", "const b: number = @a * 2", "const read: number = @b", "// untouched final sentinel"
  ].join("\n"),oracle:{},scalars:{read:4},actions:[{kind:"extract",targets:["b"]},{kind:"inline",target:"Part"}]},
  { id:"R03",hypothesis:"E06/S01: geometry-property external read survives extraction; remove second export and direct consumer",source:[
    "nui 1", "// untouched mission sentinel", "point P = coordinate(x: 3, y: 4)", "const read: number = @P.x", "// untouched final sentinel"
  ].join("\n"),oracle:{P:{kind:"point",x:3,y:4}},scalars:{read:3},actions:[{kind:"extract",targets:["P"]},{kind:"inline",target:"Part"}]},
  { id:"R04",hypothesis:"E03: lowered same-name scalar caller argument has number payload; remove second instance and external reads",source:[
    "nui 1", "// untouched mission sentinel", "const width: number = 6", "point P = coordinate(x: @width, y: 2)", "// untouched final sentinel"
  ].join("\n"),oracle:{P:{kind:"point",x:6,y:2}},actions:[{kind:"extract",targets:["P"]},{kind:"inline",target:"Part"}]},
  { id:"R05",hypothesis:"X01: multiline scalar physical end without CRLF or external dependency",source:[
    "nui 1", "// untouched mission sentinel", "const b: number = (", "  1 + 2", ")", "const read: number = @b", "// untouched final sentinel"
  ].join("\n"),oracle:{},scalars:{read:3},actions:[{kind:"extract",targets:["b"]},{kind:"inline",target:"Part"}]}
];
