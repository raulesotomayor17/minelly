use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use image::GenericImageView;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use crate::model::{SlideExport, SlideObjectExport};

const SLIDE_W: i64 = 12_192_000;
const SLIDE_H: i64 = 6_858_000;
const XML_HEADER: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

#[derive(Clone)]
struct ImageAsset {
    bytes: Vec<u8>,
    ext: String,
}

struct PreparedSlide {
    slide: SlideExport,
    illustration: Option<ImageAsset>,
    background_image: Option<ImageAsset>,
    object_images: Vec<Option<ImageAsset>>,
}

pub async fn export(
    path: String,
    format: String,
    slides: Vec<SlideExport>,
) -> Result<String> {
    if slides.is_empty() {
        return Err(anyhow!("No hay diapositivas para exportar."));
    }
    let format = format.trim().to_ascii_lowercase();
    if format != "pptx" && format != "pdf" && format != "odp" {
        return Err(anyhow!("Formato no soportado: {format}"));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(25))
        .build()
        .context("no se pudo preparar el cliente HTTP")?;
    let mut prepared = Vec::with_capacity(slides.len());
    for slide in slides {
        let illustration = fetch_asset(&client, &slide.image_url).await;
        let background_image = if is_image_reference(&slide.background) {
            fetch_asset(&client, &slide.background).await
        } else {
            None
        };
        let mut object_images = Vec::with_capacity(slide.objects.len());
        for object in &slide.objects {
            if object.object_type == "image" {
                object_images.push(fetch_asset(&client, &object.url).await);
            } else {
                object_images.push(None);
            }
        }
        prepared.push(PreparedSlide {
            slide,
            illustration,
            background_image,
            object_images,
        });
    }

    let output = PathBuf::from(path);
    if let Some(parent) = output.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .with_context(|| format!("no se pudo crear {}", parent.display()))?;
        }
    }

    if format == "pptx" {
        let out = with_extension(&output, "pptx");
        let build_path = out.clone();
        tauri::async_runtime::spawn_blocking(move || build_pptx(&build_path, &prepared))
            .await
            .map_err(|error| anyhow!("tarea de exportación interrumpida: {error}"))??;
        return Ok(out.to_string_lossy().to_string());
    }

    let target_path = with_extension(&output, &format);
    let result_path = target_path.clone();
    if format == "pdf" {
        tauri::async_runtime::spawn_blocking(move || {
            build_pdf_native(&target_path, &prepared)
        })
        .await
        .map_err(|error| anyhow!("tarea de exportación interrumpida: {error}"))??;
        return Ok(result_path.to_string_lossy().to_string());
    }
    if format == "odp" {
        tauri::async_runtime::spawn_blocking(move || {
            build_odp_native(&target_path, &prepared)
        })
        .await
        .map_err(|error| anyhow!("tarea de exportación interrumpida: {error}"))??;
        return Ok(result_path.to_string_lossy().to_string());
    }
    Err(anyhow!("Formato no soportado: {format}"))
}

fn with_extension(path: &Path, extension: &str) -> PathBuf {
    let mut output = path.to_path_buf();
    output.set_extension(extension);
    output
}

fn is_image_reference(value: &str) -> bool {
    value.starts_with("data:image/") || value.starts_with("http://") || value.starts_with("https://")
}

async fn fetch_asset(client: &reqwest::Client, url: &str) -> Option<ImageAsset> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }
    if let Some(rest) = url.strip_prefix("data:image/") {
        let (meta, data) = rest.split_once(',')?;
        if !meta.contains("base64") {
            return None;
        }
        let ext = mime_extension(meta.split(';').next().unwrap_or(""));
        let bytes = STANDARD.decode(data).ok()?;
        if bytes.len() > 20 * 1024 * 1024 {
            return None;
        }
        return Some(ImageAsset { bytes, ext });
    }
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return None;
    }
    let response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("image/jpeg")
        .to_ascii_lowercase();
    let ext = mime_extension(&content_type);
    let bytes = response.bytes().await.ok()?.to_vec();
    if bytes.is_empty() || bytes.len() > 20 * 1024 * 1024 {
        return None;
    }
    Some(ImageAsset { bytes, ext })
}

fn mime_extension(mime: &str) -> String {
    match mime.trim().to_ascii_lowercase().as_str() {
        "image/png" => "png",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "jpeg",
    }
    .to_string()
}

