import { dispatchCommand } from "../commands/commands";
import type { CommandId } from "../commands/commands";
import type { CommandRibbonIconId } from "../commandRibbons/commandRibbonSettings";
import {
  commandRibbonIconColorValues,
  type CommandRibbonIconColor
} from "../commandRibbons/commandRibbonSettings";
import { commandRibbonIconComponents } from "../commandRibbons/commandRibbonIcons";

type LeftPanelActionRibbonProps = {
  isSearchActive: boolean;
};

type LeftPanelActionButton = {
  commandId: CommandId;
  label: string;
  icon: CommandRibbonIconId;
  iconColor?: CommandRibbonIconColor;
  disabledWhenSearching?: boolean;
};

const actionButtons: LeftPanelActionButton[] = [
  {
    commandId: "moveSelectedElementUp",
    label: "選択要素を上へ",
    icon: "arrow-up",
    disabledWhenSearching: true
  },
  {
    commandId: "moveSelectedElementDown",
    label: "選択要素を下へ",
    icon: "arrow-down",
    disabledWhenSearching: true
  },
  {
    commandId: "duplicateSelectedElement",
    label: "選択要素を複製",
    icon: "copy"
  },
  {
    commandId: "toggleSelectedElementVisibility",
    label: "表示/非表示を切替",
    icon: "eye"
  },
  {
    commandId: "toggleSelectedElementEnabled",
    label: "評価する/しないを切替",
    icon: "toggle-right"
  },
  {
    commandId: "deleteSelectedElement",
    label: "選択要素を削除",
    icon: "trash",
    iconColor: "red"
  }
];

export const LeftPanelActionRibbon = ({ isSearchActive }: LeftPanelActionRibbonProps) => (
  <div className="left-panel-action-ribbon" aria-label="選択要素の操作">
    {actionButtons.map((button) => {
      const Icon = commandRibbonIconComponents[button.icon];
      const disabled = button.disabledWhenSearching === true && isSearchActive;
      return (
        <button
          key={button.commandId}
          type="button"
          className="left-panel-action-ribbon-button"
          aria-label={button.label}
          title={button.label}
          disabled={disabled}
          onClick={() => dispatchCommand(button.commandId)}
        >
          <Icon
            aria-hidden="true"
            size={16}
            strokeWidth={2}
            style={{
              color: commandRibbonIconColorValues[button.iconColor ?? "default"]
            }}
          />
        </button>
      );
    })}
  </div>
);
