import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isCommandLineInputComposing,
  setCommandLineInputComposing
} from "../commands/commandLineInputComposition";
import { startCommandLineCreation } from "../commands/commandLineSessionCommands";
import { initialCadDocumentState, useCadDocumentStore } from "../state/cadDocumentStore";
import { initialCadUiState, useCadUiStore } from "../state/cadUiStore";
import { CommandLineBar } from "./CommandLineBar";

describe("CommandLineBar", () => {
  beforeEach(() => {
    useCadDocumentStore.setState(initialCadDocumentState());
    useCadUiStore.setState(initialCadUiState());
    useCadDocumentStore.getState().commitText("nui 1", "test");
  });

  afterEach(() => {
    setCommandLineInputComposing(false);
    vi.unstubAllGlobals();
  });

  it("stays absent without a session, focuses on start, and accepts a suggested name on empty Enter", async () => {
    render(<CommandLineBar />);
    expect(screen.queryByRole("form", { name: "コマンドライン作成" })).not.toBeInTheDocument();

    act(() => { startCommandLineCreation("freePoint"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    await waitFor(() => expect(document.activeElement).toBe(input));

    fireEvent.change(input, { target: { value: "10" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.change(input, { target: { value: "rise / 2" } });
    fireEvent.submit(input.closest("form")!);

    const suggestion = input.getAttribute("placeholder");
    expect(suggestion).toBeTruthy();
    fireEvent.submit(input.closest("form")!);
    expect(useCadUiStore.getState().commandLineSession?.args.name).toBe(suggestion);
  });

  it("keeps unnamed creation behind the explicit skip button", () => {
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(input.closest("form")!);

    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("name");
  });

  it("separates the active step from recipe-ordered completed progress", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point A = (0, 0)",
      "point B = (100, 0)",
      "line 基準線 = A -> B"
    ].join("\n"), "test");
    const line = useCadDocumentStore.getState().elements.find((item) => item.name === "基準線")!;
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("lineDivisionPoint"); });
    act(() => {
      const session = useCadUiStore.getState().commandLineSession!;
      useCadUiStore.setState({
        commandLineSession: {
          ...session,
          currentStepIndex: 1,
          args: { endpoint: { lineId: line.id, endpointKey: "start" } }
        }
      });
    });

    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getAllByText("入力中：割合")).toHaveLength(2);
    expect(screen.getByLabelText("完了済みの入力")).toHaveTextContent("端点");
    expect(screen.getByLabelText("完了済みの入力")).toHaveTextContent("基準線・始点");
    expect(screen.queryByText("endpoint", { exact: true })).not.toBeInTheDocument();
  });

  it("accepts only the shared pick candidates for typed names, selected empty Enter, and arrow Enter", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point A = (0, 0)",
      "point B = (100, 0)",
      "point = (200, 0)"
    ].join("\n"), "test");
    render(<CommandLineBar />);
    const pointA = useCadDocumentStore.getState().elements.find((item) => item.name === "A")!;
    const pointB = useCadDocumentStore.getState().elements.find((item) => item.name === "B")!;
    useCadUiStore.getState().setSelectedElementId(pointB.id);

    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    expect(screen.getByRole("listbox", { name: "参照候補" })).toHaveTextContent("A");
    expect(screen.getByRole("listbox", { name: "参照候補" })).not.toHaveTextContent("point-");

    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toEqual({ mode: "reference", pointId: pointB.id });

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession?.args.endPoint).toEqual({ mode: "reference", pointId: pointA.id });
  });

  it("shows the adoptable selected candidate's name only while empty Enter would adopt it", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "point A = (0, 0)",
      "point B = (100, 0)",
      "@stop",
      "point C = (200, 0)"
    ].join("\n"), "test");
    render(<CommandLineBar />);
    const pointB = useCadDocumentStore.getState().elements.find((item) => item.name === "B")!;
    const pointC = useCadDocumentStore.getState().elements.find((item) => item.name === "C")!;
    useCadUiStore.getState().setSelectedElementId(pointB.id);

    act(() => { startCommandLineCreation("line"); });
    expect(screen.getByText("Enterで選択中を採用：B")).toBeInTheDocument();

    // A typed query takes precedence over selection adoption, so the hint goes away.
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "A" } });
    expect(screen.queryByText(/Enterで選択中を採用/)).not.toBeInTheDocument();
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Enterで選択中を採用：B")).toBeInTheDocument();

    // An active pick cursor adopts the cursor candidate instead of the selection.
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.queryByText(/Enterで選択中を採用/)).not.toBeInTheDocument();
    act(() => { useCadUiStore.getState().setActivePickCursor(null); });

    // Outside the shared candidate set (unevaluated, past @stop) nothing is offered.
    act(() => { useCadUiStore.getState().setSelectedElementId(pointC.id); });
    expect(screen.queryByText(/Enterで選択中を採用/)).not.toBeInTheDocument();
  });

  it("keeps a planned group's first child in the shared name candidates and pick cursor", () => {
    useCadDocumentStore.setState({
      elements: [
        { id: "parent", name: "グループ", type: "group", visible: true, enabled: true },
        {
          id: "first-point", name: "先頭点", type: "freePoint", visible: true, enabled: true,
          parentGroupId: "parent", x: 0, y: 0
        },
        {
          id: "inside", name: "内側", type: "offsetPoint", visible: true, enabled: true,
          parentGroupId: "parent", fromPointId: "first-point", dx: 10, dy: 0
        }
      ],
      evaluationLimitIndex: 3
    });
    useCadUiStore.getState().setGroupFold("parent", { expanded: true });
    render(<CommandLineBar />);

    act(() => { startCommandLineCreation("line", { currentCursorElementId: () => "inside" }); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    expect(screen.getByRole("listbox", { name: "参照候補" })).toHaveTextContent("先頭点");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(useCadUiStore.getState().activePickCursor).toMatchObject({ elementId: "first-point" });
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession?.args.startPoint).toEqual({
      mode: "reference",
      pointId: "first-point"
    });
  });

  it("confirms from the real completed-bar Enter path and hands focus back through its command context", () => {
    const focusElementList = vi.fn();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    render(<CommandLineBar commandContext={{ focusElementList }} />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;

    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText("入力完了。Enterで作成します。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "作成（Enter）" })).toHaveFocus();
    fireEvent.submit(form);

    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(focusElementList).toHaveBeenCalledOnce();
  });

  it("edits a completed row in place, hides normal back, and restores row focus after commit or cancel", async () => {
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: "変数 A" } });
    fireEvent.submit(form);

    const expressionRow = screen.getByRole("button", { name: "式を編集" });
    fireEvent.click(expressionRow);
    const editingInput = screen.getByRole<HTMLInputElement>("textbox");
    await waitFor(() => expect(editingInput).toHaveFocus());
    expect(editingInput).toHaveValue("12");
    expect(screen.getAllByText("編集中：式")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "戻る" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "編集をやめる" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "編集をやめる" }));
    await waitFor(() => expect(expressionRow).toHaveFocus());
    expect(useCadUiStore.getState().commandLineSession?.args.expression).toBe(12);

    fireEvent.click(expressionRow);
    fireEvent.change(screen.getByRole<HTMLInputElement>("textbox"), { target: { value: "24" } });
    fireEvent.submit(form);
    await waitFor(() => expect(expressionRow).toHaveFocus());
    expect(useCadUiStore.getState().commandLineSession?.args.expression).toBe(24);
  });

  it("returns focus to create when skipping an edited name removes its progress row", async () => {
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(form);
    fireEvent.change(input, { target: { value: "変数 A" } });
    fireEvent.submit(form);

    fireEvent.click(screen.getByRole("button", { name: "名前を編集" }));
    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));

    const create = screen.getByRole("button", { name: "作成（Enter）" });
    await waitFor(() => expect(create).toHaveFocus());
    expect(screen.queryByRole("button", { name: "名前を編集" })).not.toBeInTheDocument();
    expect(useCadUiStore.getState().commandLineSession?.args).not.toHaveProperty("name");
  });

  it("keeps the displayed input and session through bar IME events, then resumes after compositionend", () => {
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "未確定" } });
    const session = useCadUiStore.getState().commandLineSession;

    fireEvent.compositionStart(input);
    fireEvent.submit(form);
    fireEvent.keyDown(input, { key: "Escape", isComposing: true, keyCode: 229 });
    expect(startCommandLineCreation("variable")).toBe(false);
    expect(startCommandLineCreation("freePoint")).toBe(false);
    expect(useCadUiStore.getState().commandLineSession).toBe(session);
    expect(input).toHaveValue("未確定");

    fireEvent.compositionEnd(input);
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession).toMatchObject({
      currentStepIndex: 1,
      args: { expression: { kind: "expression", expression: "未確定" } }
    });
  });

  it("does not confirm a completed session during bar IME composition", () => {
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    const form = input.closest("form")!;
    fireEvent.change(input, { target: { value: "12" } });
    fireEvent.submit(form);
    fireEvent.click(screen.getByRole("button", { name: "スキップ" }));
    const completed = useCadUiStore.getState().commandLineSession;
    const confirmButton = screen.getByRole("button", { name: "作成（Enter）" });

    fireEvent.compositionStart(confirmButton);
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession).toBe(completed);
    expect(useCadDocumentStore.getState().elements).toHaveLength(0);

    fireEvent.compositionEnd(confirmButton);
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadDocumentStore.getState().elements).toHaveLength(1);
  });

  it("clears the shared bar composition marker when unmounted", () => {
    const view = render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    fireEvent.compositionStart(screen.getByRole<HTMLInputElement>("textbox"));
    expect(isCommandLineInputComposing()).toBe(true);

    view.unmount();
    expect(isCommandLineInputComposing()).toBe(false);
  });

  it("clears the shared marker when the session removes the bar form", async () => {
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    fireEvent.compositionStart(screen.getByRole<HTMLInputElement>("textbox"));
    expect(isCommandLineInputComposing()).toBe(true);

    act(() => { useCadUiStore.getState().clearPickMode(); });
    await waitFor(() => expect(isCommandLineInputComposing()).toBe(false));
  });

  it("uses Escape after composition to clear both the session and integrated pick state", () => {
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    useCadUiStore.getState().setActivePointPickTarget({ elementId: "pick" as never, parameterKey: "value" as never });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.keyDown(input, { key: "Escape" });

    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(useCadUiStore.getState().activePointPickTarget).toBeNull();
  });

  it("shows @variable candidates in a number step and narrows them by typed prefix", () => {
    useCadDocumentStore.getState().commitText(["nui 1", "var Width = 10", "var Height = 20"].join("\n"), "test");
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "@" } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Width");
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Height");

    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    const listbox = screen.getByRole("listbox", { name: "変数候補" });
    expect(listbox).toHaveTextContent("@Width");
    expect(listbox).not.toHaveTextContent("@Height");
  });

  it("replaces only the @token range on selection, leaving surrounding text untouched", () => {
    useCadDocumentStore.getState().commitText(["nui 1", "var Width = 10"].join("\n"), "test");
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "10 + @Wi" } });
    input.setSelectionRange(8, 8);
    fireEvent.select(input);
    fireEvent.click(screen.getByRole("option", { name: /@Width/ }));

    expect(input).toHaveValue("10 + @Width");
  });

  it("shows the human-readable @name (not an internal id) after selecting a candidate", () => {
    useCadDocumentStore.getState().commitText(["nui 1", "var Width = 10"].join("\n"), "test");
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    fireEvent.click(screen.getByRole("option", { name: /@Width/ }));

    expect(input).toHaveValue("@Width");
    expect(input.value).not.toMatch(/^@[0-9a-f-]{8,}/);
  });

  it("excludes a variable the evaluator has not computed (e.g. past @stop) from insertion-position candidates", () => {
    useCadDocumentStore.getState().commitText(["nui 1", "var Width = 10"].join("\n"), "test");
    const widthId = useCadDocumentStore.getState().elements.find((element) => element.name === "Width")!.id;

    const { rerender } = render(<CommandLineBar evaluation={{ computedVariables: new Map(), errors: [], warnings: [], computedGeometry: new Map() } as never} />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "@" } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    rerender(<CommandLineBar evaluation={{
      computedVariables: new Map([[widthId, { kind: "variable", elementId: widthId, name: "Width", value: 10 }]]),
      errors: [],
      warnings: [],
      computedGeometry: new Map()
    } as never} />);
    fireEvent.change(input, { target: { value: "@" } });
    input.setSelectionRange(1, 1);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Width");
  });

  it("never shows @variable candidates for name, element-reference, or lineList steps", () => {
    useCadDocumentStore.getState().commitText([
      "nui 1",
      "var Width = 10",
      "point A = (0, 0)",
      "point B = (100, 0)"
    ].join("\n"), "test");
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("line"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();
  });

  it("does not open @variable candidates during IME composition", () => {
    useCadDocumentStore.getState().commitText(["nui 1", "var Width = 10"].join("\n"), "test");
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Width");
  });

  const lineGeometryFixture = (elementId: string) => ({
    kind: "line" as const,
    elementId,
    name: "直線AB",
    startPointId: null,
    endPointId: null,
    start: { kind: "point" as const, elementId: "a", name: "a", x: 0, y: 0 },
    end: { kind: "point" as const, elementId: "b", name: "b", x: 10, y: 0 },
    length: 10,
    startAngleDeg: 0,
    endAngleDeg: 0,
    startTangentAngleDeg: 0,
    endTangentAngleDeg: 0
  });

  it("shows AB's referenceable parameters after ElementName. and narrows them by prefix", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 1", "point A = (0, 0)", "point B = (10, 0)", "line 直線AB = A -> B"].join("\n"),
      "test"
    );
    const abId = useCadDocumentStore.getState().elements.find((element) => element.name === "直線AB")!.id;
    const evaluation = {
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never;

    render(<CommandLineBar evaluation={evaluation} />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    const listbox = screen.getByRole("listbox", { name: "変数候補" });
    expect(listbox).toHaveTextContent("length");
    expect(listbox).toHaveTextContent("startTangentAngleDeg");

    fireEvent.change(input, { target: { value: "直線AB.st" } });
    input.setSelectionRange(9, 9);
    fireEvent.select(input);
    const narrowed = screen.getByRole("listbox", { name: "変数候補" });
    expect(narrowed).toHaveTextContent("startTangentAngleDeg");
    expect(narrowed).not.toHaveTextContent("length");
  });

  it("replaces only the member token on selection, leaving ElementName. untouched", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 1", "point A = (0, 0)", "point B = (10, 0)", "line 直線AB = A -> B"].join("\n"),
      "test"
    );
    const abId = useCadDocumentStore.getState().elements.find((element) => element.name === "直線AB")!.id;
    const evaluation = {
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never;

    render(<CommandLineBar evaluation={evaluation} />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "10 + 直線AB.le" } });
    input.setSelectionRange(14, 14);
    fireEvent.select(input);
    fireEvent.click(screen.getByRole("option", { name: /length/ }));

    expect(input).toHaveValue("10 + 直線AB.length");
  });

  it("excludes a disabled/uncomputed element's parameters (evaluation swap)", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 1", "point A = (0, 0)", "point B = (10, 0)", "line 直線AB = A -> B"].join("\n"),
      "test"
    );
    const abId = useCadDocumentStore.getState().elements.find((element) => element.name === "直線AB")!.id;

    const { rerender } = render(<CommandLineBar evaluation={{
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map(),
      effectiveEnabledElementIds: new Set()
    } as never} />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");
    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    rerender(<CommandLineBar evaluation={{
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never} />);
    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });

  it("never guesses candidates for an ambiguous (duplicate) element name", () => {
    useCadDocumentStore.getState().commitText(
      [
        "nui 1",
        "point A = (0, 0)",
        "point B = (10, 0)",
        "point C = (20, 0)",
        "line 直線AB = A -> B id=ab-1",
        "line 直線AB = A -> C id=ab-2"
      ].join("\n"),
      "test"
    );
    const elements = useCadDocumentStore.getState().elements;
    const duplicates = elements.filter((element) => element.name === "直線AB");
    expect(duplicates).toHaveLength(2);
    const evaluation = {
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map(duplicates.map((element) => [element.id, lineGeometryFixture(element.id)])),
      effectiveEnabledElementIds: new Set(duplicates.map((element) => element.id))
    } as never;

    render(<CommandLineBar evaluation={evaluation} />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();
  });

  it("coexists with @variable candidates in the same input without interference", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 1", "var Width = 10", "point A = (0, 0)", "point B = (10, 0)", "line 直線AB = A -> B"].join("\n"),
      "test"
    );
    const elements = useCadDocumentStore.getState().elements;
    const abId = elements.find((element) => element.name === "直線AB")!.id;
    const widthId = elements.find((element) => element.name === "Width")!.id;
    const evaluation = {
      computedVariables: new Map([[widthId, { kind: "variable", elementId: widthId, name: "Width", value: 10 }]]),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never;

    render(<CommandLineBar evaluation={evaluation} />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.change(input, { target: { value: "@Wi" } });
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("@Width");

    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });

  it("does not open element-parameter candidates during IME composition", () => {
    useCadDocumentStore.getState().commitText(
      ["nui 1", "point A = (0, 0)", "point B = (10, 0)", "line 直線AB = A -> B"].join("\n"),
      "test"
    );
    const abId = useCadDocumentStore.getState().elements.find((element) => element.name === "直線AB")!.id;
    const evaluation = {
      computedVariables: new Map(),
      errors: [],
      warnings: [],
      computedGeometry: new Map([[abId, lineGeometryFixture(abId)]]),
      effectiveEnabledElementIds: new Set([abId])
    } as never;

    render(<CommandLineBar evaluation={evaluation} />);
    act(() => { startCommandLineCreation("variable"); });
    const input = screen.getByRole<HTMLInputElement>("textbox");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.queryByRole("listbox", { name: "変数候補" })).toBeNull();

    fireEvent.compositionEnd(input);
    fireEvent.change(input, { target: { value: "直線AB." } });
    input.setSelectionRange(6, 6);
    fireEvent.select(input);
    expect(screen.getByRole("listbox", { name: "変数候補" })).toHaveTextContent("length");
  });

  it("immediately clears a displayed session when another document revision arrives", async () => {
    render(<CommandLineBar />);
    act(() => { startCommandLineCreation("variable"); });
    expect(screen.getByRole("form", { name: "コマンドライン作成" })).toBeInTheDocument();

    act(() => {
      useCadDocumentStore.getState().commitText("nui 1\npoint A = (0, 0)", "test");
    });
    await waitFor(() => expect(screen.queryByRole("form", { name: "コマンドライン作成" })).not.toBeInTheDocument());
    expect(useCadUiStore.getState().commandErrorMessage).toContain("変更されたため");
  });
});
