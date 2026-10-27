import type { Case } from "./cases";
// Frozen after candidate-second, before execution. Each varies a proven suspicious axis.
export const extensions: Case[] = [
  { id:"X01",hypothesis:"E05+R02: CRLF multiline scalar export to group-owned typed Rename",source:[
    "nui 1", "// untouched mission sentinel", "const a: number = 2", "const b: number = (", "  @a + 1", ")", "const read: number = @b", "// untouched final sentinel"
  ].join("\r\n"),oracle:{},scalars:{read:3},actions:[{kind:"extract",targets:["b"]},{kind:"inline",target:"Part"},{kind:"rename",target:"Part::b",name:"value",rejectedReason:"reference-resolution-change"},{kind:"rename",target:"Part::a",name:"input"}]},
  { id:"X02",hypothesis:"I02/R01: reverse inline order with repeated geometry-property leaf references",source:[
    "nui 1", "// untouched mission sentinel", "module M(v: number) {", "  export point P = coordinate(x: @v, y: 1)", "}",
    "instance A = M(v: 2)", "instance B = M(v: 8)", "line L = segment(start: @A::P, end: @B::P)", "const read: number = @A::P.x + @B::P.x + @A::P.x", "// untouched final sentinel"
  ].join("\n"),oracle:{"A::P":{kind:"point",x:2,y:1},"B::P":{kind:"point",x:8,y:1},L:{kind:"line",start:{x:2,y:1},end:{x:8,y:1}}},scalars:{read:12},actions:[{kind:"inline",target:"B"},{kind:"inline",target:"A"},{kind:"rename",target:"A::P",name:"Q"}]},
  { id:"X03",hypothesis:"E03/R04: two same-spelled root/group scalar dependencies lower without capture",source:[
    "nui 1", "// untouched mission sentinel", "const width: number = 9", "point Control = coordinate(x: @width, y: 0)", "group G {", "  const width: number = 4", "  point P = coordinate(x: @::width + @width, y: 1)", "}", "// untouched final sentinel"
  ].join("\n"),oracle:{Control:{kind:"point",x:9,y:0},"G::P":{kind:"point",x:13,y:1}},actions:[{kind:"extract",targets:["G::P"],rejectedCode:"parameter-name-collision"},{kind:"inline",target:"G::Part"}]},
  { id:"X04",hypothesis:"E02/E03: fractional numeric refinement remains live through Extract/Inline/Step",source:[
    "nui 1", "// untouched mission sentinel", "const width: number(step: 0.5) = 2.5", "const local: number = @width + 1", "point P = coordinate(x: @local, y: -3)", "const read: number = @local", "// untouched final sentinel"
  ].join("\n"),oracle:{P:{kind:"point",x:3.5,y:-3}},scalars:{read:3.5},actions:[{kind:"extract",targets:["local","P"]},{kind:"inline",target:"Part"},{kind:"step",marker:"const width: number(step: 0.5) =",token:"2.5",next:"3",oracle:{"Part::P":{kind:"point",x:4,y:-3}},scalars:{read:4}}]},
  { id:"X05",hypothesis:"E02/E06/S01: mixed scalar/geometry export reference routes survive instance Rename before Inline",source:[
    "nui 1", "// untouched mission sentinel", "const n: number = 2", "point P = coordinate(x: @n, y: 4)", "const read: number = @n + @P.x", "// untouched final sentinel"
  ].join("\n"),oracle:{P:{kind:"point",x:2,y:4}},scalars:{read:4},actions:[{kind:"extract",targets:["n","P"]},{kind:"rename",target:"Part",name:"Renamed"},{kind:"inline",target:"Renamed"}]}
];
