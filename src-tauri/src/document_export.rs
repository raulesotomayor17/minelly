use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::model::DocumentBlock;

const XML_HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

pub fn export_document(
    path: String,
    format: String,
    title: String,
    blocks: Vec<DocumentBlock>,
) -> Result<String> {
    let format = format.trim().to_ascii_lowercase();
    if format != "docx" && format != "odt" {
        return Err(anyhow!("Formato de texto no soportado: {format}"));
    }
    let mut output = PathBuf::from(path);
    output.set_extension(&format);
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .with_context(|| format!("no se pudo crear {}", parent.display()))?;
        }
    }
    if format == "docx" {
        build_docx(&output, &title, &blocks)?;
    } else {
        build_odt(&output, &title, &blocks)?;
    }
    Ok(output.to_string_lossy().to_string())
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn build_docx(path: &Path, title: &str, blocks: &[DocumentBlock]) -> Result<()> {
    let file = fs::File::create(path)
        .with_context(|| format!("no se pudo crear {}", path.display()))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut body = String::new();
    body.push_str(&paragraph_xml("Title", title));
    for block in blocks {
        if block.text.trim().is_empty() {
            continue;
        }
        let style = match block.kind.as_str() {
            "heading" => format!("Heading{}", block.level.clamp(1, 3)),
            "quote" => "Quote".to_string(),
            "bullet" => "ListParagraph".to_string(),
            _ => "Normal".to_string(),
        };
        let text = if block.kind == "bullet" {
            format!("• {}", block.text)
        } else {
            block.text.clone()
        };
        body.push_str(&paragraph_xml(&style, &text));
    }
    let document = format!(
        "{XML_HEADER}<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\
         <w:body>{body}<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/>\
         <w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>\
         </w:sectPr></w:body></w:document>"
    );
    let styles = format!(
        "{XML_HEADER}<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">\
         <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii=\"Georgia\" w:hAnsi=\"Georgia\"/><w:sz w:val=\"22\"/></w:rPr></w:rPrDefault>\
         <w:pPrDefault><w:pPr><w:spacing w:after=\"140\" w:line=\"300\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault></w:docDefaults>\
         <w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/></w:style>\
         <w:style w:type=\"paragraph\" w:styleId=\"Title\"><w:name w:val=\"Title\"/><w:basedOn w:val=\"Normal\"/><w:pPr><w:spacing w:after=\"300\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"44\"/></w:rPr></w:style>\
         <w:style w:type=\"paragraph\" w:styleId=\"Heading1\"><w:name w:val=\"heading 1\"/><w:basedOn w:val=\"Normal\"/><w:pPr><w:spacing w:before=\"280\" w:after=\"120\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"34\"/></w:rPr></w:style>\
         <w:style w:type=\"paragraph\" w:styleId=\"Heading2\"><w:name w:val=\"heading 2\"/><w:basedOn w:val=\"Normal\"/><w:pPr><w:spacing w:before=\"240\" w:after=\"100\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"28\"/></w:rPr></w:style>\
         <w:style w:type=\"paragraph\" w:styleId=\"Heading3\"><w:name w:val=\"heading 3\"/><w:basedOn w:val=\"Normal\"/><w:pPr><w:spacing w:before=\"200\" w:after=\"80\"/></w:pPr><w:rPr><w:b/><w:sz w:val=\"24\"/></w:rPr></w:style>\
         <w:style w:type=\"paragraph\" w:styleId=\"Quote\"><w:name w:val=\"Quote\"/><w:basedOn w:val=\"Normal\"/><w:pPr><w:ind w:left=\"720\" w:right=\"720\"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>\
         <w:style w:type=\"paragraph\" w:styleId=\"ListParagraph\"><w:name w:val=\"List Paragraph\"/><w:basedOn w:val=\"Normal\"/><w:pPr><w:ind w:left=\"720\"/></w:pPr></w:style>\
         </w:styles>"
    );
    write_zip(&mut zip, options, "[Content_Types].xml", content_types_docx().as_bytes())?;
    write_zip(&mut zip, options, "_rels/.rels", root_rels_docx().as_bytes())?;
    write_zip(&mut zip, options, "word/document.xml", document.as_bytes())?;
    write_zip(&mut zip, options, "word/styles.xml", styles.as_bytes())?;
    write_zip(
        &mut zip,
        options,
        "word/_rels/document.xml.rels",
        format!(
            "{XML_HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>\
             </Relationships>"
        )
        .as_bytes(),
    )?;
    write_zip(&mut zip, options, "docProps/core.xml", core_props(title).as_bytes())?;
    write_zip(&mut zip, options, "docProps/app.xml", app_props().as_bytes())?;
    zip.finish()?;
    Ok(())
}

