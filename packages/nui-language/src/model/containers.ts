import type {
  CadElement,
  ConditionalGroupElement,
  ForGroupElement,
  GroupElement,
  ModuleInstanceElement
} from "../types/geometry";

export type ContainerElement =
  | GroupElement
  | ConditionalGroupElement
  | ForGroupElement
  | ModuleInstanceElement;

export type ContainerElementType = ContainerElement["type"];

export const isContainerElementType = (elementType: string): elementType is ContainerElementType =>
  elementType === "group" ||
  elementType === "conditionalGroup" ||
  elementType === "forGroup" ||
  elementType === "moduleInstance";

export const isContainerElement = (element: CadElement): element is ContainerElement =>
  isContainerElementType(element.type);
