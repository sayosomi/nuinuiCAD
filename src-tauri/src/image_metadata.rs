use serde::Serialize;
use std::fs;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageMetadata {
    width_px: u32,
    height_px: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    dpi: Option<f64>,
}

#[tauri::command]
pub fn read_image_metadata(path: String) -> Result<ImageMetadata, String> {
    let bytes = fs::read(&path).map_err(|error| format!("画像を読み込めません: {error}"))?;
    parse_image_metadata(&bytes).ok_or_else(|| "画像メタデータを読み取れません。".to_string())
}

fn parse_image_metadata(bytes: &[u8]) -> Option<ImageMetadata> {
    parse_png_metadata(bytes)
        .or_else(|| parse_jpeg_metadata(bytes))
        .or_else(|| parse_webp_metadata(bytes))
}

fn be_u16(bytes: &[u8]) -> Option<u16> {
    Some(u16::from_be_bytes(bytes.get(0..2)?.try_into().ok()?))
}

fn be_u32(bytes: &[u8]) -> Option<u32> {
    Some(u32::from_be_bytes(bytes.get(0..4)?.try_into().ok()?))
}

fn le_u16(bytes: &[u8]) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(0..2)?.try_into().ok()?))
}

fn le_u24(bytes: &[u8]) -> Option<u32> {
    let bytes = bytes.get(0..3)?;
    Some(bytes[0] as u32 | ((bytes[1] as u32) << 8) | ((bytes[2] as u32) << 16))
}

fn le_u32(bytes: &[u8]) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(0..4)?.try_into().ok()?))
}

fn parse_png_metadata(bytes: &[u8]) -> Option<ImageMetadata> {
    if bytes.get(0..8)? != b"\x89PNG\r\n\x1a\n" {
        return None;
    }

    let mut offset = 8;
    let mut width_px = None;
    let mut height_px = None;
    let mut dpi = None;

    while offset + 12 <= bytes.len() {
        let length = be_u32(bytes.get(offset..offset + 4)?)? as usize;
        let chunk_type = bytes.get(offset + 4..offset + 8)?;
        let data_start = offset + 8;
        let data_end = data_start.checked_add(length)?;
        if data_end + 4 > bytes.len() {
            return None;
        }
        let data = &bytes[data_start..data_end];

        if chunk_type == b"IHDR" {
            width_px = be_u32(data.get(0..4)?);
            height_px = be_u32(data.get(4..8)?);
        } else if chunk_type == b"pHYs" && data.len() >= 9 && data[8] == 1 {
            let pixels_per_meter_x = be_u32(data.get(0..4)?)? as f64;
            let pixels_per_meter_y = be_u32(data.get(4..8)?)? as f64;
            dpi = Some(((pixels_per_meter_x + pixels_per_meter_y) / 2.0) * 0.0254);
        } else if chunk_type == b"IEND" {
            break;
        }

        offset = data_end + 4;
    }

    Some(ImageMetadata {
        width_px: width_px?,
        height_px: height_px?,
        dpi,
    })
}

fn parse_jpeg_metadata(bytes: &[u8]) -> Option<ImageMetadata> {
    if bytes.get(0..2)? != b"\xff\xd8" {
        return None;
    }

    let mut offset = 2;
    let mut dpi = None;

    while offset + 4 <= bytes.len() {
        while bytes.get(offset) == Some(&0xff) {
            offset += 1;
        }
        let marker = *bytes.get(offset)?;
        offset += 1;
        if marker == 0xd9 || marker == 0xda {
            break;
        }
        let segment_length = be_u16(bytes.get(offset..offset + 2)?)? as usize;
        if segment_length < 2 || offset + segment_length > bytes.len() {
            return None;
        }
        let data = &bytes[offset + 2..offset + segment_length];

        if marker == 0xe0 && data.len() >= 14 && data.get(0..5) == Some(b"JFIF\0") {
            let units = data[7];
            let x_density = be_u16(data.get(8..10)?)? as f64;
            let y_density = be_u16(data.get(10..12)?)? as f64;
            let density = (x_density + y_density) / 2.0;
            dpi = match units {
                1 => Some(density),
                2 => Some(density * 2.54),
                _ => dpi,
            };
        }

        if matches!(marker, 0xc0..=0xc3 | 0xc5..=0xc7 | 0xc9..=0xcb | 0xcd..=0xcf) {
            if data.len() < 7 {
                return None;
            }
            return Some(ImageMetadata {
                height_px: be_u16(data.get(1..3)?)? as u32,
                width_px: be_u16(data.get(3..5)?)? as u32,
                dpi,
            });
        }

        offset += segment_length;
    }

    None
}

fn parse_webp_metadata(bytes: &[u8]) -> Option<ImageMetadata> {
    if bytes.get(0..4)? != b"RIFF" || bytes.get(8..12)? != b"WEBP" {
        return None;
    }
    let chunk = bytes.get(12..16)?;
    let data = bytes.get(20..)?;
    if chunk == b"VP8X" {
        return Some(ImageMetadata {
            width_px: le_u24(data.get(4..7)?)? + 1,
            height_px: le_u24(data.get(7..10)?)? + 1,
            dpi: None,
        });
    }
    if chunk == b"VP8L" {
        let bits = le_u32(data.get(1..5)?)?;
        return Some(ImageMetadata {
            width_px: (bits & 0x3fff) + 1,
            height_px: ((bits >> 14) & 0x3fff) + 1,
            dpi: None,
        });
    }
    if chunk == b"VP8 " {
        return Some(ImageMetadata {
            width_px: (le_u16(data.get(6..8)?)? & 0x3fff) as u32,
            height_px: (le_u16(data.get(8..10)?)? & 0x3fff) as u32,
            dpi: None,
        });
    }
    None
}
