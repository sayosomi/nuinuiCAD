import { forwardRef, useImperativeHandle } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import type { DrawingCanvasHandle } from "../components/DrawingCanvas";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import type { RefObject } from "react";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { referencePickTargetProofFor } from "./referencePickProtocol";
import { planVscodeReferencePickSourceEdit } from "./referencePickSourceEdit";
import { worldToScreen } from "../geometry/viewport";
import type { EvaluateDocumentInput } from "../geometry/rustEvaluationInput";
import type { ExtensionToVscodeMessage, VscodeToExtensionMessage } from "./protocol";
import { VSCodeApp } from "./VSCodeApp";
import { setVscodeWebviewApi } from "./vscodeWebviewApiContext";

// Keep the production App, Store, Canvas, Pick hook and overlay. Replace only
// the shared drawing surface/layout; pointer events still hit the real overlay.
vi.mock("../components/DrawingCanvas", () => ({
  DrawingCanvas: forwardRef<DrawingCanvasHandle, {
    hostAdapter: CanvasHostAdapter;
    canvasFocusRef: RefObject<HTMLDivElement | null>;
  }>(({ hostAdapter, canvasFocusRef }, ref) => {
    useImperativeHandle(ref, () => ({} as DrawingCanvasHandle));
    return <div ref={canvasFocusRef} tabIndex={0} data-testid="pick-viewport">
      {hostAdapter.renderCanvasModeChrome?.()}
      {hostAdapter.renderHostDrawingOverlay?.({ width: 400, height: 300 })}
    </div>;
  })
}));

