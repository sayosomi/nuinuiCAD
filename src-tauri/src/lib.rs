pub mod app_menu;
pub mod document_file;
pub mod evaluation;
pub mod image_metadata;
pub mod layout_settings;
pub mod palette_settings;
pub mod print_pdf;
pub mod shortcut_settings;

use tauri::Emitter;

pub fn run() {
    tauri::Builder::default()
        .menu(app_menu::build_app_menu)
        .on_menu_event(|app, event| {
            if let Some(command_id) = app_menu::command_id_from_menu_id(event.id().as_ref()) {
                if let Err(error) = app.emit(app_menu::MENU_COMMAND_EVENT, command_id.to_string()) {
                    eprintln!("failed to emit menu command event: {error}");
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            evaluation::evaluate_document,
            image_metadata::read_image_metadata,
            document_file::read_document_file,
            document_file::write_document_file,
            print_pdf::export_print_pdf,
            layout_settings::load_layout_settings,
            layout_settings::save_layout_settings,
            palette_settings::load_palette_template,
            palette_settings::save_palette_template,
            shortcut_settings::load_shortcut_settings,
            shortcut_settings::save_shortcut_settings
        ])
        .run(tauri::generate_context!())
        .expect("failed to run nuinuiCAD");
}
