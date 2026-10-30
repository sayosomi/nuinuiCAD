import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileCanonicalText, compileFreshCanonicalText, type TextCompileResult } from "@nuinuicad/nui-language/document";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../geometry/evaluationPayload";
import { prepareRustEvaluation } from "../geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../node/rustEvaluationProcess";
import type { EvaluationResult } from "../types/geometry";
import { buildOutputPlan, type OutputPlan } from "./outputCore";
import { compare, runtimePath } from "../../test/patternArtifactAssertions";
import { parsePdf, type PdfOp } from "../../test/pdfArtifactInspector";

type Point = { x: number; y: number };
type Segment = { kind: string; start?: Point; end?: Point; center?: Point; radius?: number; startAngleDeg?: number; sweepAngleDeg?: number; control1?: Point; control2?: Point; points?: Point[] };
type Oracle = { contour: Segment[]; seam: Segment[]; points: Record<string, Point>; length: number; closed: boolean; bezier: boolean; drawables: { name: string; segments: Segment[]; color: string }[]; bounds: { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number }; svgMm: number[]; columns: number; rows: number; pageOrigins: Point[]; margin: number; profile: string };
type Checkpoint = { source: string; sha256: string; oracle: Oracle; oracleCanonicalJson: string; oracleSha256: string };
type Unit = { id: string; checkpoints: Checkpoint[] };
const fixturePath = "test/fixtures/issue-1509/manifest.json";
const manifest = JSON.parse(readFileSync(fixturePath, "utf8")) as { base: string; units: Unit[]; extensions: Unit[]; reducers: Unit[] };
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const units = [...manifest.units, ...manifest.extensions, ...manifest.reducers];
const validateOnly = process.env.ISSUE1509_VALIDATE_ONLY === "1";
const observations: Record<string, unknown>[] = [];
const counts = { spawns: 0, evaluations: 0, exports: 0, inspections: 0, negativeEvaluations: 0 };
const negativeControls: unknown[] = [];
const measurements = { maxOffsetHausdorffMm: 0, maxBezierStationErrorMm: 0, maxBezierTipErrorMm: 0 };
let rust: RustEvaluationProcess;
let directory: string;
let closed: Promise<void> | undefined;
let closure: { code: number | null; signal: string | null } | undefined;
let resourceError: Error | undefined;
let binary: { path: string; sha256: string } | undefined;
const bounded = async <T,>(p: Promise<T>) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([p, new Promise<never>((_, reject) => {
    timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1509 Rust operation exceeded 15s")); }, 15000);
  })]); } finally { clearTimeout(timer); }
};
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "nuinui-1509-"));
  if (validateOnly) return;
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  const path = resolve(process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target", "debug", process.platform === "win32" ? "evaluation_stdio.exe" : "evaluation_stdio");
  binary = { path, sha256: sha(readFileSync(path)) }; // Missing Cargo product fails here.
  rust = new RustEvaluationProcess(path, { spawnProcess: ((...args: Parameters<typeof spawn>) => {
    expect(args[0]).toBe(path);
    counts.spawns++;
    const child = spawn(...args);
    const memory = setInterval(() => {
      try {
        const rss = Number(execFileSync("ps", ["-o", "rss=", "-p", String(child.pid)], { encoding: "utf8", timeout: 1000, maxBuffer: 1024 }));
        if (rss > 512 * 1024) { resourceError = new Error("#1509 Rust child exceeded 512MiB RSS"); rust.dispose(); }
      } catch { /* Child may have exited before close. */ }
    }, 100);
    // Completion/error observers exist before the first request or teardown.
    closed = new Promise<void>(done => {
      child.once("close", (code, signal) => { clearInterval(memory); closure = { code, signal }; done(); });
      child.once("error", () => clearInterval(memory));
    });
    return child;
  }) as typeof spawn });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (process.env.ISSUE1509_RECORD) writeFileSync(process.env.ISSUE1509_RECORD, JSON.stringify({
    base: manifest.base, head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    fixtureSha256: sha(readFileSync(fixturePath)), testSha256: sha(readFileSync("src/output/outputCore.issue1509.integration.test.ts")),
    validateOnly, directory, counts, binary, closure, measurements, negativeControls, observations
  }, null, 2) + "\n");
  if (directory && !process.env.ISSUE1509_KEEP_ARTIFACTS) rmSync(directory, { recursive: true, force: true });
  expect(resourceError).toBeUndefined();
  if (!validateOnly) { expect(counts.spawns).toBe(1); expect(closure).toBeDefined(); }
});