fn build_pptx(path: &Path, slides: &[PreparedSlide]) -> Result<()> {
    let file = fs::File::create(path)
        .with_context(|| format!("no se pudo crear {}", path.display()))?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut slide_xmls = Vec::new();
    let mut slide_rels = Vec::new();
    let mut image_index = 0usize;

    for (index, prepared) in slides.iter().enumerate() {
        let mut relationships = vec![(
            "rId1".to_string(),
            "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"
                .to_string(),
            "../slideLayouts/slideLayout1.xml".to_string(),
        )];
        let mut next_rid = 2;
        let mut background_rid = None;
        let mut illustration_rid = None;

        if let Some(background) = &prepared.background_image {
            image_index += 1;
            let name = format!("image{image_index}.{}", background.ext);
            zip.start_file(format!("ppt/media/{name}"), options)?;
            zip.write_all(&background.bytes)?;
            let rid = format!("rId{next_rid}");
            next_rid += 1;
            relationships.push((
                rid.clone(),
                "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                    .to_string(),
                format!("../media/{name}"),
            ));
            background_rid = Some(rid);
        }
        if prepared.slide.objects.is_empty() {
            if let Some(illustration) = &prepared.illustration {
                image_index += 1;
                let name = format!("image{image_index}.{}", illustration.ext);
                zip.start_file(format!("ppt/media/{name}"), options)?;
                zip.write_all(&illustration.bytes)?;
                let rid = format!("rId{next_rid}");
                next_rid += 1;
                relationships.push((
                    rid.clone(),
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                        .to_string(),
                    format!("../media/{name}"),
                ));
                illustration_rid = Some(rid);
            }
        }

        let mut object_rids = Vec::with_capacity(prepared.object_images.len());
        for asset in &prepared.object_images {
            if let Some(image) = asset {
                image_index += 1;
                let name = format!("image{image_index}.{}", image.ext);
                zip.start_file(format!("ppt/media/{name}"), options)?;
                zip.write_all(&image.bytes)?;
                let rid = format!("rId{next_rid}");
                next_rid += 1;
                relationships.push((
                    rid.clone(),
                    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
                        .to_string(),
                    format!("../media/{name}"),
                ));
                object_rids.push(Some(rid));
            } else {
                object_rids.push(None);
            }
        }

        slide_xmls.push(slide_xml(
            &prepared.slide,
            background_rid.as_deref(),
            illustration_rid.as_deref(),
            &object_rids,
        ));
        let rels_xml = relationships
            .iter()
            .map(|(id, kind, target)| {
                format!(
                    "<Relationship Id=\"{id}\" Type=\"{kind}\" Target=\"{target}\"/>"
                )
            })
            .collect::<String>();
        slide_rels.push(format!(
            "{XML_HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{rels_xml}</Relationships>"
        ));
    }

    let slide_count = slides.len();
    let mut content_types = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
         <Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
         <Default Extension=\"xml\" ContentType=\"application/xml\"/>\
         <Default Extension=\"png\" ContentType=\"image/png\"/>\
         <Default Extension=\"jpeg\" ContentType=\"image/jpeg\"/>\
         <Default Extension=\"jpg\" ContentType=\"image/jpeg\"/>\
         <Default Extension=\"gif\" ContentType=\"image/gif\"/>\
         <Override PartName=\"/ppt/presentation.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml\"/>\
         <Override PartName=\"/ppt/slideMasters/slideMaster1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml\"/>\
         <Override PartName=\"/ppt/slideLayouts/slideLayout1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml\"/>\
         <Override PartName=\"/ppt/theme/theme1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.theme+xml\"/>\
         <Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\
         <Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>",
    );
    for index in 0..slide_count {
        content_types.push_str(&format!(
            "<Override PartName=\"/ppt/slides/slide{}.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.presentationml.slide+xml\"/>",
            index + 1
        ));
    }
    content_types.push_str("</Types>");

    let mut presentation_ids = String::new();
    let mut presentation_rels = String::new();
    presentation_rels.push_str(
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"slideMasters/slideMaster1.xml\"/>",
    );
    for index in 0..slide_count {
        presentation_ids.push_str(&format!(
            "<p:sldId id=\"{}\" r:id=\"rId{}\"/>",
            256 + index,
            index + 2
        ));
        presentation_rels.push_str(&format!(
            "<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide\" Target=\"slides/slide{}.xml\"/>",
            index + 2,
            index + 1
        ));
    }
    presentation_rels.push_str(&format!(
        "<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"theme/theme1.xml\"/>",
        slide_count + 2
    ));
    let presentation_xml = format!(
        "{XML_HEADER}<p:presentation xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" saveSubsetFonts=\"1\">\
         <p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>\
         <p:sldIdLst>{presentation_ids}</p:sldIdLst>\
         <p:sldSz cx=\"{SLIDE_W}\" cy=\"{SLIDE_H}\" type=\"screen16x9\"/>\
         <p:notesSz cx=\"6858000\" cy=\"9144000\"/>\
         </p:presentation>"
    );

    write_zip_entry(
        &mut zip,
        options,
        "[Content_Types].xml",
        content_types.as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "_rels/.rels",
        format!(
            "{XML_HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"ppt/presentation.xml\"/>\
             <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\
             <Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>\
             </Relationships>"
        )
        .as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "docProps/core.xml",
        format!(
            "{XML_HEADER}<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\
             <dc:title>Teoamoxtli · Sermón</dc:title>\
             <dc:creator>Teoamoxtli</dc:creator>\
             </cp:coreProperties>"
        )
        .as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "docProps/app.xml",
        format!(
            "{XML_HEADER}<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">\
             <Application>Teoamoxtli</Application>\
             <PresentationFormat>Widescreen</PresentationFormat>\
             <Slides>{slide_count}</Slides>\
             </Properties>"
        )
        .as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "ppt/presentation.xml",
        presentation_xml.as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "ppt/_rels/presentation.xml.rels",
        format!(
            "{XML_HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{presentation_rels}</Relationships>"
        )
        .as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "ppt/slideMasters/slideMaster1.xml",
        master_xml().as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        format!(
            "{XML_HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout\" Target=\"../slideLayouts/slideLayout1.xml\"/>\
             <Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme\" Target=\"../theme/theme1.xml\"/>\
             </Relationships>"
        )
        .as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "ppt/slideLayouts/slideLayout1.xml",
        layout_xml().as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels",
        format!(
            "{XML_HEADER}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
             <Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster\" Target=\"../slideMasters/slideMaster1.xml\"/>\
             </Relationships>"
        )
        .as_bytes(),
    )?;
    write_zip_entry(
        &mut zip,
        options,
        "ppt/theme/theme1.xml",
        theme_xml().as_bytes(),
    )?;
    for (index, xml) in slide_xmls.iter().enumerate() {
        write_zip_entry(
            &mut zip,
            options,
            &format!("ppt/slides/slide{}.xml", index + 1),
            xml.as_bytes(),
        )?;
        write_zip_entry(
            &mut zip,
            options,
            &format!("ppt/slides/_rels/slide{}.xml.rels", index + 1),
            slide_rels[index].as_bytes(),
        )?;
    }
    zip.finish()?;
    Ok(())
}

fn write_zip_entry(
    zip: &mut ZipWriter<fs::File>,
    options: SimpleFileOptions,
    name: &str,
    data: &[u8],
) -> Result<()> {
    zip.start_file(name, options)?;
    zip.write_all(data)?;
    Ok(())
}

fn slide_xml(
    slide: &SlideExport,
    background_rid: Option<&str>,
    illustration_rid: Option<&str>,
    object_rids: &[Option<String>],
) -> String {
    let background = normalize_color(&slide.background);
    let text_color = match background.as_deref() {
        Some(color) if is_light_color(color) => "1F232B",
        _ => "F5F8FF",
    };
    let mut tree = String::new();
    let mut next_id = 2;

    if let Some(rid) = background_rid {
        tree.push_str(&picture_xml(next_id, "Fondo", rid, 0, 0, SLIDE_W, SLIDE_H, 0.0, None));
        next_id += 1;
        tree.push_str(&overlay_xml(next_id));
        next_id += 1;
    }
    if !slide.objects.is_empty() {
        let mut ordered_objects = slide.objects.iter().enumerate().collect::<Vec<_>>();
        ordered_objects.sort_by_key(|(_, object)| object.z_index);
        for (index, object) in ordered_objects {
            let x = to_emu(object.x, SLIDE_W);
            let y = to_emu(object.y, SLIDE_H);
            let width = to_emu(object.width, SLIDE_W);
            let height = to_emu(object.height, SLIDE_H);
            if object.object_type == "image" {
                if let Some(Some(rid)) = object_rids.get(index) {
                    tree.push_str(&picture_xml(
                        next_id,
                        "Imagen",
                        rid,
                        x,
                        y,
                        width,
                        height,
                        object.rotation,
                        Some((
                            object.crop_left,
                            object.crop_top,
                            object.crop_right,
                            object.crop_bottom,
                        )),
                    ));
                    next_id += 1;
                }
            } else {
                tree.push_str(&object_text_shape(
                    next_id,
                    object,
                    x,
                    y,
                    width,
                    height,
                    text_color,
                    object.rotation,
                ));
                next_id += 1;
            }
        }
    } else {
        if let Some(rid) = illustration_rid {
            tree.push_str(&picture_xml(
                next_id,
                "Ilustración",
                rid,
                500_000,
                800_000,
                5_000_000,
                5_200_000,
                0.0,
                None,
            ));
            next_id += 1;
        }

        let text_x = if illustration_rid.is_some() {
            5_900_000
        } else {
            800_000
        };
        let text_w = if illustration_rid.is_some() {
            5_700_000
        } else {
            10_600_000
        };

        if slide.kind == "quote" {
            let quote = slide.body.first().cloned().unwrap_or_default();
            tree.push_str(&text_shape(
                next_id,
                "Cita",
                text_x,
                1_300_000,
                text_w,
                4_200_000,
                &[quote],
                text_color,
                3_000,
                true,
            ));
        } else {
            if !slide.title.trim().is_empty() {
                let title_size = if slide.kind == "title" { 4_000 } else { 3_200 };
                tree.push_str(&text_shape(
                    next_id,
                    "Título",
                    text_x,
                    750_000,
                    text_w,
                    1_500_000,
                    &[slide.title.clone()],
                    text_color,
                    title_size,
                    true,
                ));
                next_id += 1;
            }
            let body: Vec<String> = if slide.body.is_empty() {
                vec![String::new()]
            } else {
                slide.body.clone()
            };
            let body_size = match slide.kind.as_str() {
                "passage" => 1_900,
                "title" => 2_200,
                _ => 2_000,
            };
            tree.push_str(&text_shape(
                next_id,
                "Contenido",
                text_x,
                2_500_000,
                text_w,
                3_500_000,
                &body,
                text_color,
                body_size,
                false,
            ));
        }
    }

    let bg = if let Some(color) = background {
        format!(
            "<p:bg><p:bgPr><a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>"
        )
    } else {
        String::new()
    };

    format!(
        "{XML_HEADER}<p:sld xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">\
         <p:cSld>{bg}<p:spTree>\
         <p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\
         <p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>\
         {tree}</p:spTree></p:cSld>\
         <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>\
         </p:sld>"
    )
}

