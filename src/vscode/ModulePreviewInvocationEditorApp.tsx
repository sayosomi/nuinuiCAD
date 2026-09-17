import { useEffect, useRef, useState } from "react";
import type { DslCompletionSemanticSnapshot } from "@nuinuicad/nui-language";
import type { ModulePreviewInvocationEditorSite } from "../editor/modulePreviewInvocationEditor";
import type { ModulePreviewInvocationBlock } from "../dsl/modulePreviewInvocation";
import { ModulePreviewInvocationEditorController } from "../editor/modulePreviewInvocationEditor";
import type { ModulePreviewInvocation } from "../dsl/modulePreviewInvocation";
import type { VscodeModulePreviewInvocationValueEdit } from "./protocol";
import "./modulePreviewInvocation.css";

export type ModulePreviewInvocationEditorProof = {
  sessionId: string;
  documentUri: string;
  documentVersion: number;
  sourceRevision: number;
  sessionRevision: number;
  targetDefinitionStatementId: string;
};

export type ModulePreviewInvocationEditorAppProps = {
  invocation: ModulePreviewInvocation | null;
  unavailable?: string | null;
  source: { normalizedSource: string; sourceRevision: number } | null;
  semantic: DslCompletionSemanticSnapshot | null;
  target: { definitionStatementId: string; definitionStatementIndex: number } | null;
  proof: ModulePreviewInvocationEditorProof | null;
  onChange: (block: ModulePreviewInvocationBlock, site: ModulePreviewInvocationEditorSite) => void;
  onSiteChange: (site: ModulePreviewInvocationEditorSite | null) => void;
  onReferencePick: (site: ModulePreviewInvocationEditorSite) => void;
};

const geometryParameter = (site: ModulePreviewInvocationEditorSite | null): boolean => {
  const kind = site?.parameter?.type?.kind;
  return kind === "point" || kind === "line" || kind === "path";
};

const InvocationBlockEditor = ({
  block,
  source,
  semantic,
  target,
  onChange,
  onSiteChange,
  onController
}: {
  block: ModulePreviewInvocationBlock;
  source: { normalizedSource: string; sourceRevision: number };
  semantic: DslCompletionSemanticSnapshot;
  target: { definitionStatementId: string; definitionStatementIndex: number };
  onChange: (block: ModulePreviewInvocationBlock, site: ModulePreviewInvocationEditorSite) => void;
  onSiteChange: (site: ModulePreviewInvocationEditorSite | null) => void;
  onController: (controller: ModulePreviewInvocationEditorController | null) => void;
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<ModulePreviewInvocationEditorController | null>(null);
  const initialBlockRef = useRef(block);
  const initialContextRef = useRef({ source, semantic, target });
  const callbacksRef = useRef({ onChange, onSiteChange, onController });
  useEffect(() => {
    callbacksRef.current = { onChange, onSiteChange, onController };
  }, [onChange, onController, onSiteChange]);
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const initial = initialContextRef.current;
    const controller = new ModulePreviewInvocationEditorController({
      parent: mount,
      block: initialBlockRef.current,
      source: initial.source,
      semantic: initial.semantic,
      target: initial.target,
      onChange: (text, site) => callbacksRef.current.onChange({ ...site.block, text }, site),
      onSiteChange: (site) => callbacksRef.current.onSiteChange(site)
    });
    controllerRef.current = controller;
    callbacksRef.current.onController(controller);
    return () => {
      callbacksRef.current.onController(null);
      callbacksRef.current.onSiteChange(null);
      controller.destroy();
      controllerRef.current = null;
    };
  }, [block.definitionStatementId]);

  useEffect(() => {
    controllerRef.current?.updateBlock(block);
  }, [block]);

  useEffect(() => {
    controllerRef.current?.updateContext({ source, semantic, target });
  }, [semantic, source, target]);

  return <div ref={mountRef} className="module-preview-invocation-cm" data-module-preview-invocation-editor="true" />;
};

/** Presentation-only Webview composition for the host-neutral invocation editor. */
export const ModulePreviewInvocationEditorApp = ({
  invocation,
  unavailable,
  source,
  semantic,
  target,
  proof,
  onChange,
  onSiteChange,
  onReferencePick
}: ModulePreviewInvocationEditorAppProps) => {
  const controllersRef = useRef(new Map<string, ModulePreviewInvocationEditorController>());
  const [activeSite, setActiveSite] = useState<ModulePreviewInvocationEditorSite | null>(null);
  useEffect(() => () => {
    for (const controller of controllersRef.current.values()) controller.destroy();
    controllersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!invocation || !proof) return;
    const onMessage = (event: MessageEvent<unknown>) => {
      const message = event.data as Partial<VscodeModulePreviewInvocationValueEdit>;
      if (message.type !== "modulePreviewInvocationValueEdit") return;
      if (
        message.sessionId !== proof.sessionId ||
        message.documentUri !== proof.documentUri ||
        message.documentVersion !== proof.documentVersion ||
        message.sourceRevision !== proof.sourceRevision ||
        message.sessionRevision !== proof.sessionRevision ||
        message.targetDefinitionStatementId !== proof.targetDefinitionStatementId ||
        typeof message.definitionStatementId !== "string" ||
        typeof message.parameterIndex !== "number" ||
        typeof message.expression !== "string" ||
        typeof message.invocationText !== "string" ||
        typeof message.resultSelectionStart !== "number" ||
        typeof message.resultSelectionEnd !== "number"
      ) return;
      const block = invocation.blocks.find((candidate) => candidate.definitionStatementId === message.definitionStatementId);
      if (!block || block.text !== message.invocationText) return;
      controllersRef.current.get(message.definitionStatementId)?.replaceValueAtSite(
        message.parameterIndex,
        message.expression,
        { start: message.resultSelectionStart, end: message.resultSelectionEnd },
        message.invocationText
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [invocation, proof]);

  if (!invocation || !source || !semantic || !target) {
    return <div className="module-preview-invocation-unavailable" role="status">{unavailable ?? "Module Preview invocation is unavailable."}</div>;
  }

  return (
    <div className="module-preview-invocation-surface" data-module-preview-invocation-surface="true">
      {invocation.blocks.map((block) => {
        const currentSite = activeSite?.block.definitionStatementId === block.definitionStatementId
          ? activeSite
          : null;
        return (
          <section
            key={block.definitionStatementId}
            className={`module-preview-invocation-block module-preview-invocation-block-${block.kind}`}
            data-module-preview-invocation-block-kind={block.kind}
            data-module-preview-definition-id={block.definitionStatementId}
          >
            <h2>{block.kind === "target" ? "Target" : "Context"}: {block.name}</h2>
            <div className="module-preview-invocation-editor-row">
              <InvocationBlockEditor
                block={block}
                source={source}
                semantic={semantic}
                target={target}
                onChange={(nextBlock, site) => onChange(nextBlock, site)}
                onSiteChange={(site) => {
                  setActiveSite(site);
                  onSiteChange(site);
                }}
                onController={(controller) => {
                  if (controller) controllersRef.current.set(block.definitionStatementId, controller);
                  else controllersRef.current.delete(block.definitionStatementId);
                }}
              />
              {currentSite && geometryParameter(currentSite) && proof ? (
                <button
                  type="button"
                  className="module-preview-invocation-pick"
                  data-module-preview-invocation-pick="true"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onReferencePick(currentSite)}
                >Pick</button>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
};