const tol = (o: Oracle) => o.bezier ? .11 : 1e-7;
const nums = (s: string) => (s.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
function at(s: Segment, t: number): Point {
  if (s.kind === "arc") {
    const a = (s.startAngleDeg! + s.sweepAngleDeg! * t) * Math.PI / 180;
    return { x: s.center!.x + s.radius! * Math.cos(a), y: s.center!.y + s.radius! * Math.sin(a) };
  }
  if (s.kind === "line") return { x: s.start!.x + (s.end!.x - s.start!.x) * t, y: s.start!.y + (s.end!.y - s.start!.y) * t };
  const coefficients = [(1-t)**3, 3*(1-t)**2*t, 3*(1-t)*t*t, t**3];
  const points = [s.start!, s.control1!, s.control2!, s.end!];
  return { x: points.reduce((v,p,i) => v + p.x * coefficients[i], 0), y: points.reduce((v,p,i) => v + p.y * coefficients[i], 0) };
}
function pointDistance(p: Point, a: Point, b: Point) {
  const dx=b.x-a.x, dy=b.y-a.y, den=dx*dx+dy*dy;
  const t=den ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/den)) : 0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
function numericOffset(actual: Segment[], expected: Point[], tolerance: number) {
  expect(actual.length).toBeGreaterThan(0);
  const cloud = actual.flatMap(s => Array.from({length:129},(_,i) => at(s,i/128)));
  const directed = (a: Point[], b: Point[]) => Math.max(...a.map(p => Math.min(...b.slice(1).map((q,i) => pointDistance(p,b[i],q)))));
  measurements.maxOffsetHausdorffMm=Math.max(measurements.maxOffsetHausdorffMm,directed(cloud,expected),directed(expected,cloud));
  expect(directed(cloud,expected), "fitted offset -> independent normal curve").toBeLessThanOrEqual(tolerance);
  expect(directed(expected,cloud), "independent normal curve -> fitted offset").toBeLessThanOrEqual(tolerance);
  compare(actual[0].start, expected[0], .0011);
  compare(actual.at(-1)!.end, expected.at(-1), .0011);
  actual.slice(1).forEach((s,i) => compare({x:s.start!.x,y:s.start!.y},{x:actual[i].end!.x,y:actual[i].end!.y},1e-7));
}
function checkSegments(actual: Segment[], expected: Segment[], tolerance: number) {
  let i=0;
  for (const s of expected) {
    if (s.kind === "numericOffset") {
      const from=i;while(actual[i]?.kind === "bezier") i++;
      numericOffset(actual.slice(from,i),s.points!,tolerance);
    } else { compare(actual[i],s,tolerance); i++; }
  }
  expect(actual).toHaveLength(i);
}
function geometry(c: TextCompileResult, result: EvaluationResult, o: Oracle) {
  expect(result.errors).toEqual([]); expect(result.warnings).toEqual([]); expect(result.geometryValueErrors ?? []).toEqual([]);
  const lookup = (name: string) => {
    const element = c.doc.document.elements.find(e => runtimePath(c.doc,e.id) === name);
    expect(element,name).toBeDefined();
    return result.computedGeometry.get(element!.id)!;
  };
  const contour=lookup("Piece::Contour"), seam=lookup("Piece::Allowance");
  expect(contour.kind).toBe("joinedPath");expect(seam.kind).toBe("offsetLine");
  if (contour.kind === "joinedPath") {
    checkSegments(contour.segments,o.contour,1e-7); compare(contour.length,o.length,o.bezier ? .03 : 1e-7);expect(contour.closed).toBe(o.closed);
  }
  if (seam.kind === "offsetLine") { checkSegments(seam.segments,o.seam,tol(o)); expect(seam.closed).toBe(o.closed); }
  for(const [name,p] of Object.entries(o.points)) {
    const actual=lookup(`Piece::${name}`);
    if(o.bezier && actual.kind === "point") {
      const key=name.startsWith("Tip") ? "maxBezierTipErrorMm" : "maxBezierStationErrorMm";
      measurements[key]=Math.max(measurements[key],Math.hypot(actual.x-p.x,actual.y-p.y));
    }
    compare(actual,{kind:"point",...p},o.bezier ? (name.startsWith("Tip") ? .04 : .03) : 1e-7);
  }
  compare(lookup("Control::Calibration"),{kind:"line",start:{x:0,y:-15},end:{x:100,y:-15},length:100});
  compare(lookup("Control::Sibling"),{kind:"line",start:{x:0,y:-10},end:{x:3,y:-6},length:5});
  const canonicalIds=new Map(c.doc.document.elements.map(e=>[e.id,runtimePath(c.doc,e.id)]));
  for(const [id,g] of result.computedGeometry) if(g.kind === "bezierCurve") g.segments.forEach((s,i)=> {
    if(s.startPointId) canonicalIds.set(s.startPointId,`${runtimePath(c.doc,id)}.segments[${i}].start`);
    if(s.endPointId) canonicalIds.set(s.endPointId,`${runtimePath(c.doc,id)}.segments[${i}].end`);
  });
  return [...result.computedGeometry].map(([id,g]) => ({ owner: runtimePath(c.doc,id), geometry: JSON.parse(JSON.stringify(g, (k,v) => ["elementId","name"].includes(k) ? undefined : typeof v === "string" && canonicalIds.has(v) ? canonicalIds.get(v) : v)) })).sort((a,b) => a.owner.localeCompare(b.owner));
}
function segmentsOf(d: OutputPlan["drawables"][number]): Segment[] {
  if (d.kind === "text") throw new Error("unexpected text");
  return "segments" in d ? d.segments : [d];
}
function planCheck(plan: OutputPlan, c: TextCompileResult, o: Oracle) {
  compare(plan.renderedBounds,o.bounds,tol(o));
  expect(plan.drawables.map(d => d.name)).toEqual(o.drawables.map(d => d.name));
  expect(plan.drawables.map(d => runtimePath(c.doc,d.elementId))).toEqual(o.drawables.map(d => `${["Calibration","Sibling"].includes(d.name) ? "Control" : "Piece"}::${d.name}`));
  plan.drawables.forEach((d,i) => {
    checkSegments(segmentsOf(d),o.drawables[i].segments,tol(o));
    if (!("stroke" in d)) throw new Error("unexpected text");
    compare(d.stroke,{widthMm:2*25.4/96,colorHex:o.drawables[i].color,style:"solid"});
  });
  if(plan.svg) compare([plan.svg.widthMm,plan.svg.heightMm],o.svgMm,tol(o));
  if(plan.print) {
    compare([plan.print.paperWidthMm,plan.print.paperHeightMm,plan.print.strideXmm,plan.print.strideYmm,plan.print.overlapMm,plan.print.columns,plan.print.rows],[210,297,190,277,10,o.columns,o.rows]);
    compare(plan.print.pages.map(p => p.origin),o.pageOrigins,tol(o));
  }
}
function pdfCubic(s: Segment): Segment {
  if(s.kind !== "arc") return s;
  const a=s.startAngleDeg!*Math.PI/180,b=(s.startAngleDeg!+s.sweepAngleDeg!)*Math.PI/180,r=s.radius!,k=4/3*Math.tan((b-a)/4),start=at(s,0),end=at(s,1);
  return {kind:"bezier",start,control1:{x:start.x-r*k*Math.sin(a),y:start.y+r*k*Math.cos(a)},control2:{x:end.x+r*k*Math.sin(b),y:end.y-r*k*Math.cos(b)},end};
}
function fileCheck(bytes: Buffer, format: "svg"|"pdf", o: Oracle) {
  const expected=o.drawables.flatMap(d => d.segments);
  if(format === "svg") {
    const xml=new DOMParser().parseFromString(bytes.toString("utf8"),"image/svg+xml");
    expect(xml.querySelector("parsererror")).toBeNull();
    const root=xml.documentElement;
    for(const k of ["width","height"]) expect(root.getAttribute(k)).toMatch(/mm$/);
    compare([parseFloat(root.getAttribute("width")!),parseFloat(root.getAttribute("height")!)],o.svgMm,tol(o)+.00051);
    compare(nums(root.getAttribute("viewBox")!),[0,0,...o.svgMm],tol(o)+.00051);
    const nodes=[...root.querySelectorAll("path")];expect(root.children).toHaveLength(nodes.length);
    let cursor=0;
    for(const d of o.drawables) for(const s of d.segments) {
      const count=s.kind === "numericOffset" ? (() => {let n=0;while(nodes[cursor+n]?.getAttribute("d")?.includes(" C ")) n++;return n;})() : 1;
      expect(count).toBeGreaterThan(0);
      const decoded: Segment[]=[];
      for(let j=0;j<count;j++) {
        const node=nodes[cursor++];expect(node).toBeDefined();
        expect(node.getAttribute("fill")).toBe("none");expect(node.getAttribute("stroke")).toBe(d.color);compare(Number(node.getAttribute("stroke-width")),2*25.4/96,.00051);
        const data=node.getAttribute("d")!,n=nums(data);
        const point=(i:number) => ({x:n[i]+o.bounds.minX-o.margin,y:o.bounds.maxY+o.margin-n[i+1]});
        if(data.includes(" C ")) decoded.push({kind:"bezier",start:point(0),control1:point(2),control2:point(4),end:point(6)});
        else if(data.includes(" L ")) decoded.push({kind:"line",start:point(0),end:point(2)});
        else {
          expect(s.kind).toBe("arc");expect(data).toMatch(/^M [-\d.]+ [-\d.]+ A /);
          compare(n,[at(s,0).x-o.bounds.minX+o.margin,o.bounds.maxY+o.margin-at(s,0).y,s.radius,s.radius,0,0,s.sweepAngleDeg!<0 ? 1:0,at(s,1).x-o.bounds.minX+o.margin,o.bounds.maxY+o.margin-at(s,1).y],.00051);
          decoded.push(s);
        }
      }
      checkSegments(decoded,[s],s.kind === "numericOffset" ? .111 : o.bezier && d.name.startsWith("Mark") ? .04051 : .00051);
    }
    expect(nodes).toHaveLength(cursor);
    return {mm:o.svgMm,paths:nodes.map(n => n.outerHTML)};
  }
  const parsed=parsePdf(bytes),pt=72/25.4;expect(parsed.pages).toHaveLength(o.columns*o.rows);
  return parsed.pages.map((page,index) => {
    compare(page.box,[0,0,210*pt,297*pt],.00051);
    const drawing: PdfOp[]=[],guides: PdfOp[]=[];let depth=0,inDrawing=true;
    for(const op of page.ops) {if(op.op === "q") depth++;(inDrawing?drawing:guides).push(op);if(op.op === "Q" && --depth === 0) inDrawing=false;expect(depth).toBeGreaterThanOrEqual(0);}
    expect(depth).toBe(0);expect(drawing.slice(0,4).map(o => o.op)).toEqual(["q","re","W","n"]);compare(drawing[1].args,[0,0,210*pt,297*pt],.00051);
    const origin=o.pageOrigins[index],shapes:Segment[]=[];let start: Point|undefined;
    const point=(args:PdfOp["args"],i:number) => ({x:Number(args[i])/pt+origin.x,y:Number(args[i+1])/pt+origin.y});
    for(const op of drawing) {
      if(op.op === "m") {expect(start).toBeUndefined();start=point(op.args,0);}
      if(op.op === "l") {shapes.push({kind:"line",start,end:point(op.args,0)});start=undefined;}
      if(op.op === "c") {shapes.push({kind:"bezier",start,control1:point(op.args,0),control2:point(op.args,2),end:point(op.args,4)});start=undefined;}
    }
    expect(start).toBeUndefined();checkSegments(shapes,expected.map(pdfCubic),o.bezier ? .111 : .00051);
    expect(drawing.filter(p => p.op === "S")).toHaveLength(shapes.length);
    compare(drawing.filter(p => p.op === "w").map(p => p.args),shapes.map(() => [2*25.4/96*pt]),.00051);
    const wantedColors=o.drawables.flatMap(d => d.segments.flatMap(s => Array.from({length:s.kind === "numericOffset" ? shapes.length-expected.length+1 : 1},() => [1,3,5].map(i => parseInt(d.color.slice(i,i+2),16)/255))));
    compare(drawing.filter(p => p.op === "RG").map(p => p.args),wantedColors,.00051);
    const guideLines=[[10,0,10,297],[200,0,200,297],[0,10,210,10],[0,287,210,287]].flatMap(v => [{op:"m",args:v.slice(0,2).map(n=>n*pt)},{op:"l",args:v.slice(2).map(n=>n*pt)},{op:"S",args:[]}]);
    compare(guides.filter(p => ["m","l","S"].includes(p.op)),guideLines,.00051);
    return {box:page.box,pathOps:drawing.filter(p => ["m","l","c","S"].includes(p.op)),origin};
  });
}

