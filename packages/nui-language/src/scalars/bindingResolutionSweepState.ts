import type { Binding, BindingCatalog } from "./bindingCatalog";
import type { ScopeId } from "./lexicalScopeIndex";

export type ScopeFrame = {
  scopeId: ScopeId;
  iterationNames: ReadonlyMap<string, readonly Binding[]>;
  typedNames: Map<string, Binding[]>;
  activeNames: Set<string>;
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

export const transitionScopeFrames = (
  catalog: BindingCatalog,
  frames: ScopeFrame[],
  activeByName: Map<string, ScopeFrame[]>,
  targetScopeId: ScopeId,
  onEnter: (frame: ScopeFrame) => void
) => {
  while (frames.length && !isAncestor(catalog, frames[frames.length - 1].scopeId, targetScopeId)) {
    const frame = frames.pop()!;
    for (const name of frame.activeNames) activeByName.get(name)?.pop();
  }
  const entering: ScopeId[] = [];
  let current: ScopeId | null = targetScopeId;
  while (current && (!frames.length || current !== frames[frames.length - 1].scopeId)) {
    entering.push(current);
    current = catalog.scopeIndex.scopeMetadataById.get(current)?.parentId ?? null;
  }
  for (let index = entering.length - 1; index >= 0; index -= 1) {
    const scopeId = entering[index];
    const frame: ScopeFrame = {
      scopeId,
      iterationNames: catalog.lookupNamespaces.iterationByScopeAndName.get(scopeId) ?? new Map(),
      typedNames: new Map(),
      activeNames: new Set()
    };
    frames.push(frame);
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
  frame: ScopeFrame,
  activeByName: Map<string, ScopeFrame[]>
) => {
  for (const name of frame.iterationNames.keys()) activateName(frame, name, activeByName);
};
