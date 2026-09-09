import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDslSnapshot } from "../dsl/dslParser";
import { queryDslReferencePickTarget } from "../dsl/dslReferencePickQuery";
import type { VscodeReferencePickCanvasSession } from "./referencePickCanvasSession";
import { VSCodeReferencePickModeStatus } from "./VSCodeReferencePickModeStatus";

const source = [
  "nui 1",
  "line AB = segment(start: @A, end: @B)",
  "line AC = segment(start: @A, end: @C)",
  "point Cross = intersection(",
  "  line1: @AB,",
  "  line2: @AC,",
  "  index: 0,",
  "  extensions: false",
  ")"
].join("\n");

const sourceRevision = 17;
const parsed = parseDslSnapshot({ normalizedSource: source, sourceRevision });
const compiled = compileDslDocument(source, {
  preparsed: parsed,
  assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `status-test:${index}`]))
});
const targetPosition = source.indexOf("@AB") + 1;
const target = queryDslReferencePickTarget({
  source: { normalizedSource: source, sourceRevision },
  position: targetPosition,
  semantic: { sourceRevision, sourceText: source, compiled }
});

if (!target) throw new Error("status fixture did not produce a Reference Pick target");

const sessionFor = (overrides: Partial<VscodeReferencePickCanvasSession> = {}) => ({
  request: {
    requestId: 1,
    documentUri: "file:///status.nui",
    documentVersion: 1,
    targetProof: {}
  },
  target,
  candidates: [],
  draft: {
    expectedGeometryInterface: target.expectedGeometryInterface,
    role: target.role,
    multiplicity: target.multiplicity,
    hover: null,
    draftReferences: [{ base: "AB" }],
    numericProperty: null,
    status: "active"
  },
  ...overrides
} as unknown as VscodeReferencePickCanvasSession);

describe("VSCodeReferencePickModeStatus", () => {
  it("projects the exact-current Cross / line1 target and canonical draft into the shared shell", () => {
    const onFinish = vi.fn();
    render(
      <VSCodeReferencePickModeStatus
        session={sessionFor()}
        context={{
          source: { normalizedSource: source, sourceRevision },
          compiled
        }}
        onFinish={onFinish}
      />
    );

    expect(screen.getByText("PICK MODE")).toBeInTheDocument();
    expect(screen.getByText("Cross / line1")).toBeInTheDocument();
    expect(screen.getByLabelText("現在の選択")).toHaveTextContent("@AB");
    fireEvent.click(screen.getByRole("button", { name: "選択を完了" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it("shows a complete canonical numeric-property expression", () => {
    const numericSession = sessionFor({
      target: {
        ...target,
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        numericProperty: { kind: "propertySelectionRequired" }
      },
      draft: {
        expectedGeometryInterface: "path",
        role: "numericPropertyBase",
        multiplicity: "single",
        hover: null,
        draftReferences: [],
        numericProperty: {
          target: { kind: "propertySelectionRequired" },
          stage: "draft",
          selectedGeometry: { candidateElementId: "AB", reference: { base: "AB" } },
          properties: ["length"],
          draft: { candidateElementId: "AB", reference: { base: "AB" }, property: "length" }
        },
        status: "active"
      }
    });

    render(
      <VSCodeReferencePickModeStatus
        session={numericSession}
        context={{
          source: { normalizedSource: source, sourceRevision },
          compiled
        }}
        onFinish={vi.fn()}
      />
    );

    expect(screen.getByLabelText("現在の選択")).toHaveTextContent("@AB.length");
  });
});
