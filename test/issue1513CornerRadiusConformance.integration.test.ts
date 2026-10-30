import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyDocument } from "@nuinuicad/nui-language";
import { compileCanonicalText, regenerateCanonicalFromModel } from "@nuinuicad/nui-language/document";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import manifest from "./fixtures/issue-1513/manifest.json";

type XY = { x: number; y: number };
type Expected = Record<string, unknown>;
type Unit = { id: string; file: string; sha256: string; expected: Expected; errors?: string[]; revisions?: Unit[]; curveOracle?: { controls: XY[]; parameter: number; length: number; maxProjection: number; maxTangentRadians: number }; circleOracle?: { center: XY; radius: number; maxLocusError: number } };
type Geometry = XY & { kind: string; elementId: string; start: XY; end: XY; center: XY; radius: number; length: number; segments?: Geometry[] };
const units = manifest.units as unknown as Unit[];
const validateOnly = process.env.ISSUE1513_VALIDATE_ONLY === "1";
const observations: unknown[] = [];
let rust: RustEvaluationProcess;
let closed: Promise<void> | undefined;
let spawns = 0, requests = 0;
async function bounded<T>(p: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([p, new Promise<never>((_, reject) => {
    timer = setTimeout(() => { rust?.dispose(); reject(new Error("#1513 Rust exceeded 15s")); }, 15000);
  })]); } finally { clearTimeout(timer); }
}
beforeAll(() => {
  if (validateOnly) return;
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  rust = new RustEvaluationProcess("rust-evaluator/target/debug/evaluation_stdio", {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      spawns++;
      const child = spawn(...args);
      closed = new Promise<void>(resolve => { child.once("close", () => resolve()); child.once("error", () => resolve()); });
      return child;
    }) as typeof spawn
  });
}, 125000);
afterAll(async () => {
  rust?.dispose();
  if (closed) await bounded(closed);
  if (!validateOnly) expect(spawns).toBe(1);
  if (process.env.ISSUE1513_RECORD) writeFileSync(process.env.ISSUE1513_RECORD, JSON.stringify({
    base: manifest.base, head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), validateOnly, spawns, requests,
    binarySha256: validateOnly ? null : createHash("sha256").update(readFileSync("rust-evaluator/target/debug/evaluation_stdio")).digest("hex"),
    productDiff: execFileSync("git", ["diff", manifest.base, "--", "src", "packages", "rust-evaluator"], {encoding:"utf8"}), observations
  }, null, 2) + "\n");
});
function compare(actual: unknown, expected: unknown, path: string, tolerances = {coordinate: manifest.coordinateTolerance, length: manifest.lengthTolerance, angle: manifest.angleTolerance}): void {
  if (typeof expected === "number") {
    expect(typeof actual, path).toBe("number");
    const delta = Math.abs(Number(actual) - expected);
    const error = path.endsWith("AngleDeg") ? Math.min(delta, Math.abs(delta - 360)) : delta;
    expect(error, `${path}: ${actual} vs ${expected}`).toBeLessThanOrEqual(path.endsWith("AngleDeg") ? tolerances.angle : path.endsWith("length") ? tolerances.length : tolerances.coordinate);
  } else if (Array.isArray(expected)) {
    expect(actual, path).toHaveLength(expected.length);
    expected.forEach((v,i) => compare((actual as unknown[])[i],v,`${path}[${i}]`,tolerances));
  } else if (expected && typeof expected === "object") {
    expect(actual,path).toBeTruthy();
    const e = expected as Expected;
    const local = {coordinate:Number(e.coordinateTolerance ?? tolerances.coordinate),length:Number(e.lengthTolerance ?? tolerances.length),angle:Number(e.angleTolerance ?? tolerances.angle)};
    for (const [k,v] of Object.entries(e)) if (!k.endsWith("Tolerance")) compare((actual as Expected)[k],v,`${path}.${k}`,local);
  } else if (expected === null) expect(actual,path).toBeUndefined();
  else expect(actual,path).toEqual(expected);
}
const distance = (a: XY,b: XY) => Math.hypot(a.x-b.x,a.y-b.y);
function finite(value: unknown): void {
  if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
  else if (value && typeof value === "object") Object.values(value).forEach(finite);
}
function curveChecks(g: Geometry, arc: Geometry, oracle: NonNullable<Unit["curveOracle"]>) {
  const point = (t:number): XY => ({x:oracle.controls.reduce((s,p,i)=>s+p.x*[Math.pow(1-t,3),3*(1-t)**2*t,3*(1-t)*t*t,t**3][i],0),y:oracle.controls.reduce((s,p,i)=>s+p.y*[Math.pow(1-t,3),3*(1-t)**2*t,3*(1-t)*t*t,t**3][i],0)});
  expect(g.segments!.length).toBeGreaterThan(2);
  let prior=-Infinity;
  for (const p of [g.start,...g.segments!.map(s=>s.end)]) {
    expect(p.x).toBeGreaterThanOrEqual(prior); prior=p.x;
    let lo=0,hi=1;
    for(let i=0;i<50;i++) {const mid=(lo+hi)/2;if(point(mid).x<p.x)lo=mid;else hi=mid;}
    expect(distance(p,point((lo+hi)/2))).toBeLessThanOrEqual(oracle.maxProjection);
  }
  expect(Math.abs(g.length-oracle.length)).toBeLessThanOrEqual(.3);
  const t=oracle.parameter,c=oracle.controls;
  const tangent={x:3*((1-t)**2*(c[1].x-c[0].x)+2*(1-t)*t*(c[2].x-c[1].x)+t*t*(c[3].x-c[2].x)),y:3*((1-t)**2*(c[1].y-c[0].y)+2*(1-t)*t*(c[2].y-c[1].y)+t*t*(c[3].y-c[2].y))};
  const radial={x:arc.start.x-arc.center.x,y:arc.start.y-arc.center.y};
  expect(Math.abs((radial.x*tangent.x+radial.y*tangent.y)/(arc.radius*Math.hypot(tangent.x,tangent.y)))).toBeLessThanOrEqual(Math.sin(oracle.maxTangentRadians));
}
describe("#1513 independently sealed corner transaction matrix", () => {
  it.each(units)("$id canonical source -> persistent Rust / TS -> independent oracle", async unit => {
    let current=regenerateCanonicalFromModel(emptyDocument(),1);
    const failures: string[]=[];
    const priorIds=new Map<string,Map<string,string>>();
    for (const checkpoint of [unit,...(unit.revisions ?? [])]) {
      const source=readFileSync(`test/fixtures/issue-1513/${checkpoint.file}`,"utf8");
      expect(createHash("sha256").update(source).digest("hex")).toBe(checkpoint.sha256);
      const compiled=compileCanonicalText(current,source);
      observations.push({id:unit.id,file:checkpoint.file,phase:"compile",diagnostics:compiled.diagnostics,sourceRevision:compiled.doc.statementMap.sourceRevision});
      expect(compiled.status).not.toBe("fatal");expect(compiled.diagnostics).toEqual([]); current=compiled;
      const options=buildEvaluationOptions({compiledDocument:compiled.doc});
      const prepared=prepareRustEvaluation(compiled.doc.document.elements,options);
      expect(prepared.rustEligible).toBe(true);expect(compiled.sourceText).toBe(source);
      if(validateOnly)continue;
      observations.push({id:unit.id,file:checkpoint.file,phase:"input",input:prepared.input,sourceRevision:compiled.doc.statementMap.sourceRevision});requests++;
      const payloads=[["Rust",await bounded(rust.request(prepared.input)) as EvaluationPayload],["TS",evaluateElementsReferencePayload(compiled.doc.document.elements,options)]] as const;
      const statements=new Map(compiled.doc.statements.map((s,i)=>[compiled.doc.statementMap.statementIdByStatementIndex.get(i),s.name]));
      for (const [host,payload] of payloads) {
        const result=evaluationPayloadToResult(payload),byName: Record<string,Geometry>={},ids=new Map<string,string>();
        for (const g of result.computedGeometry.values()) {
          const element=compiled.doc.document.elements.find(e=>e.id===g.elementId);const groups:string[]=[];let groupId=element?.parentGroupId;
          while(groupId){const group=compiled.doc.document.elements.find(e=>e.id===groupId);if(!group)break;groups.unshift(group.name);groupId=group.parentGroupId;}
          const name=[...groups,g.name].join("::");byName[name]=g as Geometry;ids.set(name,g.elementId);
        }
        for(const entry of result.computedGeometryValues?.values() ?? [])byName[statements.get(entry.occurrence.sourceStatementId)!]=entry.value as Geometry;
        const record:Record<string,unknown>={id:unit.id,file:checkpoint.file,host,payload,byName,sourceRevision:compiled.doc.statementMap.sourceRevision};observations.push(record);
        try {
          const errors=checkpoint.errors ?? [];
          expect(result.errors).toHaveLength(errors.length);
          if(errors.length){expect(result.errors[0].message).toContain(errors[0]);expect(result.errors[0].elementName).toBe("R");expect(result.errors[0].elementId).toBe(compiled.doc.document.elements.find(e=>e.name==="R")?.id);}
          if(errors.length>1) {
            expect(result.errors[1].elementName).toBe("Consumer");
            expect(byName.Consumer).toBeUndefined();
          }
          // Failure is an atomic no-op: compare entire original publications,
          // including metadata, without a tolerance that could hide tiny trims.
          if(errors.length)for(const name of Object.keys(checkpoint.expected)) {
            if((!name.endsWith("A") && !name.endsWith("B")) || checkpoint.expected[name.slice(0,-1)+"R"] !== null)continue;
            const id=ids.get(name);if(id)expect(result.computedGeometry.get(id),`unchanged failed ${name}`).toEqual(result.preMutationGeometry?.get(id));
          }
          expect(result.warnings).toEqual([]);expect(result.geometryValueErrors ?? []).toEqual([]);
          compare(byName.Control,{...{start:{x:201,y:-103},end:{x:238,y:-103}},length:37},"unaffected Control");
          for(const [name,expected] of Object.entries(checkpoint.expected))compare(byName[name],expected,`${host}.${name}`);
          for(const [name,id]of ids){const prior=priorIds.get(host)?.get(name);if(prior)expect(id,`stable ${name}`).toBe(prior);}
          priorIds.set(host,ids);finite(payload);
          if(checkpoint.curveOracle)curveChecks(byName.A,byName.R,checkpoint.curveOracle);
          if(checkpoint.circleOracle)for(const s of byName.A.segments ?? [])for(const p of [s.start,s.end])expect(Math.abs(distance(p,checkpoint.circleOracle.center)-checkpoint.circleOracle.radius)).toBeLessThanOrEqual(checkpoint.circleOracle.maxLocusError);
          if(unit.id==="R4"){expect(ids.get("First::A")).not.toBe(ids.get("Second::A"));expect(ids.get("First::R")).toBeUndefined();}
          record.status="PASS";
        } catch(error){record.status="FAIL";record.failure=String(error);failures.push(`${host} ${checkpoint.file}: ${String(error)}`);}
      }
    }
    expect(failures).toEqual([]);
  },60000);
});
