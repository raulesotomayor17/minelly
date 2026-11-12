use teoamoxtli_lib::db::Catalog;
use teoamoxtli_lib::interlinear;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let path = args
        .next()
        .expect("uso: interlinear_smoke <STEPBible.zip> [catalog.sqlite]");
    let mut catalog = if let Some(db_path) = args.next() {
        Catalog::open(db_path)?
    } else {
        Catalog::open_in_memory()?
    };
    let report = interlinear::import_stepbible(&mut catalog, path)?;
    println!("import: {report:?}");
    let status = interlinear::status(&catalog)?;
    println!("status: {status:?}");
    for (label, book, chap) in [("GEN 1", 1, 1), ("JHN 3", 43, 3)] {
        let verses = interlinear::chapter(&catalog, book, chap)?;
        println!("{label} verses: {}", verses.len());
        if let Some(first) = verses.first() {
            println!("  verse {} tokens {}", first.verse, first.tokens.len());
            for token in first.tokens.iter().take(4) {
                println!(
                    "    {} | {} | {} | {} | {} | {}",
                    token.surface_text,
                    token.original_manuscript,
                    token.transliteration,
                    token.lemma,
                    token.strong_number,
                    token.morphology_code
                );
            }
        }
    }
    Ok(())
}
