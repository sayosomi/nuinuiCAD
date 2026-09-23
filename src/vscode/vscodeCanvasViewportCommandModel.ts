export const vscodeCanvasViewportCommands = [
  { commandId: "zoomOutCanvas", icon: "minus" },
  { commandId: "zoomInCanvas", icon: "plus" },
  { commandId: "resetCanvasView", icon: "scan" },
  { commandId: "fitDrawing", icon: "maximize" }
] as const;

export type VscodeCanvasViewportCommandId =
  (typeof vscodeCanvasViewportCommands)[number]["commandId"];

export const isVscodeCanvasViewportCommandId = (
  commandId: string
): commandId is VscodeCanvasViewportCommandId =>
  vscodeCanvasViewportCommands.some((command) => command.commandId === commandId);
