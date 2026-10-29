import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { applyLineSplices, buildSourceSemanticRenameSplices, isLastGoodDslDocument, type LastGoodDslDocument } from "@nuinuicad/nui-language/document";
import { MultiDocumentGraphCoordinator, SavedDocumentArtifactCache, buildMultiDocumentImportGraph,
  createMultiDocumentModuleRenameDocumentProof, planMultiDocumentRename, queryMultiDocumentDefinition,
  sourceIdentityOf, type MultiDocumentRenamePlan } from "@nuinuicad/nui-language/workspace";
import { graphInput, compileGraph, id, saved } from "./issue1486Support";
import { compare, runtimePath, checkFile } from "./patternArtifactAssertions";
import { buildEvaluationOptions } from "../src/geometry/productionEvaluationContext";
import { prepareRustEvaluation, evaluatePreparedRust, type RustEvaluationTransport } from "../src/geometry/rustEvaluationRunner";
import { evaluateElementsReferencePayload } from "../src/geometry/evaluationEngine";
import { evaluationPayloadToResult, type EvaluationPayload } from "../src/geometry/evaluationPayload";
import { RustEvaluationProcess } from "../src/node/rustEvaluationProcess";
import { evaluateOutputPlan } from "../src/output/outputCore";
import { compileModulePreviewRoot } from "../src/dsl/modulePreviewRoot";
import { buildModulePreviewEvaluationOptions } from "../src/vscode/modulePreviewEvaluation";
import { projectVscodeMultiDocumentCanvasRuntime, canvasRuntimePresentationFor } from "../src/vscode/multiDocumentRuntimeTransport";
import matrix from "./fixtures/issue-1490/matrix.json";
import reducers from "./fixtures/issue-1490/reducers.json";