fn to_emu(value: f64, total: i64) -> i64 {
    ((value / if total == SLIDE_W { 1280.0 } else { 720.0 }) * total as f64).round() as i64
}

fn object_text_shape(
    id: i64,
    object: &SlideObjectExport,
    x: i64,
    y: i64,
    cx: i64,
    cy: i64,
    fallback_color: &str,
    rotation: f64,
) -> String {
    let color = normalize_color(&object.color).unwrap_or_else(|| fallback_color.to_string());
    let align = match object.align.as_str() {
        "center" => "ctr",
        "right" => "r",
        _ => "l",
    };
    let size = if object.font_size > 0.0 {
        (object.font_size * 75.0).round() as i64
    } else {
        1800
    };
    let underline = if object.underline { "sng" } else { "none" };
    let font = if object.font_family.contains("Georgia") {
        "Georgia"
    } else if object.font_family.contains("Inter") {
        "Inter"
    } else if object.font_family.contains("Arial") {
        "Arial"
    } else if object.font_family.contains("Times") {
        "Times New Roman"
    } else {
        "Georgia"
    };
    let lines: Vec<&str> = if object.text.is_empty() {
        vec![""]
    } else {
        object.text.split('\n').collect()
    };
    let paragraphs = lines
        .iter()
        .map(|line| {
            format!(
                "<a:p><a:pPr algn=\"{align}\"/><a:r><a:rPr lang=\"es-ES\" sz=\"{size}\" b=\"{}\" i=\"{}\" u=\"{underline}\" dirty=\"0\"><a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill><a:latin typeface=\"{font}\"/></a:rPr><a:t>{}</a:t></a:r></a:p>",
                if object.bold { 1 } else { 0 },
                if object.italic { 1 } else { 0 },
                xml_escape(line)
            )
        })
        .collect::<String>();
    let rot = (rotation * 60_000.0).round() as i64;
    format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"Texto\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr>\
         <p:spPr><a:xfrm rot=\"{rot}\"><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>\
         <p:txBody><a:bodyPr wrap=\"square\" anchor=\"t\"/><a:lstStyle/>{paragraphs}</p:txBody></p:sp>"
    )
}

#[allow(clippy::too_many_arguments)]
fn text_shape(
    id: i64,
    name: &str,
    x: i64,
    y: i64,
    cx: i64,
    cy: i64,
    lines: &[String],
    color: &str,
    size: i64,
    bold: bool,
) -> String {
    let paragraphs = lines
        .iter()
        .map(|line| {
            format!(
                "<a:p><a:pPr algn=\"l\"/><a:r><a:rPr lang=\"es-ES\" sz=\"{size}\" b=\"{}\" dirty=\"0\"><a:solidFill><a:srgbClr val=\"{color}\"/></a:solidFill><a:latin typeface=\"Georgia\"/></a:rPr><a:t>{}</a:t></a:r></a:p>",
                if bold { 1 } else { 0 },
                xml_escape(line)
            )
        })
        .collect::<String>();
    let rot = 0;
    format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"{}\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr>\
         <p:spPr><a:xfrm rot=\"{rot}\"><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>\
         <p:txBody><a:bodyPr wrap=\"square\" anchor=\"t\"/><a:lstStyle/>{paragraphs}</p:txBody></p:sp>",
        xml_escape(name)
    )
}

fn picture_xml(
    id: i64,
    name: &str,
    rid: &str,
    x: i64,
    y: i64,
    cx: i64,
    cy: i64,
    rotation: f64,
    crop: Option<(f64, f64, f64, f64)>,
) -> String {
    let rot = (rotation * 60_000.0).round() as i64;
    let crop_xml = crop
        .map(|(left, top, right, bottom)| {
            format!(
                "<a:srcRect l=\"{}\" t=\"{}\" r=\"{}\" b=\"{}\"/>",
                (left.clamp(0.0, 90.0) * 1000.0).round() as i64,
                (top.clamp(0.0, 90.0) * 1000.0).round() as i64,
                (right.clamp(0.0, 90.0) * 1000.0).round() as i64,
                (bottom.clamp(0.0, 90.0) * 1000.0).round() as i64
            )
        })
        .unwrap_or_default();
    format!(
        "<p:pic><p:nvPicPr><p:cNvPr id=\"{id}\" name=\"{}\"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>\
         <p:blipFill><a:blip r:embed=\"{rid}\"/>{crop_xml}<a:stretch><a:fillRect/></a:stretch></p:blipFill>\
         <p:spPr><a:xfrm rot=\"{rot}\"><a:off x=\"{x}\" y=\"{y}\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr></p:pic>",
        xml_escape(name)
    )
}

fn overlay_xml(id: i64) -> String {
    format!(
        "<p:sp><p:nvSpPr><p:cNvPr id=\"{id}\" name=\"Sombra\"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>\
         <p:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{SLIDE_W}\" cy=\"{SLIDE_H}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>\
         <a:solidFill><a:srgbClr val=\"000000\"><a:alpha val=\"52000\"/></a:srgbClr></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr>\
         <p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>"
    )
}

fn is_light_color(hex: &str) -> bool {
    if hex.len() != 6 {
        return false;
    }
    let channel = |start: usize| u32::from_str_radix(&hex[start..start + 2], 16).unwrap_or(0);
    let luminance = (channel(0) * 299 + channel(2) * 587 + channel(4) * 114) / 1000;
    luminance > 160
}

fn normalize_color(value: &str) -> Option<String> {
    let clean = value.trim().trim_start_matches('#').to_ascii_uppercase();
    if clean.len() == 6 && clean.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(clean)
    } else if value.trim().is_empty() {
        Some("101722".to_string())
    } else {
        None
    }
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn master_xml() -> String {
    format!(
        "{XML_HEADER}<p:sldMaster xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\">\
         <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\
         <p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>\
         <p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>\
         <p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst>\
         </p:sldMaster>"
    )
}

fn layout_xml() -> String {
    format!(
        "{XML_HEADER}<p:sldLayout xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" type=\"blank\" preserve=\"1\">\
         <p:cSld name=\"Blank\"><p:spTree><p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>\
         <p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/><a:chOff x=\"0\" y=\"0\"/><a:chExt cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>\
         <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>"
    )
}

