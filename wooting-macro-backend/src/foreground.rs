//! Which application owns the foreground window, and which applications are available to link
//! collections to: running programs with a window, and games installed through Steam.
//!
//! Collections can be linked to application executables; they are armed while one of those
//! applications is in the foreground. Only Windows is implemented, other platforms report nothing
//! so linked collections simply stay disarmed there.

use std::path::{Path, PathBuf};

/// An application a collection can be linked to.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ApplicationEntry {
    /// Executable file name, e.g. `notepad.exe`. This is what gets linked.
    pub exe: String,
    /// Human readable name: window title for running programs, game name for installed ones.
    pub label: String,
    /// `running` (has a visible window), `background` (running, no window) or `steam`.
    pub source: String,
}

/// Executables that show up in game folders but are never the game itself.
const HELPER_EXECUTABLES: &[&str] = &[
    "unitycrashhandler",
    "crashreport",
    "crashhandler",
    "vcredist",
    "vc_redist",
    "dxsetup",
    "dxwebsetup",
    "uninstall",
    "unins000",
    "easyanticheat",
    "eac",
    "installer",
    "setup",
    "redist",
    "launcher_helper",
    "epicwebhelper",
    "bootstrapper",
    "brokerservice",
    "installcleaner",
    "attestation",
    "crashlogs",
    "prelauncher",
    "_be.exe",
    "battleye",
    "diag_",
    "miniticket",
    "gameservicelauncher",
    "anticheat",
    "unrealcefsubprocess",
    "createdump",
];

fn is_helper_executable(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    HELPER_EXECUTABLES.iter().any(|helper| lower.contains(helper))
}

/// Games installed through Steam, one entry per plausible executable, from every Steam library.
pub fn steam_applications() -> Vec<ApplicationEntry> {
    let mut entries = Vec::new();

    for library in steam::library_folders() {
        let steamapps = library.join("steamapps");
        let Ok(dir) = std::fs::read_dir(&steamapps) else {
            continue;
        };

        for manifest in dir.flatten() {
            let path = manifest.path();
            let is_manifest = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("appmanifest_") && name.ends_with(".acf"));
            if !is_manifest {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else {
                continue;
            };
            let (Some(name), Some(install_dir)) =
                (steam::vdf_value(&text, "name"), steam::vdf_value(&text, "installdir"))
            else {
                continue;
            };
            if steam::is_tool(&name) {
                continue;
            }

            let game_dir = steamapps.join("common").join(&install_dir);
            for exe in steam::executables_in(&game_dir) {
                entries.push(ApplicationEntry {
                    exe,
                    label: name.clone(),
                    source: "steam".to_string(),
                });
            }
        }
    }

    entries.sort_by(|a, b| {
        a.label
            .to_lowercase()
            .cmp(&b.label.to_lowercase())
            .then_with(|| a.exe.to_lowercase().cmp(&b.exe.to_lowercase()))
    });
    entries.dedup();
    entries
}

mod steam {
    use super::{is_helper_executable, Path, PathBuf};

    /// Steam's own redistributables and tools are listed like games; skip them.
    pub fn is_tool(name: &str) -> bool {
        let lower = name.to_lowercase();
        lower.starts_with("steamworks")
            || lower.starts_with("steam linux runtime")
            || lower.starts_with("proton")
            || lower.contains("redistributable")
    }

