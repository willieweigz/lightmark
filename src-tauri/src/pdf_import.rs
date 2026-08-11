use anydoc::{
    model::{Asset, AssetId},
    ConvertError,
};
use lopdf::{content::Content, Dictionary, Document, Object, ObjectId, Stream};
use pdf_inspector::{MarkdownOptions, PdfError, PdfOptions};
use std::collections::{HashMap, HashSet};

const MAX_PDF_IMAGE_OBJECTS: usize = 500;
const MAX_PDF_IMAGE_PIXELS: usize = 50_000_000;
const MAX_PDF_ASSET_BYTES: usize = 50 * 1024 * 1024;
const MAX_FORM_DEPTH: usize = 5;
const ASSET_TOKEN_PREFIX: &str = "lightmark-pdf-asset-";

pub(crate) struct PdfExtraction {
    pub(crate) markdown: String,
    pub(crate) assets: Vec<Asset>,
    pub(crate) skipped_asset_count: usize,
}

#[derive(Clone, Copy)]
struct ImageInvocation {
    page: u32,
    asset_id: Option<AssetId>,
}

#[derive(Clone)]
enum PixelLayout {
    Gray,
    Rgb,
    Cmyk,
    Indexed { palette: Vec<u8>, channels: usize },
}

pub(crate) fn asset_token(id: AssetId) -> String {
    format!("{ASSET_TOKEN_PREFIX}{}", id.0)
}

pub(crate) fn extract(bytes: &[u8]) -> Result<PdfExtraction, ConvertError> {
    let mut options = MarkdownOptions::default();
    options.include_images = true;
    let result =
        pdf_inspector::process_pdf_mem_with_options(bytes, PdfOptions::new().markdown(options))
            .map_err(map_pdf_error)?;

    let mut markdown = match result.markdown {
        Some(markdown) if !markdown.trim().is_empty() => markdown,
        _ => {
            return Err(ConvertError::Unsupported(format!(
                "PDF 没有可提取的文字（{:?}，{} 页），需要 OCR",
                result.pdf_type, result.page_count
            )))
        }
    };
    if !markdown.ends_with('\n') {
        markdown.push('\n');
    }

    let document = Document::load_mem(bytes).map_err(|error| ConvertError::Malformed {
        part: Some("PDF".into()),
        detail: error.to_string(),
    })?;
    let (assets, invocations, mut skipped_asset_count) = collect_images(&document);

    for invocation in invocations {
        let Some((name, placeholder_start)) = next_image_placeholder(&markdown) else {
            break;
        };
        let placeholder = format!("![Image: {name}](image)");
        let replacement = if let Some(asset_id) = invocation.asset_id {
            format!(
                "![PDF 第 {} 页图片]({})",
                invocation.page,
                asset_token(asset_id)
            )
        } else {
            format!(
                "<!-- PDF 第 {} 页有一张暂不支持提取的图片 -->",
                invocation.page
            )
        };
        markdown.replace_range(
            placeholder_start..placeholder_start + placeholder.len(),
            &replacement,
        );
    }

    while let Some((name, start)) = next_image_placeholder(&markdown) {
        let placeholder = format!("![Image: {name}](image)");
        markdown.replace_range(
            start..start + placeholder.len(),
            "<!-- PDF 中有一张暂不支持提取的图片 -->",
        );
        skipped_asset_count += 1;
    }

    Ok(PdfExtraction {
        markdown,
        assets,
        skipped_asset_count,
    })
}

fn next_image_placeholder(markdown: &str) -> Option<(String, usize)> {
    let prefix = "![Image: ";
    let suffix = "](image)";
    let start = markdown.find(prefix)?;
    let name_start = start + prefix.len();
    let name_end = markdown[name_start..].find(suffix)? + name_start;
    Some((markdown[name_start..name_end].to_owned(), start))
}

