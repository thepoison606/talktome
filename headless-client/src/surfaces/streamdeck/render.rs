//! Renders key appearances and LCD strips to RGB images.
//!
//! Keys follow the web client's look: rounded slate cards on the navy page
//! background, outlined function keys, and state colours drawn as a tint
//! with a frame of the full colour (`.talking-to`, `.speaking`).

use std::path::Path;

use ab_glyph::{point, Font, FontVec, PxScale, ScaleFont};
use image::{Rgb as ImgRgb, RgbImage};

use super::layout::{palette, Appearance, Badge, Rgb};

pub struct Renderer {
    font: Option<FontVec>,
}

impl Renderer {
    pub fn load(font_path: &Path) -> Self {
        let font = match std::fs::read(font_path) {
            Ok(bytes) => match FontVec::try_from_vec(bytes) {
                Ok(font) => Some(font),
                Err(error) => {
                    tracing::warn!(event = "streamdeck-font-invalid", path = %font_path.display(), error = %error);
                    None
                }
            },
            Err(error) => {
                tracing::warn!(event = "streamdeck-font-missing", path = %font_path.display(), error = %error, "keys will be rendered without text");
                None
            }
        };
        Self { font }
    }

    #[cfg(test)]
    pub fn has_font(&self) -> bool {
        self.font.is_some()
    }

    /// Renders one key of `size` pixels; `blink_phase` selects the blink colour.
    pub fn key(&self, appearance: &Appearance, size: (u32, u32), blink_phase: bool) -> RgbImage {
        let (w, h) = size;
        let background = match (appearance.blink, blink_phase) {
            (Some(alt), true) => alt,
            _ => appearance.background,
        };
        let style = style(background);
        let margin = (w as f32 * 0.07) as u32;
        let mut image = RgbImage::from_pixel(w, h, to_pixel(palette::GROUND));
        draw_card(&mut image, 0, 0, w, h, &style);

        // Status row along the bottom, below the text so nothing overlaps:
        // type dot on the left, badge on the right, and between them the
        // volume bar or, when muted, the MUTED pill.
        let muted = appearance.badge == Some(Badge::Muted);
        let badge = appearance.badge.filter(|badge| *badge != Badge::Muted);
        let mut text_bottom = h - margin;
        let footer = appearance.footer.trim();
        let has_row = appearance.bar.is_some()
            || appearance.marker.is_some()
            || appearance.badge.is_some()
            || !footer.is_empty();
        if has_row {
            let row_h = (h as f32 * 0.12).max(5.0) as u32;
            // Clear of a state frame, and one more pixel sideways for the
            // rounded corners.
            let inset = margin.max(frame_width(&style, w, h) + 2);
            let row_y = h - inset - row_h;
            let gap = (row_h / 2).max(2);
            let mut x = inset + 1;
            let mut right = w - inset - 1;
            if let Some(marker) = appearance.marker {
                let r = row_h as f32 / 2.0;
                fill_circle(&mut image, x as f32 + r, row_y as f32 + r, r, marker);
                x += row_h + gap;
            }
            if let Some(badge) = badge {
                right -= row_h;
                self.badge(&mut image, badge, right, row_y, row_h);
                right = right.saturating_sub(gap);
            }
            let width = right.saturating_sub(x);
            if muted {
                self.mute_pill(&mut image, x, row_y, width, row_h);
            } else if let (Some(bar), true) = (appearance.bar, footer.is_empty()) {
                let bar_h = (h as f32 * 0.08).max(3.0) as u32;
                draw_bar(
                    &mut image,
                    x,
                    row_y + (row_h - bar_h) / 2,
                    width,
                    bar_h,
                    bar,
                    palette::BAR,
                );
            }
            text_bottom = row_y - margin / 2;
            if let (Some(font), false) = (&self.font, footer.is_empty() || muted) {
                // Small text sitting on the bottom of the row: next to the
                // type dot when there is one, else centred.
                let (_, colour) = text_colours(appearance.foreground, &style);
                let scale = fit_scale(font, footer, (h as f32 * 0.15).max(8.0), width as f32);
                let ascent = font.as_scaled(PxScale::from(scale)).ascent();
                let baseline = (row_y + row_h) as f32;
                let text_w = if appearance.marker.is_some() {
                    text_width(font, footer, scale).min(width as f32)
                } else {
                    width as f32
                };
                draw_text_at(
                    &mut image,
                    font,
                    footer,
                    scale,
                    x as f32,
                    text_w,
                    baseline - ascent,
                    colour,
                );
                text_bottom = (baseline - scale * 0.73) as u32 - margin / 2;
            }
        }

        if let Some(font) = &self.font {
            let (title_color, subtitle_color) = text_colours(appearance.foreground, &style);
            let title_scale = (h as f32 * 0.24).max(9.0);
            let subtitle_scale = (h as f32 * 0.17).max(8.0);
            let has_subtitle = !appearance.subtitle.trim().is_empty();
            let lines = wrap_title(
                font,
                &appearance.title,
                title_scale,
                (w - 2 * margin) as f32,
            );
            let sub_scale = fit_scale(
                font,
                &appearance.subtitle,
                subtitle_scale,
                (w - 2 * margin) as f32,
            );
            // Over a volume bar the subtitle (percentage) sits at the bottom,
            // right above it, like on the touch strip; else under the title.
            let sub_top = ((appearance.bar.is_some() || appearance.subtitle_low) && has_subtitle)
                .then(|| text_bottom as f32 - font.as_scaled(PxScale::from(sub_scale)).ascent());
            let title_bottom = sub_top.unwrap_or(text_bottom as f32);
            let line_scale = lines
                .iter()
                .map(|line| fit_scale(font, line, title_scale, (w - 2 * margin) as f32))
                .fold(title_scale, f32::min);
            let total = lines.len() as f32 * line_scale * 1.1
                + if has_subtitle && sub_top.is_none() {
                    subtitle_scale * 1.2
                } else {
                    0.0
                };
            let mut y = ((title_bottom - margin as f32 - total) / 2.0).max(margin as f32)
                + margin as f32 * 0.5;
            for line in lines {
                draw_text(&mut image, font, &line, line_scale, y, title_color);
                y += line_scale * 1.1;
            }
            if has_subtitle {
                draw_text(
                    &mut image,
                    font,
                    &appearance.subtitle,
                    sub_scale,
                    sub_top.unwrap_or(y + 2.0),
                    subtitle_color,
                );
            }
        }
        image
    }

