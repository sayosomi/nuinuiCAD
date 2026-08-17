export type NumericReferenceOption = {
  expression: string;
  displayExpression: string;
  label: string;
  detail: string;
  /** `local` is retained only for the generic element-parameter suggestion
   * adapter; element-owned numeric variables no longer produce options. */
  source: "local" | "typed" | "iteration";
  variableId?: string;
};
