import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { SourceSearchPanel } from "./SourceSearchPanel";
import type { SourceEditorHandle } from "../editor/sourceEditorTypes";

const makeHandle = (): SourceEditorHandle => ({
  focus: vi.fn(),
  getText: vi.fn(() => ""),
  setEvaluation: vi.fn(),
  jumpToElement: vi.fn(),
  jumpToElementEnd: vi.fn(),
  jumpToLineEnd: vi.fn(),
  jumpToBindingDeclaration: vi.fn(() => true),
  jumpToBindingDeclarationPart: vi.fn(() => true),
  jumpToPropertyBindingValue: vi.fn(() => true),
  jumpToTemplateHole: vi.fn(() => true),
  selectSourceSpan: vi.fn(() => true),
  jumpToParameterValue: vi.fn(() => false),
  applyPickCandidate: vi.fn(() => true),
  pickCandidateElementIds: vi.fn(() => []),
  openTextSearch: vi.fn(),
  closeTextSearch: vi.fn(),
  runtimeDiagnostics: vi.fn(() => []),
  focusSearch: vi.fn()
});

describe("SourceSearchPanel", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText("nui 3\npoint Alpha = coordinate(x: 0, y: 0)\npoint Beta = coordinate(x: 1, y: 1)", "test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(<SourceSearchPanel handle={makeHandle()} isOpen={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("filters elements by query and jumps to the selected result", () => {
    const handle = makeHandle();
    render(<SourceSearchPanel handle={handle} isOpen onClose={vi.fn()} />);

    const input = screen.getByLabelText("要素を検索");
    fireEvent.change(input, { target: { value: "Beta" } });

    const beta = useCadDocumentStore.getState().elements.find((element) => element.name === "Beta")!;
    const result = screen.getByRole("button", { name: "Beta" });
    fireEvent.click(result);

    expect(handle.jumpToElement).toHaveBeenCalledWith(beta.id);
  });

  it("delegates to the handle's text search when switching modes", () => {
    const handle = makeHandle();
    render(<SourceSearchPanel handle={handle} isOpen onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "テキスト検索" }));
    expect(handle.openTextSearch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "要素検索" }));
    expect(handle.closeTextSearch).toHaveBeenCalled();
  });

  it("closes CodeMirror text search when the Source panel closes", () => {
    const handle = makeHandle();
    const { rerender } = render(<SourceSearchPanel handle={handle} isOpen onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "テキスト検索" }));
    rerender(<SourceSearchPanel handle={handle} isOpen={false} onClose={vi.fn()} />);
    expect(handle.closeTextSearch).toHaveBeenCalled();
  });

  it("closes on Escape when the query is already empty", () => {
    const handle = makeHandle();
    const onClose = vi.fn();
    render(<SourceSearchPanel handle={handle} isOpen onClose={onClose} />);

    fireEvent.keyDown(screen.getByLabelText("要素を検索"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