fn theme_xml() -> String {
    format!(
        "{XML_HEADER}<a:theme xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" name=\"Teoamoxtli\">\
         <a:themeElements>\
         <a:clrScheme name=\"Teo\">\
         <a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1>\
         <a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1>\
         <a:dk2><a:srgbClr val=\"1F232B\"/></a:dk2>\
         <a:lt2><a:srgbClr val=\"F5F8FF\"/></a:lt2>\
         <a:accent1><a:srgbClr val=\"5B95FF\"/></a:accent1>\
         <a:accent2><a:srgbClr val=\"D6B36A\"/></a:accent2>\
         <a:accent3><a:srgbClr val=\"46B98A\"/></a:accent3>\
         <a:accent4><a:srgbClr val=\"A78BFA\"/></a:accent4>\
         <a:accent5><a:srgbClr val=\"38BDF8\"/></a:accent5>\
         <a:accent6><a:srgbClr val=\"F28B82\"/></a:accent6>\
         <a:hlink><a:srgbClr val=\"5B95FF\"/></a:hlink>\
         <a:folHlink><a:srgbClr val=\"A78BFA\"/></a:folHlink>\
         </a:clrScheme>\
         <a:fontScheme name=\"Teo\">\
         <a:majorFont><a:latin typeface=\"Georgia\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont>\
         <a:minorFont><a:latin typeface=\"Arial\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont>\
         </a:fontScheme>\
         <a:fmtScheme name=\"Teo\">\
         <a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>\
         <a:lnStyleLst><a:ln w=\"9525\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"25400\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln><a:ln w=\"38100\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln></a:lnStyleLst>\
         <a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>\
         <a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>\
         </a:fmtScheme>\
         </a:themeElements>\
         <a:objectDefaults/><a:extraClrSchemeLst/>\
         </a:theme>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_slides() -> Vec<PreparedSlide> {
        vec![
            PreparedSlide {
                slide: SlideExport {
                    kind: "title".to_string(),
                    title: "El poder de la gracia".to_string(),
                    body: vec!["Raúl Sotomayor".to_string(), "Reflexiones de Santiago".to_string()],
                    reference: String::new(),
                    image_url: String::new(),
                    background: "#101722".to_string(),
                    objects: Vec::new(),
                },
                illustration: None,
                background_image: None,
                object_images: Vec::new(),
            },
            PreparedSlide {
                slide: SlideExport {
                    kind: "heading".to_string(),
                    title: "La gracia que justifica".to_string(),
                    body: vec!["Pablo explica la justificación por fe.".to_string()],
                    reference: String::new(),
                    image_url: String::new(),
                    background: "#F5EFE0".to_string(),
                    objects: Vec::new(),
                },
                illustration: None,
                background_image: None,
                object_images: Vec::new(),
            },
            PreparedSlide {
                slide: SlideExport {
                    kind: "illustration".to_string(),
                    title: "Una imagen vale más".to_string(),
                    body: vec!["La ilustración también se exporta.".to_string()],
                    reference: String::new(),
                    image_url: String::new(),
                    background: "#101722".to_string(),
                    objects: Vec::new(),
                },
                illustration: Some(ImageAsset {
                    bytes: STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=").unwrap(),
                    ext: "png".to_string(),
                }),
                background_image: None,
                object_images: Vec::new(),
            },
            PreparedSlide {
                slide: SlideExport {
                    kind: "heading".to_string(),
                    title: "Lienzo libre".to_string(),
                    body: Vec::new(),
                    reference: String::new(),
                    image_url: String::new(),
                    background: "#0B1726".to_string(),
                    objects: vec![
                        SlideObjectExport {
                            id: "t1".to_string(),
                            object_type: "text".to_string(),
                            text: "Texto libre\nsegunda línea".to_string(),
                            url: String::new(),
                            x: 100.0,
                            y: 80.0,
                            width: 600.0,
                            height: 140.0,
                            font_size: 48.0,
                            font_family: "Georgia".to_string(),
                            bold: true,
                            italic: false,
                            underline: false,
                            color: "#F5F8FF".to_string(),
                            align: "left".to_string(),
                            radius: None,
                            rotation: 0.0,
                            z_index: 0,
                            opacity: 1.0,
                            shadow: false,
                            crop_top: 0.0,
                            crop_right: 0.0,
                            crop_bottom: 0.0,
                            crop_left: 0.0,
                        },
                        SlideObjectExport {
                            id: "i1".to_string(),
                            object_type: "image".to_string(),
                            text: String::new(),
                            url: String::new(),
                            x: 760.0,
                            y: 140.0,
                            width: 420.0,
                            height: 360.0,
                            font_size: 0.0,
                            font_family: String::new(),
                            bold: false,
                            italic: false,
                            underline: false,
                            color: String::new(),
                            align: String::new(),
                            radius: None,
                            rotation: 0.0,
                            z_index: 0,
                            opacity: 1.0,
                            shadow: false,
                            crop_top: 0.0,
                            crop_right: 0.0,
                            crop_bottom: 0.0,
                            crop_left: 0.0,
                        },
                    ],
                },
                illustration: None,
                background_image: None,
                object_images: vec![
                    None,
                    Some(ImageAsset {
                        bytes: STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=").unwrap(),
                        ext: "png".to_string(),
                    }),
                ],
            },
        ]
    }

    #[test]
    fn builds_a_sample_pptx() {
        let path = std::env::var("TEO_EXPORT_TEST")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir().join("teo-export-test.pptx"));
        let slides = sample_slides();
        build_pptx(&path, &slides).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"PK"));
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn builds_native_odp() {
        let Ok(path) = std::env::var("TEO_ODP_TEST") else {
            return;
        };
        let path = PathBuf::from(path);
        build_odp_native(&path, &sample_slides()).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"PK"));
    }

    #[test]
    fn builds_native_pdf() {
        let Ok(path) = std::env::var("TEO_PDF_TEST") else {
            return;
        };
        let path = PathBuf::from(path);
        build_pdf_native(&path, &sample_slides()).unwrap();
        let bytes = fs::read(&path).unwrap();
        assert!(bytes.starts_with(b"%PDF"));
    }


}

// ---------------------------------------------------------------------------
// PDF nativo (sin LibreOffice): fuentes Type1, texto, imágenes y rotación.
// ---------------------------------------------------------------------------

struct NativeImage {
    bytes: Vec<u8>,
    width: u32,
    height: u32,
}

struct PdfBuilder {
    objects: Vec<Option<Vec<u8>>>,
}

impl PdfBuilder {
    fn new() -> Self {
        Self {
            objects: vec![None, None],
        }
    }

    fn reserve(&mut self) -> usize {
        self.objects.push(None);
        self.objects.len()
    }

    fn set(&mut self, id: usize, data: Vec<u8>) {
        self.objects[id - 1] = Some(data);
    }

    fn write(&self, path: &Path) -> Result<()> {
        let mut output = Vec::new();
        output.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
        let mut offsets = vec![0usize; self.objects.len() + 1];
        for (index, object) in self.objects.iter().enumerate() {
            let id = index + 1;
            if let Some(data) = object {
                offsets[id] = output.len();
                output.extend_from_slice(format!("{id} 0 obj\n").as_bytes());
                output.extend_from_slice(data);
                output.extend_from_slice(b"\nendobj\n");
            }
        }
        let xref = output.len();
        output.extend_from_slice(format!("xref\n0 {}\n", self.objects.len() + 1).as_bytes());
        output.extend_from_slice(b"0000000000 65535 f \n");
        for id in 1..=self.objects.len() {
            output.extend_from_slice(format!("{:010} 00000 n \n", offsets[id]).as_bytes());
        }
        output.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
                self.objects.len() + 1
            )
            .as_bytes(),
        );
        fs::write(path, output)
            .with_context(|| format!("no se pudo escribir {}", path.display()))?;
        Ok(())
    }
}

