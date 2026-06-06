use add_core::{analyze_directory, AnalyzeOptions};
use serde_json::{json, Value};
use std::env;
use std::path::PathBuf;

#[tauri::command]
fn maidspace_health() -> Value {
    json!({
        "ok": true,
        "mode": "local_tauri",
        "defaultRootPath": default_root_path(),
        "cwd": env::current_dir()
            .map(|path| path.display().to_string())
            .unwrap_or_else(|_| String::from(".")),
        "defaultOptions": {
            "adaptive": true,
            "scanEngine": "rust_local",
            "dependencyMode": "metadata",
            "maxFiles": 120000,
            "maxDepth": 1024,
            "targetFreeBytes": 0u64,
            "includeProgramFiles": true
        }
    })
}

#[tauri::command(rename_all = "camelCase")]
fn analyze_maidspace(root_path: String, target_free_bytes: Option<u64>) -> Result<Value, String> {
    let report = analyze_directory(&PathBuf::from(root_path), AnalyzeOptions::default())
        .map_err(|error| error.to_string())?;
    Ok(json!({
        "mode": "local_tauri",
        "targetFreeBytes": target_free_bytes.unwrap_or(0),
        "report": report
    }))
}

#[tauri::command(rename_all = "camelCase")]
fn analyze_add(root_path: String) -> Result<Value, String> {
    analyze_maidspace(root_path, None)
}

fn default_root_path() -> String {
    if cfg!(target_os = "windows") {
        env::var("SystemDrive")
            .map(|drive| format!("{}\\", drive.trim_end_matches('\\')))
            .unwrap_or_else(|_| String::from("C:\\"))
    } else {
        String::from("/")
    }
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![maidspace_health, analyze_maidspace, analyze_add])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar MaidSpace");
}
