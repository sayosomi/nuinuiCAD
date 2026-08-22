import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { createConnection, createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const VSCODE_OBSERVATION_DESCRIPTOR_DIRECTORY_NAME = "nuinuicad-mcp-observation-v1";
const VSCODE_OBSERVATION_DESCRIPTOR_VERSION = 1 as const;
const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS = 500;

export type VscodeObservationDescriptor = {
  version: typeof VSCODE_OBSERVATION_DESCRIPTOR_VERSION;
  instanceId: string;
  pid: number;
  port: number;
  authToken: string;
  workspaceFolderPaths: string[];
  startedAt: string;
};

export type VscodeObservationCandidateMetadata = Omit<VscodeObservationDescriptor, "authToken" | "version"> & {
  documentPaths: string[];
};

export type VscodeObservationLiveInstance = {
  descriptor: VscodeObservationDescriptor;
  observation: unknown;
  documentPaths: string[];
};

export type VscodeObservationResolution =
  | { kind: "selected"; instance: VscodeObservationLiveInstance }
  | {
      kind: "not-found";
      reason: "no-instances" | "instance-not-found" | "document-not-found";
      candidates: VscodeObservationCandidateMetadata[];
    }
  | {
      kind: "ambiguous";
      reason: "multiple-instances" | "document-open-in-multiple-instances";
      candidates: VscodeObservationCandidateMetadata[];
    };

export type VscodeObservationBridgeOptions = {
  observationProvider: () => unknown;
  workspaceFolderPaths: readonly string[];
  descriptorDirectory?: string;
  pid?: number;
  now?: () => Date;
  randomBytesFn?: typeof randomBytes;
};

type ObservationRequest = {
  type: "observe";
  token: string;
};

type ObservationResponse = {
  type: "observation";
  instanceId: string;
  observation: unknown;
};

type ErrorResponse = {
  type: "error";
  error: "invalid-request" | "unauthorized" | "unsupported-request" | "internal-error";
};

export type VscodeObservationClientOptions = {
  timeoutMs?: number;
};

export type VscodeObservationDiscoveryOptions = VscodeObservationClientOptions & {
  descriptorDirectory?: string;
  cleanupStale?: boolean;
};

const safeUnlink = (path: string): void => {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort stale/normal descriptor cleanup.
  }
};

const secureDirectory = (directory: string): void => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform === "win32") return;
  try {
    chmodSync(directory, 0o700);
  } catch {
    // Some filesystems do not implement POSIX modes.
  }
};

const secureFile = (path: string): void => {
  if (process.platform === "win32") return;
  try {
    chmodSync(path, 0o600);
  } catch {
    // Some filesystems do not implement POSIX modes.
  }
};

export const vscodeObservationDescriptorDirectory = (temporaryDirectory = tmpdir()): string =>
  resolve(temporaryDirectory, VSCODE_OBSERVATION_DESCRIPTOR_DIRECTORY_NAME);

export const vscodeObservationDescriptorPath = (
  instanceId: string,
  descriptorDirectory = vscodeObservationDescriptorDirectory()
): string => resolve(descriptorDirectory, `${instanceId}.json`);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseDescriptor = (value: unknown): VscodeObservationDescriptor | null => {
  if (!isObject(value)) return null;
  if (value.version !== VSCODE_OBSERVATION_DESCRIPTOR_VERSION) return null;
  if (typeof value.instanceId !== "string" || value.instanceId.length === 0) return null;
  if (!Number.isInteger(value.pid) || (value.pid as number) <= 0) return null;
  if (!Number.isInteger(value.port) || (value.port as number) <= 0 || (value.port as number) > 65535) return null;
  if (typeof value.authToken !== "string" || value.authToken.length === 0) return null;
  if (!Array.isArray(value.workspaceFolderPaths) || !value.workspaceFolderPaths.every((path) => typeof path === "string")) {
    return null;
  }
  if (typeof value.startedAt !== "string" || Number.isNaN(Date.parse(value.startedAt))) return null;
  return {
    version: VSCODE_OBSERVATION_DESCRIPTOR_VERSION,
    instanceId: value.instanceId,
    pid: value.pid as number,
    port: value.port as number,
    authToken: value.authToken,
    workspaceFolderPaths: [...value.workspaceFolderPaths] as string[],
    startedAt: value.startedAt
  };
};

const tokenMatches = (received: string, expected: string): boolean => {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const writeResponse = (socket: Socket, response: ObservationResponse | ErrorResponse): void => {
  socket.end(`${JSON.stringify(response)}\n`);
};

const parseRequest = (line: string): ObservationRequest | "unsupported" | null => {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    return null;
  }
  if (!isObject(value) || typeof value.type !== "string") return null;
  if (value.type !== "observe") return "unsupported";
  if (typeof value.token !== "string") return null;
  return { type: "observe", token: value.token };
};

