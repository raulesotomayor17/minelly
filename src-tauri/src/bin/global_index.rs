use std::path::PathBuf;

use teoamoxtli_lib::{db::Catalog, indexer};

fn main() -> anyhow::Result<()> {
    let path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var("HOME").unwrap_or_default())
                .join(".local/share/com.teoamoxtli.desktop/catalog.sqlite")
        });
    println!("Catálogo: {}", path.display());
    let mut catalog = Catalog::open(&path)?;
    let before = indexer::status_for_catalog(&catalog)?;
    println!(
        "Antes: {}/{} recursos indexados, {} pendientes, {} filas FTS",
        before.indexed_resources,
        before.total_resources,
        before.pending_resources,
        before.total_rows
    );
    if !before.pending.is_empty() {
        for resource in &before.pending {
            println!("  pendiente: [{}] {}", resource.kind, resource.title);
        }
        let reports = indexer::reindex_catalog(&mut catalog)?;
        for report in &reports {
            println!(
                "  indexado: {} ({}) · {} filas",
                report.resource_id, report.module_type, report.rows
            );
        }
    }
    let after = indexer::status_for_catalog(&catalog)?;
    println!(
        "Después: {}/{} recursos indexados, {} pendientes, {} filas FTS",
        after.indexed_resources,
        after.total_resources,
        after.pending_resources,
        after.total_rows
    );
    if let Some(query) = std::env::args().nth(2) {
        println!("Búsqueda: {query}");
        for hit in indexer::search_for_catalog(&catalog, &query, 5)? {
            println!(
                "  [{}] {} {} => {}",
                hit.module_type, hit.resource_id, hit.reference_key, hit.fragment
            );
        }
        println!("Búsqueda unificada:");
        for hit in indexer::search_everything_for_catalog(&catalog, &query, 10)? {
            println!(
                "  [{}] {} · {} · {} => {}",
                hit.source_type, hit.resource_id, hit.title, hit.reference, hit.snippet
            );
        }
    }
    Ok(())
}