describe("#1509 frozen curved-contour revisions through real persistent Rust and physical files",() => {
  it("seals all twelve primary four-checkpoint sequences",() => {
    expect(manifest.units.map(u=>u.id)).toEqual(["C1","C2","C3","C4","N1","N2","N3","N4","O1","O2","O3","O4"]);
    expect(units).toHaveLength(12);
    const extremum=manifest.units.find(u=>u.id === "O1")!.checkpoints;
    compare(extremum[0].oracle.bounds.maxX,extremum[0].oracle.drawables.find(d=>d.name === "Mark1")!.segments[0].end!.x+25.4/96);
    for(const cp of extremum.slice(1,3)) compare(cp.oracle.bounds.maxX,at(cp.oracle.drawables.find(d=>d.name === "Allowance")!.segments[1],1).x+25.4/96);
    expect(manifest.units.find(u=>u.id === "O2")!.checkpoints.map(cp=>cp.oracle.columns*cp.oracle.rows)).toEqual([1,2,3,1]);
    for(const u of units) {expect(u.checkpoints).toHaveLength(4);expect(u.checkpoints[3].source).toBe(u.checkpoints[0].source);for(const cp of u.checkpoints) {expect(sha(cp.source)).toBe(cp.sha256);expect(sha(cp.oracleCanonicalJson)).toBe(cp.oracleSha256);expect(JSON.parse(cp.oracleCanonicalJson)).toEqual(cp.oracle);}}
  });
  it("rejects a deliberately incorrect independent mark oracle",() => {
    const p=manifest.units[0].checkpoints[0].oracle.points.Tip1;
    expect(()=>compare({...p,x:p.x+.1},p)).toThrow();
  });
  it.each(units)("$id V0/V1/V2/V0",async unit => {
    let current:TextCompileResult|undefined;const failures:string[]=[],initial=new Map<string,unknown>();let ids:Map<string,string>|undefined;
    for(const [index,cp] of unit.checkpoints.entries()) {
      const record:Record<string,unknown>={id:unit.id,index,sourceSha256:cp.sha256,checks:[],compilations:[]};observations.push(record);
      current=current?compileCanonicalText(current,cp.source):compileFreshCanonicalText(cp.source);
      const fresh=compileFreshCanonicalText(cp.source);const crossCompile=new Map<string,unknown>();
      for(const [mode,c] of [["incremental",current],["fresh",fresh]] as const) {
        (record.compilations as unknown[]).push({mode,status:c.status,diagnostics:c.diagnostics,bindings:c.bindingIssueDiagnostics,revision:c.currentCompiled.spans.sourceMap.sourceRevision});
        try {
          expect(c.sourceText).toBe(cp.source);expect([...c.diagnostics,...c.bindingIssueDiagnostics]).toEqual([]);expect(c.status).toBe("valid");expect(c.docText).toBe(cp.source);
          expect(c.doc.statementMap.sourceRevision).toBe(c.currentCompiled.spans.sourceMap.sourceRevision);
          const currentIds=new Map(c.doc.document.elements.map(e=>[runtimePath(c.doc,e.id),e.id]));
          if(mode === "incremental") {if(ids) for(const name of currentIds.keys()) expect(currentIds.get(name),name).toBe(ids.get(name));else ids=currentIds;}
          if(validateOnly) continue;
          for(const format of ["svg","pdf"] as const) {
            const output=(format === "svg"?c.doc.document.svgOutputs:c.doc.document.printOutputs).find(o=>o.name === (format === "svg"?"Vector":"Paper"))!;
            expect(output).toBeDefined();
            const options=buildEvaluationOptions({compiledDocument:c.doc,evaluationLimitIndex:undefined,selectedDrawingProfileId:output.profileId});
            const prepared=prepareRustEvaluation(c.doc.document.elements,options);expect(prepared.rustEligible).toBe(true);
            const reference=evaluateElementsReference(c.doc.document.elements,options);counts.evaluations++;
            const actual=evaluationPayloadToResult(await bounded(rust.request(prepared.input)) as EvaluationPayload);
            const check=(label:string,run:()=>unknown) => {try{return run();}catch(error){failures.push(`${unit.id}/${index}/${mode}/${format}/${label}: ${String(error)}`);return undefined;}};
            const ts=check("TS geometry",()=>geometry(c,reference,cp.oracle)),rs=check("Rust geometry",()=>geometry(c,actual,cp.oracle));
            check("parity",()=>compare(rs,ts,1e-7));
            check("fresh/incremental complete geometry",()=> {if(mode === "incremental") crossCompile.set(format,rs);else compare(rs,crossCompile.get(format),1e-7);});
            for(const [engine,result] of [["TS",reference],["Rust",actual]] as const) check(`${engine} plan`,()=>planCheck(buildOutputPlan({compiledDocument:c.doc,output,evaluation:result}),c,cp.oracle));
            const plan=buildOutputPlan({compiledDocument:c.doc,output,evaluation:actual});
            const path=join(directory,`${unit.id}-${index}-${mode}.${format}`);counts.exports++;
            expect(await bounded(rust.exportOutput({path,payload:plan.rustPayload}))).toEqual({exported:true});expect(statSync(path).size).toBeLessThan(1024*1024);
            const bytes=readFileSync(path);counts.inspections++;
            const inspected=check("file",()=>fileCheck(bytes,format,cp.oracle));
            if(unit.id === "C1" && index === 0 && mode === "incremental" && format === "svg") {
              const wrong=structuredClone(cp.oracle);wrong.points.Tip1.x+=.1;
              check("detector sensitivity current geometry",()=>expect(()=>geometry(c,actual,wrong)).toThrow());
              const wrongFile=structuredClone(cp.oracle);wrongFile.drawables.find(d=>d.name === "Mark1")!.segments[0].end!.x+=.1;
              check("detector sensitivity actual SVG",()=>expect(()=>fileCheck(bytes,format,wrongFile)).toThrow());
              record.sensitivity="+0.1mm Tip1 corruption rejected by runtime and file detectors";
            }
            (record.checks as unknown[]).push({mode,format,path,sha256:sha(bytes),bytes:bytes.length,geometry:rs,reference:ts,diagnostics:{errors:actual.errors,warnings:actual.warnings,values:actual.geometryValueErrors},pages:plan.print?.pages.length,bounds:plan.renderedBounds,filePass:inspected!==undefined});
            const key=`${mode}/${format}`;
            if(index === 0) initial.set(key,{geometry:rs,artifact:inspected});
            if(index === 3) check("exact restore",()=>expect({geometry:rs,artifact:inspected}).toEqual(initial.get(key)));
          }
        } catch(error) { failures.push(`${unit.id}/${index}/${mode}: ${error instanceof Error?error.stack:String(error)}`); }
      }
      record.disposition=failures.some(f=>f.startsWith(`${unit.id}/${index}/`))?"FAIL":validateOnly?"COMPILE_VALID":"PASS";
    }
    (observations.at(-1)!).failures=failures;
    expect(failures).toEqual([]);
  },120000);
  it.each(["zero-radius", "off-curve-tip"])("%s current revision is an explicit error, never a normal export",async kind => {
    const baseline=manifest.units[0].checkpoints[0];
    const source=kind === "zero-radius" ? baseline.source.replace("const radius: number = 30","const radius: number = 0") : baseline.source.replace("base: @Station1","base: (900, 900)");
    const previous=compileFreshCanonicalText(baseline.source);
    for(const [mode,c] of [["incremental",compileCanonicalText(previous,source)],["fresh",compileFreshCanonicalText(source)]] as const) {
      expect(c.status).toBe("valid");expect(c.docText).toBe(source);expect(c.sourceText).toBe(source);
      expect(c.currentCompiled.spans.sourceMap.sourceRevision).toBe(c.doc.statementMap.sourceRevision);
      if(validateOnly) continue;
      const options=buildEvaluationOptions({compiledDocument:c.doc,evaluationLimitIndex:undefined});
      const prepared=prepareRustEvaluation(c.doc.document.elements,options);expect(prepared.rustEligible).toBe(true);counts.negativeEvaluations++;
      const actual=evaluationPayloadToResult(await bounded(rust.request(prepared.input)) as EvaluationPayload);
      const bad=c.doc.document.elements.find(e=>e.name === (kind === "zero-radius" ? "Bend" : "Tip1"))!;
      for(const r of [evaluateElementsReference(c.doc.document.elements,options),actual]) {
        expect(r.errors.some(e=>e.elementId === bad.id)).toBe(true);expect(r.computedGeometry.has(bad.id)).toBe(false);
        const control=c.doc.document.elements.find(e=>e.name === "Calibration")!;compare(r.computedGeometry.get(control.id),{length:100});
      }
      negativeControls.push({kind,mode,source,sha256:sha(source),diagnostics:actual.errors.map(e=>({...e,elementId:runtimePath(c.doc,e.elementId)})),exported:false});
    }
  });
});
