//! Which application owns the foreground window, and which applications are running.
//!
//! Collections can be linked to application executables; they are armed while one of those
//! applications is in the foreground. Only Windows is implemented, other platforms report nothing
//! so linked collections simply stay disarmed there.

#[cfg(target_os = "windows")]
mod platform {
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::Path;

    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowThreadProcessId,
    };

    /// Executable file name (e.g. `notepad.exe`) of the process owning the foreground window.
    pub fn foreground_process_name() -> Option<String> {
        // SAFETY: plain Win32 calls with valid, locally owned buffers and handles.
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
    pub fn foreground_process_name() -> Option<String> {
        None
    }

    pub fn running_process_names() -> Vec<String> {
        Vec::new()
    }

    pub fn request_fine_timer_resolution() {}
}

pub use platform::{foreground_process_name, request_fine_timer_resolution, running_process_names};