fn map_pdf_error(error: PdfError) -> ConvertError {
    match error {
        PdfError::Encrypted => ConvertError::Encrypted,
        PdfError::Io(error) => ConvertError::Io(error),
        PdfError::NotAPdf(detail) => ConvertError::Malformed {
            part: Some("PDF".into()),
            detail: format!("不是有效的 PDF：{detail}"),
        },
        PdfError::InvalidStructure => ConvertError::Malformed {
            part: Some("PDF".into()),
            detail: "PDF 结构无效".into(),
        },
        PdfError::Parse(detail) => ConvertError::Malformed {
            part: Some("PDF".into()),
            detail,
        },
    }
}

fn collect_images(document: &Document) -> (Vec<Asset>, Vec<ImageInvocation>, usize) {
    let mut assets = Vec::new();
    let mut invocations = Vec::new();
    let mut object_assets: HashMap<ObjectId, Option<AssetId>> = HashMap::new();
    let mut skipped_objects = HashSet::new();

    for (page, page_id) in document.get_pages() {
        let resources = page_resources(document, page_id);
        let Ok(content) = document.get_page_content(page_id) else {
            continue;
        };
        let mut form_stack = HashSet::new();
        collect_content_images(
            document,
            &content,
            &resources,
            page,
            0,
            &mut form_stack,
            &mut object_assets,
            &mut skipped_objects,
            &mut assets,
            &mut invocations,
        );
    }

    (assets, invocations, skipped_objects.len())
}

fn page_resources(document: &Document, page_id: ObjectId) -> Vec<&Dictionary> {
    let mut resources = Vec::new();
    if let Ok((inline, ids)) = document.get_page_resources(page_id) {
        if let Some(inline) = inline {
            resources.push(inline);
        }
        for id in ids {
            if let Ok(dictionary) = document.get_dictionary(id) {
                if !resources
                    .iter()
                    .any(|existing| std::ptr::eq(*existing, dictionary))
                {
                    resources.push(dictionary);
                }
            }
        }
    }
    resources
}

#[allow(clippy::too_many_arguments)]
fn collect_content_images<'a>(
    document: &'a Document,
    content_bytes: &[u8],
    resources: &[&'a Dictionary],
    page: u32,
    depth: usize,
    form_stack: &mut HashSet<ObjectId>,
    object_assets: &mut HashMap<ObjectId, Option<AssetId>>,
    skipped_objects: &mut HashSet<ObjectId>,
    assets: &mut Vec<Asset>,
    invocations: &mut Vec<ImageInvocation>,
) {
    if depth > MAX_FORM_DEPTH || invocations.len() >= MAX_PDF_IMAGE_OBJECTS {
        return;
    }
    let Ok(content) = Content::decode(content_bytes) else {
        return;
    };

    for operation in content.operations {
        if operation.operator != "Do" || operation.operands.is_empty() {
            continue;
        }
        let Ok(name) = operation.operands[0].as_name() else {
            continue;
        };
        let Some(object_id) = find_xobject(document, resources, name) else {
            continue;
        };
        let Ok(Object::Stream(stream)) = document.get_object(object_id) else {
            continue;
        };
        let subtype = stream.dict.get(b"Subtype").and_then(Object::as_name).ok();

        match subtype {
            Some(b"Image") => {
                let asset_id = if let Some(cached) = object_assets.get(&object_id) {
                    *cached
                } else if assets.len() >= MAX_PDF_IMAGE_OBJECTS {
                    skipped_objects.insert(object_id);
                    object_assets.insert(object_id, None);
                    None
                } else {
                    let extracted = image_asset(document, object_id, stream, assets.len());
                    let id = extracted.as_ref().map(|asset| asset.id);
                    if let Some(asset) = extracted {
                        assets.push(asset);
                    } else {
                        skipped_objects.insert(object_id);
                    }
                    object_assets.insert(object_id, id);
                    id
                };
                invocations.push(ImageInvocation { page, asset_id });
                if invocations.len() >= MAX_PDF_IMAGE_OBJECTS {
                    return;
                }
            }
            Some(b"Form") if depth < MAX_FORM_DEPTH && form_stack.insert(object_id) => {
                let form_content = stream
                    .decompressed_content()
                    .unwrap_or_else(|_| stream.content.clone());
                let form_resources = dictionary_resources(document, &stream.dict)
                    .map(|resource| vec![resource])
                    .unwrap_or_else(|| resources.to_vec());
                collect_content_images(
                    document,
                    &form_content,
                    &form_resources,
                    page,
                    depth + 1,
                    form_stack,
                    object_assets,
                    skipped_objects,
                    assets,
                    invocations,
                );
                form_stack.remove(&object_id);
            }
            _ => {}
        }
    }
}

