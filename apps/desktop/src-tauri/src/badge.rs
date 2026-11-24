//! The unread count on the taskbar button (Windows) as an overlay icon: a red circle with the number in white, "9+"
//! past nine, drawn in plain code at 32 px (port of Electron's badge.ts). Linux docks get the count itself.
use std::io::Write;

const SIZE: usize = 32;
const RED: [u8; 3] = [0xd9, 0x30, 0x25];

/// 5 by 7 dots for each glyph the badge uses.
const GLYPHS: &[(char, [&str; 7])] = &[
    ('0', ["01110", "10001", "10011", "10101", "11001", "10001", "01110"]),
    ('1', ["00100", "01100", "00100", "00100", "00100", "00100", "01110"]),
    ('2', ["01110", "10001", "00001", "00010", "00100", "01000", "11111"]),
    ('3', ["11110", "00001", "00001", "01110", "00001", "00001", "11110"]),
    ('4', ["00010", "00110", "01010", "10010", "11111", "00010", "00010"]),
    ('5', ["11111", "10000", "11110", "00001", "00001", "10001", "01110"]),
    ('6', ["00110", "01000", "10000", "11110", "10001", "10001", "01110"]),
    ('7', ["11111", "00001", "00010", "00100", "01000", "01000", "01000"]),
    ('8', ["01110", "10001", "10001", "01110", "10001", "10001", "01110"]),
    ('9', ["01110", "10001", "10001", "01111", "00001", "00010", "01100"]),
    ('+', ["00000", "00100", "00100", "11111", "00100", "00100", "00000"]),
];

/// What the badge says for a count: "" for none, the number up to 9, then "9+".
pub fn badge_text(count: u64) -> String {
    match count {
        0 => String::new(),
        1..=9 => count.to_string(),
        _ => "9+".into(),
    }
}

/// What Windows reads for the overlay ("3 unread").
pub fn badge_description(count: u64) -> String {
    match badge_text(count).as_str() {
        "" => String::new(),
        "9+" => "More than 9 unread".into(),
        t => format!("{t} unread"),
    }
}

/// The badge's RGBA pixels for `text`.
pub fn badge_pixels(text: &str) -> Vec<u8> {
    let mut px = vec![0u8; SIZE * SIZE * 4];
    let r = SIZE as f64 / 2.0;
    for y in 0..SIZE {
        for x in 0..SIZE {
            let mut inside = 0;
            for sy in 0..4 {
                for sx in 0..4 {
                    let dx = x as f64 + (sx as f64 + 0.5) / 4.0 - r;
                    let dy = y as f64 + (sy as f64 + 0.5) / 4.0 - r;
                    if dx * dx + dy * dy <= r * r {
                        inside += 1;
                    }
                }
            }
            let i = (y * SIZE + x) * 4;
            px[i..i + 3].copy_from_slice(&RED);
            px[i + 3] = ((inside as f64 / 16.0) * 255.0).round() as u8;
        }
    }
    let glyphs: Vec<&[&str; 7]> = text.chars().filter_map(|c| GLYPHS.iter().find(|(g, _)| *g == c).map(|(_, rows)| rows)).collect();
    if glyphs.is_empty() {
        return px;
    }
    let scale = if glyphs.len() == 1 { 3 } else { 2 };
    let gap = scale;
    let width = glyphs.len() * 5 * scale + (glyphs.len() - 1) * gap;
    let left = (SIZE - width) / 2;
    let top = (SIZE - 7 * scale) / 2;
    for (n, rows) in glyphs.iter().enumerate() {
        let gx = left + n * (5 * scale + gap);
        for (ry, row) in rows.iter().enumerate() {
            for (rx, bit) in row.chars().enumerate() {
                if bit != '1' {
                    continue;
                }
                for sy in 0..scale {
                    for sx in 0..scale {
                        let (x, y) = (gx + rx * scale + sx, top + ry * scale + sy);
                        if x < SIZE && y < SIZE {
                            let i = (y * SIZE + x) * 4;
                            px[i..i + 4].copy_from_slice(&[255, 255, 255, 255]);
                        }
                    }
                }
            }
        }
    }
    px
}

/// The overlay as RGBA (width, height, pixels), or None for no count.
pub fn badge_rgba(count: u64) -> Option<(u32, u32, Vec<u8>)> {
    let text = badge_text(count);
    (!text.is_empty()).then(|| (SIZE as u32, SIZE as u32, badge_pixels(&text)))
}

/// A PNG of RGBA pixels (kept for tests and for anything that wants a file).
pub fn encode_png(rgba: &[u8], size: usize) -> Vec<u8> {
    fn crc32(bytes: &[u8]) -> u32 {
        let mut c = 0xffff_ffffu32;
        for &b in bytes {
            c ^= b as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xedb8_8320 ^ (c >> 1) } else { c >> 1 };
            }
        }
        c ^ 0xffff_ffff
    }
    fn adler(data: &[u8]) -> u32 {
        let (mut a, mut b) = (1u32, 0u32);
        for &d in data {
            a = (a + d as u32) % 65521;
            b = (b + a) % 65521;
        }
        (b << 16) | a
    }
    let mut raw = Vec::with_capacity((size * 4 + 1) * size);
    for y in 0..size {
        raw.push(0);
        raw.extend_from_slice(&rgba[y * size * 4..(y + 1) * size * 4]);
    }
    // zlib with stored (uncompressed) blocks: small images, no compression crate needed.
    let mut z = vec![0x78, 0x01];
    for (i, block) in raw.chunks(65535).enumerate() {
        let last = (i + 1) * 65535 >= raw.len();
        z.push(last as u8);
        z.extend_from_slice(&(block.len() as u16).to_le_bytes());
        z.extend_from_slice(&(!(block.len() as u16)).to_le_bytes());
        z.extend_from_slice(block);
    }
    z.extend_from_slice(&adler(&raw).to_be_bytes());
    let mut out = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
    let mut chunk = |kind: &[u8], data: &[u8]| {
        out.write_all(&(data.len() as u32).to_be_bytes()).unwrap();
        let mut body = kind.to_vec();
        body.extend_from_slice(data);
        out.write_all(&body).unwrap();
        out.write_all(&crc32(&body).to_be_bytes()).unwrap();
    };
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(size as u32).to_be_bytes());
    ihdr.extend_from_slice(&(size as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(b"IHDR", &ihdr);
    chunk(b"IDAT", &z);
    chunk(b"IEND", &[]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn counts() {
        assert_eq!(badge_text(0), "");
        assert_eq!(badge_text(4), "4");
        assert_eq!(badge_text(12), "9+");
        assert_eq!(badge_description(3), "3 unread");
        assert_eq!(badge_description(40), "More than 9 unread");
        assert!(badge_rgba(0).is_none());
    }

    #[test]
    fn pixels() {
        let px = badge_pixels("5");
        let at = |x: usize, y: usize| px[(y * SIZE + x) * 4..(y * SIZE + x) * 4 + 4].to_vec();
        assert_eq!(at(0, 0)[3], 0);
        assert_eq!(at(16, 3), vec![0xd9, 0x30, 0x25, 255]);
        assert!(px.chunks(4).any(|p| p == [255, 255, 255, 255]));
        let png = encode_png(&px, SIZE);
        assert_eq!(&png[..8], &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    }
}