export class VscodeObservationBridge {
  readonly instanceId: string;
  readonly authToken: string;
  readonly descriptorDirectory: string;
  readonly descriptorPath: string;
  readonly ready: Promise<VscodeObservationDescriptor>;

  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly observationProvider: () => unknown;
  private readonly workspaceFolderPaths: string[];
  private readonly pid: number;
  private readonly now: () => Date;
  private disposed = false;

  constructor(options: VscodeObservationBridgeOptions) {
    const random = options.randomBytesFn ?? randomBytes;
    this.instanceId = random(16).toString("hex");
    this.authToken = random(32).toString("hex");
    this.descriptorDirectory = options.descriptorDirectory ?? vscodeObservationDescriptorDirectory();
    this.descriptorPath = vscodeObservationDescriptorPath(this.instanceId, this.descriptorDirectory);
    this.observationProvider = options.observationProvider;
    this.workspaceFolderPaths = [...options.workspaceFolderPaths];
    this.pid = options.pid ?? process.pid;
    this.now = options.now ?? (() => new Date());
    this.server = createServer((socket) => {
      this.sockets.add(socket);
      socket.once("close", () => this.sockets.delete(socket));
      this.handleSocket(socket);
    });

    this.ready = new Promise<VscodeObservationDescriptor>((resolveReady, rejectReady) => {
      this.server.once("error", rejectReady);
      this.server.listen({ host: "127.0.0.1", port: 0, exclusive: true }, () => {
        if (this.disposed) {
          this.server.close();
          rejectReady(new Error("VS Code observation bridge disposed before startup"));
          return;
        }
        const address = this.server.address();
        if (!address || typeof address === "string") {
          rejectReady(new Error("VS Code observation bridge did not receive a TCP address"));
          return;
        }
        const descriptor: VscodeObservationDescriptor = {
          version: VSCODE_OBSERVATION_DESCRIPTOR_VERSION,
          instanceId: this.instanceId,
          pid: this.pid,
          port: address.port,
          authToken: this.authToken,
          workspaceFolderPaths: [...this.workspaceFolderPaths],
          startedAt: this.now().toISOString()
        };
        try {
          secureDirectory(this.descriptorDirectory);
          writeFileSync(this.descriptorPath, `${JSON.stringify(descriptor)}\n`, {
            encoding: "utf8",
            flag: "wx",
            mode: 0o600
          });
          secureFile(this.descriptorPath);
        } catch (error) {
          this.server.close();
          rejectReady(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolveReady(descriptor);
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    safeUnlink(this.descriptorPath);
    if (this.server.listening) this.server.close();
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  private handleSocket(socket: Socket): void {
    if (this.disposed) {
      socket.destroy();
      return;
    }
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;
    socket.on("error", () => undefined);
    socket.on("data", (chunk: string) => {
      if (handled || this.disposed) {
        socket.destroy();
        return;
      }
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_REQUEST_BYTES) {
        handled = true;
        writeResponse(socket, { type: "error", error: "invalid-request" });
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      const request = parseRequest(buffer.slice(0, newline));
      if (request === null) {
        writeResponse(socket, { type: "error", error: "invalid-request" });
        return;
      }
      if (request === "unsupported") {
        writeResponse(socket, { type: "error", error: "unsupported-request" });
        return;
      }
      if (!tokenMatches(request.token, this.authToken)) {
        writeResponse(socket, { type: "error", error: "unauthorized" });
        return;
      }
      try {
        writeResponse(socket, {
          type: "observation",
          instanceId: this.instanceId,
          observation: this.observationProvider()
        });
      } catch {
        writeResponse(socket, { type: "error", error: "internal-error" });
      }
    });
  }
}

const observationResponse = (value: unknown, descriptor: VscodeObservationDescriptor): unknown | null => {
  if (!isObject(value)) return null;
  if (value.type !== "observation" || value.instanceId !== descriptor.instanceId || !("observation" in value)) return null;
  return value.observation;
};

export const requestVscodeObservation = async (
  descriptor: VscodeObservationDescriptor,
  options: VscodeObservationClientOptions = {}
): Promise<unknown | null> => {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  return new Promise<unknown | null>((resolveObservation, rejectObservation) => {
    const socket = createConnection({ host: "127.0.0.1", port: descriptor.port });
    let buffer = "";
    let settled = false;
    const finish = (value: unknown | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      resolveObservation(value);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      rejectObservation(error);
    };
    const timeout = setTimeout(() => fail(new Error("VS Code observation bridge timed out")), timeoutMs);
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(`${JSON.stringify({ type: "observe", token: descriptor.authToken })}\n`);
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_REQUEST_BYTES * 16) {
        fail(new Error("VS Code observation bridge response is too large"));
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer.slice(0, newline)) as unknown;
      } catch (error) {
        fail(new Error(`Invalid VS Code observation bridge response: ${String(error)}`));
        return;
      }
      finish(observationResponse(parsed, descriptor));
    });
    socket.once("error", fail);
    socket.once("end", () => {
      if (!settled) finish(null);
    });
  });
};

const descriptorFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => resolve(directory, name));
  } catch {
    return [];
  }
};

