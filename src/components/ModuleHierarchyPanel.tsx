import { useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { dispatchCommand } from "../commands/commands";
import type { ModuleMaterialization } from "../dsl/moduleMaterialization";
import type { ModuleSemanticAnalysis } from "../dsl/moduleSemanticTypes";
import {
  buildModuleHierarchy,
  moduleHierarchyMatchCount,
  moduleHierarchyNodeMatches,
  type ModuleHierarchyNode
} from "../model/moduleHierarchy";
import { useCadUiStore } from "../state/cadUiStore";
import type { CadElement } from "../types/geometry";

type ModuleHierarchyPanelProps = {
  elements: readonly CadElement[];
  moduleMaterialization?: ModuleMaterialization;
  moduleSemanticAnalysis?: ModuleSemanticAnalysis;
  onSelect?: (elementId: string) => void;
};

const badgeLabel = (node: ModuleHierarchyNode) => {
  if (node.kind === "moduleInstance") return `module: ${node.moduleDefinitionName ?? "不明"}`;
  if (node.kind === "materializedChild") {
    return `materialized · ${node.memberVisibility === "exported" ? "export" : "private"}`;
  }
  return node.typeLabel;
};

export const ModuleHierarchyPanel = ({
  elements,
  moduleMaterialization,
  moduleSemanticAnalysis,
  onSelect
}: ModuleHierarchyPanelProps) => {
  const selectedElementId = useCadUiStore((state) => state.selectedElementId);
  const [query, setQuery] = useState("");
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const roots = useMemo(
    () => buildModuleHierarchy({ elements, moduleMaterialization, moduleSemanticAnalysis }),
    [elements, moduleMaterialization, moduleSemanticAnalysis]
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchCount = moduleHierarchyMatchCount(roots, normalizedQuery);
  const select = (elementId: string) => {
    if (onSelect) onSelect(elementId);
    else dispatchCommand("selectElement", { elementId });
  };
  const toggle = (elementId: string) => {
    setCollapsedIds((previous) => {
      const next = new Set(previous);
      if (next.has(elementId)) next.delete(elementId);
      else next.add(elementId);
      return next;
    });
  };

  const renderNode = (node: ModuleHierarchyNode, depth: number): ReactNode => {
    if (!moduleHierarchyNodeMatches(node, normalizedQuery)) return null;
    const hasChildren = node.children.length > 0;
    const isCollapsed = !normalizedQuery && collapsedIds.has(node.id);
    return (
      <li key={node.id} className="module-hierarchy-item">
        <div className="module-hierarchy-row" style={{ "--module-hierarchy-depth": depth } as CSSProperties}>
          {hasChildren ? (
            <button
              type="button"
              className="module-hierarchy-toggle"
              aria-label={`${node.displayName}を${isCollapsed ? "展開" : "折り畳み"}`}
              aria-expanded={!isCollapsed}
              onClick={() => toggle(node.id)}
            >
              {isCollapsed ? "▸" : "▾"}
            </button>
          ) : <span className="module-hierarchy-toggle-placeholder" aria-hidden="true" />}
          <button
            type="button"
            className={`module-hierarchy-select ${selectedElementId === node.id ? "is-selected" : ""}`}
            aria-current={selectedElementId === node.id ? "true" : undefined}
            onClick={() => select(node.id)}
          >
            <span className="module-hierarchy-name">{node.displayName}</span>
            <small className={`module-hierarchy-badge ${node.kind}`}>{badgeLabel(node)}</small>
          </button>
        </div>
        {hasChildren && !isCollapsed ? (
          <ul className="module-hierarchy-children">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <section className="panel-section module-hierarchy-panel" aria-label="構成階層" data-testid="module-hierarchy">
      <div className="section-header">
        <div>
          <h2>構成階層</h2>
          <p className="section-subtitle">Module instance と materialized child</p>
        </div>
        <small className="module-hierarchy-count">{normalizedQuery ? `${matchCount} 件` : `${elements.length} 件`}</small>
      </div>
      <input
        className="module-hierarchy-search"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="階層を検索"
        aria-label="構成階層を検索"
      />
      {roots.length === 0 ? (
        <p className="empty-state">要素はありません。</p>
      ) : matchCount === 0 ? (
        <p className="empty-state">一致する要素はありません。</p>
      ) : (
        <ul className="module-hierarchy-tree">
          {roots.map((node) => renderNode(node, 0))}
        </ul>
      )}
    </section>
  );
};
