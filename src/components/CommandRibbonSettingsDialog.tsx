import { useMemo, useState } from "react";
import { dispatchCommand, commandPaletteItems, commands, type CommandId } from "../commands/commands";
import {
  commandRibbonIconSizes,
  defaultCommandRibbonSettings,
  normalizeCommandRibbonSettings,
  saveCommandRibbonSettings,
  type CommandRibbon,
  type CommandRibbonButton,
  type CommandRibbonIconSize,
  type CommandRibbonSettings
} from "../commandRibbons/commandRibbonSettings";
import {
  commandRibbonIconComponents,
  commandRibbonIconIds,
  commandRibbonIconLabels,
  type CommandRibbonIconId
} from "../commandRibbons/commandRibbonIcons";
import { useCadUiStore } from "../state/cadUiStore";

const newId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const firstCommandId = commandPaletteItems[0]?.commandId ?? "addLine";

const commandLabel = (commandId: CommandId) => commands[commandId]?.label ?? commandId;

const defaultButton = (): CommandRibbonButton => ({
  id: newId("button"),
  commandId: firstCommandId,
  icon: "slash",
  label: commandLabel(firstCommandId),
  showLabel: false
});

const defaultRibbon = (index: number): CommandRibbon => ({
  id: newId("ribbon"),
  label: `リボン ${index + 1}`,
  x: null,
  y: 12 + index * 44,
  orientation: "horizontal",
  iconSize: 16,
  buttons: [defaultButton()]
});

const commandSearchText = (commandId: CommandId) =>
  `${commandLabel(commandId)} ${commandId} ${(commands[commandId].palette?.keywords ?? []).join(" ")}`.toLowerCase();

const withRibbon = (
  settings: CommandRibbonSettings,
  ribbonId: string,
  update: (ribbon: CommandRibbon) => CommandRibbon
): CommandRibbonSettings => ({
  version: 1,
  ribbons: settings.ribbons.map((ribbon) => (ribbon.id === ribbonId ? update(ribbon) : ribbon))
});

const withButton = (
  settings: CommandRibbonSettings,
  ribbonId: string,
  buttonId: string,
  update: (button: CommandRibbonButton) => CommandRibbonButton
): CommandRibbonSettings =>
  withRibbon(settings, ribbonId, (ribbon) => ({
    ...ribbon,
    buttons: ribbon.buttons.map((button) => (button.id === buttonId ? update(button) : button))
  }));

const moveItem = <T,>(items: T[], index: number, direction: -1 | 1) => {
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
  const nextItems = [...items];
  [nextItems[index], nextItems[nextIndex]] = [nextItems[nextIndex], nextItems[index]];
  return nextItems;
};

export const CommandRibbonSettingsDialog = () => {
  const showCommandRibbonSettings = useCadUiStore((state) => state.showCommandRibbonSettings);
  const commandRibbonSettings = useCadUiStore((state) => state.commandRibbonSettings);
  if (!showCommandRibbonSettings) return null;
  return (
    <CommandRibbonSettingsDialogContent
      commandRibbonSettings={commandRibbonSettings ?? defaultCommandRibbonSettings()}
    />
  );
};