fn dictionary_resources<'a>(
    document: &'a Document,
    dictionary: &'a Dictionary,
) -> Option<&'a Dictionary> {
    match dictionary.get(b"Resources").ok()? {
        Object::Reference(id) => document.get_dictionary(*id).ok(),
        Object::Dictionary(resources) => Some(resources),
        _ => None,
    }
}

fn find_xobject(document: &Document, resources: &[&Dictionary], name: &[u8]) -> Option<ObjectId> {
    for resources in resources {
        let Ok(xobject_object) = resources.get(b"XObject") else {
            continue;
        };
        let xobjects = match xobject_object {
            Object::Reference(id) => document.get_dictionary(*id).ok(),
            Object::Dictionary(dictionary) => Some(dictionary),
            _ => None,
        };
        let Some(xobjects) = xobjects else {
            continue;
        };
        if let Ok(Object::Reference(id)) = xobjects.get(name) {
            return Some(*id);
        }
    }
    None
}

fn image_asset(
    document: &Document,
    object_id: ObjectId,
    stream: &Stream,
    asset_index: usize,
) -> Option<Asset> {
    let width = positive_usize(stream.dict.get(b"Width").ok()?.as_i64().ok()?)?;
    let height = positive_usize(stream.dict.get(b"Height").ok()?.as_i64().ok()?)?;
    if width.checked_mul(height)? > MAX_PDF_IMAGE_PIXELS {
        return None;
    }
    let filters = filter_names(&stream.dict);
    let origin_part = format!("pdf/object-{}-{}", object_id.0, object_id.1);

    if filters.len() == 1 && filters[0] == "DCTDecode" {
        if stream.content.len() > MAX_PDF_ASSET_BYTES {
            return None;
        }
        return Some(Asset {
            id: AssetId(asset_index),
            media_type: "image/jpeg".into(),
            origin_part,
            bytes: stream.content.clone(),
        });
    }
    if filters.iter().any(|filter| {
        matches!(
            filter.as_str(),
            "DCTDecode" | "JPXDecode" | "CCITTFaxDecode" | "JBIG2Decode"
        )
    }) {
        return None;
    }
    if stream
        .dict
        .get(b"ImageMask")
        .and_then(Object::as_bool)
        .unwrap_or(false)
    {
        return None;
    }

    let bits = stream
        .dict
        .get(b"BitsPerComponent")
        .and_then(Object::as_i64)
        .unwrap_or(8);
    if !matches!(bits, 1 | 2 | 4 | 8) {
        return None;
    }
    let layout = pixel_layout(document, stream.dict.get(b"ColorSpace").ok()?)?;
    let source_channels = match &layout {
        PixelLayout::Gray => 1,
        PixelLayout::Rgb => 3,
        PixelLayout::Cmyk => 4,
        PixelLayout::Indexed { .. } => 1,
    };
    let decoded = stream.decompressed_content().ok()?;
    let samples = unpack_samples(&decoded, width, height, source_channels, bits as usize)?;
    let (pixels, color_type) = normalize_pixels(samples, layout, width, height)?;
    let png = encode_png(&pixels, width, height, color_type).ok()?;
    if png.len() > MAX_PDF_ASSET_BYTES {
        return None;
    }
    Some(Asset {
        id: AssetId(asset_index),
        media_type: "image/png".into(),
        origin_part,
        bytes: png,
    })
}

