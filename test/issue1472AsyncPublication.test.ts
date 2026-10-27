import { execFileSync, spawn } from "node:child_process";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CadElement, ComputedGeometry, EvaluationResult } from "../src/types/geometry";
import type { EvaluateElementsOptions } from "../src/geometry/evaluate";
import type { EvaluationPayload } from "../src/geometry/evaluationPayload";
import * as engine from "../src/geometry/evaluationEngine";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { evaluatePreparedRust, prepareRustEvaluation, type RustEvaluationTransport } from "../src/geometry/rustEvaluationRunner";
import { evaluationStateIsCurrentFor, useEvaluationEngine, type EvaluationEngineState } from "../src/geometry/useEvaluationEngine";
import { initialCadDocumentState, useCadDocumentStore } from "../src/state/cadDocumentStore";
import { resolveRevisionCoherentCanvasPresentation } from "../src/components/canvasRevisionPresentation";
import manifest from "./fixtures/issue-1472/manifest.json";

type Expected = {
  evaluationRevision: number; request: number; status: string; geometry: string; source: string;
  isStale: boolean; current: boolean; interaction: boolean; error: string | null; rustEligible: boolean;
};
type Event = { op: string; expected?: Expected; file?: string; mode?: string; request?: number; value?: number | boolean | string | null };
type Props = { elements: CadElement[]; options: EvaluateElementsOptions; revision: number; transport: RustEvaluationTransport };
type Deferred = {
  resolve: (payload: EvaluationPayload) => void; reject: (error: Error) => void;
  payload: EvaluationPayload; inputHash: string;
};
const records: unknown[] = [];
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const source = (name: string) => {
  const spec = manifest.sources[name as keyof typeof manifest.sources];
  const text = readFileSync(`test/fixtures/issue-1472/${spec.file}`, "utf8");
  expect(hash(text)).toBe(spec.sha256);
  return text;
};

// Wire fixtures are built from hand coordinates, never from either evaluator.
function handPayload(elements: CadElement[], options: EvaluateElementsOptions): EvaluationPayload {
  const end = elements.find(e => e.name === "B");
  const x = end?.type === "freePoint" && typeof end.x === "number" ? end.x : 30;
  const y = end?.type === "freePoint" && typeof end.y === "number" ? end.y : 40;
  const id = (name: string) => elements.find(e => e.name === name)!.id;
  const point = (name: string, px: number, py: number): Extract<ComputedGeometry, { kind: "point" }> =>
    ({ kind: "point", elementId: id(name), name, x: px, y: py });
  const limit = options.evaluationLimitIndex ?? elements.length;
  const geometries: ComputedGeometry[] = [];
  for (const e of elements.slice(0, limit)) {
    if (e.enabled === false && !options.allowDisabledElementIds?.has(e.id)) continue;
    if (e.name === "A") geometries.push(point("A", elements.length === 1 ? 7 : 0, elements.length === 1 ? 9 : 0));
    if (e.name === "B") geometries.push(point("B", x, y));
    if (e.name === "AB") {
      const angle = Math.atan2(y, x) * 180 / Math.PI;
      geometries.push({kind: "line", elementId:e.id, name:e.name, startPointId:id("A"),endPointId:id("B"),
        start:point("A",0,0),end:point("B",x,y),length:Math.hypot(x,y),
        startAngleDeg:angle,endAngleDeg:(angle+180)%360,startTangentAngleDeg:angle,endTangentAngleDeg:angle});
    }
  }
  const ids=geometries.map(g=>g.elementId);
  return {computedGeometry:geometries,errors:[],warnings:[],evaluatedElementIds:ids,
    evaluationLimitIndex:limit,effectiveVisibleElementIds:ids,effectiveEnabledElementIds:ids};
}

function geometrySnapshot(result: EvaluationResult) {
  return [...result.computedGeometry.values()].map(g => g.kind === "point"
    ? {name:g.name,kind:g.kind,x:g.x,y:g.y}
    : g.kind === "line" ? {name:g.name,kind:g.kind,start:{x:g.start.x,y:g.start.y},end:{x:g.end.x,y:g.end.y},length:g.length}
    : {name:g.name,kind:g.kind});
}
const geometries = (kind: string) => {
  if (["empty","disabled","invalid"].includes(kind)) return [];
  if (kind === "enabled") return [{name:"A",kind:"point",x:7,y:9}];
  const a={name:"A",kind:"point",x:0,y:0};
  if (kind === "partial") return [a];
  const [x,y,length]=kind === "L" ? [-12,5,13] : [30,40,50];
  return [a,{name:"B",kind:"point",x,y},{name:"AB",kind:"line",start:{x:0,y:0},end:{x,y},length}];
};

