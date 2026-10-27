import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDslSemanticOccurrenceIndex, dslSemanticIdentityKey, planDslRenameEditsResult, queryDslSourceValueStep } from "@nuinuicad/nui-language";
import { applyLineSplices, buildSourceSemanticRenameSplices, compileCanonicalText, planExtractModule, planInlineModule, type LastGoodDslDocument, type LineSplice } from "@nuinuicad/nui-language/document";
import { registerSourceEditSession } from "../src/editor/sourceEditSession";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation } from "../src/geometry/rustEvaluationRunner";
import { RustEvaluationProcess, resolveRustEvaluationBinaryPath } from "../src/node/rustEvaluationProcess";
import { initialCadDocumentState, useCadDocumentStore } from "../src/state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../src/state/cadUiStore";
import { applyBakePlan, planBakeGeometry, type BakePlan } from "../src/commands/bakeGeometry";
import { applyCoordinatePointConversionPlan, coordinatePointConversionBaseCandidates, planCoordinatePointConversion } from "../src/commands/coordinatePointConversion";
import { cases, type Action, type Oracle } from "./fixtures/issue-1464/cases";
import { reducers } from "./fixtures/issue-1464/reducers";
import { extensions } from "./fixtures/issue-1464/extensions";
import { references, type ReferenceOracle } from "./fixtures/issue-1464/references";
import freeze from "./fixtures/issue-1464/freeze.json";