const CommandRibbonSettingsDialogContent = ({
  commandRibbonSettings
}: {
  commandRibbonSettings: CommandRibbonSettings;
}) => {
  const commandRibbonSettingsLoading = useCadUiStore((state) => state.commandRibbonSettingsLoading);
  const commandRibbonSettingsError = useCadUiStore((state) => state.commandRibbonSettingsError);
  const setCommandRibbonSettings = useCadUiStore((state) => state.setCommandRibbonSettings);
  const setCommandRibbonSettingsLoading = useCadUiStore(
    (state) => state.setCommandRibbonSettingsLoading
  );
  const setCommandRibbonSettingsError = useCadUiStore(
    (state) => state.setCommandRibbonSettingsError
  );
  const [draftSettings, setDraftSettings] = useState(commandRibbonSettings);
  const [selectedRibbonId, setSelectedRibbonId] = useState(draftSettings.ribbons[0]?.id ?? "");
  const [selectedButtonId, setSelectedButtonId] = useState(draftSettings.ribbons[0]?.buttons[0]?.id ?? "");
  const [commandQuery, setCommandQuery] = useState("");
  const selectedRibbon =
    draftSettings.ribbons.find((ribbon) => ribbon.id === selectedRibbonId) ??
    draftSettings.ribbons[0] ??
    null;
  const selectedButton =
    selectedRibbon?.buttons.find((button) => button.id === selectedButtonId) ??
    selectedRibbon?.buttons[0] ??
    null;
  const hasChanges = JSON.stringify(commandRibbonSettings) !== JSON.stringify(draftSettings);
  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase();
    if (!query) return commandPaletteItems;
    return commandPaletteItems.filter((item) => commandSearchText(item.commandId).includes(query));
  }, [commandQuery]);
  const commandCandidates = selectedButton && !filteredCommands.some((item) => item.commandId === selectedButton.commandId)
    ? [
        {
          commandId: selectedButton.commandId,
          label: commandLabel(selectedButton.commandId),
          keywords: []
        },
        ...filteredCommands
      ]
    : filteredCommands;

  const close = () => dispatchCommand("closeCommandRibbonSettings");

  const saveSettings = async () => {
    setCommandRibbonSettingsLoading(true);
    setCommandRibbonSettingsError(null);
    try {
      const normalized = normalizeCommandRibbonSettings(draftSettings);
      await saveCommandRibbonSettings(normalized);
      setCommandRibbonSettings(normalized);
      close();
    } catch (error) {
      setCommandRibbonSettingsError(
        error instanceof Error ? error.message : "コマンドリボン設定を保存できません。"
      );
    } finally {
      setCommandRibbonSettingsLoading(false);
    }
  };

  const selectRibbon = (ribbonId: string) => {
    const ribbon = draftSettings.ribbons.find((item) => item.id === ribbonId);
    setSelectedRibbonId(ribbonId);
    setSelectedButtonId(ribbon?.buttons[0]?.id ?? "");
  };

  const addRibbon = () => {
    setDraftSettings((current) => {
      const ribbon = defaultRibbon(current.ribbons.length);
      setSelectedRibbonId(ribbon.id);
      setSelectedButtonId(ribbon.buttons[0]?.id ?? "");
      return { version: 1, ribbons: [...current.ribbons, ribbon] };
    });
  };

  const duplicateRibbon = () => {
    if (!selectedRibbon) return;
    const duplicate = {
      ...selectedRibbon,
      id: newId("ribbon"),
      label: `${selectedRibbon.label} コピー`,
      x: selectedRibbon.x === null ? null : selectedRibbon.x + 32,
      y: selectedRibbon.y + 32,
      buttons: selectedRibbon.buttons.map((button) => ({ ...button, id: newId("button") }))
    };
    setDraftSettings((current) => ({ version: 1, ribbons: [...current.ribbons, duplicate] }));
    setSelectedRibbonId(duplicate.id);
    setSelectedButtonId(duplicate.buttons[0]?.id ?? "");
  };

  const deleteRibbon = () => {
    if (!selectedRibbon || draftSettings.ribbons.length <= 1) return;
    setDraftSettings((current) => {
      const ribbons = current.ribbons.filter((ribbon) => ribbon.id !== selectedRibbon.id);
      setSelectedRibbonId(ribbons[0]?.id ?? "");
      setSelectedButtonId(ribbons[0]?.buttons[0]?.id ?? "");
      return { version: 1, ribbons };
    });
  };

  const moveRibbon = (ribbonId: string, direction: -1 | 1) => {
    setDraftSettings((current) => ({
      version: 1,
      ribbons: moveItem(
        current.ribbons,
        current.ribbons.findIndex((ribbon) => ribbon.id === ribbonId),
        direction
      )
    }));
  };

  const moveButton = (buttonId: string, direction: -1 | 1) => {
    if (!selectedRibbon) return;
    setDraftSettings((current) =>
      withRibbon(current, selectedRibbon.id, (ribbon) => ({
        ...ribbon,
        buttons: moveItem(
          ribbon.buttons,
          ribbon.buttons.findIndex((button) => button.id === buttonId),
          direction
        )
      }))
    );
  };

  const applyCommandToSelectedButton = (commandId: CommandId) => {
    if (!selectedRibbon || !selectedButton) return;
    setDraftSettings((current) =>
      withButton(current, selectedRibbon.id, selectedButton.id, (button) => ({
        ...button,
        commandId,
        label: commandLabel(commandId)
      }))
    );
  };

  const applyIconToSelectedButton = (icon: CommandRibbonIconId) => {
    if (!selectedRibbon || !selectedButton) return;
    setDraftSettings((current) =>
      withButton(current, selectedRibbon.id, selectedButton.id, (button) => ({
        ...button,
        icon
      }))
    );
  };

  return (
    <div
      className="command-ribbon-settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <section
        className="command-ribbon-settings"
        role="dialog"
        aria-modal="true"
        aria-label="コマンドリボン設定"
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>コマンドリボン</h2>
            <p>Canvas上に固定表示するコマンドボタン</p>
          </div>
          <button type="button" onClick={close}>閉じる</button>
        </div>

        <div className="command-ribbon-settings-body">
          <aside className="command-ribbon-settings-sidebar">
            <div className="command-ribbon-settings-actions">
              <button type="button" onClick={addRibbon}>追加</button>
              <button type="button" disabled={!selectedRibbon} onClick={duplicateRibbon}>複製</button>
              <button
                type="button"
                disabled={!selectedRibbon || draftSettings.ribbons.length <= 1}
                onClick={deleteRibbon}
              >
                削除
              </button>
            </div>
            <div className="command-ribbon-settings-tabs" role="listbox" aria-label="リボン">
              {draftSettings.ribbons.map((ribbon, index) => (
                <div
                  className={`command-ribbon-settings-tab ${ribbon.id === selectedRibbon?.id ? "selected" : ""}`}
                  key={ribbon.id}
                >
                  <button
                    type="button"
                    aria-selected={ribbon.id === selectedRibbon?.id}
                    onClick={() => selectRibbon(ribbon.id)}
                  >
                    <span>{ribbon.label}</span>
                    <small>{ribbon.orientation === "vertical" ? "縦" : "横"} / {ribbon.iconSize}px</small>
                  </button>
                  <div className="command-ribbon-order-buttons">
                    <button
                      type="button"
                      aria-label={`${ribbon.label}を上へ`}
                      disabled={index === 0}
                      onClick={() => {
                        selectRibbon(ribbon.id);
                        moveRibbon(ribbon.id, -1);
                      }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`${ribbon.label}を下へ`}
                      disabled={index === draftSettings.ribbons.length - 1}
                      onClick={() => {
                        selectRibbon(ribbon.id);
                        moveRibbon(ribbon.id, 1);
                      }}
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </aside>

          {selectedRibbon ? (
            <div className="command-ribbon-settings-editor">
              <div className="command-ribbon-settings-grid">
                <label>
                  名前
                  <input
                    value={selectedRibbon.label}
                    onChange={(event) =>
                      setDraftSettings((current) =>
                        withRibbon(current, selectedRibbon.id, (ribbon) => ({
                          ...ribbon,
                          label: event.target.value
                        }))
                      )
                    }
                  />
                </label>
                <label>
                  向き
                  <select
                    value={selectedRibbon.orientation}
                    onChange={(event) =>
                      setDraftSettings((current) =>
                        withRibbon(current, selectedRibbon.id, (ribbon) => ({
                          ...ribbon,
                          orientation: event.target.value === "vertical" ? "vertical" : "horizontal"
                        }))
                      )
                    }
                  >
                    <option value="horizontal">横</option>
                    <option value="vertical">縦</option>
                  </select>
                </label>
                <label>
                  アイコンサイズ
                  <select
                    value={selectedRibbon.iconSize}
                    onChange={(event) =>
                      setDraftSettings((current) =>
                        withRibbon(current, selectedRibbon.id, (ribbon) => ({
                          ...ribbon,
                          iconSize: Number(event.target.value) as CommandRibbonIconSize
                        }))
                      )
                    }
                  >
                    {commandRibbonIconSizes.map((size) => (
                      <option key={size} value={size}>{size}px</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="command-ribbon-command-filter">
                <input
                  value={commandQuery}
                  placeholder="コマンドを検索"
                  aria-label="コマンドを検索"
                  onChange={(event) => setCommandQuery(event.target.value)}
                />
                <button
                  type="button"
                  onClick={() => {
                    const commandId = filteredCommands[0]?.commandId ?? firstCommandId;
                    const buttonId = newId("button");
                    setDraftSettings((current) =>
                      withRibbon(current, selectedRibbon.id, (ribbon) => ({
                        ...ribbon,
                        buttons: [
                          ...ribbon.buttons,
                          {
                            ...defaultButton(),
                            id: buttonId,
                            commandId,
                            label: commandLabel(commandId)
                          }
                        ]
                      }))
                    );
                    setSelectedButtonId(buttonId);
                  }}
                >
                  ボタン追加
                </button>
              </div>

              <div className="command-ribbon-draft-preview" aria-label="リボンプレビュー">
                <div className={`command-ribbon-preview is-${selectedRibbon.orientation}`}>
                  {selectedRibbon.buttons.map((button) => {
                    const Icon = commandRibbonIconComponents[button.icon];
                    return (
                      <span
                        className={button.id === selectedButton?.id ? "selected" : ""}
                        key={button.id}
                      >
                        <Icon size={selectedRibbon.iconSize} strokeWidth={2} />
                        {button.showLabel ? <em>{button.label}</em> : null}
                      </span>
                    );
                  })}
                </div>
              </div>

              {selectedButton ? (
                <div className="command-ribbon-button-picker">
                  <div className="command-ribbon-button-picker-header">
                    <strong>選択中: {selectedButton.label}</strong>
                    <span>{selectedButton.commandId}</span>
                  </div>
                  <div className="command-ribbon-command-candidates" aria-label="コマンド候補">
                    {commandCandidates.length === 0 ? (
                      <p>該当するコマンドはありません。</p>
                    ) : (
                      commandCandidates.slice(0, 24).map((item) => (
                        <button
                          type="button"
                          key={item.commandId}
                          className={item.commandId === selectedButton.commandId ? "selected" : ""}
                          onClick={() => applyCommandToSelectedButton(item.commandId)}
                        >
                          <span>{item.label}</span>
                          <small>{item.commandId}</small>
                        </button>
                      ))
                    )}
                  </div>
                  <div className="command-ribbon-icon-grid" aria-label="アイコン候補">
                    {commandRibbonIconIds.map((iconId) => {
                      const Icon = commandRibbonIconComponents[iconId];
                      return (
                        <button
                          type="button"
                          key={iconId}
                          className={iconId === selectedButton.icon ? "selected" : ""}
                          aria-label={`${commandRibbonIconLabels[iconId]} アイコン`}
                          title={commandRibbonIconLabels[iconId]}
                          onClick={() => applyIconToSelectedButton(iconId)}
                        >
                          <Icon size={selectedRibbon.iconSize} strokeWidth={2} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="command-ribbon-button-list">
                {selectedRibbon.buttons.map((button, index) => (
                  <div
                    className={`command-ribbon-button-row ${button.id === selectedButton?.id ? "selected" : ""}`}
                    key={button.id}
                  >
                    <button
                      type="button"
                      className="command-ribbon-button-select"
                      onClick={() => setSelectedButtonId(button.id)}
                    >
                      <span>{commandLabel(button.commandId)}</span>
                      <small>{button.commandId}</small>
                    </button>
                    <label>
                      ラベル
                      <input
                        value={button.label}
                        onChange={(event) =>
                          setDraftSettings((current) =>
                            withButton(current, selectedRibbon.id, button.id, (item) => ({
                              ...item,
                              label: event.target.value
                            }))
                          )
                        }
                      />
                    </label>
                    <label className="command-ribbon-label-toggle">
                      <input
                        type="checkbox"
                        checked={button.showLabel}
                        onChange={(event) =>
                          setDraftSettings((current) =>
                            withButton(current, selectedRibbon.id, button.id, (item) => ({
                              ...item,
                              showLabel: event.target.checked
                            }))
                          )
                        }
                      />
                      表示
                    </label>
                    <div className="command-ribbon-icon-preview" aria-hidden="true">
                      {(() => {
                        const Icon = commandRibbonIconComponents[button.icon];
                        return <Icon size={selectedRibbon.iconSize} strokeWidth={2} />;
                      })()}
                    </div>
                    <div className="command-ribbon-order-buttons">
                      <button
                        type="button"
                        aria-label={`${button.label}を前へ`}
                        disabled={index === 0}
                        onClick={() => {
                          setSelectedButtonId(button.id);
                          moveButton(button.id, -1);
                        }}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`${button.label}を後へ`}
                        disabled={index === selectedRibbon.buttons.length - 1}
                        onClick={() => {
                          setSelectedButtonId(button.id);
                          moveButton(button.id, 1);
                        }}
                      >
                        ↓
                      </button>
                    </div>
                    <button
                      type="button"
                      disabled={selectedRibbon.buttons.length <= 1}
                      onClick={() =>
                        setDraftSettings((current) => {
                          const nextButtons = selectedRibbon.buttons.filter((item) => item.id !== button.id);
                          setSelectedButtonId(nextButtons[0]?.id ?? "");
                          return withRibbon(current, selectedRibbon.id, (ribbon) => ({
                            ...ribbon,
                            buttons: ribbon.buttons.filter((item) => item.id !== button.id)
                          }));
                        })
                      }
                    >
                      削除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="command-ribbon-settings-footer">
          {commandRibbonSettingsError ? (
            <p className="shortcut-settings-error" role="alert">{commandRibbonSettingsError}</p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              const defaults = defaultCommandRibbonSettings();
              setDraftSettings(defaults);
              setSelectedRibbonId(defaults.ribbons[0]?.id ?? "");
            }}
          >
            初期値
          </button>
          <button type="button" onClick={close}>キャンセル</button>
          <button
            type="button"
            disabled={commandRibbonSettingsLoading || !hasChanges}
            onClick={saveSettings}
          >
            {commandRibbonSettingsLoading ? "保存中..." : "保存"}
          </button>
        </div>
      </section>
    </div>
  );
};
