use std::path::PathBuf;
use std::{time, vec};

use anyhow::Result;
use copypasta::{ClipboardContext, ClipboardProvider};
use fastrand;
use rdev;
use tokio::sync::mpsc::UnboundedSender;
use url::Url;

use super::{audio, util};

/// Virtual-key codes of the media keys, which rdev has no named variant for.
const VK_MEDIA_NEXT_TRACK: u32 = 0xB0;
const VK_MEDIA_PREV_TRACK: u32 = 0xB1;
const VK_MEDIA_STOP: u32 = 0xB2;
const VK_MEDIA_PLAY_PAUSE: u32 = 0xB3;

/// How long the pasted text stays on the clipboard before the previous content is restored.
/// Applications read the clipboard when they process the paste shortcut, which takes a moment.
const PASTE_RESTORE_DELAY: time::Duration = time::Duration::from_millis(150);

// Frequently used keys within the code.
const COPY_HOTKEY: [rdev::Key; 2] = [rdev::Key::ControlLeft, rdev::Key::KeyC];
const PASTE_HOTKEY: [rdev::Key; 2] = [rdev::Key::ControlLeft, rdev::Key::KeyV];

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Hash, Eq)]
#[serde(tag = "type")]
pub enum DirectoryAction {
    File { data: PathBuf },
    Directory { data: PathBuf },
    Website { data: Url },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Hash, Eq)]
#[serde(tag = "type")]
/// Types of actions related to the OS to perform.
pub enum SystemAction {
    Open { action: DirectoryAction },
    Volume { action: VolumeAction },
    Clipboard { action: ClipboardAction },
    Media { action: MediaAction },
    /// Handled by `Macro::execute`, which has access to the macro library.
    Macro { action: MacroAction },
    /// Handled by `Macro::execute`, which can reach the backend.
    Collection { action: CollectionAction },
    /// Handled by `Macro::execute`, which queues it on the executor to keep ordering.
    Text { action: TextAction },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Hash, Eq)]
#[serde(tag = "type")]
/// Types text as keystrokes (Unicode key events), see `plugin::typing`.
pub enum TextAction {
    Type { data: String },
}

impl SystemAction {
    /// Execute the keys themselves.
    pub async fn execute(&self, send_channel: UnboundedSender<rdev::EventType>) -> Result<()> {
        match &self {
            SystemAction::Open { action } => match action {
                DirectoryAction::Directory { data } | DirectoryAction::File { data } => {
                    opener::open(data)?;
                }
                DirectoryAction::Website { data } => {
                    // The open_browser explicitly opens the path in a browser window.
                    opener::open_browser(data.as_str())?;
                }
            },
            SystemAction::Volume { action } => match action {
                VolumeAction::ToggleMute => {
                    util::direct_send_key(&send_channel, vec![rdev::Key::VolumeMute]).await?;
                }
                VolumeAction::LowerVolume => {
                    util::direct_send_key(&send_channel, vec![rdev::Key::VolumeDown]).await?;
                }
                VolumeAction::IncreaseVolume => {
                    util::direct_send_key(&send_channel, vec![rdev::Key::VolumeUp]).await?;
                }
                VolumeAction::ToggleMicrophoneMute => {
                    let muted = audio::toggle_microphone_mute()?;
                    log::info!("Microphone {}", if muted { "muted" } else { "unmuted" });
                }
            },
            SystemAction::Media { action } => {
                let code = match action {
                    MediaAction::NextTrack => VK_MEDIA_NEXT_TRACK,
                    MediaAction::PrevTrack => VK_MEDIA_PREV_TRACK,
                    MediaAction::StopTrack => VK_MEDIA_STOP,
                    MediaAction::PlayPauseTrack => VK_MEDIA_PLAY_PAUSE,
                };
                util::direct_send_key(&send_channel, vec![rdev::Key::Unknown(code)]).await?;
            }
            SystemAction::Macro { .. }
            | SystemAction::Collection { .. }
            | SystemAction::Text { .. } => {
                // Intercepted earlier by Macro::execute; nothing to do here.
            }
            SystemAction::Clipboard { action } => match action {
                ClipboardAction::SetClipboard { data } => {
                    ClipboardContext::new()
                        .map_err(|err| anyhow::Error::msg(err.to_string()))?
                        .set_contents(data.to_owned())
                        .map_err(|err| anyhow::Error::msg(err.to_string()))?;
                }
                ClipboardAction::Copy => {
                    util::direct_send_hotkey(&send_channel, COPY_HOTKEY.to_vec()).await?;
                }
                ClipboardAction::GetClipboard => {
                    ClipboardContext::new()
                        .map_err(|err| anyhow::Error::msg(err.to_string()))?
                        .get_contents()
                        .map_err(|err| anyhow::Error::msg(err.to_string()))?;
                }
                ClipboardAction::Paste => {
                    util::direct_send_hotkey(&send_channel, PASTE_HOTKEY.to_vec()).await?;
                }

                ClipboardAction::PasteUserDefinedString { data } => {
                    let mut ctx = ClipboardContext::new()
                        .map_err(|err| anyhow::Error::msg(err.to_string()))?;

                    // Keep whatever the user had on the clipboard; non-text content can't be
                    // preserved this way and is lost, as before.
                    let previous = ctx.get_contents().ok();

                    ctx.set_contents(data.to_owned())
                        .map_err(|err| anyhow::Error::msg(err.to_string()))?;

                    util::direct_send_hotkey(&send_channel, PASTE_HOTKEY.to_vec()).await?;

                    if let Some(previous) = previous {
                        tokio::time::sleep(PASTE_RESTORE_DELAY).await;
                        ctx.set_contents(previous)
                            .map_err(|err| anyhow::Error::msg(err.to_string()))?;
                    }
                }

                ClipboardAction::Sarcasm => {
                    let mut ctx = ClipboardContext::new()
                        .map_err(|err| anyhow::Error::msg(err.to_string()))?;

                    // Copy the text
                    util::direct_send_hotkey(&send_channel, COPY_HOTKEY.to_vec()).await?;

                    // Delay is required to make Discord, and some other apps cooperate properly.
                    tokio::time::sleep(time::Duration::from_millis(10)).await;

                    // Transform the text
                    let content = transform_text(
                        ctx.get_contents()
                            .map_err(|err| anyhow::Error::msg(err.to_string()))?,
                    );

                    ctx.set_contents(content)
                        .map_err(|err| anyhow::Error::msg(err.to_string()))?;

                    // Paste the text again
                    util::direct_send_hotkey(&send_channel, PASTE_HOTKEY.to_vec()).await?;
                }
            },
        }
        Ok(())
    }
}