fn build_pdf_native(path: &Path, slides: &[PreparedSlide]) -> Result<()> {
    let mut pdf = PdfBuilder::new();
    let fonts = add_pdf_fonts(&mut pdf);
    let mut page_ids = Vec::new();
    let mut image_counter = 0usize;

    for prepared in slides {
        let background = normalize_color(&prepared.slide.background)
            .unwrap_or_else(|| "101722".to_string());
        let text_color = if is_light_color(&background) {
            "1F232B"
        } else {
            "F5F8FF"
        };
        let mut content = Vec::new();
        write_pdf_color(&mut content, &background);
        content.extend_from_slice(b"0 0 960 540 re f\n");

        let mut page_images: Vec<(String, usize)> = Vec::new();
        if let Some(asset) = &prepared.background_image {
            if let Some(image) = prepare_native_image(asset, None) {
                image_counter += 1;
                let name = format!("Im{image_counter}");
                let id = add_pdf_image(&mut pdf, &image);
                draw_pdf_image(&mut content, &name, 0.0, 0.0, 960.0, 540.0, 0.0);
                page_images.push((name, id));
            }
        }

        if !prepared.slide.objects.is_empty() {
            let mut objects = prepared.slide.objects.iter().collect::<Vec<_>>();
            objects.sort_by_key(|object| object.z_index);
            for object in objects {
                if object.object_type == "image" {
                    let index = prepared
                        .slide
                        .objects
                        .iter()
                        .position(|candidate| candidate.id == object.id)
                        .unwrap_or(0);
                    if let Some(Some(asset)) = prepared.object_images.get(index) {
                        let crop = (
                            object.crop_top,
                            object.crop_right,
                            object.crop_bottom,
                            object.crop_left,
                        );
                        if let Some(image) = prepare_native_image(asset, Some(crop)) {
                            image_counter += 1;
                            let name = format!("Im{image_counter}");
                            let id = add_pdf_image(&mut pdf, &image);
                            let x = object.x * 0.75;
                            let y = 540.0 - (object.y + object.height) * 0.75;
                            draw_pdf_image(
                                &mut content,
                                &name,
                                x,
                                y,
                                object.width * 0.75,
                                object.height * 0.75,
                                object.rotation,
                            );
                            page_images.push((name, id));
                        }
                    }
                } else {
                    draw_pdf_text_object(&mut content, object, text_color);
                }
            }
        } else {
            if prepared.slide.kind == "illustration" {
                if let Some(asset) = &prepared.illustration {
                    if let Some(image) = prepare_native_image(asset, None) {
                        image_counter += 1;
                        let name = format!("Im{image_counter}");
                        let id = add_pdf_image(&mut pdf, &image);
                        draw_pdf_image(&mut content, &name, 45.0, 80.0, 420.0, 380.0, 0.0);
                        page_images.push((name, id));
                    }
                }
            }
            draw_pdf_derived(&mut content, prepared, text_color);
        }

        let content_id = add_pdf_stream(&mut pdf, content);
        let mut xobjects = String::new();
        for (name, id) in &page_images {
            xobjects.push_str(&format!("/{name} {id} 0 R "));
        }
        let mut font_resources = String::new();
        for (name, id) in &fonts {
            font_resources.push_str(&format!("/{name} {id} 0 R "));
        }
        let page = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << {font_resources} >> /XObject << {xobjects} >> >> /Contents {content_id} 0 R >>"
        );
        let page_id = pdf.reserve();
        pdf.set(page_id, page.into_bytes());
        page_ids.push(page_id);
    }

    let pages = format!(
        "<< /Type /Pages /Kids [{}] /Count {} >>",
        page_ids
            .iter()
            .map(|id| format!("{id} 0 R"))
            .collect::<Vec<_>>()
            .join(" "),
        page_ids.len()
    );
    pdf.set(2, pages.into_bytes());
    pdf.set(
        1,
        b"<< /Type /Catalog /Pages 2 0 R >>".to_vec(),
    );
    pdf.write(path)
}

fn add_pdf_fonts(pdf: &mut PdfBuilder) -> Vec<(String, usize)> {
    let definitions = [
        ("F1", "Helvetica"),
        ("F2", "Helvetica-Bold"),
        ("F3", "Helvetica-Oblique"),
        ("F4", "Helvetica-BoldOblique"),
        ("F5", "Times-Roman"),
        ("F6", "Times-Bold"),
        ("F7", "Times-Italic"),
        ("F8", "Times-BoldItalic"),
    ];
    definitions
        .iter()
        .map(|(name, base)| {
            let id = pdf.reserve();
            let data = format!(
                "<< /Type /Font /Subtype /Type1 /BaseFont /{base} /Encoding /WinAnsiEncoding >>"
            );
            pdf.set(id, data.into_bytes());
            ((*name).to_string(), id)
        })
        .collect()
}

fn add_pdf_stream(pdf: &mut PdfBuilder, content: Vec<u8>) -> usize {
    let id = pdf.reserve();
    let mut data = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
    data.extend_from_slice(&content);
    data.extend_from_slice(b"\nendstream");
    pdf.set(id, data);
    id
}

fn add_pdf_image(pdf: &mut PdfBuilder, image: &NativeImage) -> usize {
    let id = pdf.reserve();
    let mut data = format!(
        "<< /Type /XObject /Subtype /Image /Width {} /Height {} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
        image.width, image.height, image.bytes.len()
    )
    .into_bytes();
    data.extend_from_slice(&image.bytes);
    data.extend_from_slice(b"\nendstream");
    pdf.set(id, data);
    id
}

fn prepare_native_image(
    asset: &ImageAsset,
    crop: Option<(f64, f64, f64, f64)>,
) -> Option<NativeImage> {
    let decoded = image::load_from_memory(&asset.bytes).ok()?;
    let (width, height) = decoded.dimensions();
    let (top, right, bottom, left) = crop.unwrap_or((0.0, 0.0, 0.0, 0.0));
    let x = ((left.clamp(0.0, 90.0) / 100.0) * width as f64).round() as u32;
    let y = ((top.clamp(0.0, 90.0) / 100.0) * height as f64).round() as u32;
    let crop_width = (((100.0 - left.clamp(0.0, 90.0) - right.clamp(0.0, 90.0)) / 100.0)
        * width as f64)
        .round()
        .max(1.0) as u32;
    let crop_height = (((100.0 - top.clamp(0.0, 90.0) - bottom.clamp(0.0, 90.0)) / 100.0)
        * height as f64)
        .round()
        .max(1.0) as u32;
    let crop_width = crop_width.min(width.saturating_sub(x).max(1));
    let crop_height = crop_height.min(height.saturating_sub(y).max(1));
    let cropped = decoded.crop_imm(x, y, crop_width, crop_height).to_rgb8();
    let mut jpeg = Vec::new();
    let encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 88);
    image::ImageEncoder::write_image(
        encoder,
        cropped.as_raw(),
        cropped.width(),
        cropped.height(),
        image::ExtendedColorType::Rgb8,
    )
    .ok()?;
    Some(NativeImage {
        bytes: jpeg,
        width: cropped.width(),
        height: cropped.height(),
    })
}