const base = [
  "nui 1",
  "line A = segment(start: (0, 0), end: (20, 0))",
  "line B = segment(start: (10, -10), end: (10, 10))",
  "line C = segment(start: (40, 0), end: (60, 0))"
].join("\n");
const inserted = (header: string) => base.replace("line C", `${header}\nline C`);
const generatedSource = "nui 1\nfor i in range(min: 0, max: 1, step: 1) {\n  line Mark = segment(start: (@i * 20, 0), end: (@i * 20 + 10, 0))\n  move @Mark as shifted(from: (0, 0), to: (5, 0))\n  reverse ()\n}";
const binary = process.env.NUINUICAD_RUST_EVALUATION_BINARY ?? resolve(process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target", "debug/evaluation_stdio");
const send = async (data: ExtensionToVscodeMessage) => act(async () => {
  window.dispatchEvent(new MessageEvent("message", { data }));
  await Promise.resolve();
});
const changeSource = (sourceText: string, mode: string, documentVersion = 2) => send(mode === "warm"
  ? { type: "commitText", sourceText, documentVersion, reason: "edit" }
  : { type: "replaceTextDocument", sourceText, documentVersion });
const apiFor = (holdCandidate = false, holdEmpty = false) => {
  const held: (() => void)[] = [];
  const api = {
    held,
    flush: () => held.splice(0).forEach(respond => respond()),
    postMessage: vi.fn((message: VscodeToExtensionMessage) => {
      if (message.type !== "rustEvaluationRequest") return;
      const response = JSON.parse(execFileSync(binary, [], {
        encoding: "utf8", timeout: 10_000,
        input: `${JSON.stringify({ id: message.id, input: message.input })}\n`
      }));
      const respond = () => window.dispatchEvent(new MessageEvent("message", {
        data: { type: "rustEvaluationResponse", id: response.id, payload: response.payload }
      }));
      const count = (message.input as EvaluateDocumentInput).elements.length;
      if ((holdCandidate && count === 3) || (holdEmpty && count === 0)) {
        holdCandidate = false;
        holdEmpty = false;
        held.push(respond);
      } else queueMicrotask(respond);
    })
  };
  setVscodeWebviewApi(api);
  return api;
};
const requestFor = (sourceText: string, documentVersion = 2, operation = "reverse") => {
  const compiled = compileFreshCanonicalText(sourceText).currentCompiled;
  const source = compiled.spans.sourceMap;
  const normalizedSourceOffset = sourceText.indexOf(`${operation} `) + operation.length + 1;
  const target = queryDslReferencePickTarget({
    source: { normalizedSource: source.source, sourceRevision: source.sourceRevision },
    position: normalizedSourceOffset,
    semantic: { sourceText, sourceRevision: source.sourceRevision, compiled }
  });
  expect(target).not.toBeNull();
  const targetProof = referencePickTargetProofFor(sourceText, target!);
  expect(targetProof).not.toBeNull();
  return {
    type: "referencePickStartRequest" as const, requestId: 1538,
    documentUri: "file:///issue1538.nui", documentVersion,
    normalizedSourceOffset, targetProof: targetProof!
  };
};
const results = (api: ReturnType<typeof apiFor>) => api.postMessage.mock.calls
  .map(([message]) => message).filter(message => message.type === "referencePickResult");
const settle = async (api: ReturnType<typeof apiFor>) => waitFor(() => {
  expect(api.postMessage.mock.calls.some(([m]) => m.type === "rustEvaluationRequest")).toBe(true);
  expect(document.querySelector("[data-testid='pick-viewport']")).not.toBeNull();
});
const pickAt = (x: number, y: number, explicitOption?: string) => {
  const point = worldToScreen({ x, y }, { width: 400, height: 300 }, useCadUiStore.getState().canvasViewport);
  fireEvent.pointerDown(document.querySelector("[data-testid='pick-viewport']")!, {
    button: 0, clientX: point.x, clientY: point.y
  });
  if (explicitOption && screen.queryByRole("listbox")) {
    const option = screen.getAllByRole("option").find(item => item.textContent?.startsWith(explicitOption));
    expect(option).toBeDefined();
    fireEvent.click(option!);
  }
};

describe("#1538 production Source → Canvas incomplete target Pick", () => {
  beforeAll(() => {
    if (!process.env.NUINUICAD_RUST_EVALUATION_BINARY) execFileSync("cargo", [
      "build", "--quiet", "--manifest-path", "rust-evaluator/Cargo.toml", "--bin", "evaluation_stdio"
    ], { timeout: 120_000, stdio: "inherit" });
  }, 125_000);

  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadUiStore.setState({ canvasViewport: { panX: 0, panY: 0, zoom: 4 } });
  });

  it("starts a completed target with the current compiled geometry (control)", async () => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    const sourceText = inserted("reverse @A()");
    await send({ type: "replaceTextDocument", sourceText, documentVersion: 2 });
    await settle(api);
    const before = api.postMessage.mock.calls.filter(([m]) => m.type === "rustEvaluationRequest").length;
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api)).toMatchObject([{ status: "started" }]));
    expect(document.querySelectorAll("[data-reference-pick-visuals] line")).toHaveLength(2);
    expect(api.postMessage.mock.calls.filter(([m]) => m.type === "rustEvaluationRequest")).toHaveLength(before);
  });

  it.each(["cold", "warm"])("starts %s incomplete reverse with visible, hit-testable earlier geometry", async (mode) => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    if (mode === "warm") {
      await send({ type: "replaceTextDocument", sourceText: base, documentVersion: 1 });
      await settle(api);
    }
    const sourceText = inserted("reverse ()");
    await changeSource(sourceText, mode);
    const state = useCadDocumentStore.getState();
    expect(state.sourceUpdate.kind).toBe(mode === "warm" ? "editor" : "reset");
    expect(state.docText).not.toBe(sourceText);
    const before = api.postMessage.mock.calls.filter(([m]) => m.type === "rustEvaluationRequest").length;
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api)).toMatchObject([{ status: "started" }]));
    const lines = document.querySelectorAll("[data-reference-pick-visuals] line");
    expect(lines).toHaveLength(2); // A/B only; later C must not be offered.
    const a = [...lines].find(line => line.getAttribute("y1") === line.getAttribute("y2"))!;
    const x = Number(a.getAttribute("x1")) * 0.8 + Number(a.getAttribute("x2")) * 0.2;
    const y = Number(a.getAttribute("y1")) * 0.8 + Number(a.getAttribute("y2")) * 0.2;
    fireEvent.pointerDown(document.querySelector("[data-testid='pick-viewport']")!, { button: 0, clientX: x, clientY: y });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(results(api)).toMatchObject([{ status: "started" }, { status: "confirmed", references: [{ base: "A" }] }]);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceText);
    if (mode === "warm") expect(api.postMessage.mock.calls.filter(([m]) => m.type === "rustEvaluationRequest")).toHaveLength(before);
  });

  const operations = [
    { operation: "reverse", args: "", endpoint: false, multiple: false, expected: "@A" },
    { operation: "extend", args: "to: (30, 0)", endpoint: true, multiple: false, expected: "@A.start" },
    { operation: "edge", args: "index: 0", endpoint: true, multiple: true, expected: "[@A.start, @B.end]" },
    { operation: "move", args: "from: (0, 0), to: (1, 0)", endpoint: false, multiple: true, expected: "[@A, @B]" },
    { operation: "mirrorMove", args: "axis1: (0, 0), axis2: (0, 10)", endpoint: false, multiple: true, expected: "[@A, @B]" }
  ];
  it.each(operations.flatMap(spec => ["cold", "warm"].flatMap(mode =>
    ["", "@", spec.endpoint ? "[@A.end, @]" : "[@A, @]"].map(hole => ({ ...spec, mode, hole }))
  )))("$mode $operation target '$hole': cardinality, ordered confirmation and exact patch", async spec => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    if (spec.mode === "warm") {
      await send({ type: "replaceTextDocument", sourceText: base, documentVersion: 1 });
      await settle(api);
    }
    const header = `${spec.operation} ${spec.hole} as picked(${spec.args}) // keep this comment`;
    const sourceText = inserted(header);
    await changeSource(sourceText, spec.mode);
    const request = requestFor(sourceText, 2, spec.operation);
    const before = api.postMessage.mock.calls.filter(([m]) => m.type === "rustEvaluationRequest").length;
    await send(request);
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    const started = results(api)[0]!;
    if (started.status !== "started") throw new Error("Pick did not start");
    expect(new Set(started.candidateReferences.map(ref => ref.base))).toEqual(new Set(["A", "B"]));
    expect(document.querySelectorAll("[data-reference-pick-visuals] circle").length > 0).toBe(spec.endpoint);
    pickAt(spec.endpoint ? 0 : 4, 0, spec.endpoint ? "@A.start" : undefined);
    if (spec.operation === "edge") {
      fireEvent.keyDown(window, { key: "Enter" });
      expect(results(api)).toHaveLength(1); // One endpoint cannot finish Edge.
    }
    if (spec.multiple) pickAt(10, spec.endpoint ? 10 : -5, spec.endpoint ? "@B.end" : undefined);
    fireEvent.keyDown(window, { key: "Enter" });
    const confirmed = results(api).at(-1)!;
    expect(confirmed.status).toBe("confirmed");
    if (confirmed.status !== "confirmed" || confirmed.resultKind !== "geometry") throw new Error("Pick did not confirm geometry");
    const state = useCadDocumentStore.getState();
    const plan = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: sourceText, sourceRevision: state.currentSourceRevision },
      compiled: state.currentCompiled,
      normalizedSourceOffset: request.normalizedSourceOffset,
      targetProof: request.targetProof,
      references: confirmed.references,
      allowedCandidateReferences: started.candidateReferences
    });
    expect(plan?.replacement).toBe(spec.expected);
    expect(sourceText.slice(0, plan!.range.from) + plan!.replacement + sourceText.slice(plan!.range.to))
      .toBe(inserted(`${spec.operation} ${spec.expected} as picked(${spec.args}) // keep this comment`));
    expect(state.sourceText).toBe(sourceText);
    expect(state.past).toHaveLength(spec.mode === "warm" ? 1 : 0);
    expect(api.postMessage.mock.calls.filter(([m]) => m.type === "rustEvaluationRequest")).toHaveLength(before + (spec.mode === "cold" ? 1 : 0));
  });

  it.each(["cancel", "dispose", "source", "version", "proof", "replacement"])(
    "rejects late cold candidate completion after %s", async invalidation => {
      const api = apiFor(true);
      const view = render(<VSCodeApp api={api} />);
      const sourceText = inserted("reverse ()");
      await send({ type: "replaceTextDocument", sourceText, documentVersion: 2 });
      const request = requestFor(sourceText);
      await send(request);
      await waitFor(() => expect(api.held).toHaveLength(1));
      await send({ ...request }); // Duplicate delivery must not compile/evaluate twice.
      expect(results(api)).toEqual([]);
      if (invalidation === "cancel") await send({
        type: "referencePickCancelRequest", requestId: request.requestId,
        documentUri: request.documentUri, documentVersion: request.documentVersion
      });
      else if (invalidation === "dispose") view.unmount();
      else if (invalidation === "source" || invalidation === "version") await send({
        type: "commitText", sourceText: invalidation === "source" ? base : sourceText, documentVersion: 3, reason: "edit"
      });
      else if (invalidation === "proof") await send({
        ...request, targetProof: { ...request.targetProof, oldText: "changed proof" }
      });
      else await send({ ...request, requestId: request.requestId + 1 });
      await act(async () => { api.flush(); await Promise.resolve(); });
      if (invalidation === "replacement") {
        await waitFor(() => expect(results(api)).toMatchObject([{ requestId: request.requestId + 1, status: "started" }]));
      } else {
        expect(results(api).some(result => result.status === "started")).toBe(false);
        expect(document.querySelector("[data-reference-pick-visuals]")).toBeNull();
      }
    }
  );

  it.each([
    "edge (index: )", "extend (to: )", "move (from: , to: )",
    "mirrorMove (axis1: , axis2: )", "reverse ()"
  ])("starts an actual cold template with later argument holes: %s", async header => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    const sourceText = inserted(header);
    await send({ type: "replaceTextDocument", sourceText, documentVersion: 2 });
    await send(requestFor(sourceText, 2, header.slice(0, header.indexOf(" "))));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(results(api).at(-1)).toMatchObject({ status: "canceled" });
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceText);
  });

  it.each([
    inserted("reverse ()").replace("line C", "point Bad = coordinate(x: !, y: 0)\nline C"),
    inserted("reverse ()").replace("line C", "line Bad = segment(start: @Missing, end: (0, 0))\nline C"),
    inserted("reverse (bogus: !)"),
    inserted("reverse @ as ()"),
    inserted("reverse ()\nreverse ()")
  ])("does not start for unrelated invalid Source: %s", async sourceText => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    await send({ type: "replaceTextDocument", sourceText, documentVersion: 2 });
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api).at(-1)).toMatchObject({ status: "stale" }));
    expect(document.querySelector("[data-reference-pick-visuals]")).toBeNull();
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceText);
  });

  it.each([
    {
      name: "named stage",
      sourceText: `${base}\nmove @A as shifted(from: (0, 0), to: (5, 0))\nreverse ()`,
      reference: { base: "A", pointKey: "shifted" }
    },
    {
      name: "Module-qualified geometry",
      sourceText: "nui 1\nmodule M() {\n  export line outline = segment(start: (0, 0), end: (20, 0))\n}\ninstance front = M()\nreverse ()",
      reference: { base: "front::outline" }
    },
    {
      name: "generated indexed stage in lexical scope",
      sourceText: generatedSource,
      reference: { base: "Mark", occurrenceIndex: 1, pointKey: "shifted" }
    }
  ])("projects cold $name using compiler and Rust candidate semantics", async ({ sourceText, reference }) => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    await send({ type: "replaceTextDocument", sourceText, documentVersion: 2 });
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    const started = results(api)[0]!;
    if (started.status !== "started") throw new Error("Pick did not start");
    expect(started.candidateReferences).toContainEqual(reference);
    expect(started.candidateReferences.some(item => item.pointKey?.includes("final"))).toBe(false);
    expect(document.querySelector("[data-reference-pick-visuals] line")).not.toBeNull();
    pickAt(8, 0);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(results(api).at(-1)).toMatchObject({ status: "confirmed", references: [{ base: reference.base }] });
  });

  it("renders completed generated target candidates even when normal Canvas hides generated rows", async () => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    const sourceText = generatedSource.replace("reverse ()", "reverse @Mark[1].shifted()");
    await send({ type: "replaceTextDocument", sourceText, documentVersion: 2 });
    await settle(api);
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    expect(document.querySelector("[data-reference-pick-visuals] line")).not.toBeNull();
  });

  it("clears active transient geometry on a version change and preserves authoritative Undo/Redo", async () => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    const sourceText = inserted("reverse ()");
    await send({ type: "replaceTextDocument", sourceText, documentVersion: 2 });
    const request = requestFor(sourceText);
    await send(request);
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    const evaluations = api.postMessage.mock.calls.filter(([m]) => m.type === "rustEvaluationRequest").length;
    await send({ ...request });
    expect(results(api)).toHaveLength(1);
    expect(api.postMessage.mock.calls.filter(([m]) => m.type === "rustEvaluationRequest")).toHaveLength(evaluations);
    const complete = sourceText.replace("reverse ()", "reverse @A()");
    await changeSource(complete, "warm", 3);
    expect(document.querySelector("[data-reference-pick-visuals]")).toBeNull();
    await send({ type: "commitText", sourceText, documentVersion: 4, reason: "undo" });
    expect(useCadDocumentStore.getState().currentCompiled.spans.sourceMap.source).toBe(sourceText);
    await send({ type: "commitText", sourceText: complete, documentVersion: 5, reason: "redo" });
    expect(useCadDocumentStore.getState().currentCompiled.spans.sourceMap.source).toBe(complete);
    expect(useCadDocumentStore.getState().sourceText).toBe(complete);
    expect(results(api)).toHaveLength(1);
  });

  it("derives cold authority independently of an unrelated previously rendered sample", async () => {
    const api = apiFor(false, true);
    render(<VSCodeApp api={api} />);
    await send({ type: "replaceTextDocument", sourceText: base.replaceAll("A", "WrongA").replaceAll("B", "WrongB"), documentVersion: 1 });
    await settle(api);
    const sourceText = inserted("reverse ()");
    await send({ type: "replaceTextDocument", sourceText, documentVersion: 2 });
    await waitFor(() => expect(api.held).toHaveLength(1));
    await send(requestFor(sourceText));
    await act(async () => { api.flush(); await Promise.resolve(); });
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    const started = results(api)[0]!;
    if (started.status !== "started") throw new Error("Pick did not start");
    expect(new Set(started.candidateReferences.map(item => item.base))).toEqual(new Set(["A", "B"]));
    expect(document.querySelectorAll("[data-reference-pick-visuals] line")).toHaveLength(2);
  });
});