fn paragraph_xml(style: &str, text: &str) -> String {
    format!(
        "<w:p><w:pPr><w:pStyle w:val=\"{}\"/></w:pPr><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
        xml_escape(style),
        xml_escape(text)
    )
}

fn content_types_docx() -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
         <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
         <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
         <Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
         <Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>\
         <Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\
         <Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>\
         </Types>"
    )
}

fn root_rels_docx() -> String {
    format!(
        "{XML_HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
         <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>\
         <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\
         <Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>\
         </Relationships>"
    )
}

fn core_props(title: &str) -> String {
    format!(
        "{XML_HEADER}<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\
         <dc:title>{}</dc:title><dc:creator>Teoamoxtli</dc:creator></cp:coreProperties>",
        xml_escape(title)
    )
}

fn app_props() -> String {
    format!(
        "{XML_HEADER}<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\"><Application>Teoamoxtli</Application></Properties>"
    )
}

fn build_odt(path: &Path, title: &str, blocks: &[DocumentBlock]) -> Result<()> {
    let file = fs::File::create(path)
        .with_context(|| format!("no se pudo crear {}", path.display()))?;
    let mut zip = ZipWriter::new(file);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("mimetype", stored)?;
    zip.write_all(b"application/vnd.oasis.opendocument.text")?;

    let mut body = String::new();
    body.push_str(&format!(
        "<text:h text:outline-level=\"1\" text:style-name=\"Title\">{}</text:h>",
        xml_escape(title)
    ));
    for block in blocks {
        if block.text.trim().is_empty() {
            continue;
        }
        match block.kind.as_str() {
            "heading" => body.push_str(&format!(
                "<text:h text:outline-level=\"{}\" text:style-name=\"Heading{}\">{}</text:h>",
                block.level.clamp(1, 3),
                block.level.clamp(1, 3),
                xml_escape(&block.text)
            )),
            "quote" => body.push_str(&format!(
                "<text:p text:style-name=\"Quote\">{}</text:p>",
                xml_escape(&block.text)
            )),
            "bullet" => body.push_str(&format!(
                "<text:list><text:list-item><text:p text:style-name=\"List\">• {}</text:p></text:list-item></text:list>",
                xml_escape(&block.text)
            )),
            _ => body.push_str(&format!(
                "<text:p text:style-name=\"Normal\">{}</text:p>",
                xml_escape(&block.text)
            )),
        }
    }
    let content = format!(
        "{XML_HEADER}<office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" office:version=\"1.2\">\
         <office:automatic-styles>\
         <style:style style:name=\"Normal\" style:family=\"paragraph\"><style:paragraph-properties fo:text-align=\"justify\" fo:margin-bottom=\"0.18cm\"/></style:style>\
         <style:style style:name=\"Title\" style:family=\"paragraph\"><style:paragraph-properties fo:margin-bottom=\"0.5cm\"/><style:text-properties fo:font-size=\"22pt\" fo:font-weight=\"bold\"/></style:style>\
         <style:style style:name=\"Heading1\" style:family=\"paragraph\"><style:paragraph-properties fo:margin-before=\"0.5cm\" fo:margin-bottom=\"0.2cm\"/><style:text-properties fo:font-size=\"17pt\" fo:font-weight=\"bold\"/></style:style>\
         <style:style style:name=\"Heading2\" style:family=\"paragraph\"><style:paragraph-properties fo:margin-before=\"0.4cm\" fo:margin-bottom=\"0.15cm\"/><style:text-properties fo:font-size=\"14pt\" fo:font-weight=\"bold\"/></style:style>\
         <style:style style:name=\"Heading3\" style:family=\"paragraph\"><style:paragraph-properties fo:margin-before=\"0.3cm\" fo:margin-bottom=\"0.1cm\"/><style:text-properties fo:font-size=\"12pt\" fo:font-weight=\"bold\"/></style:style>\
         <style:style style:name=\"Quote\" style:family=\"paragraph\"><style:paragraph-properties fo:margin-left=\"1cm\" fo:margin-right=\"1cm\" fo:font-style=\"italic\"/></style:style>\
         <style:style style:name=\"List\" style:family=\"paragraph\"><style:paragraph-properties fo:margin-left=\"0.8cm\"/></style:style>\
         </office:automatic-styles>\
         <office:body><office:text>{body}</office:text></office:body></office:document-content>"
    );
    let styles = format!(
        "{XML_HEADER}<office:document-styles xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" office:version=\"1.2\">\
         <office:styles><style:default-style style:family=\"paragraph\"><style:paragraph-properties fo:margin-bottom=\"0.18cm\"/><style:text-properties fo:font-size=\"11pt\" fo:font-family=\"Georgia\"/></style:default-style></office:styles>\
         <office:automatic-styles><style:page-layout style:name=\"pm1\"><style:page-layout-properties fo:page-width=\"21cm\" fo:page-height=\"29.7cm\" fo:margin=\"2cm\"/></style:page-layout></office:automatic-styles>\
         <office:master-styles><style:master-page style:name=\"Standard\" style:page-layout-name=\"pm1\"/></office:master-styles></office:document-styles>"
    );
    let manifest = format!(
        "{XML_HEADER}<manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" manifest:version=\"1.2\">\
         <manifest:file-entry manifest:full-path=\"/\" manifest:version=\"1.2\" manifest:media-type=\"application/vnd.oasis.opendocument.text\"/>\
         <manifest:file-entry manifest:full-path=\"content.xml\" manifest:media-type=\"text/xml\"/>\
         <manifest:file-entry manifest:full-path=\"styles.xml\" manifest:media-type=\"text/xml\"/>\
         <manifest:file-entry manifest:full-path=\"meta.xml\" manifest:media-type=\"text/xml\"/>\
         <manifest:file-entry manifest:full-path=\"settings.xml\" manifest:media-type=\"text/xml\"/>\
         </manifest:manifest>"
    );
    write_zip(&mut zip, deflated, "META-INF/manifest.xml", manifest.as_bytes())?;
    write_zip(&mut zip, deflated, "content.xml", content.as_bytes())?;
    write_zip(&mut zip, deflated, "styles.xml", styles.as_bytes())?;
    write_zip(&mut zip, deflated, "meta.xml", meta_xml(title).as_bytes())?;
    write_zip(&mut zip, deflated, "settings.xml", settings_xml().as_bytes())?;
    zip.finish()?;
    Ok(())
}

