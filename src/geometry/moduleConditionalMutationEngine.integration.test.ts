import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { evaluateElementsReferencePayload } from "./evaluationEngine";
import { useEvaluationEngine } from "./useEvaluationEngine";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

const source = [
  "nui 3",
  "point Outside = coordinate(x: 0, y: 0)",
  "module M() {",
  "  let value: number = 0",
  "  if Condition (false) {",
  "    set value = 1",
  "  }",
  "}",
  "module I = M()"
].join("\n");

afterEach(() => {
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.unstubAllEnvs();
  invokeMock.mockReset();
});

describe("Module conditional mutation evaluation engine", () => {
  it("forwards qualified Module conditional owners into the Rust payload", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", { configurable: true, value: {} });
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 3), source);
    expect(compiled.status).toBe("valid");
    const document = compiled.doc;
    const owners = document.moduleConditionalOwnerStatementIdByElementId;
    expect(owners?.size).toBe(1);
    const options = {
      bindingVersions: document.bindingVersions,
      statementInfoByElementId: document.statementMap.byElementId,
      statementIdByStatementIndex: document.statementMap.statementIdByStatementIndex,
      sourceExecutionPositionByElementId: document.moduleMaterialization?.sourceExecutionPositionByRuntimeElementId,
      scalarExecutionPositionByElementId: document.scalarExecutionPositionByRuntimeElementId,
      conditionalOwnerStatementIdByElementId: owners,
      moduleConditionalOwnerStatementIdByElementId: owners
    };
    invokeMock.mockResolvedValue(evaluateElementsReferencePayload(document.document.elements));

    const { result } = renderHook(() => useEvaluationEngine(document.document.elements, options));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(invokeMock).toHaveBeenCalledWith("evaluate_document", {
      input: expect.objectContaining({
        bindingVersions: expect.objectContaining({
          conditionalOwners: expect.arrayContaining(
            [...owners!].map(([elementId, ownerStatementId]) => ({ elementId, ownerStatementId }))
          )
        })
      })
    });
  });
});