fn positive_usize(value: i64) -> Option<usize> {
    (value > 0).then(|| usize::try_from(value).ok()).flatten()
}

fn filter_names(dictionary: &Dictionary) -> Vec<String> {
    match dictionary.get(b"Filter") {
        Ok(Object::Name(name)) => vec![String::from_utf8_lossy(name).into_owned()],
        Ok(Object::Array(filters)) => filters
            .iter()
            .filter_map(|filter| filter.as_name().ok())
            .map(|name| String::from_utf8_lossy(name).into_owned())
            .collect(),
        _ => Vec::new(),
    }
}

fn pixel_layout(document: &Document, object: &Object) -> Option<PixelLayout> {
    let object = match object {
        Object::Reference(id) => document.get_object(*id).ok()?,
        object => object,
    };
    match object {
        Object::Name(name) => named_pixel_layout(name),
        Object::Array(parts) if !parts.is_empty() => {
            let family = parts[0].as_name().ok()?;
            match family {
                b"Indexed" | b"I" if parts.len() >= 4 => {
                    let base = pixel_layout(document, &parts[1])?;
                    let channels = match base {
                        PixelLayout::Gray => 1,
                        PixelLayout::Rgb => 3,
                        PixelLayout::Cmyk => 4,
                        PixelLayout::Indexed { .. } => return None,
                    };
                    let palette = object_bytes(document, &parts[3])?;
                    Some(PixelLayout::Indexed { palette, channels })
                }
                b"ICCBased" if parts.len() >= 2 => {
                    let profile = match &parts[1] {
                        Object::Reference(id) => document.get_object(*id).ok()?.as_stream().ok()?,
                        Object::Stream(stream) => stream,
                        _ => return None,
                    };
                    match profile.dict.get(b"N").and_then(Object::as_i64).ok()? {
                        1 => Some(PixelLayout::Gray),
                        3 => Some(PixelLayout::Rgb),
                        4 => Some(PixelLayout::Cmyk),
                        _ => None,
                    }
                }
                b"CalGray" => Some(PixelLayout::Gray),
                b"CalRGB" | b"Lab" => Some(PixelLayout::Rgb),
                _ => named_pixel_layout(family),
            }
        }
        _ => None,
    }
}

fn named_pixel_layout(name: &[u8]) -> Option<PixelLayout> {
    match name {
        b"DeviceGray" | b"G" => Some(PixelLayout::Gray),
        b"DeviceRGB" | b"RGB" => Some(PixelLayout::Rgb),
        b"DeviceCMYK" | b"CMYK" => Some(PixelLayout::Cmyk),
        _ => None,
    }
}

fn object_bytes(document: &Document, object: &Object) -> Option<Vec<u8>> {
    let object = match object {
        Object::Reference(id) => document.get_object(*id).ok()?,
        object => object,
    };
    match object {
        Object::String(bytes, _) => Some(bytes.clone()),
        Object::Stream(stream) => stream
            .decompressed_content()
            .ok()
            .or_else(|| Some(stream.content.clone())),
        _ => None,
    }
}

fn unpack_samples(
    data: &[u8],
    width: usize,
    height: usize,
    channels: usize,
    bits: usize,
) -> Option<Vec<u8>> {
    let samples_per_row = width.checked_mul(channels)?;
    let bits_per_row = samples_per_row.checked_mul(bits)?;
    let bytes_per_row = bits_per_row.checked_add(7)? / 8;
    let required = bytes_per_row.checked_mul(height)?;
    if data.len() < required {
        return None;
    }
    if bits == 8 && bytes_per_row == samples_per_row {
        return Some(data[..required].to_vec());
    }

    let mut output = Vec::with_capacity(samples_per_row.checked_mul(height)?);
    let max_value = (1usize << bits) - 1;
    for row in 0..height {
        let row_data = &data[row * bytes_per_row..(row + 1) * bytes_per_row];
        for sample in 0..samples_per_row {
            let bit_offset = sample * bits;
            let byte_index = bit_offset / 8;
            let shift = 8 - bits - (bit_offset % 8);
            let value = ((row_data[byte_index] as usize >> shift) & max_value) * 255 / max_value;
            output.push(value as u8);
        }
    }
    Some(output)
}

