pub mod document_file;
pub mod evaluation;
pub mod shortcut_settings;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            evaluation::evaluate_document,
            document_file::read_document_file,
            document_file::write_document_file,
            shortcut_settings::load_shortcut_settings,
            shortcut_settings::save_shortcut_settings
        ])
        .run(tauri::generate_context!())
        .expect("failed to run nuinuiCAD");
}
