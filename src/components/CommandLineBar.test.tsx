import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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
