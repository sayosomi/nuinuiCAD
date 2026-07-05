use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SETTINGS_FILE_NAME: &str = "command-ribbon-settings.json";

fn default_command_ribbon_settings() -> Value {
    json!({
        "version": 1,
        "ribbons": [
            {
                "id": "drafting",
                "label": "作図",
                "dock": "canvas",
                "x": null,
                "y": 12,
                "orientation": "horizontal",
                "iconSize": 16,
                "buttons": [
                    { "id": "addFreePoint", "commandId": "addFreePoint", "icon": "circle-dot", "iconColor": "default", "label": "点", "showLabel": false },
                    { "id": "addOffsetPoint", "commandId": "addOffsetPoint", "icon": "move-right", "iconColor": "default", "label": "オフセット点", "showLabel": false },
                    { "id": "addPolarOffsetPoint", "commandId": "addPolarOffsetPoint", "icon": "slash", "iconColor": "default", "label": "極座標点", "showLabel": false },
                    { "id": "addLine", "commandId": "addLine", "icon": "slash", "iconColor": "default", "label": "線", "showLabel": false },
                    { "id": "addAngleLengthLine", "commandId": "addAngleLengthLine", "icon": "compass", "iconColor": "default", "label": "角度距離線", "showLabel": false },
                    { "id": "addArcLine", "commandId": "addArcLine", "icon": "corner-down-right", "iconColor": "default", "label": "円弧", "showLabel": false },
                    { "id": "addThreePointArcLine", "commandId": "addThreePointArcLine", "icon": "corner-down-right", "iconColor": "default", "label": "3点円弧", "showLabel": false },
                    { "id": "addCornerRadiusArcLine", "commandId": "addCornerRadiusArcLine", "icon": "corner-down-right", "iconColor": "default", "label": "角R", "showLabel": false },
                    { "id": "addBezierCurve", "commandId": "addBezierCurve", "icon": "spline", "iconColor": "default", "label": "曲線", "showLabel": false },
                    { "id": "addOffsetLine", "commandId": "addOffsetLine", "icon": "move-right", "iconColor": "default", "label": "オフセット線", "showLabel": false },
                    { "id": "addSplitLine", "commandId": "addSplitLine", "icon": "scissors", "iconColor": "default", "label": "分割線", "showLabel": false },
                    { "id": "addCopyLine", "commandId": "addCopyLine", "icon": "copy", "iconColor": "default", "label": "コピー線", "showLabel": false },
                    { "id": "addSymmetricCopyLine", "commandId": "addSymmetricCopyLine", "icon": "flip-horizontal", "iconColor": "default", "label": "対称コピー", "showLabel": false },
                    { "id": "addText", "commandId": "addText", "icon": "type", "iconColor": "default", "label": "テキスト", "showLabel": false }
                ]
            },
            {
                "id": "selection-actions",
                "label": "選択操作",
                "dock": "leftPanelBottom",
                "x": 24,
                "y": 72,
                "orientation": "horizontal",
                "iconSize": 16,
                "buttons": [
                    { "id": "moveSelectedElementUp", "commandId": "moveSelectedElementUp", "icon": "arrow-up", "iconColor": "default", "label": "上へ", "showLabel": false },
                    { "id": "moveSelectedElementDown", "commandId": "moveSelectedElementDown", "icon": "arrow-down", "iconColor": "default", "label": "下へ", "showLabel": false },
                    { "id": "duplicateSelectedElement", "commandId": "duplicateSelectedElement", "icon": "copy", "iconColor": "default", "label": "複製", "showLabel": false },
                    { "id": "toggleSelectedElementVisibility", "commandId": "toggleSelectedElementVisibility", "icon": "eye", "iconColor": "default", "label": "表示切替", "showLabel": false },
                    { "id": "toggleSelectedElementEnabled", "commandId": "toggleSelectedElementEnabled", "icon": "toggle-right", "iconColor": "default", "label": "評価切替", "showLabel": false },
                    { "id": "deleteSelectedElement", "commandId": "deleteSelectedElement", "icon": "trash", "iconColor": "red", "label": "削除", "showLabel": false }
                ]
            }
        ]
    })
}

