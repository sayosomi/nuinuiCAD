import { forwardRef, useImperativeHandle } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildEvaluationOptions } from "../geometry/productionEvaluationContext";
import { canUseRustEvaluationForElements } from "../geometry/rustEvaluationEligibility";
import { evaluateElementsReference } from "../geometry/evaluationEngine";
import { compileFreshCanonicalText } from "@nuinuicad/nui-language/document";
import { queryDslReferencePickTarget } from "@nuinuicad/nui-language";
import type { DrawingCanvasHandle } from "../components/DrawingCanvas";
import type { CanvasHostAdapter } from "../components/canvasHostAdapter";
import type { RefObject } from "react";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { referencePickSourceForReference, referencePickTargetProofFor } from "./referencePickProtocol";
import { planVscodeReferencePickSourceEdit } from "./referencePickSourceEdit";
import { worldToScreen } from "../geometry/viewport";
import type { EvaluateDocumentInput } from "../geometry/rustEvaluationInput";
import type { ExtensionToVscodeMessage, VscodeToExtensionMessage } from "./protocol";
import { VSCodeApp } from "./VSCodeApp";
import { setVscodeWebviewApi } from "./vscodeWebviewApiContext";
import * as canvasRevisionPresentation from "../components/canvasRevisionPresentation";
import * as candidateProjection from "./referencePickCandidateProjection";

