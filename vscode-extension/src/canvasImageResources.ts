import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as vscode from "vscode";
import { resolveImagePath } from "@nuinuicad/nui-language/document";
import type { VscodeCanvasImageResources } from "../../src/vscode/protocol";
import { buildPropertyBindingRuntimeEntries } from "../../src/geometry/propertyBindingRuntime";
import type { NuiLanguageAnalysisSession } from "./languageAnalysisSession";
import type { NuiRuntimeEvaluationService } from "./runtimeEvaluationService";

const localImagePath = (source: string, documentPath: string): string | null => {
  if (!source || source.includes("\0")) return null;
  let path = source;
  if (/^file:/i.test(path)) {
    try {
      const uri = new URL(path);
      if (uri.host || uri.search || uri.hash) return null;
      path = fileURLToPath(uri);
    } catch {
      return null;
    }
  } else if (/^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) {
    return null;
  }
  // Network paths are not local references. Never broaden a local grant to a share.
  if (/^[\\/]{2}/.test(path)) return null;
  path = resolveImagePath(path, documentPath);
  return isAbsolute(path) && [".png", ".jpg", ".jpeg", ".webp"].includes(extname(path).toLowerCase())
    ? resolve(path) : null;
};

/** Per-panel authority, populated only from the host's canonical document. */
export class CanvasImageResources {
  private resources: VscodeCanvasImageResources = {};
  private imageRoots: vscode.Uri[] = [];
  private documentUri: string | null = null;

  constructor(private readonly dist: vscode.Uri) {}

  publishDocument(
    webview: vscode.Webview,
    document: vscode.TextDocument,
    analysis: NuiLanguageAnalysisSession,
    runtime: Pick<NuiRuntimeEvaluationService, "evaluateCurrent">,
    isCurrent: () => boolean,
    onResolved: (resources: VscodeCanvasImageResources) => void
  ): VscodeCanvasImageResources {
    const sourceText = document.getText();
    if (analysis.getSource() !== sourceText) analysis.replaceSource(sourceText);
    const snapshot = analysis.runtimeEvaluationSnapshot();
    if (!snapshot || analysis.diagnostics().some((diagnostic) => diagnostic.severity === "error")) {
      return this.publish(webview, document, null);
    }
    const compiled = snapshot.compiled;
    const elements = compiled.document.elements;
    const boundImageIds = new Set(buildPropertyBindingRuntimeEntries({
      propertyBindings: compiled.propertyBindings ?? new Map(),
      elementIdByStatementIndex: compiled.statementMap?.elementIdByStatementIndex ?? new Map(),
      materializedPropertyBindings: compiled.materializedPropertyBindings
    }, elements).filter((entry) => entry.parameterKey === "sourcePath").map((entry) => entry.elementId));
    const paths = elements.flatMap((element) => element.type === "image" && !boundImageIds.has(element.id)
      ? [element.sourcePath] : []);
    if (boundImageIds.size > 0) {
      const version = document.version;
      const current = () => isCurrent() && document.version === version && document.getText() === sourceText;
      // Only the canonical host snapshot may authorize evaluated string paths.
      // Webview-supplied evaluation requests are deliberately not used here.
      void runtime.evaluateCurrent({
        documentKey: document.uri.toString(), documentVersion: version,
        source: { normalizedSource: snapshot.sourceText, sourceRevision: snapshot.sourceRevision },
        session: analysis, isCancelled: () => !current()
      }).then((result) => {
        if (!result || !current()) return;
        const resolvedPaths = [...result.evaluation.computedGeometry.values()]
          .filter((geometry) => geometry.kind === "image").map((image) => image.sourcePath);
        onResolved(this.publish(webview, document, resolvedPaths));
      }).catch(() => {
        // Unavailable runtime paths stay unmapped and use the renderer's error fallback.
      });
    }
    return this.publish(webview, document, paths);
  }

  publish(
    webview: vscode.Webview,
    document: vscode.TextDocument,
    sourcePaths: readonly string[] | null
  ): VscodeCanvasImageResources {
    if (this.documentUri !== document.uri.toString()) {
      this.documentUri = document.uri.toString();
      this.resources = {};
      this.imageRoots = [];
    }
    // A fatal source revision retains the same document's last-good presentation.
    if (sourcePaths !== null) {
      const resources: Record<string, string> = Object.create(null);
      const roots = new Map<string, vscode.Uri>();
      if (document.uri.scheme === "file" && !document.uri.authority) {
        for (const source of sourcePaths) {
          const path = localImagePath(source, document.uri.fsPath);
          if (!path) continue;
          const uri = vscode.Uri.file(path);
          const directory = dirname(path);
          // VS Code requires directory roots. Never grant a filesystem root or home.
          let canonicalDirectory: string;
          try { canonicalDirectory = realpathSync(directory); } catch { continue; }
          if (canonicalDirectory === dirname(canonicalDirectory) || canonicalDirectory === realpathSync(homedir())) continue;
          resources[source] = webview.asWebviewUri(uri).toString();
          const root = vscode.Uri.file(directory);
          roots.set(root.toString(), root);
        }
      }
      this.resources = resources;
      this.imageRoots = [...roots.values()];
    }
    webview.options = { ...webview.options, localResourceRoots: [this.dist, ...this.imageRoots] };
    return this.resources;
  }
}
