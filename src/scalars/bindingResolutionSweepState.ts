import type { Binding, BindingCatalog } from "./bindingCatalog";
import type { ScopeId } from "./lexicalScopeIndex";

export type ScopeFrame = {
  scopeId: ScopeId;
  iterationNames: ReadonlyMap<string, readonly Binding[]>;
  typedNames: Map<string, Binding[]>;
  /** Mutable owner lane; bindings are stored once and survive frame exit. */
  legacyNames: Map<string, Binding[]> | null;
  legacyOwnerId: string | null;
  mergeLegacyWithLexical: boolean;
  activeNames: Set<string>;
};

export type MutableLegacyLanes = {
  globalNames: Map<string, Binding[]>;
  outsideGroupsNames: Map<string, Binding[]>;
  groupNamesByOwner: Map<string, Map<string, Binding[]>>;
  activeFramesByOwner: Map<string, ScopeFrame[]>;
  rootFrame: ScopeFrame | null;
};

const isAncestor = (catalog: BindingCatalog, ancestorId: ScopeId, descendantId: ScopeId) => {
  const ancestor = catalog.scopeIndex.scopeMetadataById.get(ancestorId);
  const descendant = catalog.scopeIndex.scopeMetadataById.get(descendantId);
  return !!ancestor && !!descendant && ancestor.treeEnter <= descendant.treeEnter && descendant.treeEnter < ancestor.treeExit;
};

export const activateName = (frame: ScopeFrame, name: string, activeByName: Map<string, ScopeFrame[]>) => {
  if (frame.activeNames.has(name)) return;
  frame.activeNames.add(name);
  const stack = activeByName.get(name) ?? [];
  stack.push(frame);
  activeByName.set(name, stack);
};

export const createMutableLegacyLanes = (): MutableLegacyLanes => ({
  globalNames: new Map(),
  outsideGroupsNames: new Map(),
  groupNamesByOwner: new Map(),
  activeFramesByOwner: new Map(),
  rootFrame: null
});

export const transitionScopeFrames = (
  catalog: BindingCatalog,
  frames: ScopeFrame[],
  activeByName: Map<string, ScopeFrame[]>,
  targetScopeId: ScopeId,
  legacyLanes: MutableLegacyLanes | null,
  onEnter: (frame: ScopeFrame) => void
) => {
  while (frames.length && !isAncestor(catalog, frames[frames.length - 1].scopeId, targetScopeId)) {
    const frame = frames.pop()!;
    for (const name of frame.activeNames) activeByName.get(name)?.pop();
    if (legacyLanes && frame.legacyOwnerId) legacyLanes.activeFramesByOwner.get(frame.legacyOwnerId)?.pop();
    if (legacyLanes && frame.scopeId === catalog.scopeIndex.rootScopeId) legacyLanes.rootFrame = null;
  }
  const entering: ScopeId[] = [];
  let current: ScopeId | null = targetScopeId;
  while (current && (!frames.length || current !== frames[frames.length - 1].scopeId)) {
    entering.push(current);
    current = catalog.scopeIndex.scopeMetadataById.get(current)?.parentId ?? null;
  }
  for (let index = entering.length - 1; index >= 0; index -= 1) {
    const scopeId = entering[index];
    const containerId = catalog.containerIndex.containerIdByScopeId.get(scopeId) ?? null;
    const legacyNames = containerId && legacyLanes
      ? (legacyLanes.groupNamesByOwner.get(containerId) ?? new Map<string, Binding[]>())
      : null;
    if (containerId && legacyLanes && !legacyLanes.groupNamesByOwner.has(containerId)) {
      legacyLanes.groupNamesByOwner.set(containerId, legacyNames!);
    }
    const frame: ScopeFrame = {
      scopeId,
      iterationNames: catalog.lookupNamespaces.iterationByScopeAndName.get(scopeId) ?? new Map(),
      typedNames: new Map(),
      legacyNames,
      legacyOwnerId: containerId,
      mergeLegacyWithLexical: !!containerId && catalog.containerIndex.effectiveScopeIdByContainerId.get(containerId) === scopeId,
      activeNames: new Set()
    };
    frames.push(frame);
    if (legacyLanes) {
      if (containerId) {
        const ownerFrames = legacyLanes.activeFramesByOwner.get(containerId) ?? [];
        ownerFrames.push(frame);
        legacyLanes.activeFramesByOwner.set(containerId, ownerFrames);
      }
      if (scopeId === catalog.scopeIndex.rootScopeId) legacyLanes.rootFrame = frame;
    }
    onEnter(frame);
  }
};

export const addTypedBindingToFrame = (frame: ScopeFrame, binding: Binding) => {
  const bucket = frame.typedNames.get(binding.name) ?? [];
  bucket.push(binding);
  frame.typedNames.set(binding.name, bucket);
};

export const addTypedBinding = (frame: ScopeFrame, binding: Binding, activeByName: Map<string, ScopeFrame[]>) => {
  addTypedBindingToFrame(frame, binding);
  activateName(frame, binding.name, activeByName);
};

export const activateFrameNames = (
  catalog: BindingCatalog,
  frame: ScopeFrame,
  activeByName: Map<string, ScopeFrame[]>,
  legacyLanes: MutableLegacyLanes | null
) => {
  for (const name of frame.iterationNames.keys()) activateName(frame, name, activeByName);
  for (const name of frame.legacyNames?.keys() ?? []) activateName(frame, name, activeByName);
  if (!legacyLanes || frame.scopeId !== catalog.scopeIndex.rootScopeId) return;
  for (const name of legacyLanes.globalNames.keys()) activateName(frame, name, activeByName);
  for (const name of legacyLanes.outsideGroupsNames.keys()) activateName(frame, name, activeByName);
};

const appendBinding = (names: Map<string, Binding[]>, binding: Binding) => {
  const bucket = names.get(binding.name) ?? [];
  bucket.push(binding);
  names.set(binding.name, bucket);
};

export const activateLegacyBinding = (
  binding: Binding,
  lanes: MutableLegacyLanes,
  activeByName: Map<string, ScopeFrame[]>
) => {
  if (binding.visibility.kind === "global") {
    appendBinding(lanes.globalNames, binding);
    if (lanes.rootFrame) activateName(lanes.rootFrame, binding.name, activeByName);
    return;
  }
  if (binding.visibility.kind === "outsideGroups") {
    appendBinding(lanes.outsideGroupsNames, binding);
    if (lanes.rootFrame) activateName(lanes.rootFrame, binding.name, activeByName);
    return;
  }
  if (binding.visibility.kind !== "groupSubtree") return;
  const names = lanes.groupNamesByOwner.get(binding.visibility.ownerContainerId) ?? new Map<string, Binding[]>();
  appendBinding(names, binding);
  lanes.groupNamesByOwner.set(binding.visibility.ownerContainerId, names);
  for (const frame of lanes.activeFramesByOwner.get(binding.visibility.ownerContainerId) ?? []) {
    activateName(frame, binding.name, activeByName);
  }
};