    /// Red pill reading MUTED, drawn where the volume bar would be.
    fn mute_pill(&self, image: &mut RgbImage, x: u32, y: u32, w: u32, h: u32) {
        fill_round_rect(image, x, y, w, h, h / 2, palette::MUTED);
        let Some(font) = &self.font else { return };
        let label = "MUTED";
        let scale = fit_scale(font, label, h as f32 * 1.05, w as f32 - h as f32);
        if scale < 7.0 {
            // Too small to read: the red pill alone says muted.
            return;
        }
        // Centre the capitals vertically: cap height is about 0.73 em.
        let ascent = font.as_scaled(PxScale::from(scale)).ascent();
        let top = y as f32 + (h as f32 + scale * 0.73) / 2.0 - ascent;
        draw_text_at(
            image,
            font,
            label,
            scale,
            x as f32,
            w as f32,
            top,
            palette::WHITE,
        );
    }

    /// Draws a badge into the `size` square at `x`, `y` of the status row.
    fn badge(&self, image: &mut RgbImage, badge: Badge, x: u32, y: u32, size: u32) {
        let (cx, cy, r) = (
            x as f32 + size as f32 / 2.0,
            y as f32 + size as f32 / 2.0,
            size as f32 / 2.0,
        );
        match badge {
            Badge::Lock => {
                // Padlock: a shackle ring (open in the middle) above a
                // rounded body that covers its lower half.
                let ring = size as f32 * 0.3;
                let ring_cy = y as f32 + ring + 0.5;
                let inside = sample(image, cx, ring_cy);
                let thickness = (size as f32 * 0.13).max(1.2);
                fill_circle(image, cx, ring_cy, ring, palette::LOCK);
                fill_circle(image, cx, ring_cy, (ring - thickness).max(0.0), inside);
                let body_y = y + size * 2 / 5;
                fill_round_rect(
                    image,
                    x,
                    body_y,
                    size,
                    size - (body_y - y),
                    size / 5,
                    palette::LOCK,
                );
            }
            // Shown in the status row instead, see `mute_pill`.
            Badge::Muted => {}
            Badge::OnAir => fill_circle(image, cx, cy, r, palette::WHITE),
        }
    }

    /// Renders the Stream Deck + touch strip: one segment per encoder.
    pub fn strip(&self, size: (u32, u32), segments: &[StripSegment]) -> RgbImage {
        let (w, h) = size;
        let mut image = RgbImage::from_pixel(w, h, to_pixel(palette::GROUND));
        if segments.is_empty() {
            return image;
        }
        let horizontal = w >= h;
        let count = segments.len() as u32;
        let (seg_w, seg_h) = if horizontal {
            (w / count, h)
        } else {
            (w, h / count)
        };
        for (index, segment) in segments.iter().enumerate() {
            let (x0, y0) = if horizontal {
                (index as u32 * seg_w, 0)
            } else {
                (0, index as u32 * seg_h)
            };
            let margin = (seg_h.min(seg_w) as f32 * 0.1) as u32;
            let gap = 2;
            let style = style(segment.background);
            draw_card(
                &mut image,
                x0 + gap,
                y0 + gap,
                seg_w.saturating_sub(2 * gap),
                seg_h.saturating_sub(2 * gap),
                &style,
            );
            if segment.background == palette::GROUND {
                continue;
            }
            let bar_h = (seg_h as f32 * 0.18).max(6.0) as u32;
            let bar_y = y0 + seg_h - margin - bar_h;
            draw_bar(
                &mut image,
                x0 + margin,
                bar_y,
                seg_w - 2 * margin,
                bar_h,
                segment.volume,
                if segment.muted {
                    palette::MUTED
                } else if segment.background == palette::OFFLINE {
                    // Offline: the level stays readable but greyed out.
                    palette::OFFLINE_TEXT
                } else {
                    palette::BAR
                },
            );
            // Quarter marks make the linear position readable at a glance.
            for fraction in [0.25, 0.5, 0.75] {
                let x = x0 + margin + ((seg_w - 2 * margin) as f32 * fraction) as u32;
                for y in bar_y + 2..bar_y + bar_h.saturating_sub(2) {
                    blend_pixel(&mut image, x, y, palette::IDLE_TEXT, 0.25);
                }
            }
            if let Some(font) = &self.font {
                let foreground = if segment.background == palette::OFFLINE {
                    palette::OFFLINE_TEXT
                } else {
                    palette::IDLE_TEXT
                };
                let (title_color, subtitle_color) = text_colours(foreground, &style);
                let scale = (seg_h as f32 * 0.3).max(10.0);
                let scale = fit_scale(font, &segment.title, scale, (seg_w - 2 * margin) as f32);
                draw_text_at(
                    &mut image,
                    font,
                    &segment.title,
                    scale,
                    x0 as f32,
                    seg_w as f32,
                    y0 as f32 + margin as f32,
                    title_color,
                );
                let subtitle = if segment.muted {
                    "MUTED".to_string()
                } else {
                    crate::audio::mixer::format_volume_percent(segment.volume)
                };
                let sub_scale = (seg_h as f32 * 0.24).max(9.0);
                // Bottom-aligned: the percentage sits just above the bar,
                // the name stays at the top.
                let sub_top = bar_y as f32
                    - (margin as f32 / 2.0).max(2.0)
                    - font.as_scaled(PxScale::from(sub_scale)).ascent();
                draw_text_at(
                    &mut image,
                    font,
                    &subtitle,
                    sub_scale,
                    x0 as f32,
                    seg_w as f32,
                    sub_top,
                    subtitle_color,
                );
            }
        }
        image
    }
}

