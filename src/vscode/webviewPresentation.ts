import { useEffect, useState } from "react";
import type { DslDiagnosticPresentation } from "../dsl/dslTypes";

export type VscodeWebviewLocale = "ja" | "en";

/**
 * Resolved, clone-safe presentation data published by the Extension Host.
 * Webviews may interpolate primitive parameters into these resolved strings,
 * but they do not select a locale or own a translation catalog.
 */
export type VscodeWebviewPresentation = {
  locale: VscodeWebviewLocale;
  strings: Readonly<Record<string, string>>;
  diagnosticTemplates: Readonly<Record<string, string>>;
};

export type WebviewPresentationParameters = Readonly<Record<string, string | number | boolean>>;

const interpolate = (
  text: string,
  parameters: WebviewPresentationParameters | undefined
): string => {
  if (!parameters) return text;
  return text.replace(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder, name: string) =>
    Object.prototype.hasOwnProperty.call(parameters, name) ? String(parameters[name]) : placeholder
  );
};

export const webviewPresentationTextFor = (
  presentation: VscodeWebviewPresentation | null | undefined,
  key: string,
  fallback: string,
  parameters?: WebviewPresentationParameters
): string => interpolate(presentation?.strings[key] ?? fallback, parameters);

export const webviewDiagnosticTextFor = (
  presentation: VscodeWebviewPresentation | null | undefined,
  diagnostic: { message: string; presentation?: DslDiagnosticPresentation }
): string => {
  const diagnosticPresentation = diagnostic.presentation;
  if (!diagnosticPresentation) return diagnostic.message;
  const template = presentation?.diagnosticTemplates[diagnosticPresentation.key];
  return template
    ? interpolate(template, diagnosticPresentation.parameters)
    : diagnostic.message;
};

export const webviewInputDiagnosticTextFor = (
  presentation: VscodeWebviewPresentation | null | undefined,
  diagnostic: { message: string; presentation?: DslDiagnosticPresentation }
): string => {
  const diagnosticPresentation = diagnostic.presentation;
  if (!diagnosticPresentation) return diagnostic.message;
  return webviewPresentationTextFor(
    presentation,
    diagnosticPresentation.key,
    diagnostic.message,
    diagnosticPresentation.parameters
  );
};

export const useVscodeWebviewPresentation = (): VscodeWebviewPresentation | null => {
  const [presentation, setPresentation] = useState<VscodeWebviewPresentation | null>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      const value = event.data;
      if (typeof value !== "object" || value === null || (value as { type?: unknown }).type !== "webviewPresentation") return;
      const candidate = (value as { presentation?: unknown }).presentation;
      if (typeof candidate !== "object" || candidate === null) return;
      const resolved = candidate as Partial<VscodeWebviewPresentation>;
      if (
        (resolved.locale !== "ja" && resolved.locale !== "en") ||
        typeof resolved.strings !== "object" ||
        resolved.strings === null ||
        typeof resolved.diagnosticTemplates !== "object" ||
        resolved.diagnosticTemplates === null
      ) return;
      setPresentation(resolved as VscodeWebviewPresentation);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return presentation;
};
