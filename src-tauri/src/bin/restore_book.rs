use std::process::ExitCode;


fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("uso: restore_book <catalog.sqlite> <resource_id>");
        eprintln!("     restore_book scan <catalog.sqlite> [--force]");
        eprintln!("     restore_book digest <catalog.sqlite> <resource_id>");
        eprintln!("     restore_book apply <catalog.sqlite> <resource_id> <plan.json>");
        eprintln!("     restore_book undo <catalog.sqlite> <backup.json>");
        eprintln!("     restore_book import <catalog.sqlite> <archivo>");
        eprintln!("     restore_book search <catalog.sqlite> <resource_id> <consulta>");
        return ExitCode::from(2);
    }

    if args[0] == "scan" {
        let Some(catalog_path) = args.get(1) else {
            eprintln!("falta la ruta del catálogo");
            return ExitCode::from(2);
        };
        let force = args.iter().any(|arg| arg == "--force");
        let mut catalog = match minelly_lib::db::Catalog::open(catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => {
                eprintln!("error al abrir el catálogo: {error:#}");
                return ExitCode::FAILURE;
            }
        };
        let reports = minelly_lib::library::scan_book_structures(&mut catalog, force);
        if reports.is_empty() {
            println!("sin libros pendientes de revisar");
        }
        for report in &reports {
            match &report.error {
                Some(error) => eprintln!("✗ {}: {error}", report.title),
                None => println!(
                    "✓ {}: {} → {} capítulos{}",
                    report.title,
                    report.before,
                    report.after,
                    if report.changed { "" } else { " (sin cambios)" }
                ),
            }
        }
        return ExitCode::SUCCESS;
    }

    if args[0] == "digest" {
        let (Some(catalog_path), Some(resource_id)) = (args.get(1), args.get(2)) else {
            eprintln!("uso: restore_book digest <catalog> <resource_id>");
            return ExitCode::from(2);
        };
        let catalog = match minelly_lib::db::Catalog::open(catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => {
                eprintln!("error al abrir el catálogo: {error:#}");
                return ExitCode::FAILURE;
            }
        };
        return match minelly_lib::typeset::digest(&catalog, resource_id) {
            Ok(digest) => {
                if args.iter().any(|arg| arg == "--json") {
                    println!("{}", serde_json::to_string_pretty(&digest).unwrap_or_default());
                    return ExitCode::SUCCESS;
                }
                println!(
                    "{} · {} bloques · {} candidatos · ~{} tokens",
                    digest.title, digest.block_count, digest.candidates.len(), digest.estimated_tokens
                );
                for candidate in digest.candidates.iter().take(15) {
                    println!("  {} · {} · {}", candidate.index, candidate.tag, candidate.text);
                }
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("error: {error:#}");
                ExitCode::FAILURE
            }
        }
    }

    if args[0] == "apply" {
        let (Some(catalog_path), Some(resource_id), Some(plan_path)) =
            (args.get(1), args.get(2), args.get(3))
        else {
            eprintln!("uso: restore_book apply <catalog> <resource_id> <plan.json>");
            return ExitCode::from(2);
        };
        let raw = match std::fs::read_to_string(plan_path) {
            Ok(raw) => raw,
            Err(error) => {
                eprintln!("no se pudo leer el plan: {error}");
                return ExitCode::FAILURE;
            }
        };
        let plan: minelly_lib::typeset::TypesetPlan = match serde_json::from_str(&raw) {
            Ok(plan) => plan,
            Err(error) => {
                eprintln!("plan inválido: {error}");
                return ExitCode::FAILURE;
            }
        };
        let mut catalog = match minelly_lib::db::Catalog::open(catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => {
                eprintln!("error al abrir el catálogo: {error:#}");
                return ExitCode::FAILURE;
            }
        };
        return match minelly_lib::typeset::apply(&mut catalog, resource_id, &plan) {
            Ok(report) => {
                println!("capítulos: {} · copia: {}", report.chapters, report.backup_path);
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("error: {error:#}");
                ExitCode::FAILURE
            }
        }
    }

    if args[0] == "undo" {
        let (Some(catalog_path), Some(backup_path)) = (args.get(1), args.get(2)) else {
            eprintln!("uso: restore_book undo <catalog> <backup>");
            return ExitCode::from(2);
        };
        let mut catalog = match minelly_lib::db::Catalog::open(catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => {
                eprintln!("error al abrir el catálogo: {error:#}");
                return ExitCode::FAILURE;
            }
        };
        return match minelly_lib::typeset::undo(&mut catalog, backup_path) {
            Ok(chapters) => {
                println!("capítulos restaurados: {chapters}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("error: {error:#}");
                ExitCode::FAILURE
            }
        };
    }

    if args[0] == "import" {
        let (Some(catalog_path), Some(file_path)) = (args.get(1), args.get(2)) else {
            eprintln!("uso: restore_book import <catalog> <archivo>");
            return ExitCode::from(2);
        };
        let mut catalog = match minelly_lib::db::Catalog::open(catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => {
                eprintln!("error al abrir el catálogo: {error:#}");
                return ExitCode::FAILURE;
            }
        };
        return match minelly_lib::import::import_path(&mut catalog, std::path::Path::new(file_path)) {
            Ok(report) => {
                println!(
                    "importado: {} · {} capítulos",
                    report.resource.title, report.resource.entry_count
                );
                for warning in report.warnings {
                    println!("aviso: {warning}");
                }
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("error: {error:#}");
                ExitCode::FAILURE
            }
        };
    }

    if args[0] == "search" {
        let (Some(catalog_path), Some(resource_id), Some(query)) =
            (args.get(1), args.get(2), args.get(3))
        else {
            eprintln!("uso: restore_book search <catalog> <resource_id> <consulta>");
            return ExitCode::from(2);
        };
        let catalog = match minelly_lib::db::Catalog::open(catalog_path) {
            Ok(catalog) => catalog,
            Err(error) => {
                eprintln!("error al abrir el catálogo: {error:#}");
                return ExitCode::FAILURE;
            }
        };
        return match minelly_lib::resource_search::search_resource(&catalog, resource_id, query, 20) {
            Ok(matches) => {
                println!("{} coincidencias", matches.len());
                for item in matches.iter().take(10) {
                    println!("  {} · {} · {}", item.title, item.occurrences, item.snippet);
                }
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("error: {error:#}");
                ExitCode::FAILURE
            }
        };
    }

    let Some(resource_id) = args.get(1) else {
        eprintln!("falta el identificador del libro");
        return ExitCode::from(2);
    };

    let mut catalog = match minelly_lib::db::Catalog::open(&args[0]) {
        Ok(catalog) => catalog,
        Err(error) => {
            eprintln!("error al abrir el catálogo: {error:#}");
            return ExitCode::FAILURE;
        }
    };

    match minelly_lib::library::restore_epub_from_source(&mut catalog, resource_id) {
        Ok(chapters) => {
            println!("capítulos restaurados: {}", chapters.len());
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}