const records: Array<Record<string, unknown>> = [];
const state = () => useCadDocumentStore.getState();
const sourceSnapshot = () => ({ normalizedSource: state().sourceText.replace(/\r\n/g,"\n"), sourceRevision: state().doc.statementMap.sourceRevision });
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const statementPath = (doc: LastGoodDslDocument, index: number): string => {
  const s = doc.statements[index];
  if (!s) throw new Error(`missing statement ${index}`);
  const parent = s.enclosing?.statementIndex;
  return [parent === undefined ? "" : statementPath(doc,parent), s.name ?? ""].filter(Boolean).join("::");
};
const statementAt = (path: string) => {
  const index = state().doc.statements.findIndex((s,i) => s.name && statementPath(state().doc,i) === path);
  if (index < 0) throw new Error(`missing authored target ${path}`);
  return index;
};
const statementId = (path: string) => state().doc.statementMap.statementIdByStatementIndex!.get(statementAt(path))!;
const elementId = (path: string) => state().doc.statementMap.elementIdByStatementIndex.get(statementAt(path))!;
const identities = () => state().doc.sourceLexicalNamespace!.allDeclarations.map(d => ({ path: statementPath(state().doc,d.statementIndex), id: d.statementId, kind: d.kind }));
const occurrences = () => createDslSemanticOccurrenceIndex(state().doc).occurrences.map(o => ({
  from: o.from, to: o.to, text: sourceSnapshot().normalizedSource.slice(o.from,o.to), kind: o.kind, identity: dslSemanticIdentityKey(o.identity)
}));
const replacePath = (path: string, from: string, to: string) => path===from||path.startsWith(from+"::") ? to+path.slice(from.length) : path;
const nextReferences = (current: ReferenceOracle[], action: Action): ReferenceOracle[] => {
  if (action.kind==="extract" && !action.rejectedCode) return current.map(reference=>{
    const movedConsumer=action.targets.some(t=>reference.from===t||reference.from.startsWith(t+"::"));
    const result={...reference};
    if(movedConsumer && !action.targets.some(t=>reference.to===t||reference.to.startsWith(t+"::"))) {
      result.parameterOf=[...action.targets[0].split("::").slice(0,-1),"Extracted"].join("::");
    }
    for (const target of action.targets) {
      const parent=target.split("::").slice(0,-1);
      const moved=[...parent,"Extracted",target.split("::").at(-1)!].join("::");
      result.from=replacePath(result.from,target,moved);
      if (result.to===target || result.to.startsWith(target+"::")) {
        result.to=replacePath(result.to,target,moved);
        if (!movedConsumer)result.via=[...parent,"Part"].join("::");
      }
    }
    return result;
  });
  if (action.kind==="inline" && !action.skipped) {
    const instance=state().doc.moduleSemanticAnalysis!.instancesByStatementId.get(statementId(action.target))!;
    const definitionPath=statementPath(state().doc,instance.callee!.definitionStatementIndex);
    return current.map(reference=>reference.via===action.target ? {...reference,to:replacePath(reference.to,definitionPath,action.target)} : reference);
  }
  if (action.kind==="rename" && !action.rejectedReason) {
    const to=[...action.target.split("::").slice(0,-1),action.name].join("::");
    return current.map(r=>({...r,from:replacePath(r.from,action.target,to),to:replacePath(r.to,action.target,to),...(r.via?{via:replacePath(r.via,action.target,to)}:{})}));
  }
  if(action.kind==="convert" && action.successes!==0)return [...current,...action.targets.filter(p=>p!=="Skip").map(from=>({from,to:action.base}))];
  if(action.kind==="append")return [...current,{from:"Other",to:"Extracted::P",via:"Second"}];
  return current;
};
const assertReferences = (expected: ReferenceOracle[]) => {
  const index=createDslSemanticOccurrenceIndex(state().doc);
  const source=sourceSnapshot().normalizedSource;
  const ownerId=(o: typeof index.occurrences[number]): string|null => {
    const identity=o.identity;
    if(identity.kind==="typed") {
      const binding=state().doc.bindingAnalysis?.catalog.bindingsById.get(identity.bindingId);
      return binding?state().doc.statementMap.statementIdByStatementIndex!.get(binding.statementIndex)??null:null;
    }
    if(identity.kind==="element")return state().doc.statementMap.byElementId.get(identity.elementId)?identity.elementId:null;
    if(identity.kind==="module" && "statementId" in identity.target)return identity.target.statementId;
    return null;
  };
  for(const reference of expected) {
    const consumer=state().doc.statements[statementAt(reference.from)];
    const candidates=index.occurrences.filter(o=>o.kind==="reference"&&o.from>=consumer.documentRange.from&&o.to<=consumer.documentRange.to);
    if(reference.parameterOf) {
      const definitionId=statementId(reference.parameterOf);
      const parameter=state().doc.moduleSemanticAnalysis!.definitionsByStatementId.get(definitionId)!.parameters.find(p=>p.name===reference.to.split("::").at(-1))!;
      expect(candidates.some(o=>o.identity.kind==="module"&&o.identity.target.kind==="moduleParameter"&&o.identity.target.slot.definitionStatementId===definitionId&&o.identity.target.slot.parameterIndex===parameter.parameterIndex),`lowered parameter ${reference.parameterOf}::${reference.to}`).toBe(true);
      continue;
    }
    const toId=statementId(reference.to);
    const target=candidates.filter(o=>source.slice(o.from,o.to)===reference.to.split("::").at(-1)&&ownerId(o)===toId);
    expect(target,`reference ${reference.from} -> ${reference.to}`).not.toHaveLength(0);
    if(reference.via) {
      const viaId=statementId(reference.via);
      expect(candidates.some(o=>ownerId(o)===viaId && target.some(t=>source.slice(o.to,t.from)==="::")),`qualified route ${reference.via} -> ${reference.to}`).toBe(true);
    }
  }
};
const clean = () => {
  expect(state().docText).toBe(state().sourceText);
  expect([...state().diagnostics, ...state().bindingIssueDiagnostics].filter(d => d.severity === "error")).toEqual([]);
  expect(state().doc.sourceLexicalNamespace?.collisions).toEqual([]);
};
const atomic = (before: ReturnType<typeof state>, changed: boolean) => {
  expect(state().past.length).toBe(before.past.length + Number(changed));
  expect(state().sourceRevision).toBe(before.sourceRevision + Number(changed));
  expect(state().doc.statementMap.sourceRevision).toBe(before.doc.statementMap.sourceRevision + Number(changed));
  if (!changed) {
    expect(state().sourceText).toBe(before.sourceText);
    expect(state().future).toBe(before.future);
  }
};
const commit = (splices: readonly LineSplice[], createdElementIds?: readonly string[]) => {
  const before = state();
  const predicted = applyLineSplices(before.sourceText,splices);
  // Exercise the production IME protection before the actual host-neutral commit.
  const unregister = registerSourceEditSession({ isComposing: () => true, hasPendingText: () => false, flush: () => "blocked-composition" });
  try { expect(state().commitLineSplices(splices)).toEqual({ status: "rejected", reason: "composition" }); atomic(before,false); }
  finally { unregister(); }
  const result = state().commitLineSplices(splices,{ createdElementIds });
  expect(result.status).toBe(predicted === before.sourceText ? "noop" : "applied");
  atomic(before,predicted !== before.sourceText);
  expect(state().sourceText).toBe(predicted);
  const oldLines=before.sourceText.replace(/\r\n/g,"\n").split("\n");
  const newLines=state().sourceText.replace(/\r\n/g,"\n").split("\n");
  let oldCursor=0; let newCursor=0;
  for (const splice of [...splices].sort((a,b)=>a.startLine-b.startLine||a.endLine-b.endLine)) {
    const untouched=splice.startLine-1-oldCursor;
    expect(newLines.slice(newCursor,newCursor+untouched)).toEqual(oldLines.slice(oldCursor,oldCursor+untouched));
    oldCursor=splice.endLine; newCursor+=untouched+splice.replacementLines.length;
  }
  expect(newLines.slice(newCursor)).toEqual(oldLines.slice(oldCursor));
  clean();
};

