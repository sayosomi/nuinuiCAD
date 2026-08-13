import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import seamAllowanceCopySource from "../../docs/module/manual-fixtures/nui4-seam-allowance-copy.nui?raw";
import { compileDslDocument } from "../dsl/dslDocument";
import { parseDsl } from "../dsl/dslParser";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { ModuleHierarchyPanel } from "./ModuleHierarchyPanel";

const compiledFixture = () => {
  const parsed = parseDsl(seamAllowanceCopySource);
  return compileDslDocument(seamAllowanceCopySource, {
    preparsed: parsed,
    assignedStatementIds: new Map(parsed.statements.map((_, index) => [index, `panel:${index}`] as const))
  });
};

describe("ModuleHierarchyPanel", () => {
  it("shows the instance definition and private/exported materialized children", () => {
    useCadUiStore.setState(initialCadUiState());
    const compiled = compiledFixture();
    expect(compiled.document).not.toBeNull();
    const onSelect = vi.fn();
    render(
      <ModuleHierarchyPanel
        elements={compiled.document!.elements}
        moduleMaterialization={compiled.moduleMaterialization}
        moduleSemanticAnalysis={compiled.moduleSemanticAnalysis}
        onSelect={onSelect}
      />
    );

    const panel = screen.getByTestId("module-hierarchy");
    expect(within(panel).getByText("写し")).toBeInTheDocument();
    expect(within(panel).getByText("module: 縫い代写し")).toBeInTheDocument();
    expect(within(panel).getByText("脇コピー")).toBeInTheDocument();
    expect(within(panel).getAllByText("materialized · private").length).toBeGreaterThan(0);
    expect(within(panel).getAllByText("materialized · export").length).toBe(2);

    fireEvent.click(within(panel).getByText("写し"));
    expect(onSelect).toHaveBeenCalledWith(expect.stringContaining("module-runtime:"));
  });

  it("filters the hierarchy while keeping matching descendants reachable", () => {
    useCadUiStore.setState(initialCadUiState());
    const compiled = compiledFixture();
    render(
      <ModuleHierarchyPanel
        elements={compiled.document!.elements}
        moduleMaterialization={compiled.moduleMaterialization}
        moduleSemanticAnalysis={compiled.moduleSemanticAnalysis}
      />
    );
    fireEvent.change(screen.getByRole("searchbox", { name: "構成階層を検索" }), { target: { value: "脇コピー" } });
    expect(screen.getByText("脇コピー")).toBeInTheDocument();
    expect(screen.getByText("写し")).toBeInTheDocument();
  });
});
