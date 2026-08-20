use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const SETTINGS_FILE_NAME: &str = "bake-settings.json";

fn default_bake_settings() -> Value {
    json!({
        "version": 1,
        "nuinuiCAD.bake.emitSkippedComments": true,
        "nuinuiCAD.bake.includeHiddenGeometry": false,
        "nuinuiCAD.bake.includeDisabledGeometry": false
    })
}

fn bake_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join(SETTINGS_FILE_NAME))
        .map_err(|error| format!("Bake設定の保存先を取得できません: {error}"))
}

fn load_bake_settings_from_path(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(default_bake_settings());
    }

    let content =
        fs::read_to_string(path).map_err(|error| format!("Bake設定を読み込めません: {error}"))?;
    match serde_json::from_str(&content) {
        Ok(settings) => Ok(settings),
        Err(_) => Ok(default_bake_settings()),
    }
}

fn save_bake_settings_to_path(path: &Path, input: Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Bake設定フォルダを作成できません: {error}"))?;
    }
    let content = serde_json::to_string_pretty(&input)
        .map_err(|error| format!("Bake設定をJSONに変換できません: {error}"))?;
    fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("Bake設定を保存できません: {error}"))
}

#[tauri::command]
pub fn load_bake_settings(app: tauri::AppHandle) -> Result<Value, String> {
    load_bake_settings_from_path(&bake_settings_path(&app)?)
}

#[tauri::command]
pub fn save_bake_settings(app: tauri::AppHandle, input: Value) -> Result<(), String> {
    save_bake_settings_to_path(&bake_settings_path(&app)?, input)
}

#[cfg(test)]
mod tests {
    use super::{load_bake_settings_from_path, save_bake_settings_to_path};
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
            .join(format!("nuinuicad-bake-{nonce}"))
            .join(file_name)
    }

    #[test]
    fn returns_default_settings_for_missing_file() {
        let settings = load_bake_settings_from_path(&test_path("missing.json"))
            .expect("missing file should load");
        assert_eq!(
            settings,
            json!({
                "version": 1,
                "nuinuiCAD.bake.emitSkippedComments": true,
                "nuinuiCAD.bake.includeHiddenGeometry": false,
                "nuinuiCAD.bake.includeDisabledGeometry": false
            })
        );
    }

    #[test]
    fn saves_and_loads_exact_settings() {
        let path = test_path("bake-settings.json");
        let input = json!({
            "version": 1,
            "nuinuiCAD.bake.emitSkippedComments": false,
            "nuinuiCAD.bake.includeHiddenGeometry": true,
            "nuinuiCAD.bake.includeDisabledGeometry": true
        });
        save_bake_settings_to_path(&path, input.clone()).expect("settings should save");
        assert_eq!(
            load_bake_settings_from_path(&path).expect("settings should load"),
            input
        );
        fs::remove_dir_all(path.parent().expect("path should have a parent"))
            .expect("test directory should be removable");
    }
}