/// Page hints on the touch strip: there is a page to swipe to on that side.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct StripArrows {
    pub prev: bool,
    pub next: bool,
}

/// Draws a small filled arrow at each strip edge that has a page behind it:
/// left / right on a landscape strip, top / bottom on a portrait one.
pub fn draw_strip_arrows(image: &mut RgbImage, arrows: StripArrows) {
    let (w, h) = image.dimensions();
    let horizontal = w >= h;
    let short = w.min(h);
    let depth = (short as f32 * 0.16).max(5.0) as u32; // how far the arrow points
    let span = depth * 2; // its base
    let inset = (short as f32 * 0.04).max(2.0) as u32;
    let colour = to_pixel(palette::SUBTEXT);
    let mut put = |x: u32, y: u32| {
        if let Some(px) = image.get_pixel_mut_checked(x, y) {
            *px = colour;
        }
    };
    for (show, forward) in [(arrows.prev, false), (arrows.next, true)] {
        if !show {
            continue;
        }
        // Step from the base (d = 0) to the tip (d = depth); the arrow narrows.
        for d in 0..=depth {
            let half = (span / 2) * (depth - d) / depth.max(1);
            let along = if forward {
                (if horizontal { w } else { h }) - inset - depth + d
            } else {
                inset + depth - d
            };
            let middle = (if horizontal { h } else { w }) / 2;
            for across in middle.saturating_sub(half)..=middle + half {
                if horizontal {
                    put(along, across);
                } else {
                    put(across, along);
                }
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StripSegment {
    pub title: String,
    pub volume: f32,
    pub muted: bool,
    pub background: Rgb,
}

/// How strongly a state colour tints the card. The web client uses 12% on
/// a card; a key needs more to read from a distance.
const TALK_TINT: f32 = 0.35;
const STATE_TINT: f32 = 0.3;
/// Incoming / receiving green: a bit stronger and without a frame, so a
/// feed that always carries audio (PGM) does not sit in a permanent frame.
const INCOMING_TINT: f32 = 0.4;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Frame {
    /// No frame: a plain card.
    None,
    /// Thin outline, like the web client's buttons and offline cards.
    Outline(Rgb),
    /// Thick frame of the full state colour.
    State(Rgb),
}

#[derive(Debug, Clone, Copy, PartialEq)]
struct Style {
    /// `None` leaves the key as page background (an empty key).
    fill: Option<Rgb>,
    frame: Frame,
    /// Solid tally fill: white text instead of slate.
    solid: bool,
}

/// Maps a palette role to how the key is drawn.
fn style(color: Rgb) -> Style {
    let tinted = |tint: f32, frame: bool| Style {
        fill: Some(mix(palette::IDLE, color, tint)),
        frame: if frame {
            Frame::State(color)
        } else {
            Frame::None
        },
        solid: false,
    };
    match color {
        c if c == palette::GROUND => Style {
            fill: None,
            frame: Frame::None,
            solid: false,
        },
        c if c == palette::TALKING || c == palette::LOCKED => tinted(TALK_TINT, true),
        c if c == palette::INCOMING => tinted(INCOMING_TINT, false),
        c if c == palette::SELECTED || c == palette::MENU || c == palette::STATUS_BAD => {
            tinted(STATE_TINT, true)
        }
        c if c == palette::MUTED => tinted(STATE_TINT, false),
        c if c == palette::MENU_ITEM => Style {
            fill: Some(color),
            frame: Frame::Outline(palette::MENU_OUTLINE),
            solid: false,
        },
        c if c == palette::CONTROL => Style {
            fill: Some(color),
            frame: Frame::Outline(palette::OUTLINE),
            solid: false,
        },
        c if c == palette::OFFLINE => Style {
            fill: Some(color),
            frame: Frame::None,
            solid: false,
        },
        c if c == palette::ON_AIR || c == palette::PREVIEW || c == palette::REPLY => Style {
            fill: Some(color),
            frame: Frame::None,
            solid: true,
        },
        _ => Style {
            fill: Some(color),
            frame: Frame::None,
            solid: false,
        },
    }
}

/// Title and subtitle colours. Keys that set their own foreground (offline
/// text) keep it for both lines.
fn text_colours(foreground: Rgb, style: &Style) -> (Rgb, Rgb) {
    if foreground != palette::IDLE_TEXT {
        (foreground, foreground)
    } else if style.solid {
        (palette::WHITE, palette::WHITE)
    } else if matches!(style.frame, Frame::State(_)) || style.fill.is_none() {
        (palette::IDLE_TEXT, palette::IDLE_TEXT)
    } else {
        (palette::IDLE_TEXT, palette::SUBTEXT)
    }
}

fn mix(base: Rgb, color: Rgb, amount: f32) -> Rgb {
    let mix =
        |base: u8, color: u8| (base as f32 * (1.0 - amount) + color as f32 * amount).round() as u8;
    Rgb(
        mix(base.0, color.0),
        mix(base.1, color.1),
        mix(base.2, color.2),
    )
}

fn frame_width(style: &Style, w: u32, h: u32) -> u32 {
    match style.frame {
        Frame::None => 0,
        Frame::Outline(_) => (w.min(h) as f32 / 36.0).round().max(1.0) as u32,
        Frame::State(_) => (w.min(h) as f32 * 0.05).max(3.0) as u32,
    }
}

/// Draws a rounded card with its frame into the given rectangle.
fn draw_card(image: &mut RgbImage, x: u32, y: u32, w: u32, h: u32, style: &Style) {
    let Some(fill) = style.fill else { return };
    let radius = (w.min(h) as f32 * 0.14) as u32;
    let width = frame_width(style, w, h);
    match style.frame {
        Frame::Outline(color) | Frame::State(color) => {
            fill_round_rect(image, x, y, w, h, radius, color);
            fill_round_rect(
                image,
                x + width,
                y + width,
                w.saturating_sub(2 * width),
                h.saturating_sub(2 * width),
                radius.saturating_sub(width),
                fill,
            );
        }
        Frame::None => fill_round_rect(image, x, y, w, h, radius, fill),
    }
}

/// Volume bar: a rounded slate track with the level in `color`.
fn draw_bar(image: &mut RgbImage, x: u32, y: u32, w: u32, h: u32, level: f32, color: Rgb) {
    fill_round_rect(image, x, y, w, h, h / 2, palette::BAR_TRACK);
    let filled = (w as f32 * level.clamp(0.0, 1.0)) as u32;
    if filled > 0 {
        fill_round_rect(image, x, y, filled, h, h.min(filled) / 2, color);
    }
}

fn to_pixel(rgb: Rgb) -> ImgRgb<u8> {
    ImgRgb([rgb.0, rgb.1, rgb.2])
}

fn sample(image: &RgbImage, x: f32, y: f32) -> Rgb {
    let (w, h) = image.dimensions();
    let px = image.get_pixel(
        (x.max(0.0) as u32).min(w - 1),
        (y.max(0.0) as u32).min(h - 1),
    );
    Rgb(px[0], px[1], px[2])
}

/// Blends `color` into one pixel with `coverage` (0..1) for smooth edges.
fn blend_pixel(image: &mut RgbImage, x: u32, y: u32, color: Rgb, coverage: f32) {
    if coverage <= 0.0 {
        return;
    }
    let Some(pixel) = image.get_pixel_mut_checked(x, y) else {
        return;
    };
    let coverage = coverage.min(1.0);
    let blend =
        |dst: u8, src: u8| (dst as f32 + (src as f32 - dst as f32) * coverage).round() as u8;
    *pixel = ImgRgb([
        blend(pixel[0], color.0),
        blend(pixel[1], color.1),
        blend(pixel[2], color.2),
    ]);
}

/// Fills a rectangle with anti-aliased rounded corners of `radius`.
fn fill_round_rect(image: &mut RgbImage, x: u32, y: u32, w: u32, h: u32, radius: u32, color: Rgb) {
    let r = radius.min(w / 2).min(h / 2) as f32;
    let (left, top) = (x as f32, y as f32);
    let (right, bottom) = (left + w as f32, top + h as f32);
    for yy in y..y + h {
        for xx in x..x + w {
            let (px, py) = (xx as f32 + 0.5, yy as f32 + 0.5);
            // Nearest corner centre when the pixel lies in a corner square.
            let cx = if px < left + r {
                Some(left + r)
            } else if px > right - r {
                Some(right - r)
            } else {
                None
            };
            let cy = if py < top + r {
                Some(top + r)
            } else if py > bottom - r {
                Some(bottom - r)
            } else {
                None
            };
            let coverage = match (cx, cy) {
                (Some(cx), Some(cy)) => r - ((px - cx).powi(2) + (py - cy).powi(2)).sqrt() + 0.5,
                _ => 1.0,
            };
            blend_pixel(image, xx, yy, color, coverage);
        }
    }
}

fn fill_circle(image: &mut RgbImage, cx: f32, cy: f32, r: f32, color: Rgb) {
    let x0 = (cx - r - 1.0).max(0.0) as u32;
    let y0 = (cy - r - 1.0).max(0.0) as u32;
    for yy in y0..(cy + r + 1.0) as u32 {
        for xx in x0..(cx + r + 1.0) as u32 {
            let d = ((xx as f32 + 0.5 - cx).powi(2) + (yy as f32 + 0.5 - cy).powi(2)).sqrt();
            blend_pixel(image, xx, yy, color, r - d + 0.5);
        }
    }
}

fn text_width(font: &FontVec, text: &str, scale: f32) -> f32 {
    let scaled = font.as_scaled(PxScale::from(scale));
    text.chars()
        .map(|c| scaled.h_advance(scaled.glyph_id(c)))
        .sum()
}

fn fit_scale(font: &FontVec, text: &str, scale: f32, max_width: f32) -> f32 {
    let width = text_width(font, text, scale);
    if width <= max_width || width <= 0.0 {
        scale
    } else {
        (scale * max_width / width).max(6.0)
    }
}

/// Splits a title into at most two lines at a space when it does not fit.
fn wrap_title(font: &FontVec, title: &str, scale: f32, max_width: f32) -> Vec<String> {
    let title = title.trim();
    if title.is_empty() {
        return Vec::new();
    }
    if text_width(font, title, scale) <= max_width {
        return vec![title.to_string()];
    }
    let words: Vec<&str> = title.split_whitespace().collect();
    if words.len() < 2 {
        return vec![title.to_string()];
    }
    let mut best: Option<(f32, String, String)> = None;
    for split in 1..words.len() {
        let first = words[..split].join(" ");
        let second = words[split..].join(" ");
        let widest = text_width(font, &first, scale).max(text_width(font, &second, scale));
        if best.as_ref().map(|(w, _, _)| widest < *w).unwrap_or(true) {
            best = Some((widest, first, second));
        }
    }
    match best {
        Some((_, first, second)) => vec![first, second],
        None => vec![title.to_string()],
    }
}

fn draw_text(image: &mut RgbImage, font: &FontVec, text: &str, scale: f32, top: f32, color: Rgb) {
    let (w, _) = image.dimensions();
    draw_text_at(image, font, text, scale, 0.0, w as f32, top, color);
}

#[allow(clippy::too_many_arguments)]
fn draw_text_at(
    image: &mut RgbImage,
    font: &FontVec,
    text: &str,
    scale: f32,
    x0: f32,
    width: f32,
    top: f32,
    color: Rgb,
) {
    let scaled = font.as_scaled(PxScale::from(scale));
    let text_w = text_width(font, text, scale);
    let mut x = x0 + (width - text_w).max(0.0) / 2.0;
    let baseline = top + scaled.ascent();
    let (iw, ih) = image.dimensions();
    for ch in text.chars() {
        let id = scaled.glyph_id(ch);
        let glyph = id.with_scale_and_position(PxScale::from(scale), point(x, baseline));
        if let Some(outlined) = font.outline_glyph(glyph) {
            let bounds = outlined.px_bounds();
            outlined.draw(|gx, gy, coverage| {
                let px = bounds.min.x as i32 + gx as i32;
                let py = bounds.min.y as i32 + gy as i32;
                if px < 0 || py < 0 || px >= iw as i32 || py >= ih as i32 {
                    return;
                }
                let pixel = image.get_pixel_mut(px as u32, py as u32);
                let blend =
                    |dst: u8, src: u8| (dst as f32 + (src as f32 - dst as f32) * coverage) as u8;
                *pixel = ImgRgb([
                    blend(pixel[0], color.0),
                    blend(pixel[1], color.1),
                    blend(pixel[2], color.2),
                ]);
            });
        }
        x += scaled.h_advance(id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_small_percentage_is_not_drawn_as_a_large_minimum_fill() {
        let mut image = RgbImage::new(100, 20);
        draw_bar(&mut image, 0, 0, 100, 12, 0.02, palette::BAR);
        assert_eq!(
            image.get_pixel(1, 6).0,
            [palette::BAR.0, palette::BAR.1, palette::BAR.2]
        );
        assert_ne!(
            image.get_pixel(4, 6).0,
            [palette::BAR.0, palette::BAR.1, palette::BAR.2]
        );
    }

    fn renderer() -> Renderer {
        let path = Path::new("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf");
        Renderer::load(path)
    }

    #[test]
    fn renders_key_with_text_bar_and_badge() {
        let renderer = renderer();
        let mut appearance = Appearance::blank();
        appearance.title = "Camera Left".into();
        appearance.subtitle = "90%".into();
        appearance.background = palette::IDLE;
        appearance.bar = Some(0.5);
        appearance.badge = Some(Badge::Lock);
        let image = renderer.key(&appearance, (72, 72), false);
        assert_eq!(image.dimensions(), (72, 72));
        // Bar drawn: left half of the bar row is the bar colour.
        let bar_px = image.get_pixel(10, 63);
        assert_eq!(bar_px.0, [palette::BAR.0, palette::BAR.1, palette::BAR.2]);
        // Badge drawn at the right end of the status row.
        assert_eq!(image.get_pixel(63, 65).0, [251, 191, 36]);
        if renderer.has_font() {
            // Some text pixels differ from the background.
            let changed = image
                .pixels()
                .filter(|p| {
                    p.0 == [
                        palette::IDLE_TEXT.0,
                        palette::IDLE_TEXT.1,
                        palette::IDLE_TEXT.2,
                    ]
                })
                .count();
            assert!(changed > 20, "text rendered: {changed}");
        }
    }

    #[test]
    fn status_row_has_dot_then_bar_or_mute_pill() {
        let renderer = renderer();
        let mut appearance = Appearance::blank();
        appearance.title = "Virus".into();
        appearance.background = palette::IDLE;
        appearance.bar = Some(1.0);
        appearance.marker = Some(palette::FEED_DOT);
        let key = renderer.key(&appearance, (96, 96), false);
        // 96 px: inset 6, row 11 px from y 79; dot spans x 7..18, bar
        // starts after a 5 px gap.
        let row_mid = 79 + 5;
        assert_eq!(key.get_pixel(11, row_mid).0, [100, 116, 139]);
        assert_eq!(key.get_pixel(18, row_mid).0, [31, 41, 55]);
        assert_eq!(key.get_pixel(30, row_mid).0, [96, 165, 250]);

        appearance.badge = Some(Badge::Muted);
        let muted = renderer.key(&appearance, (96, 96), false);
        assert_eq!(muted.get_pixel(11, row_mid).0, [100, 116, 139]);
        // Pill edge (left of the label) is red, no bar colour anywhere.
        assert_eq!(muted.get_pixel(24, row_mid).0, [239, 68, 68]);
        assert!(!muted.pixels().any(|p| p.0 == [96, 165, 250]));
        // Nothing drawn in the top-right corner.
        assert_eq!(muted.get_pixel(84, 12).0, [31, 41, 55]);

        // Other badges sit right of a shorter bar: bar ends at x 73, a
        // 5 px gap, padlock from x 78.
        appearance.badge = Some(Badge::Lock);
        let locked = renderer.key(&appearance, (96, 96), false);
        assert_eq!(locked.get_pixel(71, row_mid).0, [96, 165, 250]);
        assert_eq!(locked.get_pixel(75, row_mid).0, [31, 41, 55]);
        assert_eq!(locked.get_pixel(84, 86).0, [251, 191, 36]);
        assert_eq!(locked.get_pixel(84, 12).0, [31, 41, 55]);
    }

    #[test]
    fn status_row_keeps_clear_of_a_state_frame() {
        let renderer = renderer();
        let mut appearance = Appearance::blank();
        appearance.background = palette::LOCKED;
        appearance.bar = Some(0.5);
        appearance.badge = Some(Badge::Lock);
        appearance.marker = Some(palette::USER_DOT);
        let key = renderer.key(&appearance, (48, 48), false);
        // 48 px: 3 px frame, row 5 px high from y 38. The line between the
        // row and the frame stays the tinted key colour, also under the
        // padlock in the bottom-right corner.
        let tint = [58, 41, 112];
        for x in [8, 24, 40] {
            assert_eq!(key.get_pixel(x, 44).0, tint, "x {x}");
        }
        assert_eq!(key.get_pixel(46, 40).0, [109, 40, 217]);
        assert_eq!(key.get_pixel(43, 40).0, tint);
    }

    #[test]
    fn talk_and_incoming_keys_use_web_client_colours() {
        let renderer = renderer();
        let mut talking = Appearance::blank();
        talking.background = palette::TALKING;
        talking.title = "Talk".into();
        talking.subtitle = "we speak".into();
        let mut incoming = Appearance::blank();
        incoming.background = palette::INCOMING;
        incoming.title = "News".into();
        incoming.subtitle = "incoming".into();
        incoming.blink = Some(palette::IDLE);
        let talk = renderer.key(&talking, (96, 96), false);
        let listen = renderer.key(&incoming, (96, 96), false);
        // Web client look: talking has a full colour frame around the card
        // tinted with the state colour; incoming is a green tint without a
        // frame. The rounded corners show the page background.
        assert_eq!(talk.get_pixel(48, 1).0, [139, 92, 246]);
        assert_eq!(talk.get_pixel(8, 48).0, [69, 59, 122]);
        assert_eq!(listen.get_pixel(48, 1).0, [32, 103, 71]);
        assert_eq!(listen.get_pixel(8, 48).0, [32, 103, 71]);
        assert_eq!(talk.get_pixel(0, 0).0, [11, 17, 32]);
        if let Ok(dir) = std::env::var("TALKTOME_COLOUR_SWATCH_DIR") {
            let dir = std::path::PathBuf::from(dir);
            let _ = std::fs::create_dir_all(&dir);
            talk.save(dir.join("streamdeck_key_talking.png"))
                .expect("write talking swatch");
            listen
                .save(dir.join("streamdeck_key_incoming.png"))
                .expect("write incoming swatch");
            let listen_blink = renderer.key(&incoming, (96, 96), true);
            listen_blink
                .save(dir.join("streamdeck_key_incoming_blink.png"))
                .expect("write incoming blink swatch");
        }
    }

    #[test]
    fn blink_uses_alternate_colour() {
        let renderer = Renderer { font: None };
        let mut appearance = Appearance::blank();
        appearance.background = palette::INCOMING;
        appearance.blink = Some(palette::IDLE);
        let a = renderer.key(&appearance, (32, 32), false);
        let b = renderer.key(&appearance, (32, 32), true);
        assert_ne!(a.get_pixel(16, 16), b.get_pixel(16, 16));
    }

    #[test]
    fn renders_strip_segments() {
        let renderer = renderer();
        let segments = vec![
            StripSegment {
                title: "Crew".into(),
                volume: 0.9,
                muted: false,
                background: palette::IDLE,
            },
            StripSegment {
                title: "Cam 2".into(),
                volume: 0.3,
                muted: true,
                background: palette::IDLE,
            },
        ];
        let image = renderer.strip((800, 100), &segments);
        assert_eq!(image.dimensions(), (800, 100));
        image
            .save(std::env::temp_dir().join("talktome-strip-plus.png"))
            .unwrap();
        let vertical = renderer.strip((100, 1200), &segments);
        assert_eq!(vertical.dimensions(), (100, 1200));
    }

    fn demo_snapshot() -> crate::state::Snapshot {
        use crate::state::{ConnectionState, IncomingInfo, Snapshot, TargetInfo};
        use crate::talk::TargetKey;
        let mut snapshot = Snapshot::initial("ui", "ueli");
        snapshot.connection = ConnectionState::Ready;
        snapshot.audio_ok = true;
        snapshot.production = Some("News Desk".into());
        snapshot.targets = ["adi", "beni", "oli", "andy", "jan", "kenny"]
            .into_iter()
            .enumerate()
            .map(|(i, name)| TargetInfo {
                key: TargetKey::User(i as i64),
                name: name.into(),
                can_talk: true,
                online: true,
                held: false,
                locked: false,
                incoming: false,
                receiving: false,
                volume: 0.65,
                muted: false,
                members: Vec::new(),
            })
            .collect();
        snapshot.targets.push(TargetInfo {
            key: TargetKey::Conference(1),
            name: "News".into(),
            can_talk: true,
            online: true,
            held: false,
            locked: false,
            incoming: true,
            receiving: false,
            volume: 0.8,
            muted: false,
            members: Vec::new(),
        });
        snapshot.targets.push(TargetInfo {
            key: TargetKey::Feed(1),
            name: "Virus".into(),
            can_talk: false,
            online: true,
            held: false,
            locked: false,
            incoming: false,
            receiving: true,
            volume: 0.65,
            muted: false,
            members: Vec::new(),
        });
        snapshot.targets.push(TargetInfo {
            key: TargetKey::Conference(2),
            name: "Regie".into(),
            can_talk: false,
            online: true,
            held: false,
            locked: false,
            incoming: false,
            receiving: false,
            volume: 0.5,
            muted: false,
            members: Vec::new(),
        });
        snapshot.targets[1].held = true;
        snapshot.targets[2].locked = true;
        snapshot.targets[3].online = false;
        snapshot.targets[4].muted = true;
        snapshot.reply_target = Some(TargetKey::Conference(1));
        snapshot.reply_name = Some("News".into());
        snapshot.incoming = vec![IncomingInfo {
            from_name: "jan".into(),
            target: Some(TargetKey::Conference(1)),
        }];
        snapshot
    }

    fn compose_grid(
        renderer: &Renderer,
        keys: &[crate::surfaces::streamdeck::layout::KeySpec],
        cols: u8,
        size: u32,
    ) -> RgbImage {
        let cols = cols.max(1) as u32;
        let rows = (keys.len() as u32).div_ceil(cols);
        let gap = 6;
        let mut canvas = RgbImage::from_pixel(
            cols * (size + gap) + gap,
            rows * (size + gap) + gap,
            ImgRgb([12, 14, 20]),
        );
        for (index, spec) in keys.iter().enumerate() {
            let key = renderer.key(&spec.appearance, (size, size), false);
            let col = index as u32 % cols;
            let row = index as u32 / cols;
            let x0 = gap + col * (size + gap);
            let y0 = gap + row * (size + gap);
            for y in 0..size {
                for x in 0..size {
                    canvas.put_pixel(x0 + x, y0 + y, *key.get_pixel(x, y));
                }
            }
        }
        canvas
    }

    #[test]
    fn composes_neo_and_plus_layouts() {
        use crate::surfaces::streamdeck::layout::{
            layout, DeckState, Geometry, LayoutOptions, MenuPage, Role,
        };
        use crate::talk::TargetKey;
        let renderer = renderer();
        let snapshot = demo_snapshot();
        let options = LayoutOptions::default();
        let neo = Geometry {
            keys: 8,
            rows: 2,
            cols: 4,
            encoders: 0,
            touchpoints: 2,
            visual: true,
        };
        let keys = layout(&neo, &snapshot, &DeckState::default(), &options);
        assert_eq!(keys[0].appearance.title, "ueli");
        assert_eq!(keys[0].appearance.subtitle, "News Desk");
        assert_eq!(keys[1].role, Role::VolumeToggle);
        assert_eq!(keys[3].role, Role::Reply);
        assert_eq!(keys[3].appearance.subtitle, "News");
        assert_eq!(keys[4].role, Role::Target(TargetKey::User(0)));
        let idle = compose_grid(&renderer, &keys, neo.cols, 72);
        let dir = std::env::temp_dir();
        idle.save(dir.join("talktome-layout-neo.png")).unwrap();

        let volume = DeckState {
            volume_layer: true,
            selected: Some(TargetKey::User(0)),
            ..DeckState::default()
        };
        let keys = layout(&neo, &snapshot, &volume, &options);
        assert_eq!(keys[0].role, Role::VolumeToggle);
        // More targets than keys: NEXT replaces MUTE (hold a target to mute).
        assert_eq!(keys[1].role, Role::NextPage);
        assert_eq!(keys[2].role, Role::VolumeDown);
        assert_eq!(keys[3].role, Role::VolumeUp);
        assert_eq!(keys[4].role, Role::Target(TargetKey::User(0)));
        compose_grid(&renderer, &keys, neo.cols, 72)
            .save(dir.join("talktome-layout-neo-volume.png"))
            .unwrap();

        let plus = Geometry {
            keys: 8,
            rows: 2,
            cols: 4,
            encoders: 4,
            touchpoints: 0,
            visual: true,
        };
        let keys = layout(&plus, &snapshot, &DeckState::default(), &options);
        compose_grid(&renderer, &keys, plus.cols, 72)
            .save(dir.join("talktome-layout-plus.png"))
            .unwrap();
        let plusxl = Geometry {
            keys: 36,
            rows: 4,
            cols: 9,
            encoders: 6,
            touchpoints: 0,
            visual: true,
        };
        let keys = layout(&plusxl, &snapshot, &DeckState::default(), &options);
        assert!(!keys.iter().any(|key| key.role == Role::NextEncoderPage));
        assert_eq!(keys[2].role, Role::MembersToggle);
        assert_eq!(keys[8].role, Role::Reply);
        compose_grid(&renderer, &keys, plusxl.cols, 48)
            .save(dir.join("talktome-layout-plusxl.png"))
            .unwrap();

        let mk2 = Geometry {
            keys: 15,
            rows: 3,
            cols: 5,
            encoders: 0,
            touchpoints: 0,
            visual: true,
        };
        let keys = layout(&mk2, &snapshot, &DeckState::default(), &options);
        assert_eq!(keys[5].role, Role::Target(TargetKey::User(0)));
        assert_eq!(keys[5].appearance.title, "adi");
        assert_eq!(keys[10].appearance.title, "kenny");
        compose_grid(&renderer, &keys, mk2.cols, 72)
            .save(dir.join("talktome-layout-mk2-eight.png"))
            .unwrap();
        let mut offline = snapshot.clone();
        offline.connection = crate::state::ConnectionState::Disconnected;
        let offline_state = DeckState {
            local_ip: Some("192.0.2.10".into()),
            ..DeckState::default()
        };
        let keys = layout(&mk2, &offline, &offline_state, &options);
        compose_grid(&renderer, &keys, mk2.cols, 72)
            .save(dir.join("talktome-layout-mk2-offline.png"))
            .unwrap();
        let mut menu_snapshot = snapshot.clone();
        menu_snapshot.productions = ["News Desk", "Sport", "Meteo"]
            .into_iter()
            .map(|name| crate::state::ProductionInfo {
                id: name.to_lowercase(),
                name: name.into(),
            })
            .collect();
        for (page, file) in [
            (MenuPage::Root, "talktome-layout-menu-root.png"),
            (
                MenuPage::Productions,
                "talktome-layout-menu-productions.png",
            ),
            (MenuPage::Info, "talktome-layout-menu-info.png"),
        ] {
            let mut menu = DeckState::default();
            menu.open_menu(page);
            let keys = layout(&mk2, &menu_snapshot, &menu, &options);
            compose_grid(&renderer, &keys, mk2.cols, 72)
                .save(dir.join(file))
                .unwrap();
        }
        let mut five = snapshot.clone();
        five.targets.truncate(5);
        let keys = layout(&mk2, &five, &DeckState::default(), &options);
        // Five targets fill the row under the command row; the bottom stays empty.
        assert_eq!(keys[5].appearance.title, "adi");
        assert_eq!(keys[10].role, Role::Empty);
        compose_grid(&renderer, &keys, mk2.cols, 72)
            .save(dir.join("talktome-layout-mk2-five.png"))
            .unwrap();
        let pedal = Geometry {
            keys: 3,
            rows: 1,
            cols: 3,
            encoders: 0,
            touchpoints: 0,
            visual: false,
        };
        let options = LayoutOptions {
            pedal_left: Some(TargetKey::User(0)),
            pedal_middle: Some(TargetKey::Conference(1)),
        };
        let keys = layout(&pedal, &snapshot, &DeckState::default(), &options);
        assert_eq!(keys[2].role, Role::Reply);
        compose_grid(&renderer, &keys, 3, 96)
            .save(dir.join("talktome-layout-pedal.png"))
            .unwrap();
    }
}
