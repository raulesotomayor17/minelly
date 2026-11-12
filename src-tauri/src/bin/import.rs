use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::Result;
use teoamoxtli_lib::db::Catalog;
use teoamoxtli_lib::import::{import_path, scan_folder};

fn main() -> ExitCode {
    match run() {
        Ok(failed) => {
            if failed {
                ExitCode::FAILURE
            } else {
                ExitCode::SUCCESS
            }
        }
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<bool> {
    let mut db_path = PathBuf::from("data/catalog.sqlite");
    let mut inputs = Vec::new();
    let mut clear = false;
    let mut json = false;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--db" => {
                let value = args.next().unwrap_or_else(|| "data/catalog.sqlite".to_string());
                db_path = PathBuf::from(value);
            }
            "--clear" => clear = true,
            "--json" => json = true,
            "--help" | "-h" => {
                println!(
                    "Uso: import [--db RUTA] [--clear] [--json] <carpeta|archivo>...\n\
                     Sin argumentos, importa ../recursos."
                );
                return Ok(false);
            }
            other => inputs.push(PathBuf::from(other)),
        }
    }
    if inputs.is_empty() {
        inputs.push(PathBuf::from("../recursos"));
    }

    let mut files = Vec::new();
    for input in &inputs {
        if input.is_dir() {
            files.extend(scan_folder(input));
        } else {
            files.push(input.clone());
        }
    }
    files.sort();
    files.dedup();

    if files.is_empty() {
        eprintln!("No se encontraron módulos en: {inputs:?}");
        return Ok(true);
    }

    let mut catalog = Catalog::open(&db_path)?;
    if clear {
        catalog.clear()?;
    }

    println!("Catálogo: {}", db_path.display());
    println!("Módulos encontrados: {}", files.len());
    let mut failed = false;
    let mut reports = Vec::new();
    for file in &files {
        match import_path(&mut catalog, file) {
            Ok(report) => {
                println!(
                    "  OK  {:<34} {:<11} versículos={:<6} entradas={:<6}",
                    report.resource.title,
                    report.resource.kind.label(),
                    report.resource.verse_count,
                    report.resource.entry_count
                );
                for warning in &report.warnings {
                    println!("      aviso: {warning}");
                }
                reports.push(report);
            }
            Err(error) => {
                failed = true;
                println!("  ERR {}: {error:#}", file.display());
            }
        }
    }

    println!("\nRecursos en el catálogo:");
    for resource in catalog.list_resources()? {
        println!(
            "  {:<10} {:<38} {}",
            resource.kind.label(),
            resource.title,
            resource.abbreviation
        );
    }

    if json {
        println!("\n{}", serde_json::to_string_pretty(&reports)?);
    }
    Ok(failed)
}
