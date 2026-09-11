//! Typing text as keystrokes, for applications that do not accept a paste.
//!
//! Characters are sent as Unicode key events, so the result does not depend on the keyboard
//! layout. Games reading raw scancodes may ignore Unicode events; that is a limitation of the
//! method, not something a layout-specific path would fix reliably.

use std::time;

use anyhow::Result;

/// Pause between characters, so applications that process input on a timer keep up.
pub const CHARACTER_DELAY: time::Duration = time::Duration::from_millis(3);

/// Value the rdev fork stamps on every simulated input (`rdev::INJECTED_EXTRA_INFO`), so the grab
/// hook passes our own keystrokes through.
const INJECTED_EXTRA_INFO: usize = 0x574F_4F54;

/// Types the text into the focused application. Newlines are sent as Enter.
#[cfg(target_os = "windows")]
pub fn type_text(text: &str) -> Result<()> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE, VK_RETURN,
    };

    fn input(unicode: u16, virtual_key: u16, up: bool) -> INPUT {
        let mut flags = if virtual_key == 0 { KEYEVENTF_UNICODE } else { 0 };
        if up {
            flags |= KEYEVENTF_KEYUP;
        }
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: virtual_key,
                    wScan: unicode,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: INJECTED_EXTRA_INFO,
                },
            },
        }
    }

    for character in text.chars() {
        let mut inputs: Vec<INPUT> = Vec::with_capacity(4);
        if character == '\n' {
            inputs.push(input(0, VK_RETURN, false));
            inputs.push(input(0, VK_RETURN, true));
        } else if character == '\r' {
            continue;
        } else {
            let mut units = [0u16; 2];
            for unit in character.encode_utf16(&mut units) {
                inputs.push(input(*unit, 0, false));
                inputs.push(input(*unit, 0, true));
            }
        }

        // SAFETY: plain Win32 call with a locally owned, correctly sized array.
        let sent = unsafe {
            SendInput(
                inputs.len() as u32,
                inputs.as_ptr(),
                std::mem::size_of::<INPUT>() as i32,
            )
        };
        if sent != inputs.len() as u32 {
            anyhow::bail!("SendInput sent {} of {} events", sent, inputs.len());
        }

        std::thread::sleep(CHARACTER_DELAY);
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn type_text(_text: &str) -> Result<()> {
    anyhow::bail!("typing text is only implemented on Windows")
}