fn normalize_pixels(
    samples: Vec<u8>,
    layout: PixelLayout,
    width: usize,
    height: usize,
) -> Option<(Vec<u8>, png::ColorType)> {
    let pixel_count = width.checked_mul(height)?;
    match layout {
        PixelLayout::Gray => (samples.len() >= pixel_count)
            .then(|| (samples[..pixel_count].to_vec(), png::ColorType::Grayscale)),
        PixelLayout::Rgb => {
            let len = pixel_count.checked_mul(3)?;
            (samples.len() >= len).then(|| (samples[..len].to_vec(), png::ColorType::Rgb))
        }
        PixelLayout::Cmyk => {
            let len = pixel_count.checked_mul(4)?;
            if samples.len() < len {
                return None;
            }
            let mut rgb = Vec::with_capacity(pixel_count.checked_mul(3)?);
            for pixel in samples[..len].chunks_exact(4) {
                let c = pixel[0] as u16;
                let m = pixel[1] as u16;
                let y = pixel[2] as u16;
                let k = pixel[3] as u16;
                rgb.push(255u16.saturating_sub((c + k).min(255)) as u8);
                rgb.push(255u16.saturating_sub((m + k).min(255)) as u8);
                rgb.push(255u16.saturating_sub((y + k).min(255)) as u8);
            }
            Some((rgb, png::ColorType::Rgb))
        }
        PixelLayout::Indexed { palette, channels } => {
            if samples.len() < pixel_count || !matches!(channels, 1 | 3 | 4) {
                return None;
            }
            let output_channels = if channels == 1 { 1 } else { 3 };
            let mut output = Vec::with_capacity(pixel_count.checked_mul(output_channels)?);
            for index in samples[..pixel_count].iter().copied() {
                let offset = (index as usize).checked_mul(channels)?;
                if offset + channels > palette.len() {
                    return None;
                }
                match channels {
                    1 => output.push(palette[offset]),
                    3 => output.extend_from_slice(&palette[offset..offset + 3]),
                    4 => {
                        let c = palette[offset] as u16;
                        let m = palette[offset + 1] as u16;
                        let y = palette[offset + 2] as u16;
                        let k = palette[offset + 3] as u16;
                        output.push(255u16.saturating_sub((c + k).min(255)) as u8);
                        output.push(255u16.saturating_sub((m + k).min(255)) as u8);
                        output.push(255u16.saturating_sub((y + k).min(255)) as u8);
                    }
                    _ => return None,
                }
            }
            Some((
                output,
                if output_channels == 1 {
                    png::ColorType::Grayscale
                } else {
                    png::ColorType::Rgb
                },
            ))
        }
    }
}

fn encode_png(
    pixels: &[u8],
    width: usize,
    height: usize,
    color_type: png::ColorType,
) -> Result<Vec<u8>, png::EncodingError> {
    let mut output = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut output, width as u32, height as u32);
        encoder.set_color(color_type);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(pixels)?;
    }
    Ok(output)
}