const readDescriptor = (path: string): VscodeObservationDescriptor | null => {
  try {
    return parseDescriptor(JSON.parse(readFileSync(path, "utf8")) as unknown);
  } catch {
    return null;
  }
};

const observationDocumentPaths = (observation: unknown): string[] => {
  if (!isObject(observation) || !Array.isArray(observation.documents)) return [];
  const paths = new Set<string>();
  for (const document of observation.documents) {
    if (isObject(document) && typeof document.documentPath === "string") paths.add(document.documentPath);
  }
  return [...paths].sort();
};

export const canonicalizeObservationDocumentPath = (
  input: string,
  platform: NodeJS.Platform = process.platform
): string => {
  let path = input;
  if (input.startsWith("file:")) {
    try {
      path = fileURLToPath(input);
    } catch {
      path = input;
    }
  }
  let canonical = normalize(resolve(path));
  try {
    canonical = realpathSync.native(canonical);
  } catch {
    // A caller may resolve a path before it exists. Normalized absolute form is still deterministic.
  }
  return platform === "win32" ? canonical.toLowerCase() : canonical;
};

export const discoverVscodeObservationInstances = async (
  options: VscodeObservationDiscoveryOptions = {}
): Promise<VscodeObservationLiveInstance[]> => {
  const directory = options.descriptorDirectory ?? vscodeObservationDescriptorDirectory();
  const cleanupStale = options.cleanupStale ?? true;
  const live: VscodeObservationLiveInstance[] = [];

  await Promise.all(descriptorFiles(directory).map(async (path) => {
    const descriptor = readDescriptor(path);
    if (!descriptor) {
      if (cleanupStale) safeUnlink(path);
      return;
    }
    try {
      const observation = await requestVscodeObservation(descriptor, options);
      if (observation === null) return;
      live.push({ descriptor, observation, documentPaths: observationDocumentPaths(observation) });
    } catch {
      if (cleanupStale) safeUnlink(path);
    }
  }));

  return live.sort((left, right) => left.descriptor.instanceId.localeCompare(right.descriptor.instanceId));
};

const candidateMetadata = (instance: VscodeObservationLiveInstance): VscodeObservationCandidateMetadata => ({
  instanceId: instance.descriptor.instanceId,
  pid: instance.descriptor.pid,
  port: instance.descriptor.port,
  workspaceFolderPaths: [...instance.descriptor.workspaceFolderPaths],
  startedAt: instance.descriptor.startedAt,
  documentPaths: [...instance.documentPaths]
});

export const resolveVscodeObservationInstance = async (
  input: { instanceId?: string; documentPath?: string },
  options: VscodeObservationDiscoveryOptions = {}
): Promise<VscodeObservationResolution> => {
  const instances = await discoverVscodeObservationInstances(options);
  const candidates = instances.map(candidateMetadata);

  if (input.instanceId) {
    const selected = instances.find((instance) => instance.descriptor.instanceId === input.instanceId);
    return selected
      ? { kind: "selected", instance: selected }
      : { kind: "not-found", reason: "instance-not-found", candidates };
  }

  if (input.documentPath) {
    const requested = canonicalizeObservationDocumentPath(input.documentPath);
    const matches = instances.filter((instance) => instance.documentPaths.some(
      (path) => canonicalizeObservationDocumentPath(path) === requested
    ));
    if (matches.length === 1) return { kind: "selected", instance: matches[0]! };
    if (matches.length === 0) return { kind: "not-found", reason: "document-not-found", candidates };
    return {
      kind: "ambiguous",
      reason: "document-open-in-multiple-instances",
      candidates: matches.map(candidateMetadata)
    };
  }

  if (instances.length === 1) return { kind: "selected", instance: instances[0]! };
  if (instances.length === 0) return { kind: "not-found", reason: "no-instances", candidates: [] };
  return { kind: "ambiguous", reason: "multiple-instances", candidates };
};
