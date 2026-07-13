import type { NumericVariableReferenceOption } from "../geometry/variableReferenceOptions";

export const NumericVariableSuggestPopover = ({
  options,
  activeIndex,
  onApply,
  onHover
}: {
  options: NumericVariableReferenceOption[];
  activeIndex: number;
  onApply: (option: NumericVariableReferenceOption) => void;
  onHover: (index: number) => void;
}) => {
  if (options.length === 0) return null;
  return <div className="numeric-variable-suggest-popover" role="listbox" aria-label="変数候補">
    {options.map((option, index) => <button key={option.expression} type="button" role="option" aria-selected={index === activeIndex} className={index === activeIndex ? "active-suggestion" : ""} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => onHover(index)} onClick={() => onApply(option)}><strong>{option.label}</strong><small>{option.detail}</small></button>)}
  </div>;
};
