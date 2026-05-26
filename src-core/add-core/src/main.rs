use add_core::{analyze_directory, AnalyzeOptions};
use anyhow::Context;
use std::env;
use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let root = env::args()
        .nth(1)
        .map(PathBuf::from)
        .context("Informe o diretorio raiz: add-core <caminho>")?;

    let report = analyze_directory(&root, AnalyzeOptions::default())?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