let rust: RustEvaluationProcess;
let requestCount = 0;
let lastInput: unknown;
let responseBytes=0;
beforeAll(() => {
  execFileSync("cargo",["build","--quiet","--manifest-path","rust-evaluator/Cargo.toml","--bin","evaluation_stdio"],{ timeout: 120_000, stdio: "inherit" });
  rust = new RustEvaluationProcess(resolveRustEvaluationBinaryPath(process.cwd()), {
    spawnProcess: ((...args: Parameters<typeof spawn>) => {
      const child = spawn(...args);
      child.stdout?.on("data",(chunk: Buffer) => {
        responseBytes += chunk.byteLength;
        if (responseBytes > 8 * 1024 * 1024) child.kill();
      });
      return child;
    }) as typeof spawn
  });
},120_000);
afterAll(() => {
  rust?.dispose();
  if (process.env.ISSUE1464_RECORD) writeFileSync(process.env.ISSUE1464_RECORD,JSON.stringify({ requestCount, records },null,2)+"\n");
});
const production = async (doc = state().doc) => {
  const options = buildEvaluationOptions({ compiledDocument: doc, evaluationLimitIndex: undefined });
  const prepared = prepareRustEvaluation(doc.document.elements,options);
  lastInput=prepared.input;
  expect(prepared.rustEligible,"ordinary production Rust eligibility").toBe(true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  requestCount++;
  responseBytes=0;
  try {
    const payload = await Promise.race([
      rust.request(prepared.input) as Promise<EvaluationPayload>,
      new Promise<never>((_,reject) => { timer=setTimeout(() => { rust.dispose(); reject(new Error("Rust request exceeded 15 seconds")); },15_000); })
    ]);
    expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(8*1024*1024);
    return { payload, reference: evaluateElementsReferencePayload(doc.document.elements,options) };
  } finally { clearTimeout(timer); }
};
const runtimePath = (doc: LastGoodDslDocument, id: string): string => {
  const entry = doc.moduleMaterialization?.executionStatements.find(e => e.runtimeElementId === id);
  if (entry) {
    const parent = entry.parentGroupId ? runtimePath(doc,entry.parentGroupId) : "";
    return [parent,entry.statement.name ?? ""].filter(Boolean).join("::");
  }
  const e = doc.document.elements.find(e => e.id === id);
  if (!e) throw new Error(`missing runtime source for ${id}`);
  return [e.parentGroupId ? runtimePath(doc,e.parentGroupId) : "", e.name].filter(Boolean).join("::");
};
const closeMatch = (actual: unknown, expected: unknown) => {
  if (typeof expected === "number") { expect(typeof actual).toBe("number"); expect(Math.abs((actual as number)-expected)).toBeLessThanOrEqual(1e-7); }
  else if (expected && typeof expected === "object") {
    for (const [key,value] of Object.entries(expected)) closeMatch((actual as Record<string,unknown> | undefined)?.[key],value);
  } else expect(actual).toEqual(expected);
};
const assertOracle = (oracle: Oracle, scalars: Record<string,number>, payload: EvaluationPayload) => {
  expect(payload.errors).toEqual([]);
  for (const [path,expected] of Object.entries(oracle)) {
    const matching = payload.computedGeometry.filter(g => runtimePath(state().doc,g.elementId) === path);
    expect(matching,`geometry ${path}; actual routes: ${payload.computedGeometry.map(g=>runtimePath(state().doc,g.elementId)).join(",")}`).toHaveLength(1);
    closeMatch(matching[0],expected);
  }
  for (const [path,value] of Object.entries(scalars)) {
    const index = statementAt(path);
    const binding = state().doc.bindingAnalysis?.catalog.bindings.find(b => b.statementIndex === index);
    expect(binding,`scalar identity ${path}`).toBeDefined();
    const evaluation = payload.computedScalarBindings?.find(b=>b.bindingId===binding!.id)?.evaluation;
    expect(evaluation).toMatchObject({ status: "ok", value: { kind: "number" } });
    closeMatch((evaluation as { value: { value: number } }).value.value,value);
  }
};
const remap = (oracle: Oracle, from: string, to: string): Oracle => Object.fromEntries(Object.entries(oracle).map(([path,value]) => [path===from || path.startsWith(from+"::") ? to+path.slice(from.length) : path,value]));
const renameSplices = (plan: Extract<ReturnType<typeof planDslRenameEditsResult>,{status:"ok"}>["plan"]) => {
  const compiled=state().doc;
  const projected = buildSourceSemanticRenameSplices(sourceSnapshot().normalizedSource,compiled,plan.edits.map(e=>({
    statementIndex: compiled.statements.findIndex(s=>s.physicalSpan.segments.some(p=>e.from>=p.from && e.to<=p.to)),
    span: { start:0,end:0 }, physicalSpan: { segments:[{from:e.from,to:e.to}],sourceRevision:plan.sourceRevision },oldName:e.expectedText,newName:e.newText
  })));
  expect(projected.ok).toBe(true);
  if (!projected.ok) throw new Error(projected.reason);
  return projected.splices;
};
const bakePlan = (target: string, payload: EvaluationPayload) => {
  const plan=planBakeGeometry({ mode:"current", compiled:state().doc, elements:state().doc.document.elements, evaluation:evaluationPayloadToResult(payload), selectedElementIds:[elementId(target)] });
  expect(plan?.successfulTargetCount).toBe(1);
  expect(plan?.skippedTargets).toEqual([]);
  if (!plan) throw new Error("missing Bake plan");
  return plan;
};

describe("Issue #1464 frozen composite transformations", () => {
  it.each([...cases,...extensions,...reducers])("$id: $hypothesis",async row=> {
    const record: Record<string,unknown> = { id:row.id, source:row.source, sourceSha256:hash(row.source), hypothesis:row.hypothesis, frozenOracle:row.oracle, frozenActions:row.actions, steps:[], disposition:"BLOCKED" };
    records.push(record);
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.setState(initialCadDocumentState());
    state().commitText(row.source,"test");
    useCadDocumentStore.setState({past:[],future:[]});
    let oracle={...row.oracle};
    let scalars={...row.scalars};
    let referenceOracle=[...references[row.id]];
    let staleBake: BakePlan | undefined;
    let rejected=false;
    try {
      const frozen=freeze.units.find(unit=>unit.id===row.id)!;
      expect(hash(row.source)).toBe(frozen.sourceSha256);
      expect(hash(JSON.stringify([row.actions,row.oracle,row.scalars,references[row.id]]))).toBe(frozen.oracleSha256);
      clean();
      let evaluated=await production();
      assertOracle(oracle,scalars,evaluated.payload);
      assertOracle(oracle,scalars,evaluated.reference);
      assertReferences(referenceOracle);
      record.initial={ identities:identities(), occurrences:occurrences(), payload:evaluated.payload };
      // Sensitivity is a wrong source reference/value, never a corrupted production evaluator.
      const victim=Object.keys(oracle).find(p=>!p.includes("::"));
      if (victim) {
        const wrongText=state().sourceText.replace(new RegExp(`@${victim}(?=[.,)\\s])`),"@MissingTarget");
        if (wrongText!==state().sourceText) {
          const wrong=compileCanonicalText(state(),wrongText);
          const compilerDetected=[...wrong.diagnostics,...wrong.bindingIssueDiagnostics].some(d=>d.severity==="error");
          if (!compilerDetected) {
            const options=buildEvaluationOptions({compiledDocument:wrong.doc,evaluationLimitIndex:undefined});
            // Malformed sources are explicitly ineligible, not positive fallback coverage.
            expect(prepareRustEvaluation(wrong.doc.document.elements,options).rustEligible).toBe(false);
            expect(evaluateElementsReferencePayload(wrong.doc.document.elements,options).errors.length).toBeGreaterThan(0);
          }
          record.missingReferenceSensitivity="detected";
        }
      }
      const initialConversion = row.id==="C05" ? (()=> {
        const snap={document:state(),evaluation:evaluationPayloadToResult(evaluated.payload)};
        const base=coordinatePointConversionBaseCandidates({snapshot:snap,targetIds:[elementId("Neighbor")]}).find(b=>b.sourceElementId===elementId("Base"))!;
        return planCoordinatePointConversion({snapshot:snap,targetIds:[elementId("Neighbor")],base,mode:"xy"});
      })() : undefined;
      for (const action of row.actions) {
        const expectedReferences=nextReferences(referenceOracle,action);
        const step: Record<string,unknown>={action,expectedReferences,sourceBefore:state().sourceText,revisionBefore:state().doc.statementMap.sourceRevision,identitiesBefore:identities(),occurrencesBefore:occurrences()};
        (record.steps as unknown[]).push(step);
        const before=state();
        if (action.kind==="extract") {
          const plan=planExtractModule({source:sourceSnapshot(),compiled:state().doc,statementIds:action.targets.map(statementId),moduleName:"Extracted",instanceName:"Part"});
          step.plan=plan;
          if (action.rejectedCode) {
            expect(plan).toMatchObject({status:"rejected",code:action.rejectedCode}); atomic(before,false);
            evaluated=await production(); assertOracle(oracle,scalars,evaluated.payload); assertOracle(oracle,scalars,evaluated.reference);
            step.result="SUPPORTED_REJECTION"; step.unreachableFollowup="generated instance is absent after atomic Extract rejection"; rejected=true; break;
          }
          expect(plan.status).toBe("planned");
          if (plan.status!=="planned") throw new Error(JSON.stringify(plan));
          commit(plan.splices);
          const parent=action.targets[0].split("::").slice(0,-1).join("::");
          for (const target of action.targets) {
            const to=[parent,"Part",target.split("::").at(-1)].filter(Boolean).join("::");
            oracle=remap(oracle,target,to);
            scalars=Object.fromEntries(Object.entries(remap(Object.fromEntries(Object.entries(scalars).map(([k,v])=>[k,{value:v}])),target,to)).map(([k,v])=>[k,v.value as number]));
          }
        } else if (action.kind==="inline") {
          const plan=planInlineModule({source:sourceSnapshot(),compiled:state().doc,targets:[{documentKey:null,statementId:statementId(action.target)}],policy:{includeHiddenInstances:action.hidden??false,includeDisabledInstances:false}});
          step.plan=plan;
          expect(plan.status).toBe("planned");
          if (plan.status!=="planned") throw new Error(JSON.stringify(plan));
          if (action.skipped) { expect(plan.targets).toMatchObject([{status:"skipped",code:action.skipped}]); expect(plan.splices).toEqual([]); rejected=true; }
          else expect(plan.targets).toMatchObject([{status:"inlined"}]);
          commit(plan.splices);
          if (staleBake) { const current=state(); expect(applyBakePlan(staleBake).status).toBe("rejected"); atomic(current,false); step.staleBake="rejected"; staleBake=undefined; }
        } else if (action.kind==="rename") {
          const stmt=state().doc.statements[statementAt(action.target)];
          const declaration=occurrences().find(o=>o.kind==="declaration" && o.from>=stmt.documentRange.from && o.to<=stmt.documentRange.to && o.text===action.target.split("::").at(-1));
          expect(declaration).toBeDefined();
          const snapshot={source:sourceSnapshot(),semantic:{sourceRevision:sourceSnapshot().sourceRevision,compiled:state().doc}};
          const plan=planDslRenameEditsResult(snapshot,declaration!.from,action.name);
          step.plan=plan;
          if (action.rejectedReason) {
            expect(plan).toMatchObject({status:"rejected",rejection:{reason:action.rejectedReason}}); atomic(before,false);
            step.result="SUPPORTED_REJECTION"; rejected=true;
            evaluated=await production(); assertOracle(oracle,scalars,evaluated.payload); assertOracle(oracle,scalars,evaluated.reference);
            continue;
          }
          expect(plan.status).toBe("ok");
          if (plan.status!=="ok") throw new Error(JSON.stringify(plan));
          const beforeOccurrences=occurrences();
          const splices=renameSplices(plan.plan);
          commit(splices);
          const expectedOccurrences=beforeOccurrences.map(o=>{
            const edit=plan.plan.edits.find(e=>e.from===o.from && e.to===o.to);
            const delta=plan.plan.edits.filter(e=>e.to<=o.from).reduce((sum,e)=>sum+e.newText.length-(e.to-e.from),0);
            return {...o,from:o.from+delta,to:o.from+delta+(edit?edit.newText.length:o.to-o.from),text:edit?edit.newText:o.text};
          });
          expect(occurrences()).toEqual(expectedOccurrences);
          const to=[...action.target.split("::").slice(0,-1),action.name].join("::");
          oracle=remap(oracle,action.target,to);
          scalars=Object.fromEntries(Object.entries(scalars).map(([k,v])=>[k===action.target?to:k,v]));
        } else if (action.kind==="convert") {
          const snapshot={document:state(),evaluation:evaluationPayloadToResult(evaluated.payload)};
          const targetIds=action.targets.map(elementId);
          const base=coordinatePointConversionBaseCandidates({snapshot,targetIds}).find(b=>b.sourceElementId===elementId(action.base)) ?? (action.successes===0 ? initialConversion?.base : undefined);
          expect(base).toBeDefined();
          const plan=planCoordinatePointConversion({snapshot,targetIds,base:base!,mode:action.mode});
          step.plan=plan;
          expect(plan.successfulTargetCount).toBe(action.successes??action.targets.length);
          for (const id of plan.successfulTargetIds) {
            const path=action.targets[targetIds.indexOf(id)];
            const p=oracle[path] as {x:number;y:number}; const b=oracle[action.base] as {x:number;y:number};
            const expected=action.mode==="xy" ? {dx:p.x-b.x,dy:p.y-b.y} : {angle:((Math.atan2(p.y-b.y,p.x-b.x)*180/Math.PI)%360+360)%360,distance:Math.hypot(p.x-b.x,p.y-b.y)};
            step.independentConversion=expected;
            const text=plan.splices.flatMap(s=>s.replacementLines).join("\n");
            for (const [key,value] of Object.entries(expected)) { const match=text.match(new RegExp(`${key}:\\s*([-+0-9.eE]+)`)); expect(match).not.toBeNull(); closeMatch(Number(match![1]),value); }
          }
          const applied=applyCoordinatePointConversionPlan(plan,snapshot);
          if (plan.successfulTargetCount===0) { expect(applied.status).toBe("noop"); atomic(before,false); rejected=true; }
          else { expect(applied.status).toBe("applied"); commit(plan.splices,[...plan.successfulTargetIds]); if(applied.status==="applied")expect(state().sourceText).toBe(applied.document.sourceText); }
          if (initialConversion) { const current=state(); expect(applyCoordinatePointConversionPlan(initialConversion,{document:current,evaluation:evaluationPayloadToResult(evaluated.payload)}).status).toBe("rejected"); atomic(current,false); step.staleConversion="rejected"; }
        } else if (action.kind==="step") {
          const source=sourceSnapshot().normalizedSource;
          const offset=source.indexOf(action.token,source.indexOf(action.marker)+action.marker.length);
          expect(offset).toBeGreaterThanOrEqual(0);
          const plan=queryDslSourceValueStep({source:sourceSnapshot(),semantic:{sourceRevision:sourceSnapshot().sourceRevision,compiled:state().doc},selections:[{start:offset,end:offset}],direction:1});
          step.plan=plan;
          expect(plan?.edit).toMatchObject({expectedText:action.token,newText:action.next});
          if (!plan) throw new Error("missing Source Value Step plan");
          expect(source.slice(plan.edit.from,plan.edit.to)).toBe(plan.edit.expectedText);
          const next=source.slice(0,plan.edit.from)+plan.edit.newText+source.slice(plan.edit.to);
          state().commitText(next,"editor");
          atomic(before,true); clean(); oracle={...oracle,...action.oracle}; scalars={...scalars,...action.scalars};
        } else if (action.kind==="append") {
          const n=state().sourceText.replace(/\r\n/g,"\n").split("\n").length;
          commit([{startLine:n+1,endLine:n,replacementLines:action.text.split("\n")}]); oracle={...oracle,...action.oracle};
        } else if (action.kind==="bake" || action.kind==="staleBake" || action.kind==="history") {
          let plan=bakePlan(action.target,evaluated.payload); step.plan=plan;
          if (action.kind==="staleBake") { staleBake=plan; atomic(before,false); continue; }
          if (action.kind==="history") {
            const oldText=state().sourceText;
            const oldRevision=state().doc.statementMap.sourceRevision;
            expect(state().commitLineSplices([]).status).toBe("noop"); atomic(before,false);
            state().undo(); expect(state().sourceText).not.toBe(oldText);
            state().redo(); expect(state().sourceText).toBe(oldText);
            expect(state().doc.statementMap.sourceRevision).toBeGreaterThan(oldRevision);
            const restored=state(); expect(applyBakePlan(plan).status).toBe("rejected"); atomic(restored,false);
            evaluated=await production(); assertOracle(oracle,scalars,evaluated.payload);
            plan=bakePlan(action.target,evaluated.payload); step.freshPlan=plan;
          }
          const current=state(); expect(applyBakePlan(plan).status).toBe("applied"); atomic(current,true); clean();
          const generated=state().doc.document.elements.find(e=>e.id===plan.generatedElementIds[0]);
          expect(generated).toBeDefined();
          if (action.kind==="bake" && action.generatedName)expect(generated!.name).toBe(action.generatedName);
          const parent=action.target.split("::").slice(0,-1);
          oracle[[...parent,generated!.name].join("::")]=action.expected;
        }
        clean();
        for (const text of row.protected??[]) expect(state().sourceText).toContain(text);
        expect(state().sourceText).toContain("// untouched mission sentinel");
        expect(state().sourceText).toContain("// untouched final sentinel");
        step.sourceAfter=state().sourceText; step.revisionAfter=state().doc.statementMap.sourceRevision;
        step.identitiesAfter=identities(); step.occurrencesAfter=occurrences();
        const oldDeclarations=step.identitiesBefore as ReturnType<typeof identities>;
        const correspondence=oldDeclarations.map(old=> {
          let path=old.path;
          if (action.kind==="rename" && (path===action.target || path.startsWith(action.target+"::"))) {
            path=[...action.target.split("::").slice(0,-1),action.name].join("::")+path.slice(action.target.length);
          }
          const moved=action.kind==="extract" && action.targets.some(t=>old.path===t||old.path.startsWith(t+"::"));
          const replaced=action.kind==="inline" && old.path===action.target;
          if (!moved && !replaced) {
            expect(identities().find(d=>d.path===path)?.id,`untouched identity ${old.path}`).toBe(old.id);
          }
          return {before:old,after:identities().find(d=>d.path===path)??null,allowedMove:moved,allowedReplacement:replaced};
        });
        step.identityCorrespondence=correspondence;
        evaluated=await production(); step.payload=evaluated.payload;
        assertOracle(oracle,scalars,evaluated.payload); assertOracle(oracle,scalars,evaluated.reference);
        referenceOracle=expectedReferences; assertReferences(referenceOracle);
        step.result="PASS";
      }
      record.disposition=rejected?"SUPPORTED_REJECTION":"PASS";
    } catch (error) { record.failure=error instanceof Error?error.message:String(error); record.lastInput=lastInput; record.initializerReferences=state().doc.bindingAnalysis?.initializerReferences; record.scalarProgram=state().doc.scalarProgram; record.rootScalarSites=[...state().doc.moduleSemanticAnalysis?.rootScalarExpressionsByStatementId??[]]; throw error; }
  },45_000);
});