// This exact assertion is also exercised with deliberately corrupt states below.
function assertState(actual: EvaluationEngineState, expected: Expected, revision: number, request: number, mode: string) {
  expect({evaluationRevision:actual.evaluationRevision,evaluationRequestRevision:actual.evaluationRequestRevision,
    status:actual.status,source:actual.source,mode:actual.mode,isStale:actual.isStale,
    rustEligible:actual.rustEligible,error:actual.error instanceof Error ? actual.error.message : actual.error,
    geometry:geometrySnapshot(actual.evaluation),current:evaluationStateIsCurrentFor(actual,revision)})
    .toEqual({evaluationRevision:expected.evaluationRevision,evaluationRequestRevision:request,status:expected.status,
      source:expected.source,mode,isStale:expected.isStale,rustEligible:expected.rustEligible,error:expected.error,
      geometry:geometries(expected.geometry),current:expected.current});
  expect(actual.evaluation.warnings).toEqual([]);
  expect(actual.evaluation.geometryValueErrors ?? []).toEqual([]);
  if (expected.geometry === "invalid") {
    expect(actual.evaluation.errors).toHaveLength(1);
    expect(actual.evaluation.errors[0]).toMatchObject({elementName:"Result",missingDependencyId:"@Missing",
      message:"Result は @Missing を参照していますが、@Missing が見つからないため評価できません。参照先を確認してください。"});
  } else expect(actual.evaluation.errors).toEqual([]);
}

afterEach(()=>{cleanup();vi.unstubAllEnvs();vi.restoreAllMocks();});
afterAll(()=>{if(process.env.ISSUE1472_RECORD)writeFileSync(process.env.ISSUE1472_RECORD,JSON.stringify(records,null,2)+"\n");});

