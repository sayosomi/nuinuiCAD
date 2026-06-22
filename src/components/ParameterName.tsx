import { getParameterDefinitions } from "../parameters/parameterDefinitions";
import type { ParameterKey } from "../parameters/parameterDefinitions";
import type { CadElement } from "../types/geometry";

export const ParameterName = ({
  element,
  parameterKey,
  label
}: {
  element: CadElement;
  parameterKey: ParameterKey;
  label: string;
}) => {
  const definition = getParameterDefinitions(element).find((parameter) => parameter.key === parameterKey);
  return (
    <span className="parameter-name">
      <kbd>{definition?.directKey}</kbd>
      {label}
    </span>
  );
};
