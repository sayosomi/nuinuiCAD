import { VSCodeApp } from "./VSCodeApp";
import type { VscodeWebviewApi } from "./protocol";

/**
 * Dedicated Module Preview Webview entry point.
 *
 * The surface is intentionally routed separately even while it shares the
 * production Canvas application shell. Extension-host lifecycle/retargeting
 * can therefore remain independent from the ordinary Canvas session without
 * introducing a second renderer.
 */
export const ModulePreviewApp = ({ api }: { api: VscodeWebviewApi }) => (
  <VSCodeApp api={api} />
);