fn meta_xml(title: &str) -> String {
    format!(
        "{XML_HEADER}<office:document-meta xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:meta=\"urn:oasis:names:tc:opendocument:xmlns:meta:1.0\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" office:version=\"1.2\">\
         <office:meta><dc:title>{}</dc:title><meta:generator>Teoamoxtli</meta:generator></office:meta></office:document-meta>",
        xml_escape(title)
    )
}

fn settings_xml() -> String {
    format!(
        "{XML_HEADER}<office:document-settings xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:config=\"urn:oasis:names:tc:opendocument:xmlns:config:1.0\" office:version=\"1.2\"><office:settings/></office:document-settings>"
    )
}

fn write_zip(
    zip: &mut ZipWriter<fs::File>,
    options: SimpleFileOptions,
    name: &str,
    data: &[u8],
) -> Result<()> {
    zip.start_file(name, options)?;
    zip.write_all(data)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_blocks() -> Vec<DocumentBlock> {
        vec![
            DocumentBlock { kind: "heading".to_string(), level: 2, text: "La gracia que justifica".to_string() },
            DocumentBlock { kind: "paragraph".to_string(), level: 0, text: "Somos declarados justos por la fe en Cristo.".to_string() },
            DocumentBlock { kind: "quote".to_string(), level: 0, text: "Por gracia sois salvos por medio de la fe.".to_string() },
            DocumentBlock { kind: "bullet".to_string(), level: 0, text: "No por obras.".to_string() },
        ]
    }

    #[test]
    fn builds_native_docx_and_odt() {
        let Ok(base) = std::env::var("TEO_DOC_NATIVE_TEST") else {
            return;
        };
        for format in ["docx", "odt"] {
            let path = format!("{base}.{format}");
            export_document(
                path.clone(),
                format.to_string(),
                "El poder de la gracia".to_string(),
                sample_blocks(),
            )
            .unwrap();
            let bytes = fs::read(&path).unwrap();
            assert!(bytes.starts_with(b"PK"));
            assert!(bytes.len() > 1000);
        }
    }
}
