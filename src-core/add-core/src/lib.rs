use anyhow::{anyhow, Context};
use rayon::prelude::*;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use walkdir::{DirEntry, WalkDir};

#[derive(Debug, Clone)]
pub struct AnalyzeOptions {
    pub max_files: usize,
    pub max_depth: usize,
    pub unused_days_threshold: u64,
    pub frequent_use_days_threshold: u64,
}

impl Default for AnalyzeOptions {
    fn default() -> Self {
        Self {
            max_files: 15_000,
            max_depth: 18,
            unused_days_threshold: 30,
            frequent_use_days_threshold: 4,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct AddReport {
    pub algorithm: String,
    pub root_path: String,
    pub summary: Summary,
    pub files: Vec<FileDecision>,
}

#[derive(Debug, Serialize)]
pub struct Summary {
    pub files: usize,
    pub directories: usize,
    pub can_delete: usize,
    pub probably_useless: usize,
    pub must_keep: usize,
    pub review: usize,
}

#[derive(Debug, Serialize)]
pub struct FileDecision {
    pub path: String,
    pub extension: String,
    pub size: u64,
    pub days_since_access: u64,
    pub protected_reasons: Vec<String>,
    pub dependency_hint: DependencyHint,
    pub utility_status: UtilityStatus,
    pub deletion_decision: DeletionDecision,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DependencyHint {
    None,
    Low,
    Medium,
    High,
    Uncertain,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UtilityStatus {
    System,
    Protected,
    UsedByUser,
    DependencyRelevant,
    LowUse,
    ProbablyUseless,
    Uncertain,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeletionDecision {
    CanDelete,
    ProbablyUseless,
    Review,
    DoNotDelete,
}

pub fn analyze_directory(root: &Path, options: AnalyzeOptions) -> anyhow::Result<AddReport> {
    let root = root
        .canonicalize()
        .with_context(|| format!("Diretorio nao encontrado: {}", root.display()))?;

    if !root.is_dir() {
        return Err(anyhow!("O caminho informado nao e um diretorio: {}", root.display()));
    }

    let mut directories = 0usize;
    let mut file_paths = Vec::new();

    for entry in WalkDir::new(&root)
        .max_depth(options.max_depth)
        .into_iter()
        .filter_entry(|entry| should_enter(entry))
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        if entry.file_type().is_dir() {
            directories += 1;
            continue;
        }

        if entry.file_type().is_file() {
            file_paths.push(entry.path().to_path_buf());
            if file_paths.len() >= options.max_files {
                break;
            }
        }
    }

    let provider_names = build_provider_name_index(&file_paths);
    let files: Vec<FileDecision> = file_paths
        .par_iter()
        .filter_map(|path| analyze_file(&root, path, &provider_names, &options).ok())
        .collect();

    let summary = Summary {
        files: files.len(),
        directories: directories.saturating_sub(1),
        can_delete: files
            .iter()
            .filter(|file| file.deletion_decision == DeletionDecision::CanDelete)
            .count(),
        probably_useless: files
            .iter()
            .filter(|file| file.deletion_decision == DeletionDecision::ProbablyUseless)
            .count(),
        must_keep: files
            .iter()
            .filter(|file| file.deletion_decision == DeletionDecision::DoNotDelete)
            .count(),
        review: files
            .iter()
            .filter(|file| file.deletion_decision == DeletionDecision::Review)
            .count(),
    };

    Ok(AddReport {
        algorithm: "A.D.D".to_string(),
        root_path: root.display().to_string(),
        summary,
        files,
    })
}

fn analyze_file(
    root: &Path,
    path: &Path,
    provider_names: &HashSet<String>,
    options: &AnalyzeOptions,
) -> anyhow::Result<FileDecision> {
    let metadata = fs::metadata(path)?;
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let days_since_access = metadata
        .accessed()
        .ok()
        .map(days_since)
        .unwrap_or(options.unused_days_threshold + 1);
    let protected_reasons = protected_reasons(path, &relative);
    let dependency_hint = dependency_hint(path, &extension, provider_names);
    let utility_status = utility_status(
        &protected_reasons,
        dependency_hint,
        days_since_access,
        options,
    );
    let deletion_decision = deletion_decision(utility_status, dependency_hint);

    Ok(FileDecision {
        path: relative,
        extension,
        size: metadata.len(),
        days_since_access,
        protected_reasons,
        dependency_hint,
        utility_status,
        deletion_decision,
    })
}

fn should_enter(entry: &DirEntry) -> bool {
    let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
    !matches!(
        name.as_str(),
        ".git"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | "windows"
            | "system32"
            | "winsxs"
            | "program files"
            | "program files (x86)"
            | "programdata"
            | "system volume information"
    )
}

fn build_provider_name_index(paths: &[PathBuf]) -> HashSet<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for path in paths {
        if let Some(stem) = path.file_stem().and_then(|value| value.to_str()) {
            *counts.entry(stem.to_ascii_lowercase()).or_default() += 1;
        }
    }
    counts
        .into_iter()
        .filter_map(|(name, count)| (count > 1).then_some(name))
        .collect()
}

fn dependency_hint(path: &Path, extension: &str, provider_names: &HashSet<String>) -> DependencyHint {
    if protected_file_name(path) {
        return DependencyHint::High;
    }

    if matches!(
        extension,
        "dll" | "exe" | "sys" | "so" | "dylib" | "lock" | "toml" | "json"
    ) {
        return DependencyHint::Medium;
    }

    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if provider_names.contains(&stem) {
        return DependencyHint::Medium;
    }

    if matches!(extension, "tmp" | "log" | "bak" | "old" | "cache") {
        return DependencyHint::Low;
    }

    DependencyHint::None
}

fn utility_status(
    protected_reasons: &[String],
    dependency_hint: DependencyHint,
    days_since_access: u64,
    options: &AnalyzeOptions,
) -> UtilityStatus {
    if protected_reasons
        .iter()
        .any(|reason| reason.contains("sistema") || reason.contains("executavel"))
    {
        return UtilityStatus::System;
    }
    if !protected_reasons.is_empty() {
        return UtilityStatus::Protected;
    }
    if days_since_access <= options.frequent_use_days_threshold {
        return UtilityStatus::UsedByUser;
    }
    if matches!(dependency_hint, DependencyHint::High | DependencyHint::Medium) {
        return UtilityStatus::DependencyRelevant;
    }
    if days_since_access >= options.unused_days_threshold && dependency_hint == DependencyHint::None {
        return UtilityStatus::ProbablyUseless;
    }
    if days_since_access >= options.unused_days_threshold {
        return UtilityStatus::LowUse;
    }
    UtilityStatus::Uncertain
}

fn deletion_decision(
    utility_status: UtilityStatus,
    dependency_hint: DependencyHint,
) -> DeletionDecision {
    match utility_status {
        UtilityStatus::System | UtilityStatus::Protected | UtilityStatus::UsedByUser => {
            DeletionDecision::DoNotDelete
        }
        UtilityStatus::ProbablyUseless => DeletionDecision::CanDelete,
        UtilityStatus::LowUse if dependency_hint == DependencyHint::Low => {
            DeletionDecision::ProbablyUseless
        }
        UtilityStatus::DependencyRelevant | UtilityStatus::LowUse | UtilityStatus::Uncertain => {
            DeletionDecision::Review
        }
    }
}

fn protected_reasons(path: &Path, relative: &str) -> Vec<String> {
    let mut reasons = Vec::new();
    let absolute = path.to_string_lossy().to_ascii_lowercase();
    let relative = relative.to_ascii_lowercase();

    if protected_file_name(path) {
        reasons.push("arquivo de configuracao/lock".to_string());
    }

    if matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "exe" | "dll" | "sys" | "msi" | "bat" | "cmd" | "ps1" | "so" | "dylib"
    ) {
        reasons.push("executavel ou biblioteca".to_string());
    }

    for token in [
        "windows",
        "system32",
        "winsxs",
        "windowsapps",
        "program files",
        "program files (x86)",
        "programdata",
        "system volume information",
    ] {
        if absolute.contains(token) || relative.contains(token) {
            reasons.push("diretorio do sistema".to_string());
            break;
        }
    }

    reasons.sort();
    reasons.dedup();
    reasons
}

fn protected_file_name(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    matches!(
        name.as_str(),
        ".env"
            | ".env.local"
            | "package.json"
            | "package-lock.json"
            | "pnpm-lock.yaml"
            | "yarn.lock"
            | "cargo.toml"
            | "cargo.lock"
            | "pyproject.toml"
            | "requirements.txt"
            | "go.mod"
            | "go.sum"
            | "tsconfig.json"
            | "dockerfile"
    )
}

fn days_since(time: SystemTime) -> u64 {
    SystemTime::now()
        .duration_since(time)
        .unwrap_or(Duration::ZERO)
        .as_secs()
        / 86_400
}