fn draw_pdf_text_object(content: &mut Vec<u8>, object: &SlideObjectExport, fallback: &str) {
    let color = normalize_color(&object.color).unwrap_or_else(|| fallback.to_string());
    let size = if object.font_size > 0.0 {
        object.font_size * 0.75
    } else {
        18.0
    };
    let font = pdf_font_name(object);
    let lines = wrap_pdf_text(&object.text, object.width * 0.75, size);
    let x = object.x * 0.75;
    let top = object.y * 0.75;
    let width = object.width * 0.75;
    let mut baseline = 540.0 - top - size;
    for line in lines {
        let text_width = estimate_pdf_width(&line, size);
        let offset = match object.align.as_str() {
            "center" => (width - text_width) / 2.0,
            "right" => width - text_width,
            _ => 0.0,
        };
        let line_x = x + offset.max(0.0);
        content.extend_from_slice(b"q\n");
        let radians = object.rotation.to_radians();
        let cx = x + width / 2.0;
        let cy = 540.0 - (top + object.height * 0.75 / 2.0);
        content.extend_from_slice(
            format!(
                "{:.5} {:.5} {:.5} {:.5} {:.3} {:.3} cm\n1 0 0 1 {:.3} {:.3} cm\n",
                radians.cos(),
                radians.sin(),
                -radians.sin(),
                radians.cos(),
                cx,
                cy,
                -cx,
                -cy
            )
            .as_bytes(),
        );
        write_pdf_color(content, &color);
        content.extend_from_slice(
            format!("BT /{font} {size:.2} Tf 1 0 0 1 {line_x:.3} {baseline:.3} Tm ").as_bytes(),
        );
        write_pdf_string(content, &line);
        content.extend_from_slice(b" Tj ET\nQ\n");
        if object.underline {
            content.extend_from_slice(b"q\n");
            content.extend_from_slice(
                format!("{:.3} {:.3} m {:.3} {:.3} l S\nQ\n", line_x, baseline - 1.5, line_x + text_width, baseline - 1.5)
                    .as_bytes(),
            );
        }
        baseline -= size * 1.22;
    }
}

fn draw_pdf_derived(content: &mut Vec<u8>, prepared: &PreparedSlide, fallback: &str) {
    let slide = &prepared.slide;
    let title_size = if slide.kind == "title" { 42.0 } else { 32.0 };
    let body_size = if slide.kind == "passage" { 18.0 } else { 19.0 };
    let mut fake = SlideObjectExport {
        id: "derived-title".to_string(),
        object_type: "text".to_string(),
        text: if slide.kind == "quote" {
            slide.body.first().cloned().unwrap_or_default()
        } else {
            slide.title.clone()
        },
        url: String::new(),
        x: 70.0,
        y: if slide.kind == "quote" { 150.0 } else { 65.0 },
        width: if prepared.illustration.is_some() && slide.kind == "illustration" { 590.0 } else { 1140.0 },
        height: 120.0,
        font_size: if slide.kind == "quote" { 30.0 } else { title_size },
        font_family: "Georgia".to_string(),
        bold: true,
        italic: slide.kind == "quote",
        underline: false,
        color: fallback.to_string(),
        align: if slide.kind == "quote" { "center".to_string() } else { "left".to_string() },
        radius: None,
        rotation: 0.0,
        z_index: 0,
        opacity: 1.0,
        shadow: false,
        crop_top: 0.0,
        crop_right: 0.0,
        crop_bottom: 0.0,
        crop_left: 0.0,
    };
    if slide.kind == "illustration" {
        fake.width = 600.0;
        fake.x = 660.0;
        fake.y = 80.0;
    }
    draw_pdf_text_object(content, &fake, fallback);
    if slide.kind != "quote" && !slide.body.is_empty() {
        fake.id = "derived-body".to_string();
        fake.text = slide.body.join("\n");
        fake.x = if slide.kind == "illustration" { 660.0 } else { 70.0 };
        fake.y = if slide.kind == "illustration" { 280.0 } else { 220.0 };
        fake.width = if slide.kind == "illustration" { 560.0 } else { 1140.0 };
        fake.height = 300.0;
        fake.font_size = body_size;
        fake.bold = false;
        fake.italic = false;
        fake.align = "left".to_string();
        draw_pdf_text_object(content, &fake, fallback);
    }
}

fn draw_pdf_image(
    content: &mut Vec<u8>,
    name: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rotation: f64,
) {
    let radians = rotation.to_radians();
    let cx = x + width / 2.0;
    let cy = y + height / 2.0;
    content.extend_from_slice(b"q\n");
    content.extend_from_slice(
        format!(
            "{:.5} {:.5} {:.5} {:.5} {:.3} {:.3} cm\n1 0 0 1 {:.3} {:.3} cm\n{width:.3} 0 0 {height:.3} {x:.3} {y:.3} cm\n/{name} Do\nQ\n",
            radians.cos(),
            radians.sin(),
            -radians.sin(),
            radians.cos(),
            cx,
            cy,
            -cx,
            -cy
        )
        .as_bytes(),
    );
}

fn write_pdf_color(content: &mut Vec<u8>, hex: &str) {
    let (r, g, b) = pdf_rgb(hex);
    content.extend_from_slice(format!("{r:.4} {g:.4} {b:.4} rg\n").as_bytes());
}

fn pdf_rgb(hex: &str) -> (f64, f64, f64) {
    let clean = hex.trim().trim_start_matches('#');
    if clean.len() != 6 {
        return (0.96, 0.97, 1.0);
    }
    let channel = |start: usize| {
        u8::from_str_radix(&clean[start..start + 2], 16).unwrap_or(255) as f64 / 255.0
    };
    (channel(0), channel(2), channel(4))
}

fn pdf_font_name(object: &SlideObjectExport) -> &'static str {
    let serif = object.font_family.contains("Georgia") || object.font_family.contains("Times");
    match (serif, object.bold, object.italic) {
        (true, true, true) => "F8",
        (true, true, false) => "F6",
        (true, false, true) => "F7",
        (true, false, false) => "F5",
        (false, true, true) => "F4",
        (false, true, false) => "F2",
        (false, false, true) => "F3",
        (false, false, false) => "F1",
    }
}

fn estimate_pdf_width(text: &str, size: f64) -> f64 {
    text.chars().count() as f64 * size * 0.5
}

fn wrap_pdf_text(text: &str, max_width: f64, size: f64) -> Vec<String> {
    let max_chars = ((max_width / (size * 0.5)).max(1.0)) as usize;
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let mut current = String::new();
        for word in paragraph.split_whitespace() {
            if current.is_empty() {
                current = word.to_string();
            } else if current.chars().count() + 1 + word.chars().count() <= max_chars {
                current.push(' ');
                current.push_str(word);
            } else {
                lines.push(current);
                current = word.to_string();
            }
        }
        if current.is_empty() {
            lines.push(String::new());
        } else {
            lines.push(current);
        }
    }
    lines
}

fn write_pdf_string(content: &mut Vec<u8>, text: &str) {
    content.push(b'(');
    for ch in text.chars() {
        let byte = if (ch as u32) <= 255 { ch as u8 } else { b'?' };
        match byte {
            b'(' | b')' | b'\\' => {
                content.push(b'\\');
                content.push(byte);
            }
            _ => content.push(byte),
        }
    }
    content.push(b')');
}

// ---------------------------------------------------------------------------
// ODP nativo (sin LibreOffice): ZIP/XML de OpenDocument Presentation.
// ---------------------------------------------------------------------------

const ODP_CM_PER_PX: f64 = 33.867 / 1280.0;