type Cell = typeof matrix[number];
type Bundle = ReturnType<typeof compileGraph>;
type Files = Record<string, string>;
type Oracle = Cell["expected"];
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const records: Record<string, unknown>[] = [];
let directory: string, rust: RustEvaluationProcess, closed: Promise<void> | undefined;
let spawns = 0, requests = 0, exports = 0;
const bounded = async <T,>(promise: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => { rust.dispose(); reject(new Error("#1490 request exceeded 15 seconds")); }, 15000);
  })]); } finally { clearTimeout(timer); }
};
const transport: RustEvaluationTransport = async input => { requests++; return await bounded(rust.request(input)) as EvaluationPayload; };
beforeAll(() => {
  execFileSync("cargo", ["build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"], { timeout: 120000, stdio: "inherit" });
  directory = mkdtempSync(join(tmpdir(), "nuinui-1490-"));
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
  rust?.dispose(); if (closed) await bounded(closed);
  if (process.env.ISSUE1490_RECORD) writeFileSync(process.env.ISSUE1490_RECORD, JSON.stringify({ directory, spawns, requests, exports, records }, null, 2) + "\n");
  if (directory && !process.env.ISSUE1490_KEEP_ARTIFACTS) rmSync(directory, { recursive: true, force: true });
  if (requests) expect(spawns).toBe(1);
});
const legal = (b: Bundle): LastGoodDslDocument => {
  expect(b.graph.valid, JSON.stringify(b.graph.diagnostics)).toBe(true);
  expect(b.analysis.valid, JSON.stringify(b.analysis.diagnostics)).toBe(true);
  expect([...b.compiled.diagnostics, ...b.compiled.bindingIssueDiagnostics ?? []].filter(d => d.severity === "error")).toEqual([]);
  expect(isLastGoodDslDocument(b.compiled)).toBe(true);
  return b.compiled as LastGoodDslDocument;
};
const geometry = (doc: LastGoodDslDocument, result: ReturnType<typeof evaluationPayloadToResult>, expected: Oracle) => {
  expect(result.errors).toEqual([]); expect(result.geometryValueErrors ?? []).toEqual([]);
  const shapes = Object.fromEntries([...result.computedGeometry].filter(([,g])=>g.kind !== "group").map(([key,g])=>[runtimePath(doc,key),g]));
  expect(Object.keys(shapes).sort()).toEqual(Object.keys(expected.geometry).sort());
  compare(shapes, expected.geometry);
  for (const [key,g] of result.computedGeometry) if(g.kind !== "group") expect(result.effectiveVisibleElementIds?.has(key)).toBe(true);
  const edit=doc.bindingAnalysis!.catalog.bindings.find(b=>b.name==="rootEdit")!;
  expect(result.computedScalarBindings?.get(edit.id)).toMatchObject({status:"ok",value:{kind:"number",value:expected.scalars.rootEdit}});
  return shapes;
};
const origin = (b: Bundle, expectedDocument = id("types.nui")) => {
  const record = b.graph.nodes.get(id("types.nui"))!.publicApi.publicEntriesByName.get("Measure")!;
  expect(record.identity.documentId).toBe(expectedDocument);
  const identity = `record-type:${expectedDocument.length}:${expectedDocument}${record.identity.localIdentity.length}:${record.identity.localIdentity}`;
  const records=b.compiled.sourceLexicalNamespace!.recordSemanticAnalysis!;
  expect(records.definitionsByStatementId.get(identity)?.name).toBe("Measure");
  expect([...records.valuesByStatementId.values()].find(v=>v.name==="first")?.typeIdentity).toBe(identity);
  const entry=b.graph.nodes.get(id("module.nui"))!.publicApi.publicEntriesByName;
  const module=entry.get("Pocket")??entry.get("PocketRenamed");
  expect(module?.identity.documentId).toBe(id("module.nui"));
  if(b.graph.nodes.has(id("facade.nui"))) expect(b.graph.nodes.get(id("facade.nui"))!.publicApi.publicEntriesByName.get(module!.name)!.identity).toEqual(module!.identity);
  return { record:record.identity,module:module!.identity };
};
const physical = async (b: Bundle, expected: Oracle, label: string) => {
  const doc=legal(b), artifacts=[];
  for(const format of ["svg","pdf"] as const) {
    const selected=(format==="svg"?doc.document.svgOutputs:doc.document.printOutputs).find(o=>o.name===(format==="svg"?"Vector":"Paper"))!;
    const plan=await evaluateOutputPlan({compiledDocument:doc,output:selected,evaluate:async(elements,options)=>{
      const prepared=prepareRustEvaluation(elements,options);expect(prepared.rustEligible).toBe(true);return evaluatePreparedRust(prepared,transport);
    }});
    expect(plan.outputId).toBe(selected.id);expect(plan.outputName).toBe(selected.name);
    compare(plan.renderedBounds,expected.bounds);
    expect(plan.placements).toHaveLength(expected.placements.length);
    plan.placements.forEach((v,i)=>{const e=expected.placements[i];expect(runtimePath(doc,v.groupId)).toBe(e.group);compare(v,{at:e.at,scale:e.scale,angleDeg:e.angle,mirror:false,origin:{x:0,y:0}});});
    compare(plan.drawables,expected.drawables.map(g=>({kind:g.kind,name:g.name,start:g.start,end:g.end})));
    if(plan.print){compare([plan.print.columns,plan.print.rows,plan.print.strideXmm,plan.print.strideYmm,plan.print.overlapMm],[expected.columns,expected.rows,190,277,10]);compare(plan.print.pages.map(p=>p.origin),expected.pageOrigins);}
    const path=join(directory,`${label}.${format}`);exports++;
    expect(await bounded(rust.exportOutput({path,payload:plan.rustPayload}))).toEqual({exported:true});
    const bytes=readFileSync(path);checkFile(bytes,format,expected);
    artifacts.push({format,path,sha256:sha(bytes),byteLength:bytes.length});
  }
  return artifacts;
};
const applyPlan = (owners: Bundle[], plan: MultiDocumentRenamePlan, files: Files) => {
  const next={...files};
  for(const item of plan.documents) {
    const owner=owners.find(b=>b.graph.rootDocumentId===item.source.documentId)!;
    expect(item.source).toEqual(sourceIdentityOf(owner.graph.rootSource));
    const source=next[basename(item.source.documentId)]!;
    const projection=buildSourceSemanticRenameSplices(source,owner.compiled,item.edits.map(e=>({
      statementIndex:owner.compiled.statements.findIndex(s=>s.physicalSpan.segments.some(p=>p.from<=e.from&&e.to<=p.to)),
      span:{start:0,end:0},physicalSpan:{segments:[{from:e.from,to:e.to}],sourceRevision:owner.graph.rootSource.sourceRevision},oldName:e.expectedText,newName:e.newText
    })));
    expect(projection.ok).toBe(true);if(!projection.ok)throw new Error(projection.reason);
    next[basename(item.source.documentId)]=applyLineSplices(source,projection.splices);
  }
  return next;
};
const footprint = (plan: MultiDocumentRenamePlan) => Object.fromEntries(plan.documents.map(d=>[basename(d.source.documentId),d.edits]));
it("seals all twelve independent sources, exact edits and physical oracles", () => {
  expect(matrix).toHaveLength(12);
  for(const cell of matrix){expect(sha(JSON.stringify(cell.expected))).toBe(cell.hashes.oracle);expect(sha(JSON.stringify(cell.edits))).toBe(cell.hashes.edits);expect(sha(JSON.stringify(cell.after))).toBe(cell.hashes.after);for(const [f,t]of Object.entries(cell.files))expect(sha(t)).toBe((cell.hashes.files as Files)[f]);}
});
it("prevalidates every positive saved/current bundle before numeric evaluation",async()=>{
  for(const cell of matrix)for(const file of Object.keys(cell.files)){
    const b=compileGraph(await buildMultiDocumentImportGraph(graphInput(cell.files as Files,file,cell.state+1)));
    const errors=[...b.compiled.diagnostics,...b.compiled.bindingIssueDiagnostics??[]].filter(d=>d.severity==="error");
    records.push({id:cell.id,prevalidation:file,errors});legal(b);
  }
},60000);
for(let root=1;root<=4;root++)it(`R${root}: genuine public Module Rename → saved/current rebuild → actual SVG/PDF`,async()=>{
  const rootDir=join(directory,`R${root}`);mkdirSync(rootDir);
  const coordinator=new MultiDocumentGraphCoordinator(),cache=new SavedDocumentArtifactCache();
  const cells=matrix.filter(c=>c.root===root),baseline=cells[0];
  let files: Files={...baseline.files} as Files;
  const write=(next:Files)=>{for(const[f,t]of Object.entries(next))writeFileSync(join(rootDir,f),t);};write(files);
  const build=async(file:string,source=files[file],revision=1)=>coordinator.rebuild({...graphInput({...files,[file]:source},file,revision),cache,loader:{async loadSavedDependency(_importer,relative){const file=basename(relative);return{status:"loaded",snapshot:saved(file,readFileSync(join(rootDir,file),"utf8"))};}}});
  const get=async(file:string,source=files[file],revision=1)=>{const existing=coordinator.graphForRoot(id(file));if(existing?.rootSource.normalizedSource===source&&existing.rootSource.sourceRevision===revision&&existing.valid)return compileGraph(existing);const result=await build(file,source,revision);expect(result.status).toBe("current");if(result.status!=="current")throw new Error("unavailable current graph");return compileGraph(result.graph);};
  const independent=await get("independent.nui");legal(independent);
  const controlFiles=async(b:Bundle,label:string)=>{
    const doc=legal(b),out=[];
    for(const format of ["svg","pdf"] as const){const output=(format==="svg"?doc.document.svgOutputs:doc.document.printOutputs).find(o=>o.name===(format==="svg"?"Vector":"Paper"))!;
      const plan=await evaluateOutputPlan({compiledDocument:doc,output,evaluate:async(elements,options)=>{const p=prepareRustEvaluation(elements,options);expect(p.rustEligible).toBe(true);return evaluatePreparedRust(p,transport);}});
      const path=join(directory,`${label}.${format}`);expect(await bounded(rust.exportOutput({path,payload:plan.rustPayload}))).toEqual({exported:true});exports++;out.push(sha(readFileSync(path)));}
    return out;
  };
  const control=await controlFiles(independent,`R${root}-independent-before`);
  const foreign=root===4?await get("foreignRoot.nui"):null;
  const foreignBefore=foreign?await controlFiles(foreign,`R${root}-foreign-before`):null;
  const snapshots:{b:Bundle;expected:Oracle}[]=[];
  let pureHashes: string[] | undefined,originalIdentity: ReturnType<typeof origin> | undefined;
  for(const cell of cells){
    const record:Record<string,unknown>={id:cell.id,hashes:cell.hashes,disposition:"UNRESOLVED"};records.push(record);
    if(cell.state===1){
      // Enumerate the entire saved workspace, including facade, second importer
      // and same-name foreign owner. Core receives only canonical semantic indexes.
      expect(readdirSync(rootDir).sort()).toEqual(Object.keys(files).sort());
      const owners:Bundle[]=[];for(const file of readdirSync(rootDir).sort())owners.push(await get(file));owners.forEach(legal);
      const owner=owners.find(b=>b.graph.rootDocumentId===id("module.nui"))!;
      const indexes=owners.map(b=>b.index),proveDocument=createMultiDocumentModuleRenameDocumentProof({graph:owner.graph,analysis:owner.analysis,graphs:owners.filter(b=>b!==owner).map(b=>b.graph),compiledByDocument:new Map(owners.map(b=>[b.graph.rootDocumentId,b.compiled]))});
      const selection=(cell.edits as Record<string,{from:number}[]>)["module.nui"][0].from;
      const input={index:owner.index,documentId:id("module.nui"),position:selection,newName:"PocketRenamed",reverseImporters:{status:"complete" as const,indexes},proveDocument};
      expect(planMultiDocumentRename({...input,reverseImporters:{status:"incomplete"}}).status).toBe("rejected");
      expect(planMultiDocumentRename({...input,newName:"bad name"}).status).toBe("rejected");
      const plan=planMultiDocumentRename(input);record.rename=plan;expect(plan.status,JSON.stringify(plan)).toBe("ok");if(plan.status!=="ok")throw new Error("supported Module Rename rejected");
      expect(footprint(plan.plan)).toEqual(cell.edits);
      for(const[file,edits]of Object.entries(cell.edits))for(const edit of edits??[]){const b=owners.find(b=>b.graph.rootDocumentId===id(file))!;expect(planMultiDocumentRename({...input,index:b.index,documentId:id(file),position:edit.from})).toEqual(plan);}
      const wrong=structuredClone(plan.plan);wrong.documents[0].edits[0].from++;
      expect(()=>expect(footprint(wrong)).toEqual(cell.edits)).toThrow();
      const omitted=structuredClone(plan.plan);omitted.documents.pop();expect(()=>expect(footprint(omitted)).toEqual(cell.edits)).toThrow();
      const typeOwner=owners.find(b=>b.graph.rootDocumentId===id("types.nui"))!;
      expect(planMultiDocumentRename({...input,index:typeOwner.index,documentId:id("types.nui"),position:files["types.nui"].indexOf("Measure"),newName:"OtherRecord"}).status).toBe("rejected");
      const next=applyPlan(owners,plan.plan,files);expect(next).toEqual(cell.after);
      expect(()=>applyPlan(owners,plan.plan,next)).toThrow();
      files=next;write(files);for(const d of plan.plan.documents)coordinator.invalidateSavedDependency(d.source.documentId);
      const caller=await get("root.nui",files["root.nui"],2),from=files["root.nui"].indexOf("pattern::PocketRenamed")+9;
      expect(queryMultiDocumentDefinition({index:caller.index,documentId:id("root.nui"),position:from})?.target.source.documentId).toBe(id("module.nui"));
    }
    if(cell.state===2){files={...cell.files} as Files;write(files);const affected=coordinator.invalidateSavedDependency(id("types.nui"));expect(affected).toContain(id("root.nui"));if(root===4)expect(affected).toContain(id("second.nui"));expect(affected).not.toContain(id("independent.nui"));expect(affected).not.toContain(id("foreignRoot.nui"));record.affected=affected;
      const dirty=await buildMultiDocumentImportGraph({...graphInput({...files,"types.nui":cell.dirty},"types.nui",99),cache});expect(dirty.rootSource.normalizedSource).toBe(cell.dirty);expect(readFileSync(join(rootDir,"types.nui"),"utf8")).toBe(files["types.nui"]);record.dirtyHash=sha(cell.dirty);}
    const b=await get("root.nui",files["root.nui"],cell.state+1),doc=legal(b);record.identities=origin(b);
    if(originalIdentity)expect(record.identities).toEqual(originalIdentity);else originalIdentity=record.identities as ReturnType<typeof origin>;
    expect(b.graph.dependencyFingerprints.get(id("types.nui"))).toBe((cell.hashes.files as Files)["types.nui"]);
    expect(doc.spans.sourceMap.source).toBe(files["root.nui"]);expect(doc.spans.sourceMap.sourceRevision).toBe(cell.state+1);
    const options=buildEvaluationOptions({compiledDocument:doc}),prepared=prepareRustEvaluation(doc.document.elements,options);expect(prepared.rustEligible).toBe(true);
    record.preparedHash=sha(JSON.stringify(prepared));record.reference=evaluateElementsReferencePayload(doc.document.elements,options);
    geometry(doc,evaluationPayloadToResult(record.reference as EvaluationPayload),cell.expected);
    const result=await evaluatePreparedRust(prepared,transport);record.geometry=geometry(doc,result,cell.expected);
    const canvas=projectVscodeMultiDocumentCanvasRuntime({graph:b.graph,compiled:doc,graphRevision:cell.state+1});
    const elements=canvas?canvasRuntimePresentationFor(JSON.parse(JSON.stringify(canvas))).elements:doc.document.elements;
    expect(elements.some(e=>e.name==="Unauthored")).toBe(false);geometry(doc,await evaluatePreparedRust(canvas?.preparedRustEvaluation??prepared,transport),cell.expected);
    const artifacts=await physical(b,cell.expected,cell.id);record.artifacts=artifacts;
    if(cell.state===0)pureHashes=artifacts.map(a=>a.sha256);if(cell.state===1)expect(artifacts.map(a=>a.sha256)).toEqual(pureHashes);
    expect(()=>origin(b,id("facade.nui"))).toThrow();
    const wrong=structuredClone(cell.expected);wrong.svgMm[0]++;expect(()=>checkFile(readFileSync(artifacts[0].path),"svg",wrong)).toThrow();
    const wrongPdf=structuredClone(cell.expected);wrongPdf.paperMm[0]++;expect(()=>checkFile(readFileSync(artifacts[1].path),"pdf",wrongPdf)).toThrow();
    const wrongOutput=structuredClone(cell.expected);wrongOutput.drawables.reverse();expect(()=>checkFile(readFileSync(artifacts[0].path),"svg",wrongOutput)).toThrow();
    if(root===3){const wrongInstance=structuredClone(cell.expected);wrongInstance.geometry["Left::piece::Edge"]=structuredClone(wrongInstance.geometry["Right::piece::Edge"]);expect(()=>geometry(doc,result,wrongInstance)).toThrow();
      // Preview the original defining document, preserving its imported type;
      // the existing Preview owner targets local definitions only.
      const module=await get("module.nui",files["module.nui"],cell.state+1),definition=module.compiled.moduleSemanticAnalysis!.definitions.find(d=>d.name===(cell.state===0?"Pocket":"PocketRenamed"))!;
      const preview=compileModulePreviewRoot({source:module.graph.rootSource,semantic:{sourceRevision:cell.state+1,sourceText:files["module.nui"],compiled:module.compiled},target:{definitionStatementId:definition.statementId,definitionStatementIndex:definition.statementIndex,name:definition.name},arguments:[{name:"measure",expression:`types::Measure(x: ${cell.state===2?36:17}, y: ${cell.state===2?-37:-23})`},{name:"shift",expression:"3"}]});
      expect(preview).not.toBeNull();expect(preview!.diagnostics.filter(d=>d.severity==="error")).toEqual([]);
      const pp=prepareRustEvaluation(preview!.compileResult.elements,buildModulePreviewEvaluationOptions(preview!));expect(pp.rustEligible).toBe(true);
      const pr=await evaluatePreparedRust(pp,transport);expect(pr.errors).toEqual([]);const visible=[...pr.computedGeometry.values()].filter(g=>preview!.targetRuntimeElementIds.includes(g.elementId)&&g.kind!=="group");expect(visible).toHaveLength(2);compare(visible.find(g=>g.name==="Edge"),cell.expected.geometry["Left::piece::Edge"]);record.preview="PASS";
    }
    if(root===4){const second=await get("second.nui",files["second.nui"],cell.state+1);origin(second);record.secondArtifacts=await physical(second,cell.secondExpected!,`${cell.id}-second`);}
    expect(coordinator.graphForRoot(id("independent.nui"))).toBe(independent.graph);expect(await controlFiles(independent,`${cell.id}-independent`)).toEqual(control);
    if(foreign){expect(coordinator.graphForRoot(id("foreignRoot.nui"))).toBe(foreign.graph);expect(await controlFiles(foreign,`${cell.id}-foreign`)).toEqual(foreignBefore);}
    if(cell.state===2){expect(()=>geometry(doc,result,baseline.expected)).toThrow();
      const restored=await get("root.nui",cell.restoreSource,4);record.restored=await physical(restored,cell.restored,`${cell.id}-restored`);
      writeFileSync(join(rootDir,"types.nui"),"nui 1\nexport record Measure(x: Missing)\n");coordinator.invalidateSavedDependency(id("types.nui"));
      const invalid=await build("root.nui",cell.restoreSource,5);expect(invalid.status).not.toBe("stale");const graph=coordinator.graphForRoot(id("root.nui"));expect(graph?.valid??false).toBe(false);record.invalid=invalid.status;
      if(graph){const invalidBundle=compileGraph(graph);expect(()=>legal(invalidBundle)).toThrow();expect(projectVscodeMultiDocumentCanvasRuntime({graph,compiled:invalidBundle.compiled,graphRevision:5})).toBeNull();}
      for(const a of artifacts)expect(sha(readFileSync(a.path))).toBe(a.sha256);
      writeFileSync(join(rootDir,"types.nui"),files["types.nui"]);coordinator.invalidateSavedDependency(id("types.nui"));const recovered=await get("root.nui",cell.restoreSource,6);record.recovered=await physical(recovered,cell.restored,`${cell.id}-recovered`);
      expect((record.restored as typeof artifacts).map(a=>a.sha256)).toEqual((record.recovered as typeof artifacts).map(a=>a.sha256));
    }
    snapshots.push({b,expected:cell.expected});for(const old of snapshots){const d=legal(old.b),p=prepareRustEvaluation(d.document.elements,buildEvaluationOptions({compiledDocument:d}));geometry(d,await evaluatePreparedRust(p,transport),old.expected);}
    record.disposition=root===4?"BUG→FIXED→REPASS":"BASE_PASS";
  }
},120000);

