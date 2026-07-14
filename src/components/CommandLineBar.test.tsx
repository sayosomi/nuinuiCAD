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
    fireEvent.submit(form);

    expect(useCadUiStore.getState().commandLineSession).toBeNull();
    expect(focusElementList).toHaveBeenCalledOnce();
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

    fireEvent.compositionStart(input);
    fireEvent.submit(form);
    expect(useCadUiStore.getState().commandLineSession).toBe(completed);
    expect(useCadDocumentStore.getState().elements).toHaveLength(0);

    fireEvent.compositionEnd(input);
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
