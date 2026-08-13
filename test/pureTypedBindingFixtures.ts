export const PURE_TYPED_BINDING_SIZES = [250, 1_000] as const;

export const buildPureTypedBindingSource = (bindingCount: number) => {
  const lines = ["nui 4"];
  for (let index = 0; index < bindingCount; index += 1) {
    const declaration = index % 2 === 0 ? "const" : "let";
    const initializer = index === 0 ? "0" : `@V${index - 1} + 1`;
    lines.push(`${declaration} V${index}: number = ${initializer}`);
  }
  return {
    source: lines.join("\n"),
    scale: { referenceCount: Math.max(0, bindingCount - 1) }
  };
};