describe("#1472 frozen real React publication traces",()=>{
  beforeAll(() => {
    execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  }, 125000);

  it.each(manifest.units)("$id",async unit=>{
    let requests: Deferred[]=[];
    let props: Props;
    let mode="rust";
    let view: ReturnType<typeof renderHook<EvaluationEngineState, Props>> | undefined;
    let ids=new Map<number,number>();
    let highest=0;
    let renders=0;
    let options: EvaluateElementsOptions={};
    let compiled: ReturnType<typeof useCadDocumentStore.getState>["doc"] | undefined;
    let sourceFile="K";
    const failures:string[]=[];
    const warn=vi.spyOn(console,"warn").mockImplementation(()=>undefined);
    vi.spyOn(console,"error").mockImplementation(()=>undefined);
    const reference=vi.spyOn(engine,"evaluateElementsReference");
    const transport = (): RustEvaluationTransport => input=>new Promise((resolve,reject)=>{
      requests.push({resolve,reject,payload:handPayload(props.elements,props.options),inputHash:hash(JSON.stringify(input))});
    });
    function update(file:string) {
      const previous=useCadDocumentStore.getState();
      useCadDocumentStore.getState().commitText(source(file),"editor");
      const current=useCadDocumentStore.getState();
      if(file==="F") {
        expect(current.compiledDocumentRevision).toBe(previous.compiledDocumentRevision);
        expect(current.sourceRevision).toBe(previous.sourceRevision+1);
        expect(current.doc).toBe(previous.doc);
        expect(current.diagnostics.some(d=>d.code==="unclosed-call")).toBe(true);
      } else {
        expect(current.compiledDocumentRevision).toBe(previous.compiledDocumentRevision+1);
        expect(current.diagnostics.map(d=>d.code)).toEqual(file==="I" ? ["undefined-geometry-reference"] : []);
      }
      if(current.doc!==compiled){
        compiled=current.doc;
        options=buildEvaluationOptions({compiledDocument:compiled,evaluationLimitIndex:undefined});
      }
      sourceFile=file;
      props={elements:current.elements,options,revision:current.compiledDocumentRevision,transport:props?.transport ?? transport()};
    }
    let ordinal=0;
    for(const event of unit.events as Event[]) {
      ordinal++;
      const beforeRequests=requests.length;
      const beforeWarnings=warn.mock.calls.length;
      const beforeReferences=reference.mock.calls.length;
      const beforeRenders=renders;
      if(event.op==="mount") {
        cleanup();useCadDocumentStore.setState(initialCadDocumentState());
        requests=[];ids=new Map();highest=0;compiled=undefined;mode=event.mode!;vi.stubEnv("VITE_EVALUATION_ENGINE",mode);
        update(event.file!);
        props={...props,transport:transport()};
        view=renderHook(p=>{renders++;return useEvaluationEngine(p.elements,p.options,p.revision,p.transport);},{initialProps:props});
        // Unchanged render is a neighboring control in every trace.
        view.rerender(props);
        expect(requests).toHaveLength(1);
      } else if(event.op==="source") {
        update(event.file!);view!.rerender(props!);
      } else if(event.op==="limit" || event.op==="allow") {
        options={...options,...(event.op==="limit" ? {evaluationLimitIndex:event.value===null ? undefined : Number(event.value)}
          : {allowDisabledElementIds:event.value ? new Set([props!.elements[0].id]) : undefined})};
        props={...props!,options};view!.rerender(props);
      } else if(event.op==="transport") {
        props={...props!,transport:transport()};view!.rerender(props);
      } else if(event.op==="mode") {
        mode=String(event.value);vi.stubEnv("VITE_EVALUATION_ENGINE",mode);view!.rerender(props!);
      } else if(event.op==="unmount") {
        records.push({unit:unit.id,event:ordinal,op:event.op,mounted:false,
          source:sourceFile,compiledRevision:props!.revision,requests:requests.length,
          expected:"no live publication or interaction authority; subsequent old callbacks must cause zero renders"});
        view!.unmount();view=undefined;continue;
      } else if(event.op==="remount") {
        view=renderHook(p=>{renders++;return useEvaluationEngine(p.elements,p.options,p.revision,p.transport);},{initialProps:props!});
      } else {
        const request=requests[event.request!-1];
        expect(request,`deferred request ${event.request}`).toBeDefined();
        await act(async()=>{
          if(event.op==="resolve")request.resolve(request.payload);
          else request.reject(new Error(`request-${event.request}`));
        });
        expect(requests).toHaveLength(beforeRequests);
        // Superseded completions must not execute deferred reference evaluation or log mismatches.
        if(event.request!==requests.length || !view) {
          expect(warn.mock.calls).toHaveLength(beforeWarnings);
          expect(reference.mock.calls).toHaveLength(beforeReferences);
          expect(renders,"cancelled callbacks cannot publish into either session").toBe(beforeRenders);
        }
      }
      if(!event.expected || !view)continue;
      const actual=view.result.current;
      const expected=event.expected;
      const current=useCadDocumentStore.getState();
      const record={unit:unit.id,event:ordinal,op:event.op,source:sourceFile,sourceRevision:current.sourceRevision,
        compiledRevision:current.compiledDocumentRevision,mode,requests:requests.length,inputHashes:requests.map(r=>r.inputHash),
        expected,actual:{...actual,evaluation:{geometry:geometrySnapshot(actual.evaluation),computedGeometry:[...actual.evaluation.computedGeometry.values()],errors:actual.evaluation.errors,warnings:actual.evaluation.warnings,geometryValueErrors:actual.evaluation.geometryValueErrors ?? []},
          error:actual.error instanceof Error ? actual.error.message : actual.error,current:evaluationStateIsCurrentFor(actual,current.compiledDocumentRevision)}};
      records.push(record);
      try {
        if(!ids.has(expected.request)) {
          expect(actual.evaluationRequestRevision,"new request identity strictly increases").toBeGreaterThan(highest);
          ids.set(expected.request,actual.evaluationRequestRevision);highest=actual.evaluationRequestRevision;
        }
        assertState(actual,expected,current.compiledDocumentRevision,ids.get(expected.request)!,mode);
        // Existing Canvas presentation policy also removes authority for fatal editor text.
        const presentation=resolveRevisionCoherentCanvasPresentation({
          current:{elements:props!.elements,canonicalElements:props!.elements,evaluationLimitIndex:options.evaluationLimitIndex,
            visibilityProfiles:[],activeVisibilityProfileId:null,moduleSemanticContext:{}},
          evaluation:actual.evaluation,compiledDocumentRevision:current.compiledDocumentRevision,evaluationState:actual,lastStable:null,
          holdLastStable:current.sourceText!==current.docText
        });
        expect(evaluationStateIsCurrentFor(presentation.renderEvaluationState,current.compiledDocumentRevision)).toBe(expected.interaction);
        if(event.op==="source" && ["K2","S2"].includes(event.file!) && requests.length>=2) {
          expect(requests.at(-1)!.inputHash,"identical legal evaluation inputs across compiled revisions").toBe(requests[0].inputHash);
        }
        if(mode!=="rust" && options.scalarProgram && actual.status==="evaluating")expect(reference.mock.calls).toHaveLength(beforeReferences);
      } catch(error) {
        const message=`${unit.id}.${ordinal} ${event.op}: ${String(error)}`;
        failures.push(message);Object.assign(record,{failure:message});
      }
    }
    view?.unmount();
    expect(failures,failures.join("\n")).toEqual([]);
  });

  it("validates hand geometry with canonical source and one real persistent Rust process",async()=>{
    let closed:Promise<void> | undefined;
    let spawns=0;
    const rust=new RustEvaluationProcess("rust-evaluator/target/debug/evaluation_stdio",{
      spawnProcess:((...args:Parameters<typeof spawn>)=>{
        spawns++;
        const child=spawn(...args);
        closed=new Promise<void>(resolve=>{child.once("close",()=>resolve());child.once("error",()=>resolve());});
        return child;
      }) as typeof spawn
    });
    async function bounded<T>(promise:Promise<T>):Promise<T> {
      let timer:ReturnType<typeof setTimeout> | undefined;
      try{return await Promise.race([promise,new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>{rust.dispose();reject(new Error("#1472 Rust request/close exceeded 15s"));},15000);
      })]);}finally{clearTimeout(timer);}
    }
    try {
      useCadDocumentStore.setState(initialCadDocumentState());
      for(const file of ["K","L","S"]) {
        useCadDocumentStore.getState().commitText(source(file),"editor");
        const state=useCadDocumentStore.getState();
        expect(state.diagnostics).toEqual([]);
        const options=buildEvaluationOptions({compiledDocument:state.doc,evaluationLimitIndex:undefined});
        const prepared=prepareRustEvaluation(state.elements,options);
        expect(prepared.rustEligible).toBe(true);
        const result=await bounded(evaluatePreparedRust(prepared,async input=>await rust.request(input) as EvaluationPayload));
        const actual=geometrySnapshot(result);
        const expected=geometries(file==="L" ? "L" : "K");
        expect(actual).toEqual(expected);
        expect(result.errors).toEqual([]);expect(result.warnings).toEqual([]);
        // Distinct wrong geometry is rejected by the same coordinate comparison.
        expect(()=>expect(actual).toEqual(geometries(file==="L" ? "K" : "L"))).toThrow();
        records.push({control:"persistent Rust",file,sourceSha256:hash(source(file)),revision:state.compiledDocumentRevision,
          inputHash:hash(JSON.stringify(prepared.input)),rustEligible:prepared.rustEligible,geometry:actual,errors:result.errors});
      }
      expect(spawns).toBe(1);
    }finally{rust.dispose();if(closed)await bounded(closed);records.push({control:"Rust cleanup",spawns,closed:!!closed});}
  },60000);

  it("rejects intentionally wrong states with the same complete assertion",()=>{
    const elements:CadElement[]=[{id:"a",name:"A",type:"freePoint",activity:"visible",x:0,y:0}];
    const evaluation={...engine.emptyEvaluationResult(elements),computedGeometry:new Map([["a",{kind:"point" as const,elementId:"a",name:"A",x:0,y:0}]])};
    const actual:EvaluationEngineState={evaluation,evaluationRevision:2,evaluationRequestRevision:10,mode:"rust",source:"rust",status:"ready",rustEligible:true,isStale:false,error:null};
    const expected:Expected={evaluationRevision:2,request:1,status:"ready",geometry:"partial",source:"rust",rustEligible:true,isStale:false,current:true,interaction:true,error:null};
    const check=(s:EvaluationEngineState,e=expected)=>assertState(s,e,2,10,"rust");
    check(actual);
    for(const wrong of [
      {...actual,evaluationRevision:1}, {...actual,evaluationRequestRevision:9},
      {...actual,status:"evaluating" as const}, {...actual,isStale:true},
      {...actual,evaluation:{...evaluation,computedGeometry:new Map()}},
      {...actual,status:"failed" as const,error:new Error("stale failure")}
    ])expect(()=>check(wrong)).toThrow();
    expect(()=>check(actual,{...expected,status:"evaluating",current:false})).toThrow();
    const failed={...actual,evaluation:engine.emptyEvaluationResult(elements),status:"failed" as const,error:new Error("request-1")};
    const failExpected={...expected,status:"failed",geometry:"empty",error:"request-1"};
    check(failed,failExpected);
    expect(()=>check({...failed,source:"fallback",evaluation},failExpected)).toThrow();
  });
});