fn build_odp_native(path: &Path, slides: &[PreparedSlide]) -> Result<()> {
    let file = fs::File::create(path)
        .with_context(|| format!("no se pudo crear {}", path.display()))?;
    let mut zip = ZipWriter::new(file);
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    zip.start_file("mimetype", stored)?;
    zip.write_all(b"application/vnd.oasis.opendocument.presentation")?;

    let mut styles = String::from(
        "<style:style style:name=\"gr1\" style:family=\"graphic\"><style:graphic-properties draw:stroke=\"none\" draw:fill=\"none\"/></style:style>\
         <style:style style:name=\"dp1\" style:family=\"drawing-page\"><style:drawing-page-properties presentation:background-visible=\"true\" presentation:background-objects-visible=\"true\"/></style:style>",
    );
    let mut pages = String::new();
    let mut image_files: Vec<(String, Vec<u8>, String)> = Vec::new();
    let mut image_counter = 0usize;
    let mut style_counter = 0usize;

    for (slide_index, prepared) in slides.iter().enumerate() {
        let slide = &prepared.slide;
        let background = normalize_color(&slide.background).unwrap_or_else(|| "101722".to_string());
        let text_color = if is_light_color(&background) { "#1F232B" } else { "#F5F8FF" };
        let page_style = format!("dp{}", slide_index + 2);
        styles.push_str(&format!(
            "<style:style style:name=\"{page_style}\" style:family=\"drawing-page\"><style:drawing-page-properties draw:fill=\"solid\" draw:fill-color=\"#{background}\" fo:background-color=\"#{background}\" presentation:background-visible=\"true\" presentation:background-objects-visible=\"true\"/></style:style>"
        ));
        let mut page = String::new();
        if let Some(asset) = &prepared.background_image {
            let (href, _) = odp_add_image(asset, &mut image_files, &mut image_counter);
            page.push_str(&odp_image_frame(&href, 0.0, 0.0, 1280.0, 720.0, 0.0));
        }

        if !slide.objects.is_empty() {
            let mut objects = slide.objects.iter().collect::<Vec<_>>();
            objects.sort_by_key(|object| object.z_index);
            for object in objects {
                if object.object_type == "image" {
                    let index = slide
                        .objects
                        .iter()
                        .position(|candidate| candidate.id == object.id)
                        .unwrap_or(0);
                    if let Some(Some(asset)) = prepared.object_images.get(index) {
                        let cropped = prepare_odp_image(
                            asset,
                            Some((
                                object.crop_top,
                                object.crop_right,
                                object.crop_bottom,
                                object.crop_left,
                            )),
                        );
                        let (href, _) = odp_add_image(&cropped, &mut image_files, &mut image_counter);
                        page.push_str(&odp_image_frame(
                            &href,
                            object.x,
                            object.y,
                            object.width,
                            object.height,
                            object.rotation,
                        ));
                    }
                } else {
                    style_counter += 1;
                    let style_name = format!("P{style_counter}");
                    styles.push_str(&odp_text_style(&style_name, object));
                    page.push_str(&odp_text_frame(
                        &style_name,
                        &object.text,
                        object.x,
                        object.y,
                        object.width,
                        object.height,
                        object.rotation,
                    ));
                }
            }
        } else {
            let title = if slide.kind == "quote" {
                slide.body.first().cloned().unwrap_or_default()
            } else {
                slide.title.clone()
            };
            let mut title_object = SlideObjectExport {
                id: "derived-title".to_string(),
                object_type: "text".to_string(),
                text: title,
                url: String::new(),
                x: 70.0,
                y: if slide.kind == "quote" { 150.0 } else { 70.0 },
                width: if slide.kind == "illustration" { 600.0 } else { 1140.0 },
                height: 120.0,
                font_size: if slide.kind == "quote" { 34.0 } else { 40.0 },
                font_family: "Georgia".to_string(),
                bold: true,
                italic: slide.kind == "quote",
                underline: false,
                color: text_color.to_string(),
                align: if slide.kind == "quote" { "center".to_string() } else { "left".to_string() },
                radius: None,
                rotation: 0.0,
                z_index: 0,
                opacity: 1.0,
                shadow: false,
                crop_top: 0.0,
                crop_right: 0.0,
                crop_bottom: 0.0,
                crop_left: 0.0,
            };
            if slide.kind == "illustration" {
                title_object.x = 660.0;
                title_object.y = 100.0;
                title_object.width = 560.0;
                if let Some(asset) = &prepared.illustration {
                    let (href, _) = odp_add_image(asset, &mut image_files, &mut image_counter);
                    page.push_str(&odp_image_frame(&href, 45.0, 80.0, 560.0, 540.0, 0.0));
                }
            }
            style_counter += 1;
            let title_style = format!("P{style_counter}");
            styles.push_str(&odp_text_style(&title_style, &title_object));
            page.push_str(&odp_text_frame(
                &title_style,
                &title_object.text,
                title_object.x,
                title_object.y,
                title_object.width,
                title_object.height,
                title_object.rotation,
            ));
            if slide.kind != "quote" && !slide.body.is_empty() {
                let body_object = SlideObjectExport {
                    id: "derived-body".to_string(),
                    object_type: "text".to_string(),
                    text: slide.body.join("\n"),
                    url: String::new(),
                    x: if slide.kind == "illustration" { 660.0 } else { 70.0 },
                    y: if slide.kind == "illustration" { 280.0 } else { 230.0 },
                    width: if slide.kind == "illustration" { 560.0 } else { 1140.0 },
                    height: 300.0,
                    font_size: 20.0,
                    font_family: "Georgia".to_string(),
                    bold: false,
                    italic: false,
                    underline: false,
                    color: text_color.to_string(),
                    align: "left".to_string(),
                    radius: None,
                    rotation: 0.0,
                    z_index: 0,
                    opacity: 1.0,
                    shadow: false,
                    crop_top: 0.0,
                    crop_right: 0.0,
                    crop_bottom: 0.0,
                    crop_left: 0.0,
                };
                style_counter += 1;
                let body_style = format!("P{style_counter}");
                styles.push_str(&odp_text_style(&body_style, &body_object));
                page.push_str(&odp_text_frame(
                    &body_style,
                    &body_object.text,
                    body_object.x,
                    body_object.y,
                    body_object.width,
                    body_object.height,
                    0.0,
                ));
            }
        }
        pages.push_str(&format!(
            "<draw:page draw:name=\"Diapositiva {}\" draw:style-name=\"{page_style}\" draw:master-page-name=\"Default\">{page}</draw:page>",
            pages.matches("<draw:page ").count() + 1
        ));
    }

    let content = format!(
        "{XML_HEADER}<office:document-content xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:text=\"urn:oasis:names:tc:opendocument:xmlns:text:1.0\" xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" xmlns:draw=\"urn:oasis:names:tc:opendocument:xmlns:drawing:1.0\" xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" xmlns:svg=\"urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" xmlns:presentation=\"urn:oasis:names:tc:opendocument:xmlns:presentation:1.0\" office:version=\"1.2\">\
         <office:automatic-styles>{styles}</office:automatic-styles>\
         <office:body><office:presentation>{pages}</office:presentation></office:body></office:document-content>"
    );
    let styles_doc = format!(
        "{XML_HEADER}<office:document-styles xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:style=\"urn:oasis:names:tc:opendocument:xmlns:style:1.0\" xmlns:fo=\"urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0\" office:version=\"1.2\">\
         <office:styles/>\
         <office:automatic-styles><style:page-layout style:name=\"pm1\"><style:page-layout-properties fo:page-width=\"33.867cm\" fo:page-height=\"19.05cm\" fo:margin=\"0cm\"/></style:page-layout></office:automatic-styles>\
         <office:master-styles><style:master-page style:name=\"Default\" style:page-layout-name=\"pm1\"/></office:master-styles></office:document-styles>"
    );
    let mut manifest = String::from(
        "<manifest:manifest xmlns:manifest=\"urn:oasis:names:tc:opendocument:xmlns:manifest:1.0\" manifest:version=\"1.2\">\
         <manifest:file-entry manifest:full-path=\"/\" manifest:version=\"1.2\" manifest:media-type=\"application/vnd.oasis.opendocument.presentation\"/>\
         <manifest:file-entry manifest:full-path=\"content.xml\" manifest:media-type=\"text/xml\"/>\
         <manifest:file-entry manifest:full-path=\"styles.xml\" manifest:media-type=\"text/xml\"/>\
         <manifest:file-entry manifest:full-path=\"meta.xml\" manifest:media-type=\"text/xml\"/>\
         <manifest:file-entry manifest:full-path=\"settings.xml\" manifest:media-type=\"text/xml\"/>",
    );
    for (name, _, media) in &image_files {
        manifest.push_str(&format!(
            "<manifest:file-entry manifest:full-path=\"Pictures/{name}\" manifest:media-type=\"{media}\"/>"
        ));
    }
    manifest.push_str("</manifest:manifest>");

    write_zip_entry(&mut zip, deflated, "META-INF/manifest.xml", manifest.as_bytes())?;
    write_zip_entry(&mut zip, deflated, "content.xml", content.as_bytes())?;
    write_zip_entry(&mut zip, deflated, "styles.xml", styles_doc.as_bytes())?;
    write_zip_entry(&mut zip, deflated, "meta.xml", odp_meta_xml("Presentación").as_bytes())?;
    write_zip_entry(&mut zip, deflated, "settings.xml", odp_settings_xml().as_bytes())?;
    for (name, bytes, _) in &image_files {
        zip.start_file(format!("Pictures/{name}"), deflated)?;
        zip.write_all(bytes)?;
    }
    zip.finish()?;
    Ok(())
}

