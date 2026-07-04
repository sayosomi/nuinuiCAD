use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SETTINGS_FILE_NAME: &str = "layout-settings.json";

fn default_layout_settings() -> Value {
    json!({
        "version": 1,
        "leftPanelWidth": 320,
        "collapsedPrintPanelSections": ["variables"]
    })
}

fn layout_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE_NAME))
        .map_err(|error| format!("レイアウト設定の保存先を取得できません: {error}"))
}

fn load_layout_settings_from_path(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(default_layout_settings());
    }

    let content = fs::read_to_string(path)
        .map_err(|error| format!("レイアウト設定を読み込めません: {error}"))?;
    match serde_json::from_str(&content) {
        Ok(settings) => Ok(settings),
        Err(_) => Ok(default_layout_settings()),
    }
}

fn save_layout_settings_to_path(path: &Path, input: Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("レイアウト設定フォルダを作成できません: {error}"))?;
    }
    let content = serde_json::to_string_pretty(&input)
        .map_err(|error| format!("レイアウト設定をJSONに変換できません: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("レイアウト設定を保存できません: {error}"))
}

#[tauri::command]
pub fn load_layout_settings(app: tauri::AppHandle) -> Result<Value, String> {
    load_layout_settings_from_path(&layout_settings_path(&app)?)
}

#[tauri::command]
pub fn save_layout_settings(app: tauri::AppHandle, input: Value) -> Result<(), String> {
    save_layout_settings_to_path(&layout_settings_path(&app)?, input)
}

#[cfg(test)]
mod tests {
    use super::{load_layout_settings_from_path, save_layout_settings_to_path};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn test_path(file_name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be after epoch")
            .as_nanos();
        std::env::temp_dir()
            .join(format!("nuinuicad-layout-{nonce}"))
            .join(file_name)
    }

    #[test]
    fn returns_default_settings_for_missing_file() {
        let path = test_path("missing.json");
        let settings = load_layout_settings_from_path(&path).expect("missing file should load");

        assert_eq!(
            settings,
            json!({
                "version": 1,
                "leftPanelWidth": 320,
                "collapsedPrintPanelSections": ["variables"]
            })
        );
    }

    #[test]
    fn saves_and_loads_layout_settings() {
        let path = test_path("layout-settings.json");
        let input = json!({ "version": 1, "leftPanelWidth": 520 });

        save_layout_settings_to_path(&path, input.clone()).expect("settings should save");
        let settings = load_layout_settings_from_path(&path).expect("settings should load");

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

        let settings = load_layout_settings_from_path(&path).expect("broken file should load");

        assert_eq!(
            settings,
            json!({
                "version": 1,
                "leftPanelWidth": 320,
                "collapsedPrintPanelSections": ["variables"]
            })
        );
        fs::remove_file(&path).expect("broken file should be removable");
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
            save_layout_settings_to_path(&path, json!({ "version": 1, "leftPanelWidth": 320 }))
                .expect_err("file parent should fail");

        assert!(error.contains("レイアウト設定フォルダを作成できません"));
        fs::remove_file(path.parent().expect("path should have a parent"))
            .expect("blocking file should be removable");
    }
}
