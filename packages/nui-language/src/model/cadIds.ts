import type { CadElementType } from "../types/geometry";

let idSequence = 1;

export const createCadElementId = (type: CadElementType) => {
  idSequence += 1;
  return `${type}-${Date.now().toString(36)}-${idSequence}`;
};