for(const row of reducers)it(`${row.id}: ${row.reason}`,async()=>{
 const b=compileGraph(await buildMultiDocumentImportGraph(graphInput({...row.files,"root.nui":row.source},"root.nui"))),doc=legal(b);
 const options=buildEvaluationOptions({compiledDocument:doc}),prepared=prepareRustEvaluation(doc.document.elements,options);expect(prepared.rustEligible).toBe(true);
 const reference=evaluateElementsReferencePayload(doc.document.elements,options),result=await evaluatePreparedRust(prepared,transport);
 records.push({id:row.id,source:row.source,files:row.files,expected:row.expected,prepared,reference,rust:{errors:result.errors,geometry:[...result.computedGeometry.values()]}});
 expect(reference.errors).toEqual([]);expect(result.errors).toEqual([]);
 compare(reference.computedGeometry.find(g=>g.kind==="point"),row.expected);compare([...result.computedGeometry.values()].find(g=>g.kind==="point"),row.expected);
},30000);

it("direct and facade routes encode independently equivalent physical files",()=>{
 for(let state=0;state<=2;state++){
  const hashes=(root:number)=>(records.find(r=>r.id===`R${root}-S${state}`&&r.artifacts)?.artifacts as {sha256:string}[]).map(a=>a.sha256);
  expect(hashes(1)).toEqual(hashes(2));
 }
});
