//! Audio device control that has no keyboard shortcut equivalent: the microphone mute state.

use anyhow::Result;

/// Toggles the mute state of the default communication microphone. Returns the new state.
#[cfg(target_os = "windows")]
pub fn toggle_microphone_mute() -> Result<bool> {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eCapture, eCommunications, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    // SAFETY: standard Core Audio COM calls; every interface is released when dropped.
    unsafe {
        // The calling thread may already be initialised with another apartment model: that error
        // is harmless for what follows.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eCapture, eCommunications)?;
        let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;

        let muted = volume.GetMute()?.as_bool();
        volume.SetMute(!muted, std::ptr::null())?;
        Ok(!muted)
    }
}

#[cfg(not(target_os = "windows"))]
pub fn toggle_microphone_mute() -> Result<bool> {
    anyhow::bail!("microphone mute is only implemented on Windows")
}
