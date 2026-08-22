import type { VscodeWebviewApi } from "./protocol";

let currentVscodeWebviewApi: VscodeWebviewApi | null = null;

export const setVscodeWebviewApi = (api: VscodeWebviewApi): void => {
  currentVscodeWebviewApi = api;
};

export const vscodeWebviewApi = (): VscodeWebviewApi | null => currentVscodeWebviewApi;