fn command_ribbon_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE_NAME))
        .map_err(|error| format!("コマンドリボン設定の保存先を取得できません: {error}"))
}

fn load_command_ribbon_settings_from_path(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(default_command_ribbon_settings());
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("コマンドリボン設定を読み込めません: {error}"))?;
    match serde_json::from_str(&content) {
        Ok(settings) => Ok(settings),
        Err(_) => Ok(default_command_ribbon_settings()),
    }
}

fn save_command_ribbon_settings_to_path(path: &Path, input: Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("コマンドリボン設定フォルダを作成できません: {error}"))?;
    }
    let content = serde_json::to_string_pretty(&input)
        .map_err(|error| format!("コマンドリボン設定をJSONに変換できません: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("コマンドリボン設定を保存できません: {error}"))
}

#[tauri::command]
pub fn load_command_ribbon_settings(app: tauri::AppHandle) -> Result<Value, String> {
    load_command_ribbon_settings_from_path(&command_ribbon_settings_path(&app)?)
}

#[tauri::command]
pub fn save_command_ribbon_settings(app: tauri::AppHandle, input: Value) -> Result<(), String> {
    save_command_ribbon_settings_to_path(&command_ribbon_settings_path(&app)?, input)
}

#[cfg(test)]
mod tests {
    use super::{load_command_ribbon_settings_from_path, save_command_ribbon_settings_to_path};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_path(file_name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after UNIX_EPOCH")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nuinuicad-command-ribbons-{nonce}"))
            .join(file_name)
    }

    #[test]
    fn returns_default_settings_for_missing_file() {
        let path = test_path("missing.json");
        let settings =
            load_command_ribbon_settings_from_path(&path).expect("missing file should load");

        assert_eq!(settings["version"], json!(1));
        assert_eq!(settings["ribbons"][0]["id"], json!("drafting"));
    }

    #[test]
    fn saves_and_loads_command_ribbon_settings() {
        let path = test_path("command-ribbon-settings.json");
        let input = json!({
            "version": 1,
            "ribbons": [
                {
                    "id": "custom",
                    "label": "Custom",
                    "x": 80,
                    "y": 24,
                    "orientation": "vertical",
                    "buttons": [
                        { "id": "line", "commandId": "addLine", "icon": "slash", "label": "Line", "showLabel": true }
                    ]
                }
            ]
        });

        save_command_ribbon_settings_to_path(&path, input.clone()).expect("settings should save");
        let settings = load_command_ribbon_settings_from_path(&path).expect("settings should load");

        assert_eq!(settings, input);
        fs::remove_dir_all(path.parent().expect("path should have a parent"))
            .expect("test directory should be removable");
    }

    #[test]
    fn falls_back_to_default_settings_for_invalid_json() {
        let path = test_path("broken.json");
        fs::create_dir_all(path.parent().expect("path should have a parent"))
            .expect("test directory should be creatable");
        fs::write(&path, "{not-json").expect("broken json should be writable");

        let settings =
            load_command_ribbon_settings_from_path(&path).expect("broken file should load");

        assert_eq!(settings["version"], json!(1));
        assert_eq!(settings["ribbons"][0]["id"], json!("drafting"));
        fs::remove_dir_all(path.parent().expect("path should have a parent"))
            .expect("test directory should be removable");
    }

    #[test]
    fn returns_error_for_unwritable_path() {
        let path = test_path("missing-parent").join("settings.json");
        let blocking_parent = path.parent().expect("path should have a parent");
        fs::create_dir_all(
            blocking_parent
                .parent()
                .expect("blocking parent should have a parent"),
        )
        .expect("test directory should be creatable");
        fs::write(blocking_parent, "not a directory").expect("blocking file should be writable");

        let error =
            save_command_ribbon_settings_to_path(&path, json!({ "version": 1, "ribbons": [] }))
                .expect_err("file parent should fail");

        assert!(error.contains("コマンドリボン設定フォルダを作成できません"));
        fs::remove_file(path.parent().expect("path should have a parent"))
            .expect("blocking file should be removable");
    }
}
