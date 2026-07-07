import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { dispatchCommand } from "../commands/commands";
import { useCadDocumentStore } from "../state/cadDocumentStore";
import { useCadUiStore } from "../state/cadUiStore";

export const VisibilityProfilePanel = ({ showHeader = true }: { showHeader?: boolean }) => {
  const visibilityRoles = useCadDocumentStore((state) => state.visibilityRoles);
  const visibilityProfiles = useCadDocumentStore((state) => state.visibilityProfiles);
  const activeVisibilityProfileId = useCadDocumentStore((state) => state.activeVisibilityProfileId);
  const setActiveVisibilityProfileId = useCadDocumentStore((state) => state.setActiveVisibilityProfileId);
  const addVisibilityRole = useCadDocumentStore((state) => state.addVisibilityRole);
  const updateVisibilityRole = useCadDocumentStore((state) => state.updateVisibilityRole);
  const deleteVisibilityRole = useCadDocumentStore((state) => state.deleteVisibilityRole);
  const addVisibilityProfile = useCadDocumentStore((state) => state.addVisibilityProfile);
  const updateVisibilityProfile = useCadDocumentStore((state) => state.updateVisibilityProfile);
  const deleteVisibilityProfile = useCadDocumentStore((state) => state.deleteVisibilityProfile);
  const setVisibilityProfileRoleVisible = useCadDocumentStore((state) => state.setVisibilityProfileRoleVisible);
  const activeProfile =
    visibilityProfiles.find((profile) => profile.id === activeVisibilityProfileId) ??
    visibilityProfiles[0];

  if (!activeProfile) return null;

  const addRole = () => {
    const name = window.prompt("追加する表示ロール名", `ロール${visibilityRoles.length + 1}`);
    if (name !== null) addVisibilityRole(name);
  };
  const addProfile = () => {
    const name = window.prompt("追加する表示プロファイル名", `表示${visibilityProfiles.length + 1}`);
    if (name !== null) addVisibilityProfile(name);
  };

  return (
    <section className="panel-section visibility-profile-panel">
      {showHeader ? (
        <div className="section-header">
          <div>
            <h2>表示プロファイル</h2>
            <p className="section-subtitle">ロールごとの表示を切り替え</p>
          </div>
        </div>
      ) : null}
      <div className="visibility-profile-controls">
        <label className="print-select-field">
          <span>プロファイル</span>
          <select
            value={activeProfile.id}
            onChange={(event) => setActiveVisibilityProfileId(event.currentTarget.value)}
          >
            {visibilityProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <label className="print-select-field">
          <span>名前</span>
          <input
            type="text"
            aria-label="表示プロファイル名"
            value={activeProfile.name}
            onChange={(event) =>
              updateVisibilityProfile(activeProfile.id, { name: event.currentTarget.value })
            }
          />
        </label>
        <div className="visibility-profile-actions">
          <button type="button" onClick={addProfile}>
            <Plus aria-hidden="true" />
            プロファイル
          </button>
          <button
            type="button"
            onClick={() => deleteVisibilityProfile(activeProfile.id)}
            disabled={visibilityProfiles.length <= 1}
          >
            <Trash2 aria-hidden="true" />
            プロファイル削除
          </button>
        </div>
      </div>
      <div className="visibility-role-list" aria-label="表示ロール">
        {visibilityRoles.length === 0 ? (
          <p className="empty-state">表示ロールはありません。</p>
        ) : (
          visibilityRoles.map((role) => {
            const visible = activeProfile.roleVisibility[role.id] ?? activeProfile.defaultRoleVisible;
            return (
              <div className="visibility-role-row" key={role.id}>
                <button
                  type="button"
                  className="visibility-role-toggle"
                  aria-label={`${role.name}を${visible ? "非表示" : "表示"}`}
                  onClick={() => setVisibilityProfileRoleVisible(activeProfile.id, role.id, !visible)}
                >
                  {visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
                </button>
                <input
                  type="text"
                  aria-label="表示ロール名"
                  value={role.name}
                  onChange={(event) => updateVisibilityRole(role.id, { name: event.currentTarget.value })}
                />
                <button
                  type="button"
                  className="visibility-role-delete"
                  aria-label={`${role.name}を削除`}
                  onClick={() => deleteVisibilityRole(role.id)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            );
          })
        )}
      </div>
      <button type="button" className="visibility-add-role-button" onClick={addRole}>
        <Plus aria-hidden="true" />
        ロールを追加
      </button>
    </section>
  );
};

export const VisibilityProfileSettingsDialog = () => {
  const showVisibilityProfileSettings = useCadUiStore(
    (state) => state.showVisibilityProfileSettings
  );

  if (!showVisibilityProfileSettings) return null;

  const close = () => dispatchCommand("closeVisibilityProfileSettings");

  return (
    <div
      className="visibility-profile-settings-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
    >
      <section
        className="visibility-profile-settings"
        role="dialog"
        aria-modal="true"
        aria-label="表示プロファイル"
      >
        <div className="shortcut-overlay-header">
          <div>
            <h2>表示プロファイル</h2>
            <p>ロールごとの表示を切り替え</p>
          </div>
          <button type="button" onClick={close}>閉じる</button>
        </div>
        <div className="visibility-profile-settings-body">
          <VisibilityProfilePanel showHeader={false} />
        </div>
      </section>
    </div>
  );
};
