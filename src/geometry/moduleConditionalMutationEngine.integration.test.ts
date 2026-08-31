import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compileCanonicalText, regenerateCanonicalFromModel } from "../document/canonicalDocument";
import { emptyDocument } from "../dsl/dslDocumentTestUtils";
import { evaluateElementsReferencePayload } from "./evaluationEngine";
import type { RustEvaluationTransport } from "./rustEvaluationRunner";
import { useEvaluationEngine } from "./useEvaluationEngine";

const source = [
  "nui 1",
  "point Outside = coordinate(x: 0, y: 0)",
  "module M() {",
  "  let value: number = 0",
  "  if (false) {",
  "    set value = 1",
  "  }",
  "}",
  "instance I = M()"
].join("\n");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Module conditional mutation evaluation engine", () => {
  it("forwards qualified Module conditional owners into the Rust payload", async () => {
    vi.stubEnv("VITE_EVALUATION_ENGINE", "rust");
    const compiled = compileCanonicalText(regenerateCanonicalFromModel(emptyDocument(), 1), source);
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
    const transport = vi.fn<RustEvaluationTransport>(async () =>
      evaluateElementsReferencePayload(document.document.elements)
    );

    const { result } = renderHook(() =>
      useEvaluationEngine(document.document.elements, options, 0, transport)
    );

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingVersions: expect.objectContaining({
          conditionalOwners: expect.arrayContaining(
            [...owners!].map(([elementId, ownerStatementId]) => ({ elementId, ownerStatementId }))
          )
        })
      })
    );
  });
});