    /// Value of `"key" "value"` in Valve's KeyValues text format (first occurrence).
    pub fn vdf_value(text: &str, key: &str) -> Option<String> {
        let needle = format!("\"{}\"", key);
        for line in text.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix(&needle) {
                if let Some(quoted) = rest.trim().strip_prefix('"') {
                    let value: String = quoted.chars().take_while(|c| *c != '"').collect();
                    return Some(value.replace("\\\\", "\\"));
                }
            }
        }
        None
    }

    /// Every Steam library folder on this machine (the main install and any extra libraries).
    pub fn library_folders() -> Vec<PathBuf> {
        let mut folders = Vec::new();
        let Some(steam_path) = steam_install_path() else {
            return folders;
        };
        folders.push(steam_path.clone());

        if let Ok(text) = std::fs::read_to_string(steam_path.join("steamapps/libraryfolders.vdf"))
        {
            for line in text.lines() {
                let line = line.trim();
                if let Some(rest) = line.strip_prefix("\"path\"") {
                    if let Some(quoted) = rest.trim().strip_prefix('"') {
                        let value: String = quoted.chars().take_while(|c| *c != '"').collect();
                        let path = PathBuf::from(value.replace("\\\\", "\\"));
                        if !folders.contains(&path) {
                            folders.push(path);
                        }
                    }
                }
            }
        }

        folders
    }

    /// Plausible game executables in an install folder: the top level, plus the layouts Unreal
    /// (`*/Binaries/Win64`) and Unity (`*_Data` next to the exe) use, helpers filtered out.
    pub fn executables_in(game_dir: &Path) -> Vec<String> {
        let mut found = Vec::new();
        collect_executables(game_dir, 0, &mut found);
        found.sort_by_key(|name| name.to_lowercase());
        found.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        found
    }

    fn collect_executables(dir: &Path, depth: u8, found: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if path.is_dir() {
                // Unreal: <Project>/Binaries/Win64/<Project>-Win64-Shipping.exe (three levels).
                if depth < 3 {
                    collect_executables(&path, depth + 1, found);
                }
            } else if name.to_lowercase().ends_with(".exe") && !is_helper_executable(name) {
                // Only take deeper executables from Binaries folders, to avoid tool directories.
                let in_binaries = depth == 0
                    || dir
                        .to_string_lossy()
                        .to_lowercase()
                        .replace('/', "\\")
                        .contains("\\binaries\\");
                if in_binaries {
                    found.push(name.to_string());
                }
            }
        }
    }

    #[cfg(target_os = "windows")]
    fn steam_install_path() -> Option<PathBuf> {
        use windows_sys::Win32::System::Registry::{
            RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ,
        };

        let subkey: Vec<u16> = "Software\\Valve\\Steam\0".encode_utf16().collect();
        let value: Vec<u16> = "SteamPath\0".encode_utf16().collect();
        let mut buffer = [0u16; 1024];
        let mut size = (buffer.len() * 2) as u32;

        // SAFETY: plain registry read into a locally owned buffer.
        let status = unsafe {
            RegGetValueW(
                HKEY_CURRENT_USER,
                subkey.as_ptr(),
                value.as_ptr(),
                RRF_RT_REG_SZ,
                std::ptr::null_mut(),
                buffer.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if status == 0 {
            let length = buffer.iter().position(|c| *c == 0).unwrap_or(buffer.len());
            let path = PathBuf::from(String::from_utf16_lossy(&buffer[..length]));
            if path.is_dir() {
                return Some(path);
            }
        }

        let fallback = PathBuf::from("C:\\Program Files (x86)\\Steam");
        fallback.is_dir().then_some(fallback)
    }

    #[cfg(not(target_os = "windows"))]
    fn steam_install_path() -> Option<PathBuf> {
        None
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use super::ApplicationEntry;
    use std::collections::HashMap;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;

    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, INVALID_HANDLE_VALUE, LPARAM};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible, GW_OWNER,
    };

    /// Executable file name of a process, e.g. `notepad.exe`.
    fn process_name(process_id: u32) -> Option<String> {
        // SAFETY: plain Win32 calls with valid, locally owned buffers and handles.
        unsafe {
            let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id);
            if process == 0 {
                return None;
            }

            let mut buffer = [0u16; 1024];
            let mut length = buffer.len() as u32;
            let ok = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
            CloseHandle(process);
            if ok == 0 {
                return None;
            }

            let path = OsString::from_wide(&buffer[..length as usize]);
            Path::new(&path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
        }
    }

    /// Executable file name (e.g. `notepad.exe`) of the process owning the foreground window.
    pub fn foreground_process_name() -> Option<String> {
        // SAFETY: plain Win32 calls.
        unsafe {
            let window = GetForegroundWindow();
            if window == 0 {
                return None;
            }
            let mut process_id: u32 = 0;
            GetWindowThreadProcessId(window, &mut process_id);
            if process_id == 0 {
                return None;
            }
            process_name(process_id)
        }
    }

    /// Executable file names of all running processes, deduplicated and sorted.
    pub fn running_process_names() -> Vec<String> {
        let mut names = Vec::new();

        // SAFETY: plain Win32 calls; the snapshot handle is closed before returning.
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return names;
            }

            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

            if Process32FirstW(snapshot, &mut entry) != 0 {
                loop {
                    let length = entry
                        .szExeFile
                        .iter()
                        .position(|c| *c == 0)
                        .unwrap_or(entry.szExeFile.len());
                    names.push(String::from_utf16_lossy(&entry.szExeFile[..length]));

                    if Process32NextW(snapshot, &mut entry) == 0 {
                        break;
                    }
                }
            }

            CloseHandle(snapshot);
        }

        names.sort_by_key(|name| name.to_lowercase());
        names.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
        names
    }

    /// Running programs that own a visible top-level window, keyed by executable, with the
    /// window title as label. Programs without a window are listed as `background`.
    pub fn running_applications() -> Vec<ApplicationEntry> {
        let mut windowed: HashMap<String, String> = HashMap::new();

        unsafe extern "system" fn enumerate(window: HWND, lparam: LPARAM) -> BOOL {
            let windowed = &mut *(lparam as *mut HashMap<String, String>);

            // Only top-level, visible, titled windows: what the user thinks of as "open apps".
            if IsWindowVisible(window) == 0 || GetWindow(window, GW_OWNER) != 0 {
                return 1;
            }
            let title_length = GetWindowTextLengthW(window);
            if title_length <= 0 {
                return 1;
            }
            let mut title = vec![0u16; title_length as usize + 1];
            let copied = GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32);
            let title = String::from_utf16_lossy(&title[..copied.max(0) as usize]);

            let mut process_id: u32 = 0;
            GetWindowThreadProcessId(window, &mut process_id);
            if let Some(exe) = process_name(process_id) {
                windowed.entry(exe).or_insert(title);
            }
            1
        }

        // SAFETY: the callback only touches the map passed through lparam for the duration of
        // the call.
        unsafe {
            EnumWindows(Some(enumerate), &mut windowed as *mut _ as LPARAM);
        }

        let mut entries: Vec<ApplicationEntry> = windowed
            .iter()
            .map(|(exe, title)| ApplicationEntry {
                exe: exe.clone(),
                label: title.clone(),
                source: "running".to_string(),
            })
            .collect();

        for exe in running_process_names() {
            if !windowed.keys().any(|known| known.eq_ignore_ascii_case(&exe)) {
                entries.push(ApplicationEntry {
                    label: exe.clone(),
                    exe,
                    source: "background".to_string(),
                });
            }
        }

        entries.sort_by(|a, b| {
            a.source
                .cmp(&b.source)
                .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
        });
        entries
    }

    /// Asks Windows for 1 ms timer resolution for this process. Without it, sleeps round up to
    /// the default ~15.6 ms tick, which makes 20 ms macro delays take 31 ms and hold thresholds
    /// fire late.
    pub fn request_fine_timer_resolution() {
        // SAFETY: documented to be safe to call at any time; the request lasts for the process.
        unsafe {
            windows_sys::Win32::Media::timeBeginPeriod(1);
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::ApplicationEntry;

    pub fn foreground_process_name() -> Option<String> {
        None
    }

    pub fn running_process_names() -> Vec<String> {
        Vec::new()
    }

    pub fn running_applications() -> Vec<ApplicationEntry> {
        Vec::new()
    }

    pub fn request_fine_timer_resolution() {}
}

pub use platform::{
    foreground_process_name, request_fine_timer_resolution, running_applications,
    running_process_names,
};

/// Everything a collection can be linked to: running programs first, then installed games.
pub fn list_applications() -> Vec<ApplicationEntry> {
    let mut entries = running_applications();
    entries.extend(steam_applications());
    entries
}

#[cfg(test)]
mod tests {
    #[test]
    fn lists_applications() {
        for entry in super::list_applications() {
            println!("{:<10} {:<40} {}", entry.source, entry.exe, entry.label);
        }
    }
}
