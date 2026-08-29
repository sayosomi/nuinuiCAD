import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type RefObject, type WheelEvent } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Ban,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
  EyeOff,
  FileCode,
  GitBranch,
  Info,
  Layers,
  Link,
  Minus,
  MoreHorizontal,
  Move,
  PanelBottom,
  Search,
  SlidersHorizontal,
  Spline,
  Square,
  X,
} from "lucide-react";
import type { VscodeWebviewApi } from "./protocol";
import {
  explorerMockAncestorsOf,
  explorerMockChildrenOf,
  explorerMockGeometry,
  explorerMockGeometryById,
  explorerMockIsContainer,
  explorerMockModifierById,
  explorerMockModifiers,
  explorerMockTypeLabel,
  type ExplorerMockActivity,
  type ExplorerMockGeometry,
  type ExplorerMockGeometryKind,
  type ExplorerMockModifier,
  type ExplorerMockTab,
} from "./explorerMockFixture";
import "./explorerMock.css";

type DetailTab = "geometry" | "dependencies" | "presentation";
type FilterAxis = "type" | "activity" | "diagnostics" | "groupModule" | "category";
type DiagnosticFilterValue = "all" | "present" | "absent";
type StructuredFilter = {
  type: ExplorerMockGeometryKind | "all";
  activity: ExplorerMockActivity | "all";
  diagnostics: DiagnosticFilterValue;
  groupModule: string | "all";
  category: ExplorerMockModifier["category"] | "all";
};
type FilterChip = { axis: FilterAxis; value: string };
type ContextMenuState = { x: number; y: number; kind: "background" | "row" | "reference" | "operation"; id?: string };
const DETAIL_TABS: ReadonlyArray<readonly [DetailTab, string]> = [["geometry", "Geometry"], ["dependencies", "Dependencies"], ["presentation", "Presentation"]];
const EXPLORER_TABS: ReadonlyArray<readonly [ExplorerMockTab, ReactNode]> = [["elements", <>Elements <span>{explorerMockGeometry.length}</span></>], ["modifiers", <>Modifiers <span>{explorerMockModifiers.length}</span></>]];

const FILTER_AXIS_LABELS: Record<FilterAxis, string> = {
  type: "Type",
  activity: "Activity",
  diagnostics: "Diagnostics",
  groupModule: "Group/Module",
  category: "Category"
};

const createEmptyFilter = (): StructuredFilter => ({
  type: "all",
  activity: "all",
  diagnostics: "all",
  groupModule: "all",
  category: "all"
});

const geometryTypeChoices = [...new Set(explorerMockGeometry.map((geometry) => geometry.kind))];
const groupModuleChoices = explorerMockGeometry.filter((geometry) => geometry.kind === "group" || geometry.kind === "module");
const modifierCategoryChoices = [...new Set(explorerMockModifiers.map((modifier) => modifier.category))];

const filterChipsFor = (tab: ExplorerMockTab, filter: StructuredFilter): FilterChip[] => {
  const values: FilterChip[] = tab === "elements"
    ? [
        { axis: "type", value: filter.type },
        { axis: "activity", value: filter.activity },
        { axis: "diagnostics", value: filter.diagnostics },
        { axis: "groupModule", value: filter.groupModule }
      ]
    : [{ axis: "category", value: filter.category }];
  return values.filter(({ value }) => value !== "all");
};

const activityLabel: Record<ExplorerMockActivity, string> = {
  visible: "Visible",
  hidden: "Hidden",
  disabled: "Disabled"
};

const geometryIconFor = (kind: ExplorerMockGeometryKind) => {
  if (kind === "point") return CircleDot;
  if (kind === "line") return Minus;
  if (kind === "bezier") return Spline;
  if (kind === "arc") return Circle;
  if (kind === "path") return GitBranch;
  if (kind === "module") return Layers;
  if (kind === "operation") return Move;
  return FileCode;
};

const iconForActivity = (activity: ExplorerMockActivity) => {
  if (activity === "hidden") return EyeOff;
  if (activity === "disabled") return Ban;
  return null;
};

const displayNameFor = (id: string): string =>
  explorerMockGeometryById.get(id)?.name ?? explorerMockModifierById.get(id)?.name ?? id;

const geometryHierarchyPath = (geometry: ExplorerMockGeometry): string =>
  [...explorerMockAncestorsOf(geometry.id), geometry.id].map(displayNameFor).join(" / ");

const matchesStructuredFilter = (geometry: ExplorerMockGeometry, filter: StructuredFilter): boolean => {
  if (filter.type !== "all" && geometry.kind !== filter.type) return false;
  if (filter.activity !== "all" && geometry.activity !== filter.activity) return false;
  if (filter.diagnostics === "present" && !geometry.diagnostic) return false;
  if (filter.diagnostics === "absent" && geometry.diagnostic) return false;
  if (filter.groupModule !== "all" && geometry.id !== filter.groupModule && !explorerMockAncestorsOf(geometry.id).includes(filter.groupModule)) return false;
  return true;
};

const isActualGeometryMatch = (geometry: ExplorerMockGeometry, search: string, filter: StructuredFilter): boolean => {
  if (geometry.kind === "operation") return false;
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const searchMatch = !normalizedSearch || [
    geometry.name,
    geometryHierarchyPath(geometry),
    geometry.kind,
    geometry.category,
    geometry.moduleOrigin ?? "",
    geometry.diagnostic?.message ?? ""
  ].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
  return searchMatch && matchesStructuredFilter(geometry, filter);
};

const filterOptionLabel = (axis: FilterAxis, value: string): string => {
  if (value === "all") return "All";
  if (axis === "type") return explorerMockTypeLabel(value as ExplorerMockGeometryKind);
  if (axis === "activity") return activityLabel[value as ExplorerMockActivity];
  if (axis === "diagnostics") return value === "present" ? "Present" : "Absent";
  if (axis === "groupModule") {
    const geometry = explorerMockGeometryById.get(value);
    return geometry ? `${geometry.name} · ${explorerMockTypeLabel(geometry.kind)}` : value;
  }
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
};

