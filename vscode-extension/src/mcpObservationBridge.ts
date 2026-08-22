import {
  VscodeObservationBridge,
  type VscodeObservationBridgeOptions
} from "../../src/node/vscodeObservationBridge";

export const NUI_MCP_OBSERVATION_ENV = "NUINUICAD_MCP_OBSERVATION";
export const NUI_MCP_OBSERVATION_SETTING = "developer.mcpObservation.enabled";

export const mcpObservationEnabled = (
  configured: boolean,
  environment: NodeJS.ProcessEnv = process.env
): boolean => environment[NUI_MCP_OBSERVATION_ENV] === "1" || configured;

export type CreateMcpObservationBridgeOptions = Omit<VscodeObservationBridgeOptions, "workspaceFolderPaths"> & {
  configured: boolean;
  workspaceFolderPaths: readonly string[];
  environment?: NodeJS.ProcessEnv;
};

export const createMcpObservationBridge = (
  options: CreateMcpObservationBridgeOptions
): VscodeObservationBridge | null => {
  if (!mcpObservationEnabled(options.configured, options.environment)) return null;
  return new VscodeObservationBridge({
    observationProvider: options.observationProvider,
    workspaceFolderPaths: options.workspaceFolderPaths,
    descriptorDirectory: options.descriptorDirectory,
    pid: options.pid,
    now: options.now,
    randomBytesFn: options.randomBytesFn
  });
};