// Keep the production App, Store, Canvas, Pick hook and overlay. Replace only
// the shared drawing surface/layout; pointer events still hit the real overlay.
vi.mock("../components/DrawingCanvas", () => ({
  DrawingCanvas: forwardRef<DrawingCanvasHandle, {
    hostAdapter: CanvasHostAdapter;
    canvasFocusRef: RefObject<HTMLDivElement | null>;
  }>(({ hostAdapter, canvasFocusRef }, ref) => {
    useImperativeHandle(ref, () => ({ finalizeCanvasInteraction: () => undefined } as DrawingCanvasHandle));
    return <div ref={canvasFocusRef} tabIndex={0} data-testid="pick-viewport">
      {hostAdapter.renderCanvasModeChrome?.()}
      {hostAdapter.renderHostDrawingOverlay?.({ width: 400, height: 300 })}
      {hostAdapter.renderHostOverlay?.({ width: 400, height: 300 })}
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
const generatedPresentationSource = [
  "nui 1",
  "for i in range(min: 0, max: 2, step: 1, showGenerated: false) {",
  "  line Mark = segment(start: (@i * 80 + 10, @i * 60 + 12), end: (@i * 80 + 22, @i * 60 + 12))",
  "  move @Mark as shifted(from: (0, 0), to: (35, 24))",
  "  reverse ()",
  "}",
].join("\n");
const binary = process.env.NUINUICAD_RUST_EVALUATION_BINARY ?? resolve(process.env.CARGO_TARGET_DIR ?? "rust-evaluator/target", "debug/evaluation_stdio");
const send = async (data: ExtensionToVscodeMessage) => act(async () => {
  window.dispatchEvent(new MessageEvent("message", { data }));
  await Promise.resolve();
});
const changeSource = (sourceText: string, mode: string, documentVersion = 2) => send(mode === "warm"
  ? { type: "commitText", sourceText, documentVersion, reason: "edit" }
  : { type: "replaceTextDocument", sourceText, documentVersion });
const apiFor = (holdCandidate = false, holdEmpty = false, candidateReply?: "transport-error" | "decode-error" | "different",
  holdRequest?: (message: Extract<VscodeToExtensionMessage, { type: "rustEvaluationRequest" }>) => boolean) => {
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
      const count = (message.input as EvaluateDocumentInput).elements.length;
      const candidate = count === 3 && candidateReply;
      const data = candidate === "transport-error"
        ? { type: "rustEvaluationError", id: response.id, error: "candidate transport failed" }
        : { type: "rustEvaluationResponse", id: response.id, payload: candidate === "decode-error"
          ? { ...response.payload, computedScalarBindings: [{ bindingId: "bad", evaluation: { status: "invalid" } }] }
          : candidate === "different" ? { ...response.payload, computedGeometry: [] } : response.payload };
      const respond = () => window.dispatchEvent(new MessageEvent("message", { data }));
      if (holdRequest?.(message) || (holdCandidate && count === 3) || (holdEmpty && count === 0)) {
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
    const option = screen.getAllByRole("option").find(item => item.querySelector("strong")?.textContent === explicitOption);
    expect(option).toBeDefined();
    fireEvent.click(option!);
  }
};

describe("#1538 production Source → Canvas incomplete target Pick", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
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

  it.each(["completed", "inserted"].flatMap(transition =>
    ["none", "empty", "generated"].flatMap(prior =>
      ["pending", "ready"].map(delivery => ({ transition, delivery, prior })))
  ))("warm generated $transition → incomplete with $delivery Rust delivery, prior=$prior", async ({ transition, delivery, prior }) => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    const observations: {
      source: string | undefined;
      state: Parameters<typeof canvasRevisionPresentation.useRevisionCoherentCanvasPresentation>[0]["evaluationState"];
      presentation: ReturnType<typeof canvasRevisionPresentation.useRevisionCoherentCanvasPresentation>;
    }[] = [];
    const usePresentation = canvasRevisionPresentation.useRevisionCoherentCanvasPresentation;
    vi.spyOn(canvasRevisionPresentation, "useRevisionCoherentCanvasPresentation").mockImplementation(input => {
      const presentation = usePresentation(input);
      observations.push({ source: input.current.compiledDocument?.spans.sourceMap.source, state: input.evaluationState, presentation });
      return presentation;
    });
    const projection = vi.spyOn(candidateProjection, "projectIncompleteReferencePickCandidate");
    let hold = prior === "none";
    const api = apiFor(false, false, undefined, () => hold);
    render(<VSCodeApp api={api} />);
    const valid = transition === "completed"
      ? generatedSource.replace("reverse ()", "reverse @Mark[1].shifted()")
      : generatedSource.replace("  reverse ()\n", "");
    if (prior === "generated") await send({ type: "replaceTextDocument", sourceText: `${valid}\n// accepted baseline`, documentVersion: 0 });
    if (prior === "empty") await send({ type: "replaceTextDocument", sourceText: "nui 1", documentVersion: 0 });
    if (prior !== "none") {
      await waitFor(() => expect(observations.at(-1)!.state?.status).toBe("ready"));
      expect(observations.at(-1)!.presentation.renderEvaluation.computedGeometry.size).toBe(prior === "generated" ? 2 : 0);
      hold = true;
    }
    await send(prior === "generated"
      ? { type: "commitText", sourceText: valid, documentVersion: 1, reason: "edit" }
      : { type: "replaceTextDocument", sourceText: valid, documentVersion: 1 });
    await waitFor(() => expect(api.held.length).toBeGreaterThan(0));
    // Drain only the startup request. The same single-flight production
    // transport now sends (and holds) the generated baseline request.
    if (prior === "none") await act(async () => { api.flush(); });
    expect(api.held).toHaveLength(1);
    const baselineRequest = api.postMessage.mock.calls.map(([message]) => message)
      .filter(message => message.type === "rustEvaluationRequest").at(-1)!;
    expect((baselineRequest.input as EvaluateDocumentInput).elements).not.toHaveLength(0);
    const pending = observations.at(-1)!;
    expect(pending.source).toBe(valid);
    expect(pending.state).toMatchObject({ source: "rust", status: "evaluating", isStale: prior !== "none" });
    expect(pending.state!.evaluation.computedGeometry.size).toBe(prior === "generated" ? 2 : 0);
    // First incorrect boundary on Base: the actual mounted Canvas publishes
    // and retains this unevaluated placeholder as a coherent stable snapshot.
    if (delivery === "pending") expect.soft(pending.presentation.hasCoherentSnapshot).toBe(prior !== "none");
    hold = false;
    if (delivery === "ready") {
      await act(async () => { api.flush(); });
      await waitFor(() => expect(observations.at(-1)!.state?.status).toBe("ready"));
      expect(observations.at(-1)!.presentation.renderEvaluation.computedGeometry.size).toBe(2);
    }
    await changeSource(generatedSource, "warm", 2);
    expect(useCadDocumentStore.getState().sourceUpdate.kind).toBe("editor");
    const pinned = observations.at(-1)!.presentation;
    expect(pinned.isPinned).toBe(true);
    if (delivery === "pending") expect.soft(pinned.hasCoherentSnapshot).toBe(prior !== "none");
    const request = requestFor(generatedSource);
    await send(request);
    if (delivery === "pending") {
      if (prior !== "generated") expect.soft(results(api)).toEqual([]);
      await act(async () => { api.flush(); });
    }
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    const started = results(api)[0]!;
    if (started.status !== "started") throw new Error("Pick did not start");
    expect.soft(started.candidateReferences).toContainEqual({ base: "Mark", occurrenceIndex: 1, pointKey: "shifted" });
    expect.soft(document.querySelectorAll("[data-reference-pick-visuals] line")).toHaveLength(2);
    expect.soft(projection).toHaveBeenCalledTimes(delivery === "pending" && prior !== "generated" ? 1 : 0);

    const viewport = screen.getByTestId("pick-viewport");
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 300 } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: /Fit the drawing|描画全体を表示/ }));
    // Independently known world bounds are (5,0)–(35,0). Assert the shared
    // command's exact viewport and both occurrences' screen-space endpoints.
    const fitted = useCadUiStore.getState().canvasViewport;
    expect(fitted).toEqual({ zoom: 11.2, panX: -224, panY: 0 });
    const lines = [...document.querySelectorAll("[data-reference-pick-visuals] line")];
    for (const line of lines) {
      for (const attr of ["x1", "x2"]) {
        expect(Number(line.getAttribute(attr))).toBeGreaterThanOrEqual(32);
        expect(Number(line.getAttribute(attr))).toBeLessThanOrEqual(368);
      }
      expect(Number(line.getAttribute("y1"))).toBe(150);
      expect(Number(line.getAttribute("y2"))).toBe(150);
    }
    pickAt(8, 0);
    expect(screen.getByRole("listbox")).toBeInTheDocument(); // First occurrence is hittable too.
    fireEvent.keyDown(window, { key: "Escape" });
    pickAt(28, 0);
    const option = screen.getAllByRole("option").find(item => item.querySelector("strong")?.textContent === "@Mark[1].shifted")!;
    expect(option).toBeDefined();
    if (transition === "completed") fireEvent.click(option);
    else {
      fireEvent.keyDown(window, { key: "ArrowUp" });
      fireEvent.keyDown(window, { key: "Enter" });
    }
    fireEvent.keyDown(window, { key: "Enter" });
    const confirmed = results(api).at(-1)!;
    expect(confirmed).toMatchObject({ status: "confirmed", references: [{ base: "Mark", occurrenceIndex: 1, pointKey: "shifted" }] });
    if (confirmed.status !== "confirmed" || confirmed.resultKind !== "geometry") throw new Error("Pick did not confirm");
    const state = useCadDocumentStore.getState();
    const plan = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: generatedSource, sourceRevision: state.currentSourceRevision },
      compiled: state.currentCompiled, normalizedSourceOffset: request.normalizedSourceOffset,
      targetProof: request.targetProof, references: confirmed.references, allowedCandidateReferences: started.candidateReferences
    })!;
    const complete = generatedSource.slice(0, plan.range.from) + plan.replacement + generatedSource.slice(plan.range.to);
    expect(complete).toBe(generatedSource.replace("reverse ()", "reverse @Mark[1].shifted()"));
    expect(state.sourceText).toBe(generatedSource);
    await changeSource(complete, "warm", 3);
    await send({ type: "commitText", sourceText: generatedSource, documentVersion: 4, reason: "undo" });
    expect(useCadDocumentStore.getState().sourceText).toBe(generatedSource);
    await send({ type: "commitText", sourceText: complete, documentVersion: 5, reason: "redo" });
    expect(useCadDocumentStore.getState().sourceText).toBe(complete);
    expect(results(api)).toHaveLength(2);
  });

  it.each(["cold", "warm"])("#1538 A: %s partial target retains A when only B is selected", async mode => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    if (mode === "warm") {
      await send({ type: "replaceTextDocument", sourceText: base, documentVersion: 1 });
      await settle(api);
    }
    const sourceText = inserted("move [@A, @] as picked(from: (0, 0), to: (1, 0)) // keep");
    await changeSource(sourceText, mode);
    const request = requestFor(sourceText, 2, "move");
    await send(request);
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    expect(screen.getByText("@A")).toBeInTheDocument();
    pickAt(10, -5, "@B");
    fireEvent.keyDown(window, { key: "Enter" });
    const confirmed = results(api).at(-1)!;
    expect(confirmed).toMatchObject({ status: "confirmed", references: [{ base: "A" }, { base: "B" }] });
    if (confirmed.status !== "confirmed" || confirmed.resultKind !== "geometry") throw new Error("Pick did not confirm");
    const started = results(api)[0]!;
    if (started.status !== "started") throw new Error("Pick did not start");
    const state = useCadDocumentStore.getState();
    const plan = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: sourceText, sourceRevision: state.currentSourceRevision },
      compiled: state.currentCompiled, normalizedSourceOffset: request.normalizedSourceOffset,
      targetProof: request.targetProof, references: confirmed.references,
      allowedCandidateReferences: started.candidateReferences
    });
    expect(sourceText.slice(0, plan!.range.from) + plan!.replacement + sourceText.slice(plan!.range.to))
      .toBe(sourceText.replace("[@A, @]", "[@A, @B]"));
    expect(state.sourceText).toBe(sourceText);
  });

  it.each(["pointer", "keyboard"])("#1559: keeps the hit occurrence primary when selecting by %s", async input => {
    useCadUiStore.setState({ showCanvasGeometryNames: input === "keyboard" });
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    await changeSource(generatedSource, "cold");
    await send(requestFor(generatedSource));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    pickAt(28, 0);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    const labels = screen.getAllByRole("option").map(option => option.querySelector("strong")!.textContent);
    expect(labels).toEqual(["@Mark[1]", "@Mark[1].shifted"]);
    const disclosure = screen.getByRole("button", { name: "Other candidates / Details" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(results(api)).toHaveLength(1); // Hidden legal alternatives never auto-select.
    if (input === "pointer") fireEvent.click(disclosure);
    else fireEvent.keyDown(disclosure, { key: "Enter" });
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("option").map(option => option.querySelector("strong")!.textContent)).toEqual([
      "@Mark[1]",
      "@Mark[1].shifted",
      "@Mark[1].base",
      "@Mark",
      "@Mark.shifted",
      "@Mark.base"
    ]);
    expect(results(api)).toHaveLength(1);
    if (input === "pointer") fireEvent.click(disclosure);
    else fireEvent.keyDown(disclosure, { key: " " });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    if (input === "pointer") fireEvent.click(screen.getAllByRole("option")[1]!);
    else {
      fireEvent.keyDown(window, { key: "ArrowUp" });
      fireEvent.keyDown(window, { key: "Enter" });
    }
    expect(results(api)).toHaveLength(1); // Choosing an option does not finish Pick.
    fireEvent.keyDown(window, { key: "Enter" });
    expect(results(api).at(-1)).toMatchObject({ status: "confirmed", references: [{ base: "Mark", occurrenceIndex: 1, pointKey: "shifted" }] });
    const confirmed = results(api).at(-1)!;
    const started = results(api)[0]!;
    if (confirmed.status !== "confirmed" || confirmed.resultKind !== "geometry" || started.status !== "started") throw new Error("Pick did not confirm");
    const state = useCadDocumentStore.getState();
    const request = requestFor(generatedSource);
    const plan = planVscodeReferencePickSourceEdit({
      source: { normalizedSource: generatedSource, sourceRevision: state.currentSourceRevision },
      compiled: state.currentCompiled, normalizedSourceOffset: request.normalizedSourceOffset,
      targetProof: request.targetProof, references: confirmed.references,
      allowedCandidateReferences: started.candidateReferences
    });
    const completed = generatedSource.slice(0, plan!.range.from) + plan!.replacement + generatedSource.slice(plan!.range.to);
    expect(completed).toBe(generatedSource.replace("reverse ()", "reverse @Mark[1].shifted()"));
    await changeSource(completed, "warm", 3);
    expect(useCadDocumentStore.getState().diagnostics.filter(item => item.severity === "error")).toEqual([]);
    await send({ type: "commitText", sourceText: generatedSource, documentVersion: 4, reason: "undo" });
    expect(useCadDocumentStore.getState().sourceText).toBe(generatedSource);
    await send({ type: "commitText", sourceText: completed, documentVersion: 5, reason: "redo" });
    expect(useCadDocumentStore.getState().sourceText).toBe(completed);
  });

  it.each(["[@Missing, @]", "[@C, @]", "[@A.final, @]", "[@A..bad, @]", "[@A, @, @]", "[@A,, @]"])(
    "#1538 A: refuses malformed or unauthorized authored prefixes %s", async list => {
      const api = apiFor();
      render(<VSCodeApp api={api} />);
      const sourceText = inserted(`move ${list}(from: (0, 0), to: (1, 0))`);
      await changeSource(sourceText, "cold");
      await send(requestFor(sourceText, 2, "move"));
      await waitFor(() => expect(results(api).at(-1)?.status).toMatch(/rejected|stale/));
      expect(document.querySelector("[data-reference-pick-visuals]")).toBeNull();
      expect(useCadDocumentStore.getState().sourceText).toBe(sourceText);
    }
  );

  it("#1538 C: Fit frames real transient generated candidates and normal Fit resumes after cancel", async () => {
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    const sourceText = generatedSource.replaceAll("@i * 20", "1000 + @i * 20");
    await changeSource(sourceText, "cold");
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    const lines = () => [...document.querySelectorAll("[data-reference-pick-visuals] line")];
    expect(lines()).toHaveLength(2); // Real Rust candidate geometry exists.
    expect(lines().every(line => Number(line.getAttribute("x1")) > 400)).toBe(true);
    const viewport = document.querySelector("[data-testid='pick-viewport']")!;
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 400, height: 300 } as DOMRect);
    const fit = screen.getByRole("button", { name: /Fit the drawing|描画全体を表示/ });
    fireEvent.click(fit);
    for (const line of lines()) {
      for (const attr of ["x1", "x2"]) expect(Number(line.getAttribute(attr))).toBeGreaterThanOrEqual(32);
      for (const attr of ["x1", "x2"]) expect(Number(line.getAttribute(attr))).toBeLessThanOrEqual(368);
      for (const attr of ["y1", "y2"]) expect(Number(line.getAttribute(attr))).toBeGreaterThanOrEqual(32);
      for (const attr of ["y1", "y2"]) expect(Number(line.getAttribute(attr))).toBeLessThanOrEqual(268);
    }
    const line = lines()[1]!;
    fireEvent.pointerDown(viewport, { button: 0,
      clientX: (Number(line.getAttribute("x1")) + Number(line.getAttribute("x2"))) / 2,
      clientY: Number(line.getAttribute("y1")) });
    expect(screen.getByRole("listbox")).toBeInTheDocument(); // Real geometry hit after Fit.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(results(api)).toHaveLength(1);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(results(api).at(-1)).toMatchObject({ status: "canceled" });
    expect(lines()).toHaveLength(0);
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceText);
    const afterCancel = { ...useCadUiStore.getState().canvasViewport };
    fireEvent.click(fit);
    expect(useCadUiStore.getState().canvasViewport).toEqual(afterCancel); // Ordinary hidden generated rows have no bounds.
    await changeSource(base, "warm", 3);
    await settle(api);
    fireEvent.click(screen.getByRole("button", { name: /Fit the drawing|描画全体を表示/ }));
    expect(useCadUiStore.getState().canvasViewport).toEqual({ zoom: 5.6, panX: -168, panY: 0 });
  });

  it("MEDIUM-01: cold reference-mode Pick renders and hit-tests with zero Rust requests", async () => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", "reference");
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    const sourceText = inserted("reverse ()");
    await changeSource(sourceText, "cold");
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    expect(document.querySelectorAll("[data-reference-pick-visuals] line")).toHaveLength(2);
    expect(api.postMessage.mock.calls.filter(([message]) => message.type === "rustEvaluationRequest")).toHaveLength(0);
    pickAt(4, 0, "@A");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(results(api).at(-1)).toMatchObject({ status: "confirmed", references: [{ base: "A" }] });
  });

  it("MEDIUM-01: routes a compiler-valid disabled unavailable operand through reference evaluation", async () => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    // Disabled geometry is not evaluated. The compiler reports the unavailable
    // operand as a warning; the real reference evaluation has no errors, while
    // Rust eligibility correctly rejects its unavailable input reference.
    const sourceText = inserted("reverse ()").replace("line C", "line Disabled = segment(start: @Missing, end: (1, 0), enabled: false)\nline C");
    const candidateText = sourceText.replace("reverse ()", "");
    const canonical = compileFreshCanonicalText(candidateText);
    expect(canonical.status).toBe("warning");
    expect(canonical.docText).toBe(candidateText);
    expect(canonical.diagnostics).toEqual([expect.objectContaining({ severity: "warning", code: "undefined-geometry-reference" })]);
    const compiled = canonical.doc;
    const options = buildEvaluationOptions({ compiledDocument: compiled, evaluationLimitIndex: undefined });
    expect(evaluateElementsReference(compiled.document.elements, options).errors).toEqual([]);
    expect(canUseRustEvaluationForElements(compiled.document.elements, options)).toBe(false);
    const api = apiFor();
    render(<VSCodeApp api={api} />);
    await changeSource(sourceText, "cold");
    const before = api.postMessage.mock.calls.filter(([message]) => message.type === "rustEvaluationRequest").length;
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    const started = results(api)[0]!;
    if (started.status !== "started") throw new Error("Pick did not start");
    expect(new Set(started.candidateReferences.map(item => item.base))).toEqual(new Set(["A", "B"]));
    expect(document.querySelectorAll("[data-reference-pick-visuals] line")).toHaveLength(2);
    expect(api.postMessage.mock.calls.filter(([message]) => message.type === "rustEvaluationRequest")).toHaveLength(before);
    pickAt(4, 0, "@A");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(results(api).at(-1)).toMatchObject({ status: "confirmed", references: [{ base: "A" }] });
  });

  it.each(["parity", "shadow"])("MEDIUM-01: cold %s Pick uses reference geometry after comparing Rust", async mode => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", mode);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const api = apiFor(false, false, "different");
    render(<VSCodeApp api={api} />);
    const sourceText = inserted("reverse ()");
    await changeSource(sourceText, "cold");
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));
    expect(warn).toHaveBeenCalledWith("Rust evaluation differs from the TypeScript reference evaluation.", expect.any(Object));
    expect(document.querySelectorAll("[data-reference-pick-visuals] line")).toHaveLength(2);
    pickAt(4, 0, "@A");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(results(api).at(-1)).toMatchObject({ status: "confirmed", references: [{ base: "A" }] });
  });

  it.each([
    { scalar: false, reply: "transport-error" as const, expected: "started" },
    { scalar: true, reply: "transport-error" as const, expected: "stale" },
    { scalar: false, reply: "decode-error" as const, expected: "stale" }
  ])("MEDIUM-01: cold Rust $reply with scalar=$scalar preserves $expected policy", async ({ scalar, reply, expected }) => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const api = apiFor(false, false, reply);
    render(<VSCodeApp api={api} />);
    const sourceText = scalar
      ? inserted("reverse ()").replace("line A", "const extent: number = 20\nline A").replace("end: (20, 0)", "end: (@extent, 0)")
      : inserted("reverse ()");
    await changeSource(sourceText, "cold");
    await send(requestFor(sourceText));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: expected }));
    if (expected === "started") {
      expect(document.querySelectorAll("[data-reference-pick-visuals] line")).toHaveLength(2);
      pickAt(4, 0, "@A");
      fireEvent.keyDown(window, { key: "Enter" });
      expect(results(api).at(-1)).toMatchObject({ status: "confirmed", references: [{ base: "A" }] });
    } else expect(document.querySelector("[data-reference-pick-visuals]")).toBeNull();
    expect(useCadDocumentStore.getState().sourceText).toBe(sourceText);
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
    fireEvent.click(screen.getAllByRole("option").find(option => option.querySelector("strong")?.textContent === "@A")!);
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
    if (spec.multiple && spec.hole.startsWith("[")) expect(screen.getByText(spec.endpoint ? "@A.end" : "@A")).toBeInTheDocument();
    if (!spec.hole.startsWith("[") || !spec.multiple) pickAt(spec.endpoint ? 0 : 4, 0, spec.endpoint ? "@A.start" : "@A");
    if (spec.operation === "edge") {
      fireEvent.keyDown(window, { key: "Enter" });
      expect(results(api)).toHaveLength(1); // One endpoint cannot finish Edge.
    }
    if (spec.multiple) pickAt(10, spec.endpoint ? 10 : -5, spec.endpoint ? "@B.end" : "@B");
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
    const expected = spec.hole.startsWith("[") && spec.operation === "edge" ? "[@A.end, @B.end]" : spec.expected;
    expect(plan?.replacement).toBe(expected);
    expect(sourceText.slice(0, plan!.range.from) + plan!.replacement + sourceText.slice(plan!.range.to))
      .toBe(inserted(`${spec.operation} ${expected} as picked(${spec.args}) // keep this comment`));
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

  it.each(["completed", "inserted"].flatMap(transition =>
    ["cancel", "dispose", "source", "version", "proof", "replacement"].map(invalidation => ({ transition, invalidation }))
  ))("warm generated $transition ignores delayed replies after $invalidation", async ({ transition, invalidation }) => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    let hold = true;
    const api = apiFor(false, false, undefined, () => hold);
    const view = render(<VSCodeApp api={api} />);
    const valid = transition === "completed"
      ? generatedSource.replace("reverse ()", "reverse @Mark[1].shifted()")
      : generatedSource.replace("  reverse ()\n", "");
    await send({ type: "replaceTextDocument", sourceText: valid, documentVersion: 1 });
    await act(async () => { api.flush(); }); // Baseline response is now in flight.
    expect(api.held).toHaveLength(1);
    await changeSource(generatedSource, "warm");
    const request = requestFor(generatedSource);
    await send(request);
    const calls = api.postMessage.mock.calls.length;
    await send({ ...request });
    expect(api.postMessage.mock.calls).toHaveLength(calls);
    expect(results(api)).toEqual([]);
    if (invalidation === "cancel") await send({ type: "referencePickCancelRequest",
      requestId: request.requestId, documentUri: request.documentUri, documentVersion: request.documentVersion });
    else if (invalidation === "dispose") view.unmount();
    else if (invalidation === "source" || invalidation === "version") await send({
      type: "commitText", sourceText: invalidation === "source" ? valid : generatedSource, documentVersion: 3, reason: "edit"
    });
    else if (invalidation === "proof") await send({ ...request, targetProof: { ...request.targetProof, oldText: "changed proof" } });
    else await send({ ...request, requestId: request.requestId + 1 });
    hold = false;
    await act(async () => { api.flush(); });
    if (invalidation === "replacement") {
      await waitFor(() => expect(results(api)).toMatchObject([{ requestId: request.requestId + 1, status: "started" }]));
      expect(document.querySelectorAll("[data-reference-pick-visuals] line")).toHaveLength(2);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(results(api).at(-1)).toMatchObject({ status: "canceled" });
    } else {
      expect(results(api).some(result => result.status === "started")).toBe(false);
      expect(document.querySelector("[data-reference-pick-visuals]")).toBeNull();
    }
    if (invalidation !== "dispose") expect(useCadDocumentStore.getState().sourceText).toBe(invalidation === "source" ? valid : generatedSource);
  });

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
      name: "nested branch",
      sourceText: `${base}\nmove @A as shifted(from: (0, 0), to: (5, 0))\nmove @A.shifted as branch(from: (0, 0), to: (2, 0))\nreverse ()`,
      reference: { base: "A", pointKey: "shifted.branch" }
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
    pickAt("occurrenceIndex" in reference ? 28 : 8, 0, referencePickSourceForReference(reference));
    fireEvent.keyDown(window, { key: "Enter" });
    expect(results(api).at(-1)).toMatchObject({ status: "confirmed", references: [reference] });
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

  it("presents hidden generated Pick candidates and names legibly after Fit, then clears them on cancel", async () => {
    const api = apiFor();
    useCadUiStore.setState({ showCanvasGeometryNames: true });
    render(<VSCodeApp api={api} />);
    await changeSource(generatedPresentationSource, "cold");
    await settle(api);
    await send(requestFor(generatedPresentationSource));
    await waitFor(() => expect(results(api)[0]).toMatchObject({ status: "started" }));

    const lines = () => [...document.querySelectorAll("[data-reference-pick-visuals] line")];
    const labels = () => [...document.querySelectorAll("[data-reference-pick-geometry-identity]")];
    expect(lines()).toHaveLength(3);
    expect(labels().map((label) => label.textContent)).toEqual([
      "[i=0] Mark", "[i=1] Mark", "[i=2] Mark"
    ]);
    expect(labels().every((label) => (label as SVGTextElement).style.pointerEvents === "none")).toBe(true);
    expect(lines().every((line) => line.getAttribute("opacity") === "1")).toBe(true);

    const viewport = screen.getByTestId("pick-viewport");
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
      left: 0, top: 0, width: 400, height: 300
    } as DOMRect);
    fireEvent.click(screen.getByRole("button", { name: /Fit the drawing|描画全体を表示/ }));
    for (const line of lines()) {
      for (const attr of ["x1", "x2"]) {
        expect(Number(line.getAttribute(attr))).toBeGreaterThanOrEqual(32);
        expect(Number(line.getAttribute(attr))).toBeLessThanOrEqual(368);
      }
      for (const attr of ["y1", "y2"]) {
        expect(Number(line.getAttribute(attr))).toBeGreaterThanOrEqual(32);
        expect(Number(line.getAttribute(attr))).toBeLessThanOrEqual(268);
      }
    }

    const candidate = lines()[0]!;
    fireEvent.pointerDown(viewport, {
      button: 0,
      clientX: (Number(candidate.getAttribute("x1")) + Number(candidate.getAttribute("x2"))) / 2,
      clientY: (Number(candidate.getAttribute("y1")) + Number(candidate.getAttribute("y2"))) / 2
    });
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(results(api).at(-1)).toMatchObject({ status: "canceled" });
    expect(labels()).toHaveLength(0);
    expect(useCadDocumentStore.getState().sourceText).toBe(generatedPresentationSource);
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