const filterChipLabel = ({ axis, value }: FilterChip): string => `${FILTER_AXIS_LABELS[axis]} · ${filterOptionLabel(axis, value)}`;

const branchIsVisible = (geometry: ExplorerMockGeometry, revealAlternate: boolean): boolean =>
  geometry.branch !== "inactive" || revealAlternate;

const unionStrings = (values: string[]): string[] => [...new Set(values)];
const BEZIER_ANCHOR_ROWS = [
  ["A", "(42.0, 286.5)", "—", "—", "18.0 mm"],
  ["B", "(86.0, 282.0)", "24.0 mm", "5.5°", "20.0 mm"],
  ["C", "(128.0, 278.0)", "24.0 mm", "—", "—"]
] as const;

const PropertyRows = ({ values }: { values: Array<[string, string]> }) => (
  <div className="explorer-mock-property-list">
    {values.map(([label, value]) => (
      <div className="explorer-mock-property-row" key={label}>
        <span>{label}</span>
        <code>{value}</code>
      </div>
    ))}
  </div>
);

const FilterPopover = ({
  tab,
  filter,
  popoverRef,
  onChange,
  onDone
}: {
  tab: ExplorerMockTab;
  filter: StructuredFilter;
  popoverRef: RefObject<HTMLDivElement | null>;
  onChange: (axis: FilterAxis, value: string) => void;
  onDone: () => void;
}) => {
  const axes: readonly FilterAxis[] = tab === "elements"
    ? ["type", "activity", "diagnostics", "groupModule"]
    : ["category"];
  const optionsFor = (axis: FilterAxis): Array<{ value: string; label: string }> => {
    if (axis === "type") return geometryTypeChoices.map((value) => ({ value, label: filterOptionLabel(axis, value) }));
    if (axis === "activity") return (["visible", "hidden", "disabled"] as const).map((value) => ({ value, label: filterOptionLabel(axis, value) }));
    if (axis === "diagnostics") return (["present", "absent"] as const).map((value) => ({ value, label: filterOptionLabel(axis, value) }));
    if (axis === "groupModule") return groupModuleChoices.map((geometry) => ({ value: geometry.id, label: filterOptionLabel(axis, geometry.id) }));
    return modifierCategoryChoices.map((value) => ({ value, label: filterOptionLabel(axis, value) }));
  };

  return (
    <div ref={popoverRef} className="explorer-mock-filter-popover" role="dialog" aria-label="Structured filters" onPointerDown={(event) => event.stopPropagation()}>
      <strong>Filter</strong>
      <div className="explorer-mock-filter-axes">
        {axes.map((axis) => (
          <label className="explorer-mock-filter-axis" key={axis}>
            <span>{FILTER_AXIS_LABELS[axis]}</span>
            <select aria-label={FILTER_AXIS_LABELS[axis]} value={filter[axis]} onChange={(event) => onChange(axis, event.currentTarget.value)}>
              <option value="all">All</option>
              {optionsFor(axis).map(({ value, label }) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
        ))}
      </div>
      <button type="button" className="explorer-mock-filter-done" onClick={onDone}>Done</button>
    </div>
  );
};

const EffectivenessGroup = ({
  label,
  entries,
}: {
  label: string;
  entries: Array<{ label: string; effectiveness: "Effective" | "Partially Effective" | "Not Effective" }>;
}) => entries.length === 0 ? null : (
  <section className="explorer-mock-detail-section">
    <h4>{label}</h4>
    <div className="explorer-mock-reference-list">
      {entries.map((entry) => (
        <div className={`explorer-mock-reference-row effectiveness-${entry.effectiveness.replaceAll(" ", "-").toLocaleLowerCase()}`} key={`${label}-${entry.label}`}>
          <span>{entry.label}</span>
          <small>{entry.effectiveness}</small>
        </div>
      ))}
    </div>
  </section>
);

const GeometryDetail = ({
  geometry,
  activeTab,
  setActiveTab,
  navigateToModifier,
  navigateToGeometry,
  onOpenLocalFeedback,
  onReferenceContextMenu,
  onOperationContextMenu,
}: {
  geometry: ExplorerMockGeometry;
  activeTab: DetailTab;
  setActiveTab: (tab: DetailTab) => void;
  navigateToModifier: (id: string) => void;
  navigateToGeometry: (id: string) => void;
  onOpenLocalFeedback: (message: string) => void;
  onReferenceContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onOperationContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}) => {
  const detail = geometry.detail;
  if (activeTab === "geometry") {
    return (
      <div className="explorer-mock-detail-scroll" data-testid="geometry-detail">
        <div className="explorer-mock-detail-heading">
          <div>
            <span className="explorer-mock-eyebrow">Evaluated geometry</span>
            <h3>{geometry.name}</h3>
          </div>
          <span className="explorer-mock-detail-kind">{explorerMockTypeLabel(geometry.kind)}</span>
        </div>
        <PropertyRows values={detail.values} />
        {geometry.kind === "bezier" ? (
          <section className="explorer-mock-detail-section">
            <h4>Bezier anchors</h4>
            <div className="explorer-mock-anchor-table" role="table" aria-label="Bezier anchors">
              <div className="explorer-mock-anchor-row explorer-mock-anchor-header" role="row">
                {["Anchor", "Position", "← In", "Angle", "Out →"].map((label) => <span role="columnheader" key={label}>{label}</span>)}
              </div>
              {BEZIER_ANCHOR_ROWS.map((row) => (
                <div className="explorer-mock-anchor-row" role="row" key={row[0]}>
                  {row.map((cell) => <code role="cell" key={cell}>{cell}</code>)}
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {detail.pathDescription ? (
          <section className="explorer-mock-detail-section">
            <h4>Responsive path</h4>
            <p className="explorer-mock-note"><Info size={13} aria-hidden="true" />{detail.pathDescription}</p>
            <div className="explorer-mock-split-bar" aria-label="Responsive split 42 percent and 58 percent">
              <span style={{ width: "42%" }} />
              <span style={{ width: "58%" }} />
            </div>
          </section>
        ) : null}
        {detail.winningSource && detail.modifierId ? (
            <button type="button" className="explorer-mock-reference-button" onClick={() => navigateToModifier(detail.modifierId!)} onContextMenu={onReferenceContextMenu}>
            <Link size={13} aria-hidden="true" />
            Modifier provenance · {detail.winningSource}
            <ArrowUpRight size={12} aria-hidden="true" />
          </button>
        ) : null}
        <section className="explorer-mock-detail-section"><h4>Source flow</h4><button type="button" className="explorer-mock-operation-entry" onClick={() => onOpenLocalFeedback("Source-flow operation inspected locally.")} onContextMenu={onOperationContextMenu}><Move size={13} aria-hidden="true" /><span>Apply seam allowance</span><small>operation · source flow</small><ArrowUpRight size={12} aria-hidden="true" /></button></section>
        <button type="button" className="explorer-mock-local-action" onClick={() => setActiveTab("dependencies")}>
          <PanelBottom size={13} aria-hidden="true" /> Inspect dependency path
        </button>
      </div>
    );
  }
  if (activeTab === "dependencies") {
    return (
      <div className="explorer-mock-detail-scroll" data-testid="dependencies-detail">
        <div className="explorer-mock-detail-heading"><div><span className="explorer-mock-eyebrow">Dependency graph</span><h3>{geometry.name}</h3></div></div>
        <div className="explorer-mock-dependency-groups">
          <details open><summary>Direct inputs <span>{detail.inputs.length}</span></summary><div className="explorer-mock-reference-list">{detail.inputs.map((id) => <button type="button" className="explorer-mock-reference-button" key={id} onClick={() => navigateToGeometry(id)} onContextMenu={onReferenceContextMenu}>{displayNameFor(id)}<ArrowUpRight size={12} aria-hidden="true" /></button>)}</div></details>
          <details open><summary>Direct dependents <span>{detail.dependents.length}</span></summary><div className="explorer-mock-reference-list">{detail.dependents.map((id) => <button type="button" className="explorer-mock-reference-button" key={id} onClick={() => navigateToGeometry(id)} onContextMenu={onReferenceContextMenu}>{displayNameFor(id)}<ArrowUpRight size={12} aria-hidden="true" /></button>)}</div></details>
          <details><summary>All upstream <span>{detail.upstreamCount}</span></summary><div className="explorer-mock-path-entry"><span>Pattern → {geometry.name}</span><small>representative path</small></div></details>
          <details><summary>All downstream <span>{detail.downstreamCount}</span></summary><div className="explorer-mock-path-entry"><span>{geometry.name} → Seam boundary</span><small>representative path</small></div></details>
        </div>
      </div>
    );
  }
  return (
    <div className="explorer-mock-detail-scroll" data-testid="presentation-detail">
      <div className="explorer-mock-detail-heading"><div><span className="explorer-mock-eyebrow">Effective presentation</span><h3>{geometry.name}</h3></div></div>
      <PropertyRows values={[["Color", geometry.color], ["Width", `${geometry.width.toFixed(1)} mm`], ["Style", geometry.style], ["State", activityLabel[geometry.activity]]]} />
      <div className="explorer-mock-winning-source"><span>Winning source</span><strong>{detail.winningSource ?? "Element declaration"}</strong></div>
      <details className="explorer-mock-cascade"><summary>Cascade / history</summary><div className="explorer-mock-history"><span>Element declaration</span><span>Base Line Style</span></div></details>
      {detail.modifierId ? <button type="button" className="explorer-mock-reference-button" onClick={() => navigateToModifier(detail.modifierId!)} onContextMenu={onReferenceContextMenu}><Link size={13} aria-hidden="true" />Open {displayNameFor(detail.modifierId)}<ArrowUpRight size={12} aria-hidden="true" /></button> : null}
    </div>
  );
};

const GeometrySelectionSummary = ({ selected }: { selected: ExplorerMockGeometry[] }) => {
  const byType = selected.reduce<Record<string, number>>((counts, geometry) => {
    counts[explorerMockTypeLabel(geometry.kind)] = (counts[explorerMockTypeLabel(geometry.kind)] ?? 0) + 1;
    return counts;
  }, {});
  const sharedColors = unionStrings(selected.map((geometry) => geometry.color));
  return (
    <div className="explorer-mock-detail-scroll" data-testid="geometry-selection-summary">
      <div className="explorer-mock-detail-heading"><div><span className="explorer-mock-eyebrow">Selection summary</span><h3>{selected.length} geometries selected</h3></div><Check size={16} aria-hidden="true" /></div>
      <section className="explorer-mock-detail-section"><h4>Type breakdown</h4><div className="explorer-mock-chip-list">{Object.entries(byType).map(([type, count]) => <span className="explorer-mock-chip" key={type}>{type} · {count}</span>)}</div></section>
      <section className="explorer-mock-detail-section"><h4>Shared / mixed presentation</h4><PropertyRows values={[["Color", sharedColors.length === 1 ? sharedColors[0] : "Mixed"], ["Width", unionStrings(selected.map((geometry) => `${geometry.width.toFixed(1)} mm`)).join(" / ")], ["Style", unionStrings(selected.map((geometry) => geometry.style)).join(" / ")]]} /></section>
      <section className="explorer-mock-detail-section"><h4>Modifier coverage</h4><p className="explorer-mock-note"><Layers size={13} aria-hidden="true" />{selected.filter((geometry) => geometry.detail.modifierId).length} of {selected.length} have modifier provenance.</p></section>
      <section className="explorer-mock-detail-section"><h4>Representative action eligibility</h4><div className="explorer-mock-action-grid"><span><Check size={12} aria-hidden="true" /> Inspect</span><span><Check size={12} aria-hidden="true" /> Copy references</span><span className="is-muted"><Minus size={12} aria-hidden="true" /> Batch modify · mock only</span></div></section>
    </div>
  );
};

const ModifierDetail = ({
  selected,
  navigateToGeometry,
  onReferenceContextMenu,
}: {
  selected: ExplorerMockModifier[];
  navigateToGeometry: (id: string) => void;
  onReferenceContextMenu: (event: MouseEvent<HTMLButtonElement>) => void;
}) => {
  if (selected.length > 1) {
    const names = unionStrings(selected.flatMap((modifier) => modifier.effects.map((effect) => effect.name)));
    const profileOverrides = selected.flatMap((modifier) => modifier.profiles.filter((profile) => profile.cells.some((cell) => cell.overridden)).map((profile) => ({ modifier, profile })));
    const profileNames = unionStrings(profileOverrides.map(({ profile }) => profile.name));
    const effectivenessRank = { "Not Effective": 1, "Partially Effective": 2, Effective: 3 } as const;
    const appliedToByLabel = new Map<string, "Effective" | "Partially Effective" | "Not Effective">();
    selected.flatMap((modifier) => modifier.appliedTo).forEach((entry) => {
      const current = appliedToByLabel.get(entry.label);
      if (!current || effectivenessRank[entry.effectiveness] > effectivenessRank[current]) appliedToByLabel.set(entry.label, entry.effectiveness);
    });
    const combinedAppliedTo = [...appliedToByLabel.entries()].map(([label, effectiveness]) => ({ label, effectiveness }));
    return (
      <div className="explorer-mock-detail-scroll" data-testid="modifier-selection-summary">
        <div className="explorer-mock-detail-heading"><div><span className="explorer-mock-eyebrow">Modifier comparison</span><h3>{selected.length} Modifiers selected</h3></div></div>
        <section className="explorer-mock-detail-section"><h4>Shared values</h4><div className="explorer-mock-chip-list"><span className="explorer-mock-chip">Category · {unionStrings(selected.map((modifier) => modifier.category)).length === 1 ? selected[0].category : "Mixed"}</span><span className="explorer-mock-chip">Profiles · {profileNames.length}</span></div></section>
        <section className="explorer-mock-detail-section"><h4>Mixed values</h4><div className="explorer-mock-chip-list">{names.map((name) => <span className="explorer-mock-chip is-muted" key={name}>{name}</span>)}</div></section>
        <section className="explorer-mock-detail-section"><h4>Comparison</h4><div className="explorer-mock-comparison-table" role="table" aria-label="Modifier comparison"><div className="explorer-mock-comparison-row header" role="row"><span>Modifier</span><span>Effect</span><span>Usage</span></div>{selected.map((modifier) => <div className="explorer-mock-comparison-row" role="row" key={modifier.id}><span>{modifier.name}</span><span>{modifier.effectSummary}</span><span>{modifier.usageCount}</span></div>)}</div></section>
        {profileNames.length > 0 ? <section className="explorer-mock-detail-section"><h4>Profile comparison · Drawing Profile</h4>{profileNames.map((profileName) => <div className="explorer-mock-profile-comparison" key={profileName}><strong>{profileName}</strong>{profileOverrides.filter(({ profile }) => profile.name === profileName).map(({ modifier, profile }) => <span key={modifier.id}>{modifier.name}: {profile.cells.map((cell) => cell.value).join(" · ")}</span>)}</div>)}</section> : null}
        <section className="explorer-mock-detail-section"><h4>Applied To · combined local union</h4><EffectivenessGroup label="Effective" entries={combinedAppliedTo.filter((entry) => entry.effectiveness === "Effective")} /><EffectivenessGroup label="Partially Effective" entries={combinedAppliedTo.filter((entry) => entry.effectiveness === "Partially Effective")} /><EffectivenessGroup label="Not Effective" entries={combinedAppliedTo.filter((entry) => entry.effectiveness === "Not Effective")} /></section>
      </div>
    );
  }
  const modifier = selected[0];
  if (!modifier) return null;
  const groups = (effectiveness: "Effective" | "Partially Effective" | "Not Effective") => modifier.appliedTo.filter((entry) => entry.effectiveness === effectiveness);
  return (
    <div className="explorer-mock-detail-scroll" data-testid="modifier-detail">
      <div className="explorer-mock-detail-heading"><div><span className="explorer-mock-eyebrow">Modifier detail</span><h3>{modifier.name}</h3></div>{modifier.profileOnly ? <span className="explorer-mock-profile-only">Profile only</span> : null}</div>
      {modifier.zeroUse ? <p className="explorer-mock-warning"><AlertTriangle size={13} aria-hidden="true" /> Static fixture: this Modifier has no current uses.</p> : null}
      <section className="explorer-mock-detail-section"><h4>Effects</h4><div className="explorer-mock-effect-list">{modifier.effects.map((effect) => <div className={`explorer-mock-effect effectiveness-${effect.effectiveness.replaceAll(" ", "-").toLocaleLowerCase()}`} key={effect.name}><span>{effect.name}</span><code>{effect.value}</code><small>{effect.effectiveness}</small></div>)}</div></section>
      <section className="explorer-mock-detail-section"><h4>Profiles</h4>{modifier.profiles.map((profile) => <div className="explorer-mock-profile-card" key={profile.name}><strong>{profile.name}</strong><div>{profile.cells.map((cell) => <span className={cell.overridden ? "is-overridden" : ""} key={cell.label}><small>{cell.label}</small><code>{cell.value}</code></span>)}</div></div>)}</section>
      <details className="explorer-mock-applied-to"><summary>Applied To <span>{modifier.appliedTo.length}</span></summary>{modifier.profileOnly ? <EffectivenessGroup label="Profile Only" entries={modifier.appliedTo} /> : <><EffectivenessGroup label="Effective" entries={groups("Effective")} /><EffectivenessGroup label="Partially Effective" entries={groups("Partially Effective")} /><EffectivenessGroup label="Not Effective" entries={groups("Not Effective")} /></>}</details>
      {modifier.appliedTo[0] ? <button type="button" className="explorer-mock-reference-button" onClick={() => navigateToGeometry(explorerMockGeometry.find((geometry) => geometry.name === modifier.appliedTo[0]?.label.split(" · ")[0])?.id ?? "front-contour")} onContextMenu={onReferenceContextMenu}><Link size={13} aria-hidden="true" />Open a referenced geometry<ArrowUpRight size={12} aria-hidden="true" /></button> : null}
    </div>
  );
};

const ScopedTabStrip = <Tab extends string>({
  activeTab,
  tabs,
  onChange,
  className,
  ariaLabel,
  testId,
}: {
  activeTab: Tab;
  tabs: ReadonlyArray<readonly [Tab, ReactNode]>;
  onChange: (tab: Tab) => void;
  className: string;
  ariaLabel: string;
  testId: string;
}) => {
  const lastWheelAtRef = useRef(0);
  const moveTab = useCallback((offset: number) => {
    const index = tabs.findIndex(([tab]) => tab === activeTab);
    if (index < 0) return;
    onChange(tabs[Math.max(0, Math.min(tabs.length - 1, index + offset))][0]);
  }, [activeTab, onChange, tabs]);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); moveTab(-1); }
    if (event.key === "ArrowRight") { event.preventDefault(); moveTab(1); }
    if (event.key === "Home") { event.preventDefault(); onChange(tabs[0][0]); }
    if (event.key === "End") { event.preventDefault(); onChange(tabs[tabs.length - 1][0]); }
  };
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (Math.abs(delta) < 0.1) return;
    const now = Date.now();
    if (now - lastWheelAtRef.current < 120) { event.preventDefault(); return; }
    lastWheelAtRef.current = now;
    event.preventDefault();
    moveTab(delta > 0 ? 1 : -1);
  };
  return <div className={className} role="tablist" aria-label={ariaLabel} tabIndex={0} onKeyDown={onKeyDown} onWheel={onWheel} data-testid={testId}>
    {tabs.map(([tab, label]) => <button type="button" role="tab" aria-selected={activeTab === tab} tabIndex={activeTab === tab ? 0 : -1} className={activeTab === tab ? "is-active" : ""} key={tab} onClick={() => onChange(tab)}>{label}</button>)}
  </div>;
};

const DetailTabs = ({ activeTab, onChange }: { activeTab: DetailTab; onChange: (tab: DetailTab) => void }) => (
  <ScopedTabStrip activeTab={activeTab} tabs={DETAIL_TABS} onChange={onChange} className="explorer-mock-detail-tabs" ariaLabel="Geometry detail" testId="detail-tab-strip" />
);

const ContextMenu = ({ menu, onClose, onFeedback }: { menu: ContextMenuState; onClose: () => void; onFeedback: (message: string) => void }) => {
  const actions = menu.kind === "background" ? ["Inspect Explorer", "Create mock geometry"] : menu.kind === "reference" ? ["Navigate locally", "Copy reference"] : menu.kind === "operation" ? ["Inspect source flow", "Copy operation"] : ["Navigate", "Inspect", "Copy", "Modify"];
  return <div className="explorer-mock-context-menu" role="menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()}>{actions.map((action) => <button type="button" role="menuitem" key={action} onClick={() => { onFeedback(`${action} is local to this mock.`); onClose(); }}>{action}</button>)}</div>;
};

export const ExplorerMockApp = ({ api }: { api: VscodeWebviewApi }) => {
  void api;
  const [activeTab, setActiveTab] = useState<ExplorerMockTab>("elements");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [alternateBranchRevealed, setAlternateBranchRevealed] = useState(false);
  const [selectedByTab, setSelectedByTab] = useState<Record<ExplorerMockTab, string[]>>({ elements: [], modifiers: [] });
  const [rangeAnchorByTab, setRangeAnchorByTab] = useState<Record<ExplorerMockTab, string | null>>({ elements: null, modifiers: null });
  const [detailTabByTab, setDetailTabByTab] = useState<Record<ExplorerMockTab, DetailTab>>({ elements: "geometry", modifiers: "geometry" });
  const [detailHeightByTab, setDetailHeightByTab] = useState<Record<ExplorerMockTab, number>>({ elements: 260, modifiers: 260 });
  const [scrollTopByTab, setScrollTopByTab] = useState<Record<ExplorerMockTab, number>>({ elements: 0, modifiers: 0 });
  const [search, setSearch] = useState("");
  const [filtersByTab, setFiltersByTab] = useState<Record<ExplorerMockTab, StructuredFilter>>({ elements: createEmptyFilter(), modifiers: createEmptyFilter() });
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [flatResults, setFlatResults] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const listScrollRefs = useRef<Record<ExplorerMockTab, HTMLDivElement | null>>({ elements: null, modifiers: null });
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const filterPopoverRef = useRef<HTMLDivElement | null>(null);
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);

  const activeFilter = filtersByTab[activeTab];
  const activeFilterChips = filterChipsFor(activeTab, activeFilter);
  const resultMode = search.trim().length > 0 || activeFilterChips.length > 0;
  const actualGeometryMatches = useMemo(
    () => explorerMockGeometry.filter((geometry) => isActualGeometryMatch(geometry, search, activeFilter) && branchIsVisible(geometry, alternateBranchRevealed)),
    [activeFilter, alternateBranchRevealed, search]
  );
  const actualModifierMatches = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return explorerMockModifiers.filter((modifier) => {
      const searchMatch = !normalizedSearch || [modifier.name, modifier.effectSummary, modifier.category].some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
      const filterMatch = activeFilter.category === "all" || modifier.category === activeFilter.category;
      return searchMatch && filterMatch;
    });
  }, [activeFilter, search]);
  const actualMatchIds = useMemo(() => new Set(actualGeometryMatches.map((geometry) => geometry.id)), [actualGeometryMatches]);
  const selectedIds = selectedByTab[activeTab];
  const selectedGeometry = selectedIds.map((id) => explorerMockGeometryById.get(id)).filter((geometry): geometry is ExplorerMockGeometry => Boolean(geometry));
  const selectedModifiers = selectedIds.map((id) => explorerMockModifierById.get(id)).filter((modifier): modifier is ExplorerMockModifier => Boolean(modifier));

  const visibleGeometryRows = useMemo(() => {
    if (resultMode && flatResults) return actualGeometryMatches;
    const rows: ExplorerMockGeometry[] = [];
    const walk = (parentId: string | null) => {
      for (const geometry of explorerMockChildrenOf(parentId)) {
        if (geometry.kind === "operation") continue;
        if (!branchIsVisible(geometry, alternateBranchRevealed)) continue;
        const matchingDescendant = actualGeometryMatches.some((match) => explorerMockAncestorsOf(match.id).includes(geometry.id));
        const include = !resultMode || actualMatchIds.has(geometry.id) || matchingDescendant || explorerMockAncestorsOf(geometry.id).some((id) => actualMatchIds.has(id));
        if (include) rows.push(geometry);
        if (explorerMockIsContainer(geometry) && (expanded.has(geometry.id) || (resultMode && matchingDescendant)) && (!resultMode || include)) walk(geometry.id);
      }
    };
    walk(null);
    return rows;
  }, [actualGeometryMatches, actualMatchIds, alternateBranchRevealed, expanded, flatResults, resultMode]);

  const selectedIdsSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    const scrollElement = listScrollRefs.current[activeTab];
    if (scrollElement) scrollElement.scrollTop = scrollTopByTab[activeTab];
  }, [activeTab, scrollTopByTab]);

  useEffect(() => {
    if (!isResizing) return undefined;
    const onPointerMove = (event: globalThis.PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) return;
      setDetailHeightByTab((heights) => ({ ...heights, [activeTab]: Math.max(160, Math.min(520, start.height - (event.clientY - start.y))) }));
    };
    const onPointerUp = () => { setIsResizing(false); resizeStartRef.current = null; };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); };
  }, [activeTab, isResizing]);

  useEffect(() => {
    if (!isFilterOpen) return undefined;
    const isInsideFilter = (target: EventTarget | null): boolean => {
      if (!(target instanceof globalThis.Node)) return false;
      return Boolean(filterPopoverRef.current?.contains(target) || filterButtonRef.current?.contains(target));
    };
    const dismissOnOutside = (event: Event) => {
      if (!isInsideFilter(event.target)) setIsFilterOpen(false);
    };
    const dismissOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setIsFilterOpen(false);
    };
    document.addEventListener("pointerdown", dismissOnOutside);
    document.addEventListener("click", dismissOnOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutside);
      document.removeEventListener("click", dismissOnOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [isFilterOpen]);

  useEffect(() => {
    if (!feedback) return undefined;
    const timer = window.setTimeout(() => setFeedback(null), 2400);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const visibleModifiers = resultMode ? actualModifierMatches : explorerMockModifiers;
  const currentRows = activeTab === "elements" ? visibleGeometryRows : visibleModifiers;
  const selectableRows = currentRows.map((row) => row.id);

  const selectRow = (id: string, event: MouseEvent<HTMLButtonElement>) => {
    const isToggle = event.metaKey || event.ctrlKey;
    const anchor = rangeAnchorByTab[activeTab];
    let next: string[];
    if (event.shiftKey && anchor) {
      const start = selectableRows.indexOf(anchor);
      const end = selectableRows.indexOf(id);
      if (start >= 0 && end >= 0) next = selectableRows.slice(Math.min(start, end), Math.max(start, end) + 1);
      else next = [id];
    } else if (isToggle) {
      next = selectedIdsSet.has(id) ? selectedIds.filter((selectedId) => selectedId !== id) : [...selectedIds, id];
    } else {
      next = [id];
    }
    setSelectedByTab((tabs) => ({ ...tabs, [activeTab]: next }));
    if (!event.shiftKey) setRangeAnchorByTab((anchors) => ({ ...anchors, [activeTab]: id }));
  };

  const updateFilter = (axis: FilterAxis, value: string) => {
    setFiltersByTab((filters) => {
      const next = { ...filters[activeTab] };
      if (axis === "type") next.type = value as StructuredFilter["type"];
      if (axis === "activity") next.activity = value as StructuredFilter["activity"];
      if (axis === "diagnostics") next.diagnostics = value as DiagnosticFilterValue;
      if (axis === "groupModule") next.groupModule = value;
      if (axis === "category") next.category = value as StructuredFilter["category"];
      return { ...filters, [activeTab]: next };
    });
  };
  const resetFilter = (axis: FilterAxis) => updateFilter(axis, "all");
  const clearSelection = () => {
    setSelectedByTab((tabs) => ({ ...tabs, [activeTab]: [] }));
    setRangeAnchorByTab((anchors) => ({ ...anchors, [activeTab]: null }));
  };
  const selectAllMatches = () => setSelectedByTab((tabs) => ({ ...tabs, [activeTab]: (activeTab === "elements" ? actualGeometryMatches : actualModifierMatches).map((row) => row.id) }));

  const navigateToModifier = (id: string) => {
    setSelectedByTab((tabs) => ({ ...tabs, modifiers: [id] }));
    setRangeAnchorByTab((anchors) => ({ ...anchors, modifiers: id }));
    setActiveTab("modifiers");
    setFeedback(`Selected ${displayNameFor(id)} in the local Modifiers mock.`);
  };
  const navigateToGeometry = (id: string) => {
    const ancestors = explorerMockAncestorsOf(id);
    setExpanded((current) => new Set([...current, ...ancestors]));
    setSelectedByTab((tabs) => ({ ...tabs, elements: [id] }));
    setRangeAnchorByTab((anchors) => ({ ...anchors, elements: id }));
    setActiveTab("elements");
    setFeedback(`Revealed ${displayNameFor(id)} in the local Elements mock.`);
  };

  const beginResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStartRef.current = { y: event.clientY, height: detailHeightByTab[activeTab] };
    setIsResizing(true);
  };

  const renderGeometryRow = (geometry: ExplorerMockGeometry, contextual = false) => {
    const GeometryIcon = geometryIconFor(geometry.kind);
    const ActivityIcon = iconForActivity(geometry.activity);
    const isExpanded = expanded.has(geometry.id);
    const isBranchRow = geometry.id === "branch-fit";
    const hasChildren = explorerMockIsContainer(geometry);
    return <button
      type="button"
      className={`explorer-mock-row ${selectedIdsSet.has(geometry.id) ? "is-selected" : ""} ${contextual ? "is-contextual" : ""} ${geometry.activity !== "visible" ? `activity-${geometry.activity}` : ""}`}
      style={{ "--row-depth": `${explorerMockAncestorsOf(geometry.id).length}` } as CSSProperties}
      data-testid={`geometry-row-${geometry.id}`}
      data-match={actualMatchIds.has(geometry.id) ? "true" : "false"}
      onClick={(event) => selectRow(geometry.id, event)}
      onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, kind: geometry.kind === "operation" ? "operation" : "row", id: geometry.id }); }}
      title={`${geometryHierarchyPath(geometry)} · ${explorerMockTypeLabel(geometry.kind)}`}
    >
      <span className="explorer-mock-rail-cell" aria-hidden="true">{hasChildren ? <span className="explorer-mock-disclosure" onClick={(event) => { event.stopPropagation(); setExpanded((current) => { const next = new Set(current); if (next.has(geometry.id)) next.delete(geometry.id); else next.add(geometry.id); return next; }); }} role="presentation">{isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span> : null}</span>
      <GeometryIcon className="explorer-mock-geometry-icon" size={14} aria-hidden="true" />
      <span className={`explorer-mock-diagnostic-slot ${geometry.diagnostic ? `diagnostic-${geometry.diagnostic.severity}` : ""}`} title={geometry.diagnostic?.message}>{geometry.diagnostic ? <AlertTriangle size={12} aria-label={geometry.diagnostic.severity} /> : null}</span>
      <span className="explorer-mock-name">{geometry.name}</span>
      <span className="explorer-mock-type-badge" data-testid={`geometry-type-${geometry.id}`}>{explorerMockTypeLabel(geometry.kind)}</span>
      <span className="explorer-mock-module-cue">{geometry.moduleOrigin ? `Module · ${geometry.moduleOrigin}` : ""}</span>
      <span className="explorer-mock-activity-slot">{ActivityIcon ? <ActivityIcon size={13} aria-label={activityLabel[geometry.activity]} /> : null}</span>
      <span className="explorer-mock-color-swatch" style={{ backgroundColor: geometry.color }} aria-label={`Color ${geometry.color}`} />
      <span className={`explorer-mock-line-preview style-${geometry.style}`} style={{ "--line-width": `${Math.min(3, geometry.width)}px` } as CSSProperties} aria-label={`${geometry.style} line`} />
      <span className="explorer-mock-width">{geometry.width.toFixed(1)}</span>
      {isBranchRow ? <span className="explorer-mock-branch-affordance" role="button" aria-label={alternateBranchRevealed ? "Hide alternate branch" : "Reveal alternate branch"} onClick={(event) => { event.stopPropagation(); setAlternateBranchRevealed((visible) => !visible); }}><GitBranch size={12} /></span> : null}
    </button>;
  };

  const renderModifierRow = (modifier: ExplorerMockModifier) => <button
    type="button"
    className={`explorer-mock-modifier-row explorer-mock-row ${selectedIdsSet.has(modifier.id) ? "is-selected" : ""}`}
    data-testid={`modifier-row-${modifier.id}`}
    onClick={(event) => selectRow(modifier.id, event)}
    onContextMenu={(event) => { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, kind: "row", id: modifier.id }); }}
  >
    <span className="explorer-mock-modifier-icon"><Layers size={14} aria-hidden="true" /></span>
    <span className="explorer-mock-name">{modifier.name}</span>
    {modifier.profileOnly ? <span className="explorer-mock-profile-only">Profile only</span> : <span />}
    <span className="explorer-mock-modifier-summary">{modifier.effectSummary}</span>
    <span className="explorer-mock-usage">{modifier.usageCount} uses</span>
    {modifier.zeroUse ? <AlertTriangle size={12} aria-label="Unused Modifier" /> : null}
  </button>;

  const detailVisible = selectedIds.length > 0;
  const detailTab = detailTabByTab[activeTab];
  const openOperationContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, kind: "operation", id: "operation-seam-flow" });
  };
  const openReferenceContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, kind: "reference" });
  };

  return <main className="explorer-mock" onPointerDown={() => { if (contextMenu) setContextMenu(null); }} onContextMenu={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, kind: "background" }); } }}>
    <header className="explorer-mock-header">
      <div className="explorer-mock-title-row"><div><span className="explorer-mock-eyebrow">nuinuiCAD Explorer</span><h1>Explorer Mock</h1><span className="explorer-mock-fixture-cue" data-testid="static-fixture-cue">Static fixture · Bodice.nui</span></div><button type="button" className="explorer-mock-more-button" aria-label="Explorer Mock actions" onClick={() => setFeedback("Explorer actions are local to this mock.")}><MoreHorizontal size={16} /></button></div>
      <div className="explorer-mock-header-actions"><button type="button" onClick={() => setFeedback("Go to Source is represented locally in this mock.")}><FileCode size={13} /> Go to Source</button><button type="button" onClick={() => setFeedback("Reveal in Canvas is represented locally in this mock.")}><Square size={13} /> Reveal in Canvas</button></div>
    </header>
    <ScopedTabStrip activeTab={activeTab} tabs={EXPLORER_TABS} onChange={setActiveTab} className="explorer-mock-top-tabs" ariaLabel="Explorer data" testId="top-tab-strip" />
    <section className="explorer-mock-list-region" aria-label={activeTab === "elements" ? "Elements hierarchy" : "Modifiers list"}>
      <div className="explorer-mock-search-row"><div className="explorer-mock-search-field"><Search size={14} aria-hidden="true" /><input aria-label="Search Explorer Mock" placeholder="Search" value={search} onChange={(event) => setSearch(event.currentTarget.value)} /><button type="button" className="explorer-mock-clear-search" aria-label="Clear search" hidden={!search} onClick={() => setSearch("")}><X size={13} /></button></div><div className="explorer-mock-filter-wrap"><button ref={filterButtonRef} type="button" className={activeFilterChips.length > 0 ? "has-filters" : ""} aria-expanded={isFilterOpen} onClick={() => setIsFilterOpen((open) => !open)}><SlidersHorizontal size={14} /> Filter</button>{isFilterOpen ? <FilterPopover tab={activeTab} filter={activeFilter} popoverRef={filterPopoverRef} onChange={updateFilter} onDone={() => setIsFilterOpen(false)} /> : null}</div></div>
      {activeFilterChips.length > 0 ? <div className="explorer-mock-filter-chips" aria-label="Active filters">{activeFilterChips.map((filter) => <button type="button" className="explorer-mock-filter-chip" key={filter.axis} onClick={() => resetFilter(filter.axis)}>{filterChipLabel(filter)} <X size={11} /></button>)}</div> : null}
      {resultMode ? <div className="explorer-mock-result-header"><span>{activeTab === "elements" ? actualGeometryMatches.length : actualModifierMatches.length} results</span><button type="button" onClick={selectAllMatches}>Select All</button>{activeTab === "elements" ? <div className="explorer-mock-result-mode"><button type="button" className={!flatResults ? "is-active" : ""} aria-pressed={!flatResults} onClick={() => setFlatResults(false)}>Hierarchy</button><button type="button" className={flatResults ? "is-active" : ""} aria-pressed={flatResults} onClick={() => setFlatResults(true)}>Flat</button></div> : null}</div> : null}
      <div className="explorer-mock-scroll" ref={(element) => { listScrollRefs.current[activeTab] = element; }} onScroll={(event) => setScrollTopByTab((scroll) => ({ ...scroll, [activeTab]: event.currentTarget.scrollTop }))} onContextMenu={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); setContextMenu({ x: event.clientX, y: event.clientY, kind: "background" }); } }}>
        {activeTab === "elements" ? visibleGeometryRows.map((geometry) => renderGeometryRow(geometry, resultMode && !actualMatchIds.has(geometry.id))) : visibleModifiers.map(renderModifierRow)}
        {((activeTab === "elements" && visibleGeometryRows.length === 0) || (activeTab === "modifiers" && visibleModifiers.length === 0)) ? <div className="explorer-mock-empty"><Search size={16} />No matching {activeTab === "elements" ? "geometry" : "Modifier"}.</div> : null}
      </div>
    </section>
    {detailVisible ? <section className="explorer-mock-detail-region" style={{ height: `${detailHeightByTab[activeTab]}px` }} aria-label="Selection Detail"><div className="explorer-mock-resize-divider" role="separator" aria-orientation="horizontal" aria-label="Resize Selection Detail" tabIndex={0} onPointerDown={beginResize}><span /></div><div className="explorer-mock-detail-header"><span>Selection Detail</span><div className="explorer-mock-detail-actions"><span>{selectedIds.length} selected</span><button type="button" className="explorer-mock-clear-selection" aria-label="Clear selection" title="Clear selection" onClick={clearSelection}><X size={12} /> Clear</button></div></div>{activeTab === "elements" && selectedGeometry.length === 1 ? <><DetailTabs activeTab={detailTab} onChange={(tab) => setDetailTabByTab((tabs) => ({ ...tabs, elements: tab }))} /><GeometryDetail geometry={selectedGeometry[0]} activeTab={detailTab} setActiveTab={(tab) => setDetailTabByTab((tabs) => ({ ...tabs, elements: tab }))} navigateToModifier={navigateToModifier} navigateToGeometry={navigateToGeometry} onOpenLocalFeedback={setFeedback} onReferenceContextMenu={openReferenceContextMenu} onOperationContextMenu={openOperationContextMenu} /></> : activeTab === "elements" ? <GeometrySelectionSummary selected={selectedGeometry} /> : <ModifierDetail selected={selectedModifiers} navigateToGeometry={navigateToGeometry} onReferenceContextMenu={openReferenceContextMenu} />}</section> : null}
    {feedback ? <div className="explorer-mock-feedback" role="status">{feedback}</div> : null}
    {contextMenu ? <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} onFeedback={setFeedback} /> : null}
  </main>;
};
