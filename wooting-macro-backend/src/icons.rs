//! Icons of executables and image files as PNG data URLs, so collections and macros can show
//! the icon of the application they belong to. Windows asks the shell for the same icon
//! Explorer shows; other platforms only handle `.png` files.

use anyhow::{Context, Result};
use base64::Engine;
use std::path::Path;

/// `data:image/png;base64,...` for the icon of `path`: a `.png` file as is, anything else
/// (`.exe`, `.ico`, `.dll`, ...) through the shell's icon extraction.
pub fn icon_data_url(path: &str) -> Result<String> {
    let file = Path::new(path);
    let extension = file
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .unwrap_or_default();
    if extension == "png" {
        let bytes = std::fs::read(file).with_context(|| format!("reading {}", path))?;
        return Ok(data_url(&bytes));
    }
    let image = platform::icon_rgba(path)?;
    Ok(data_url(&encode_png(&image)?))
}

/// A decoded icon, 8-bit RGBA, rows top to bottom.
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

fn encode_png(image: &Rgba) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut out, image.width, image.height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header()?;
        writer.write_image_data(&image.pixels)?;
    }
    Ok(out)
}

fn data_url(png: &[u8]) -> String {
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(png)
    )
}

#[cfg(target_os = "windows")]
mod platform {
    use super::Rgba;
    use anyhow::{anyhow, Result};
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Graphics::Gdi::{
        CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO,
        BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows_sys::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};
    use windows_sys::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

    /// The 32 px icon the shell associates with `path`.
    pub fn icon_rgba(path: &str) -> Result<Rgba> {
        let wide: Vec<u16> = std::ffi::OsStr::new(path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        // SAFETY: plain Win32 calls with valid, zero-initialised structures; every handle the
        // shell hands back is released before returning.
        unsafe {
            // The shell needs COM on this thread; an already-initialised thread just returns
            // an informational result, which is fine.
            CoInitializeEx(std::ptr::null(), COINIT_APARTMENTTHREADED as u32);
            let mut info: SHFILEINFOW = std::mem::zeroed();
            let found = SHGetFileInfoW(
                wide.as_ptr(),
                0,
                &mut info,
                std::mem::size_of::<SHFILEINFOW>() as u32,
                SHGFI_ICON | SHGFI_LARGEICON,
            );
            if found == 0 || info.hIcon == 0 {
                return Err(anyhow!("no icon for {}", path));
            }
            let result = icon_to_rgba(info.hIcon);
            DestroyIcon(info.hIcon);
            result
        }
    }

    unsafe fn icon_to_rgba(icon: HICON) -> Result<Rgba> {
        let mut icon_info: ICONINFO = std::mem::zeroed();
        if GetIconInfo(icon, &mut icon_info) == 0 {
            return Err(anyhow!("GetIconInfo failed"));
        }
        let result = read_bitmaps(icon_info.hbmColor, icon_info.hbmMask);
        if icon_info.hbmColor != 0 {
            DeleteObject(icon_info.hbmColor);
        }
        if icon_info.hbmMask != 0 {
            DeleteObject(icon_info.hbmMask);
        }
        result
    }

    unsafe fn read_bitmaps(colour: isize, mask: isize) -> Result<Rgba> {
        let source = if colour != 0 { colour } else { mask };
        let mut bitmap: BITMAP = std::mem::zeroed();
        if GetObjectW(
            source,
            std::mem::size_of::<BITMAP>() as i32,
            &mut bitmap as *mut _ as *mut c_void,
        ) == 0
        {
            return Err(anyhow!("GetObject failed"));
        }
        let width = bitmap.bmWidth as u32;
        // A mask-only icon stacks the XOR and AND images vertically.
        let height = if colour != 0 {
            bitmap.bmHeight as u32
        } else {
            bitmap.bmHeight as u32 / 2
        };
        if width == 0 || height == 0 || width > 512 || height > 512 {
            return Err(anyhow!("unexpected icon size {}x{}", width, height));
        }

        let dc = CreateCompatibleDC(0);
        let header = || {
            let mut info: BITMAPINFO = std::mem::zeroed();
            info.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width as i32,
                biHeight: -(height as i32), // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB,
                biSizeImage: 0,
                biXPelsPerMeter: 0,
                biYPelsPerMeter: 0,
                biClrUsed: 0,
                biClrImportant: 0,
            };
            info
        };
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let mut info = header();
        let lines = GetDIBits(
            dc,
            source,
            0,
            height,
            pixels.as_mut_ptr() as *mut c_void,
            &mut info,
            DIB_RGB_COLORS,
        );
        let mut mask_pixels = vec![0u8; (width * height * 4) as usize];
        if mask != 0 {
            let mut mask_info = header();
            GetDIBits(
                dc,
                mask,
                0,
                height,
                mask_pixels.as_mut_ptr() as *mut c_void,
                &mut mask_info,
                DIB_RGB_COLORS,
            );
        }
        DeleteDC(dc);
        if lines == 0 {
            return Err(anyhow!("GetDIBits failed"));
        }

        // GDI hands back BGRA. Icons without an alpha channel use the mask instead: a set
        // mask pixel means transparent.
        let has_alpha = colour != 0 && pixels.chunks(4).any(|p| p[3] != 0);
        for (index, px) in pixels.chunks_mut(4).enumerate() {
            px.swap(0, 2);
            if !has_alpha {
                let masked = mask != 0 && mask_pixels[index * 4] != 0;
                px[3] = if masked { 0 } else { 255 };
            }
        }
        Ok(Rgba {
            width,
            height,
            pixels,
        })
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::Rgba;
    use anyhow::{anyhow, Result};

    pub fn icon_rgba(path: &str) -> Result<Rgba> {
        Err(anyhow!("icon extraction is not available on this platform ({})", path))
    }
}
