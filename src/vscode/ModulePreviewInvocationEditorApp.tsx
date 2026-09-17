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
  normalizedSource: string;
  sourceRevision: number;
  sessionRevision: number;
  targetDefinitionStatementId: string;
  targetDefinitionStatementIndex: number;
  targetName: string;
};

export type ModulePreviewInvocationEditorAppProps = {
  invocation: ModulePreviewInvocation | null;
  unavailable?: string | null;
  source: { normalizedSource: string; sourceRevision: number } | null;
  semantic: DslCompletionSemanticSnapshot | null;
  target: { definitionStatementId: string; definitionStatementIndex: number } | null;
  proof: ModulePreviewInvocationEditorProof | null;
  referencePickAvailable?: boolean;
  onChange: (block: ModulePreviewInvocationBlock, site: ModulePreviewInvocationEditorSite) => void;
  onSiteChange: (site: ModulePreviewInvocationEditorSite | null) => void;
  onValueStep: (site: ModulePreviewInvocationEditorSite, direction: 1 | -1) => void;
  onReferencePick: (site: ModulePreviewInvocationEditorSite) => void;
};

const geometryParameter = (site: ModulePreviewInvocationEditorSite | null): boolean => {
  if (!site?.parameter?.active) return false;
  const kind = site?.parameter?.type?.kind;
  return kind === "point" || kind === "line" || kind === "path";
};

const invocationBlockKeyFor = (block: Pick<ModulePreviewInvocationBlock, "kind" | "definitionStatementIndex" | "name">): string =>
  `${block.kind}:${block.definitionStatementIndex}:${block.name}`;

const InvocationBlockEditor = ({
  block,
  source,
  semantic,
  target,
  onChange,
  onSiteChange,
  onValueStep,
  onReferencePick,
  onController,
  referencePickAvailable
}: {
  block: ModulePreviewInvocationBlock;
  source: { normalizedSource: string; sourceRevision: number };
  semantic: DslCompletionSemanticSnapshot;
  target: { definitionStatementId: string; definitionStatementIndex: number };
  onChange: (block: ModulePreviewInvocationBlock, site: ModulePreviewInvocationEditorSite) => void;
  onSiteChange: (site: ModulePreviewInvocationEditorSite | null) => void;
  onValueStep: (site: ModulePreviewInvocationEditorSite, direction: 1 | -1) => void;
  onReferencePick: (site: ModulePreviewInvocationEditorSite) => void;
  onController: (controller: ModulePreviewInvocationEditorController | null) => void;
  referencePickAvailable?: boolean;
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<ModulePreviewInvocationEditorController | null>(null);
  const initialBlockRef = useRef(block);
  const initialContextRef = useRef({ source, semantic, target, referencePickAvailable });
  const callbacksRef = useRef({ onChange, onSiteChange, onValueStep, onReferencePick, onController });
  useEffect(() => {
    callbacksRef.current = { onChange, onSiteChange, onValueStep, onReferencePick, onController };
  }, [onChange, onController, onReferencePick, onSiteChange, onValueStep]);
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
      referencePickAvailable: initial.referencePickAvailable,
      onChange: (text, site) => callbacksRef.current.onChange({ ...site.block, text }, site),
      onSiteChange: (site) => callbacksRef.current.onSiteChange(site),
      onValueStep: (site, direction) => callbacksRef.current.onValueStep(site, direction),
      onReferencePick: (site) => callbacksRef.current.onReferencePick(site)
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
    controllerRef.current?.updateContext({ source, semantic, target, referencePickAvailable });
  }, [referencePickAvailable, semantic, source, target]);

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
  referencePickAvailable = true,
  onChange,
  onSiteChange,
  onValueStep,
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
        message.normalizedSource !== proof.normalizedSource ||
        message.sourceRevision !== proof.sourceRevision ||
        message.sessionRevision !== proof.sessionRevision ||
        message.targetDefinitionStatementId !== proof.targetDefinitionStatementId ||
        message.targetDefinitionStatementIndex !== proof.targetDefinitionStatementIndex ||
        message.targetName !== proof.targetName ||
        typeof message.definitionStatementId !== "string" ||
        (message.blockKind !== "ancestor" && message.blockKind !== "target") ||
        typeof message.blockDefinitionStatementIndex !== "number" ||
        typeof message.blockName !== "string" ||
        typeof message.parameterIndex !== "number" ||
        typeof message.expression !== "string" ||
        typeof message.invocationText !== "string" ||
        typeof message.resultSelectionStart !== "number" ||
        typeof message.resultSelectionEnd !== "number"
      ) return;
      const block = invocation.blocks.find((candidate) =>
        candidate.kind === message.blockKind &&
        candidate.definitionStatementIndex === message.blockDefinitionStatementIndex &&
        candidate.name === message.blockName
      );
      if (!block || block.text !== message.invocationText) return;
      controllersRef.current.get(invocationBlockKeyFor(block))?.replaceValueAtSite(
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
        const currentSite = activeSite && invocationBlockKeyFor(activeSite.block) === invocationBlockKeyFor(block)
          ? activeSite
          : null;
        return (
          <section
            key={block.definitionStatementId}
            className={`module-preview-invocation-block module-preview-invocation-block-${block.kind}`}
            data-module-preview-invocation-block-kind={block.kind}
            data-module-preview-definition-id={block.definitionStatementId}
          >
            <div className="module-preview-invocation-block-toolbar">
              <h2>{block.kind === "target" ? "Target" : "Context"}: {block.name}</h2>
              {currentSite && geometryParameter(currentSite) ? (
                <button
                  type="button"
                  className="module-preview-invocation-pick"
                  data-module-preview-invocation-pick="true"
                  disabled={!referencePickAvailable || !proof}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onReferencePick(currentSite)}
                >Pick</button>
              ) : null}
            </div>
            <div className="module-preview-invocation-editor-row">
              <InvocationBlockEditor
                block={block}
                source={source}
                semantic={semantic}
                target={target}
                onChange={(nextBlock, site) => onChange(nextBlock, site)}
                onValueStep={onValueStep}
                onReferencePick={onReferencePick}
                referencePickAvailable={referencePickAvailable}
                onSiteChange={(site) => {
                  setActiveSite(site);
                  onSiteChange(site);
                }}
                onController={(controller) => {
                  const key = invocationBlockKeyFor(block);
                  if (controller) controllersRef.current.set(key, controller);
                  else controllersRef.current.delete(key);
                }}
              />
            </div>
          </section>
        );
      })}
    </div>
  );
};
