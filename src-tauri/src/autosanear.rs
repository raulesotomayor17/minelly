use std::path::{Path, PathBuf};
use std::process::Command;

/// Ejecuta el preprocesador Python si está disponible. Si no existe Python,
/// el compilador nativo sigue siendo la red de seguridad.
pub fn clean_if_available(path: &Path) -> Option<PathBuf> {
    let ext = path.extension()?.to_string_lossy().to_ascii_lowercase();
    if !matches!(ext.as_str(), "docx" | "epub") {
        return None;
    }
    let available = Command::new("python3").arg("--version").output().ok()?.status.success();
    if !available {
        return None;
    }
    let dir = std::env::temp_dir().join(format!("minelly-autosanear-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).ok()?;
    let copy = dir.join(format!("source.{ext}"));
    std::fs::copy(path, &copy).ok()?;
    let script = dir.join("clean_book_source.py");
    std::fs::write(&script, include_str!("../../scripts/clean_book_source.py")).ok()?;
    let status = Command::new("python3").arg(&script).arg(&copy).status().ok()?;
    if status.success() && copy.is_file() {
        Some(copy)
    } else {
        None
    }
}