#[cfg(test)]
pub(crate) fn test_pdf_with_image() -> Vec<u8> {
    use lopdf::{dictionary, Object, Stream};

    let mut document = Document::with_version("1.5");
    let pages_id = document.new_object_id();
    let font_id = document.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });
    let mut image = Stream::new(
        dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => 2,
            "Height" => 2,
            "ColorSpace" => "DeviceRGB",
            "BitsPerComponent" => 8,
        },
        vec![255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0],
    );
    image.compress().expect("compress fixture image");
    let image_id = document.add_object(image);
    let resources_id = document.add_object(dictionary! {
        "Font" => dictionary! { "F1" => font_id },
        "XObject" => dictionary! { "Im0" => image_id },
    });
    let content = Content {
        operations: vec![
            lopdf::content::Operation::new("BT", vec![]),
            lopdf::content::Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 12.into()]),
            lopdf::content::Operation::new("TL", vec![16.into()]),
            lopdf::content::Operation::new("Td", vec![72.into(), 700.into()]),
            lopdf::content::Operation::new("Tj", vec![Object::string_literal("Before image")]),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new(
                "Tj",
                vec![Object::string_literal("A readable text PDF")],
            ),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new("Tj", vec![Object::string_literal("keeps paragraphs")]),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new(
                "Tj",
                vec![Object::string_literal("around a small figure")],
            ),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new("Tj", vec![Object::string_literal("with enough text")]),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new(
                "Tj",
                vec![Object::string_literal("for normal extraction")],
            ),
            lopdf::content::Operation::new("ET", vec![]),
            lopdf::content::Operation::new("q", vec![]),
            lopdf::content::Operation::new(
                "cm",
                vec![
                    40.into(),
                    0.into(),
                    0.into(),
                    40.into(),
                    72.into(),
                    560.into(),
                ],
            ),
            lopdf::content::Operation::new("Do", vec![Object::Name(b"Im0".to_vec())]),
            lopdf::content::Operation::new("Q", vec![]),
            lopdf::content::Operation::new("BT", vec![]),
            lopdf::content::Operation::new("Tf", vec![Object::Name(b"F1".to_vec()), 12.into()]),
            lopdf::content::Operation::new("TL", vec![16.into()]),
            lopdf::content::Operation::new("Td", vec![72.into(), 530.into()]),
            lopdf::content::Operation::new("Tj", vec![Object::string_literal("After image")]),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new(
                "Tj",
                vec![Object::string_literal("The following text")],
            ),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new(
                "Tj",
                vec![Object::string_literal("continues below it")],
            ),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new(
                "Tj",
                vec![Object::string_literal("and remains editable")],
            ),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new("Tj", vec![Object::string_literal("after import")]),
            lopdf::content::Operation::new("T*", vec![]),
            lopdf::content::Operation::new("Tj", vec![Object::string_literal("inside LightMark")]),
            lopdf::content::Operation::new("ET", vec![]),
        ],
    };
    let content_id = document.add_object(Stream::new(
        dictionary! {},
        content.encode().expect("encode fixture content"),
    ));
    let page_id = document.add_object(dictionary! {
        "Type" => "Page",
        "Parent" => pages_id,
        "Resources" => resources_id,
        "MediaBox" => vec![0.into(), 0.into(), 612.into(), 792.into()],
        "Contents" => content_id,
    });
    document.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => vec![page_id.into()],
            "Count" => 1,
        }),
    );
    let catalog_id = document.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    document.trailer.set("Root", catalog_id);
    let mut bytes = Vec::new();
    document.save_to(&mut bytes).expect("save fixture PDF");
    bytes
}

#[cfg(test)]
mod tests {
    use super::{asset_token, extract, test_pdf_with_image};
    use anydoc::model::AssetId;

    #[test]
    fn extracts_and_positions_a_flate_pdf_image() {
        let extraction = extract(&test_pdf_with_image()).expect("extract PDF fixture");
        assert_eq!(extraction.assets.len(), 1);
        assert_eq!(extraction.assets[0].media_type, "image/png");
        assert!(extraction.assets[0].bytes.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert_eq!(extraction.skipped_asset_count, 0);
        let before = extraction
            .markdown
            .find("Before image")
            .expect("before text");
        let image = extraction
            .markdown
            .find(&asset_token(AssetId(0)))
            .expect("image token");
        let after = extraction.markdown.find("After image").expect("after text");
        assert!(
            before < image && image < after,
            "image should stay between surrounding text"
        );
    }
}