/// Transforms the text into a sarcastic version.
fn transform_text(text: String) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii_alphabetic() && fastrand::bool() {
                if c.is_ascii_lowercase() {
                    c.to_ascii_uppercase()
                } else {
                    c.to_ascii_lowercase()
                }
            } else {
                c
            }
        })
        .collect()
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Hash, Eq)]
#[serde(tag = "type")]
/// The type of action to perform. This is used to determine which action to perform.
pub enum ClipboardAction {
    SetClipboard { data: String },
    Copy,
    GetClipboard,
    Paste,
    PasteUserDefinedString { data: String },
    Sarcasm,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Hash, Eq)]
#[serde(tag = "type")]
/// Key shortcut alias to mute/increase/decrease volume.
pub enum VolumeAction {
    LowerVolume,
    IncreaseVolume,
    ToggleMute,
    /// Mutes or unmutes the default communication microphone (Windows only).
    ToggleMicrophoneMute,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Hash, Eq)]
#[serde(tag = "type")]
/// Media player control keys.
pub enum MediaAction {
    NextTrack,
    PrevTrack,
    StopTrack,
    PlayPauseTrack,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Hash, Eq)]
#[serde(tag = "type")]
/// Runs another macro (by name) as part of this one.
pub enum MacroAction {
    Run { data: String },
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Hash, Eq)]
/// How a `CollectionAction` changes the collection's state.
pub enum CollectionMode {
    Enable,
    Disable,
    Toggle,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Hash, Eq)]
#[serde(tag = "type")]
/// Enables, disables or toggles a collection (by name).
pub enum CollectionAction {
    Enable { data: String },
    Disable { data: String },
    Toggle { data: String },
}

impl CollectionAction {
    pub fn name(&self) -> &str {
        match self {
            CollectionAction::Enable { data }
            | CollectionAction::Disable { data }
            | CollectionAction::Toggle { data } => data,
        }
    }

    pub fn mode(&self) -> CollectionMode {
        match self {
            CollectionAction::Enable { .. } => CollectionMode::Enable,
            CollectionAction::Disable { .. } => CollectionMode::Disable,
            CollectionAction::Toggle { .. } => CollectionMode::Toggle,
        }
    }
}
