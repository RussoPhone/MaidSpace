use add_core::{analyze_directory, AnalyzeOptions};
use serde_json::Value;
use std::path::PathBuf;

#[tauri::command]
fn analyze_add(root_path: String) -> Result<Value, String> {
    let report = analyze_directory(&PathBuf::from(root_path), AnalyzeOptions::default())
        .map_err(|error| error.to_string())?;
    serde_json::to_value(report).map_err(|error| error.to_string())
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![analyze_add])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar S.R.C A.D.D");
}