fn prepare_odp_image(
    asset: &ImageAsset,
    crop: Option<(f64, f64, f64, f64)>,
) -> ImageAsset {
    let Some((top, right, bottom, left)) = crop else {
        return asset.clone();
    };
    let Ok(decoded) = image::load_from_memory(&asset.bytes) else {
        return asset.clone();
    };
    let (width, height) = decoded.dimensions();
    let x = ((left.clamp(0.0, 90.0) / 100.0) * width as f64).round() as u32;
    let y = ((top.clamp(0.0, 90.0) / 100.0) * height as f64).round() as u32;
    let crop_width = (((100.0 - left.clamp(0.0, 90.0) - right.clamp(0.0, 90.0)) / 100.0)
        * width as f64)
        .round()
        .max(1.0) as u32;
    let crop_height = (((100.0 - top.clamp(0.0, 90.0) - bottom.clamp(0.0, 90.0)) / 100.0)
        * height as f64)
        .round()
        .max(1.0) as u32;
    let crop_width = crop_width.min(width.saturating_sub(x).max(1));
    let crop_height = crop_height.min(height.saturating_sub(y).max(1));
    let cropped = decoded.crop_imm(x, y, crop_width, crop_height).to_rgba8();
    let mut png = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png);
    if image::ImageEncoder::write_image(
        encoder,
        cropped.as_raw(),
        cropped.width(),
        cropped.height(),
        image::ExtendedColorType::Rgba8,
    )
    .is_err()
    {
        return asset.clone();
    }
    ImageAsset {
        bytes: png,
        ext: "png".to_string(),
    }
}

fn odp_add_image(
    asset: &ImageAsset,
    files: &mut Vec<(String, Vec<u8>, String)>,
    counter: &mut usize,
) -> (String, String) {
    *counter += 1;
    let ext = match asset.ext.as_str() {
        "png" => "png",
        "gif" => "gif",
        "webp" => "webp",
        _ => "jpg",
    };
    let name = format!("img{}.{ext}", *counter);
    let href = format!("Pictures/{name}");
    let media = match ext {
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "image/jpeg",
    };
    files.push((name, asset.bytes.clone(), media.to_string()));
    (href, media.to_string())
}

fn odp_cm(value: f64) -> f64 {
    value * ODP_CM_PER_PX
}

fn odp_image_frame(
    href: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rotation: f64,
) -> String {
    let transform = if rotation.abs() > 0.1 {
        format!(" draw:transform=\"rotate({rotation:.3})\"")
    } else {
        String::new()
    };
    format!(
        "<draw:frame draw:style-name=\"gr1\" svg:x=\"{:.3}cm\" svg:y=\"{:.3}cm\" svg:width=\"{:.3}cm\" svg:height=\"{:.3}cm\"{transform}>\
         <draw:image xlink:href=\"{}\" xlink:type=\"simple\" xlink:show=\"embed\" xlink:actuate=\"onLoad\"/></draw:frame>",
        odp_cm(x),
        odp_cm(y),
        odp_cm(width),
        odp_cm(height),
        xml_escape(href)
    )
}

fn odp_text_style(name: &str, object: &SlideObjectExport) -> String {
    let color = normalize_color(&object.color).unwrap_or_else(|| "F5F8FF".to_string());
    let family = if object.font_family.contains("Inter") || object.font_family.contains("Arial") {
        "Arial"
    } else {
        "Georgia"
    };
    let align = match object.align.as_str() {
        "center" => "center",
        "right" => "right",
        _ => "left",
    };
    format!(
        "<style:style style:name=\"{name}\" style:family=\"paragraph\"><style:paragraph-properties fo:text-align=\"{align}\"/><style:text-properties fo:font-size=\"{:.2}pt\" fo:font-family=\"{family}\" fo:font-weight=\"{}\" fo:font-style=\"{}\" fo:color=\"#{color}\"{}/></style:style>",
        object.font_size * 0.75,
        if object.bold { "bold" } else { "normal" },
        if object.italic { "italic" } else { "normal" },
        if object.underline { " style:text-underline-style=\"solid\"" } else { "" }
    )
}

fn odp_text_frame(
    style: &str,
    text: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    rotation: f64,
) -> String {
    let transform = if rotation.abs() > 0.1 {
        format!(" draw:transform=\"rotate({rotation:.3})\"")
    } else {
        String::new()
    };
    let paragraphs = text
        .split('\n')
        .map(|line| format!("<text:p text:style-name=\"{style}\">{}</text:p>", xml_escape(line)))
        .collect::<String>();
    format!(
        "<draw:frame draw:style-name=\"gr1\" svg:x=\"{:.3}cm\" svg:y=\"{:.3}cm\" svg:width=\"{:.3}cm\" svg:height=\"{:.3}cm\"{transform}>\
         <draw:text-box>{paragraphs}</draw:text-box></draw:frame>",
        odp_cm(x),
        odp_cm(y),
        odp_cm(width),
        odp_cm(height)
    )
}


fn odp_meta_xml(title: &str) -> String {
    format!(
        "{XML_HEADER}<office:document-meta xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" xmlns:meta=\"urn:oasis:names:tc:opendocument:xmlns:meta:1.0\" xmlns:dc=\"http://purl.org/dc/elements/1.1/\" office:version=\"1.2\">\
         <office:meta><dc:title>{}</dc:title><meta:generator>Teoamoxtli</meta:generator></office:meta></office:document-meta>",
        xml_escape(title)
    )
}

fn odp_settings_xml() -> String {
    format!(
        "{XML_HEADER}<office:document-settings xmlns:office=\"urn:oasis:names:tc:opendocument:xmlns:office:1.0\" office:version=\"1.2\"><office:settings/></office:document-settings>"
    )
}
