#[cfg(not(debug_assertions))]
use std::path::PathBuf;
use std::collections::{HashMap as StdHashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::{thread, time};

use anyhow::{bail, Error, Result};
#[cfg(not(debug_assertions))]
use dirs;
use halfbrown::HashMap;
use itertools::Itertools;
use log::*;
use rayon::prelude::*;
use tokio::sync::mpsc::{UnboundedReceiver, UnboundedSender};
use tokio::sync::RwLock;
use tokio::task;

use config::{ApplicationConfig, ConfigFile};

// This has to be imported for release build
#[allow(unused_imports)]
use crate::config::CONFIG_DIR;
use crate::hid_table::*;
//Plugin imports
use crate::plugin::delay;
#[allow(unused_imports)]
use crate::plugin::discord;
use crate::plugin::key_press;
use crate::plugin::mouse;
#[allow(unused_imports)]
use crate::plugin::obs;
use crate::plugin::phillips_hue;
use crate::plugin::system_event;

pub mod config;
pub mod foreground;
mod hid_table;
pub mod plugin;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
/// Type of a macro, i.e. how the trigger drives its execution.
pub enum MacroType {
    /// The sequence plays once per trigger press.
    Single,
    /// One press starts repeating the sequence, the next press stops it.
    Toggle,
    /// The sequence repeats for as long as the trigger is held down.
    OnHold,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
/// This enum is the registry for all actions that can be executed.
pub enum ActionEventType {
    KeyPressEventAction {
        data: key_press::KeyPress,
    },
    SystemEventAction {
        data: system_event::SystemAction,
    },
    //Paste, Run commandline program (terminal run? standard user?), audio, open file-manager, workspace switch left, right,
    //IDEA: System event - notification
    PhillipsHueEventAction {
        data: phillips_hue::PhillipsHueStatus,
    },
    //IDEA: Phillips hue notification
    OBSEventAction {},

    DiscordEventAction {},
    //IDEA: IKEADesk
    MouseEventAction {
        data: mouse::MouseAction,
    },
    //IDEA: Sound effects? Soundboards?
    //IDEA: Sending a message through online webapi (twitch)
    DelayEventAction {
        data: delay::Delay,
    },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(tag = "type")]
/// This enum is the registry for all incoming actions that can be analyzed for macro execution.
///
/// ! **UNIMPLEMENTED** - Allow while other keys has not been implemented yet. This is WIP already.
pub enum TriggerEventType {
    KeyPressEvent {
        data: Vec<u32>,
        allow_while_other_keys: bool,
    },
    MouseEvent {
        data: mouse::MouseButton,
    },
    //IDEA: computer time (have timezone support?)
    //IDEA: computer temperature?
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
/// What happens to a quick tap of the trigger of an `OnHold` macro with a hold threshold.
pub enum TapMode {
    /// The press is held back until it is known to be a tap, then replayed as one synthetic tap.
    /// The OS never sees the trigger key held down; a tap arrives on release instead of on press.
    #[default]
    DeferredTap,
    /// The press reaches the OS immediately. Zero tap latency, but the OS sees the trigger key
    /// held for the threshold duration before the loop starts.
    PassThrough,
}

/// Default `Macro::hold_threshold_ms`.
pub const DEFAULT_HOLD_THRESHOLD_MS: u64 = 250;

fn default_hold_threshold_ms() -> u64 {
    DEFAULT_HOLD_THRESHOLD_MS
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
/// This is a macro struct. Includes all information a macro needs to run.
pub struct Macro {
    pub name: String,
    pub icon: String,
    pub sequence: Vec<ActionEventType>,
    pub macro_type: MacroType,
    pub trigger: TriggerEventType,
    pub active: bool,
    /// `OnHold` only: how long the trigger has to be held before the loop starts. Shorter presses
    /// are taps, see `tap_mode`. 0 starts the loop on press (taps are swallowed).
    #[serde(default = "default_hold_threshold_ms")]
    pub hold_threshold_ms: u64,
    /// `OnHold` only, see `TapMode`.
    #[serde(default)]
    pub tap_mode: TapMode,
    /// `Single`: how many times the sequence plays per trigger (default 1). `Toggle`: how many
    /// loops before it stops on its own (default: until triggered again). Ignored by `OnHold`.
    #[serde(default)]
    pub repeat_count: Option<u32>,
    /// Executable names (`game.exe`, case-insensitive). When not empty the macro only fires
    /// while one of them owns the foreground window, on top of its collection being active.
    #[serde(default)]
    pub linked_processes: Vec<String>,
}

impl Macro {
    /// Whether this macro may fire with the given application in the foreground.
    fn allowed_in_foreground(&self, process: Option<&str>) -> bool {
        if self.linked_processes.is_empty() {
            return true;
        }
        process.is_some_and(|process| {
            self.linked_processes
                .iter()
                .any(|linked| linked.trim().eq_ignore_ascii_case(process))
        })
    }
}

/// Deepest chain of macros calling macros that is followed before giving up.
const MAX_MACRO_CALL_DEPTH: u8 = 8;

impl Macro {
    /// This function is used to execute a macro. It is called by the macro checker.
    /// It spawns async tasks to execute said events specifically.
    /// Make sure to expand this if you implement new action types.
    ///
    /// `depth` counts nested macro calls, see `MAX_MACRO_CALL_DEPTH`.
    async fn execute(&self, context: &ExecutionContext, depth: u8) -> Result<()> {
        let send_channel = context.channel.clone();

        for action in &self.sequence {
            match action {
                ActionEventType::SystemEventAction {
                    data: system_event::SystemAction::Macro { action },
                } => {
                    let system_event::MacroAction::Run { data: name } = action;
                    if depth >= MAX_MACRO_CALL_DEPTH {
                        bail!(
                            "macro {:?} calls {:?} more than {} levels deep, stopping",
                            self.name,
                            name,
                            MAX_MACRO_CALL_DEPTH
                        );
                    }
                    let Some(target) = context.library.read().await.find_macro(name) else {
                        bail!("macro {:?} calls unknown macro {:?}", self.name, name);
                    };
                    debug!("Macro {:?} runs macro {:?}", self.name, target.name);
                    Box::pin(target.execute(context, depth + 1)).await?;
                }
                ActionEventType::SystemEventAction {
                    data: system_event::SystemAction::Text { action },
                } => {
                    let system_event::TextAction::Type { data: text } = action;
                    // Push and send under one lock so concurrent macros keep text/sentinel order.
                    let mut pending = lock_or_recover(&context.pending_text);
                    pending.push_back(text.clone());
                    send_channel.send(rdev::EventType::KeyPress(rdev::Key::Unknown(
                        TEXT_SENTINEL,
                    )))?;
                }
                ActionEventType::SystemEventAction {
                    data: system_event::SystemAction::Collection { action },
                } => {
                    context
                        .commands
                        .send(BackendCommand::SetCollectionActive {
                            name: action.name().to_string(),
                            mode: action.mode(),
                        })
                        .map_err(|_| Error::msg("backend command channel closed"))?;
                }
                ActionEventType::KeyPressEventAction { data } => match data.keytype {
                    key_press::KeyType::Down => {
                        // One key press down
                        send_channel
                            .send(rdev::EventType::KeyPress(SCANCODE_TO_RDEV[&data.keypress]))?;
                    }
                    key_press::KeyType::Up => {
                        // One key lift up
                        send_channel.send(rdev::EventType::KeyRelease(
                            SCANCODE_TO_RDEV[&data.keypress],
                        ))?;
                    }
                    key_press::KeyType::DownUp => {
                        // Key press
                        send_channel
                            .send(rdev::EventType::KeyPress(SCANCODE_TO_RDEV[&data.keypress]))?;

                        // Wait the set delay by user
                        tokio::time::sleep(time::Duration::from_millis(data.press_duration)).await;

                        // Lift the key
                        send_channel.send(rdev::EventType::KeyRelease(
                            SCANCODE_TO_RDEV[&data.keypress],
                        ))?;
                    }
                },
                ActionEventType::PhillipsHueEventAction { .. } => {}
                ActionEventType::OBSEventAction { .. } => {}
                ActionEventType::DiscordEventAction { .. } => {}
                ActionEventType::DelayEventAction { data } => {
                    tokio::time::sleep(time::Duration::from_millis(*data)).await;
                }

                ActionEventType::SystemEventAction { data } => {
                    let action_copy = data.clone();
                    let channel_copy = send_channel.clone();
                    task::spawn(async move { action_copy.execute(channel_copy).await });
                }
                ActionEventType::MouseEventAction { data } => {
                    // Awaited like a key press so a timed mouse press holds up the
                    // sequence; the timeline view relies on that.
                    data.execute(send_channel.clone()).await?;
                }
            }
        }
        Ok(())
    }

    /// Number of key and mouse events one run of the sequence hands to the executor.
    fn injected_event_count(&self) -> u64 {
        self.sequence
            .iter()
            .map(|action| match action {
                ActionEventType::KeyPressEventAction { data } => match data.keytype {
                    key_press::KeyType::DownUp => 2,
                    key_press::KeyType::Down | key_press::KeyType::Up => 1,
                },
                ActionEventType::MouseEventAction { .. } => 2,
                _ => 0,
            })
            .sum()
    }

    /// Lower bound for the duration of one iteration when this macro loops.
    ///
    /// Every event handed to the executor takes at least `STANDARD_KEYPRESS_DELAY` to reach the OS,
    /// so a sequence without delays must not be repeated faster than the executor can drain it, or
    /// events keep piling up in the channel and play on long after the trigger was released.
    fn min_loop_iteration(&self) -> time::Duration {
        time::Duration::from_millis(
            (self.injected_event_count() * delay::STANDARD_KEYPRESS_DELAY)
                .max(MIN_LOOP_ITERATION_DELAY),
        )
    }
}

/// Collections are groups of macros.
type Collections = Vec<Collection>;

/// Hashmap to check the first trigger key of each macro.
type MacroTriggerLookup = HashMap<u32, Vec<Macro>>;

/// Identity of a trigger. Used to track the macros that are currently looping (`OnHold` / `Toggle`).
///
/// Macros have no unique id and their names are user editable, but two active macros can't share
/// a trigger in practice, so the trigger itself is a stable key.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum TriggerKey {
    /// Sorted HID codes of a keyboard trigger.
    Keys(Vec<u32>),
    /// HID code of a mouse button trigger.
    Mouse(u32),
}

impl TriggerKey {
    /// Returns true if the given HID code is part of this trigger.
    fn contains(&self, hid: u32) -> bool {
        match self {
            TriggerKey::Keys(keys) => keys.contains(&hid),
            TriggerKey::Mouse(button) => *button == hid,
        }
    }
}

impl From<&TriggerEventType> for TriggerKey {
    fn from(trigger: &TriggerEventType) -> Self {
        match trigger {
            TriggerEventType::KeyPressEvent { data, .. } => {
                let mut keys = data.clone();
                keys.sort_unstable();
                keys.dedup();
                TriggerKey::Keys(keys)
            }
            TriggerEventType::MouseEvent { data } => TriggerKey::Mouse(data.into()),
        }
    }
}

/// Handle to a macro that is currently looping.
#[derive(Debug, Clone)]
pub struct LoopHandle {
    /// Cleared to stop the loop after its current iteration.
    running: Arc<AtomicBool>,
    /// Whether releasing any key of the trigger stops the loop (`OnHold`) or not (`Toggle`).
    stop_on_release: bool,
    /// Whether the release of `main_key` must be swallowed because the OS never saw its press
    /// (`OnHold` with `TapMode::DeferredTap`).
    swallow_release: bool,
    /// The trigger's main key, i.e. the last one of the combination.
    main_key: u32,
}

/// An `OnHold` trigger that was pressed and is waiting to turn out a tap or a hold.
#[derive(Debug, Clone)]
pub struct PendingHold {
    pressed_at: time::Instant,
    threshold: time::Duration,
    tap_mode: TapMode,
    /// Cleared when the press is resolved before the timer fires. Also identifies the timer.
    armed: Arc<AtomicBool>,
    main_key: u32,
    macros: Macro,
}

/// State of a trigger that has a looping macro in flight.
#[derive(Debug, Clone)]
pub enum TriggerState {
    Pending(PendingHold),
    Running(LoopHandle),
}

impl TriggerState {
    fn stop(&self) {
        match self {
            TriggerState::Pending(pending) => pending.armed.store(false, Ordering::Relaxed),
            TriggerState::Running(handle) => handle.running.store(false, Ordering::Relaxed),
        }
    }
}

type Registry = StdHashMap<TriggerKey, TriggerState>;

/// Macros currently pending or looping (`OnHold` or `Toggle`), keyed by trigger identity.
///
/// This is a plain mutex rather than the async `RwLock`: it is touched from the grab thread, from
/// async tasks and from synchronous Tauri commands, and it is never held across an await.
pub type RunningMacros = Arc<Mutex<Registry>>;

/// Duration of the synthetic tap replayed when a deferred press turns out to be a tap.
const TAP_REPLAY_DURATION: time::Duration = time::Duration::from_millis(30);

/// The key of a trigger whose release resolves a tap or a hold: the last key of a combination.
fn main_key_of(trigger: &TriggerEventType) -> u32 {
    match trigger {
        TriggerEventType::KeyPressEvent { data, .. } => data.last().copied().unwrap_or_default(),
        TriggerEventType::MouseEvent { data } => data.into(),
    }
}

/// Events the executor is about to inject into the OS (see `keypress_executor_sender`).
///
/// Injected events come back through the grab hook exactly like physical input, and `rdev` does
/// not flag them. Recognising them here keeps the macros' own output out of the pressed-key state:
/// otherwise a looping macro's key presses hide every other trigger (including the one that should
/// stop it) for the duration of each press, and a lifted modifier reads as the user releasing it.
type InjectedEvents = Arc<Mutex<Vec<rdev::EventType>>>;

/// Minimum duration of one loop iteration in milliseconds, see `Macro::min_loop_iteration`.
const MIN_LOOP_ITERATION_DELAY: u64 = 10;

/// Text waiting to be typed by the executor, see `TEXT_SENTINEL`.
type PendingText = Arc<Mutex<VecDeque<String>>>;

/// A key code that never comes from a keyboard. Sent through the executor channel as
/// `KeyPress(Key::Unknown(TEXT_SENTINEL))` right after pushing the text onto `PendingText`, so
/// typed text keeps its place among the key events of the sequence.
const TEXT_SENTINEL: u32 = 0xFFFF_FFF0;

/// How long a looping macro keeps injecting events without the grab hook seeing any of them
/// before it concludes the hook is gone and stops itself, see `spawn_macro_loop`.
const HOOK_STALL_TIMEOUT: time::Duration = time::Duration::from_secs(1);

/// Locks a mutex, recovering the data if another thread panicked while holding it.
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Something a macro asks the backend to do that needs the whole backend, not just the executor.
/// Processed by the host (`MacroBackend::take_command_receiver`), which can also tell the UI.
#[derive(Debug, Clone)]
pub enum BackendCommand {
    SetCollectionActive {
        name: String,
        mode: system_event::CollectionMode,
    },
    /// A macro started executing (for activity feedback in the UI).
    MacroFired { name: String },
    /// Macro output was toggled by the pause hotkey.
    ListeningChanged { listening: bool },
}

/// Everything the grab hook needs to start, stop and keep track of macro executions.
#[derive(Debug, Clone)]
struct ExecutionContext {
    /// Sender side of the executor channel, see `keypress_executor_sender`.
    channel: UnboundedSender<rdev::EventType>,
    /// All macros, for macros that call other macros.
    library: Arc<RwLock<MacroData>>,
    /// Requests for the backend host, see `BackendCommand`.
    commands: UnboundedSender<BackendCommand>,
    /// Executable name of the application owning the foreground window, as last reported.
    foreground: Arc<Mutex<Option<String>>>,
    /// Whether the hook thread answered the last supervisor check.
    hook_healthy: Arc<AtomicBool>,
    /// Text queued for the executor, see `TEXT_SENTINEL`.
    pending_text: PendingText,
    /// HID codes of the hotkey that toggles macro output, see `ApplicationConfig::pause_hotkey`.
    pause_hotkey: Arc<Mutex<Vec<u32>>>,
    running: RunningMacros,
    injected: InjectedEvents,
    is_listening: Arc<AtomicBool>,
    /// Counts every event the grab hook has seen, injected ones included. Looping macros use it
    /// as a liveness signal for the hook.
    hook_events: Arc<AtomicU64>,
}

/// A snapshot of the backend's health for the UI.
#[derive(Debug, Clone, serde::Serialize)]
pub struct BackendStatus {
    /// The hook thread answered the last supervisor check (always true before the first check).
    pub hook_healthy: bool,
    /// Events seen by the hook since start.
    pub hook_events: u64,
    /// Times the hook was re-installed.
    pub rehooks: u64,
    /// Executable name of the application owning the foreground window.
    pub foreground: Option<String>,
    /// Whether macros are processed at all (Disable Macro Output flips this).
    pub listening: bool,
}

/// State of the application in RAM (RWlock).
#[derive(Debug)]
pub struct MacroBackend {
    pub data: Arc<RwLock<MacroData>>,
    pub config: Arc<RwLock<ApplicationConfig>>,
    pub triggers: Arc<RwLock<MacroTriggerLookup>>,
    pub is_listening: Arc<AtomicBool>,
    pub running: RunningMacros,
    /// Executable name of the application owning the foreground window, as last reported.
    foreground: Arc<Mutex<Option<String>>>,
    command_sender: UnboundedSender<BackendCommand>,
    /// Taken once by the host with `take_command_receiver`.
    command_receiver: Mutex<Option<UnboundedReceiver<BackendCommand>>>,
    hook_events: Arc<AtomicU64>,
    hook_healthy: Arc<AtomicBool>,
    pause_hotkey: Arc<Mutex<Vec<u32>>>,
}

///MacroData is the main data structure that contains all macro data.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MacroData {
    pub data: Collections,
}

impl Default for MacroData {
    fn default() -> Self {
        MacroData {
            data: vec![Collection {
                name: "Collection 1".to_string(),
                icon: ":smile:".to_string(),
                macros: vec![],
                active: true,
                linked_processes: vec![],
            }],
        }
    }
}

impl MacroData {
    /// Extracts the first trigger data from the macros.
    pub fn extract_triggers(&self) -> Result<MacroTriggerLookup> {
        let mut output_hashmap = MacroTriggerLookup::new();

        for collections in &self.data {
            if collections.active {
                for macros in &collections.macros {
                    if macros.active {
                        match &macros.trigger {
                            TriggerEventType::KeyPressEvent { data, .. } => {
                                //TODO: optimize using references
                                match data.len() {
                                    0 => {
                                        bail!("a trigger key can't be zero, aborting trigger generation: {:#?}", data);
                                    }
                                    1 => {
                                        let first_data = match data.first() {
                                            Some(data) => *data,
                                            None => {
                                                return Err(Error::msg(
                                                    "Error getting first element in macro trigger",
                                                ));
                                            }
                                        };
                                        output_hashmap
                                            .entry(first_data)
                                            .or_default()
                                            .push(macros.clone())
                                    }
                                    _ => data[..data.len() - 1].iter().for_each(|x| {
                                        output_hashmap.entry(*x).or_default().push(macros.clone());
                                    }),
                                }
                            }
                            TriggerEventType::MouseEvent { data } => {
                                let data: u32 = data.into();

                                match output_hashmap.get_mut(&data) {
                                    Some(value) => value.push(macros.clone()),
                                    None => {
                                        output_hashmap.insert_nocheck(data, vec![macros.clone()])
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(output_hashmap)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
/// Collection struct that defines what a group of macros looks like and what properties it carries
pub struct Collection {
    pub name: String,
    pub icon: String,
    pub macros: Vec<Macro>,
    pub active: bool,
    /// Executable names (`game.exe`, case-insensitive). When not empty the collection is armed
    /// only while one of them owns the foreground window and `active` is managed automatically.
    #[serde(default)]
    pub linked_processes: Vec<String>,
}

impl Collection {
    /// Whether this collection's `active` flag is driven by the foreground application.
    pub fn is_linked(&self) -> bool {
        !self.linked_processes.is_empty()
    }

    fn is_linked_to(&self, process: &str) -> bool {
        self.linked_processes
            .iter()
            .any(|linked| linked.trim().eq_ignore_ascii_case(process))
    }
}

impl MacroData {
    /// Finds a macro by name (case-insensitive), in any collection. The first match wins.
    pub fn find_macro(&self, name: &str) -> Option<Macro> {
        let name = name.trim();
        self.data
            .iter()
            .flat_map(|collection| collection.macros.iter())
            .find(|macros| macros.name.trim().eq_ignore_ascii_case(name))
            .cloned()
    }

    /// Enables, disables or toggles the collection with the given name (case-insensitive).
    /// Returns whether the state changed. Collections linked to applications are left alone.
    pub fn set_collection_active(&mut self, name: &str, mode: system_event::CollectionMode) -> bool {
        let name = name.trim();
        let Some(collection) = self
            .data
            .iter_mut()
            .find(|collection| collection.name.trim().eq_ignore_ascii_case(name))
        else {
            warn!("No collection named {:?} to {:?}", name, mode);
            return false;
        };
        if collection.is_linked() {
            warn!(
                "Collection {:?} is controlled by its linked applications, ignoring {:?}",
                collection.name, mode
            );
            return false;
        }
        let active = match mode {
            system_event::CollectionMode::Enable => true,
            system_event::CollectionMode::Disable => false,
            system_event::CollectionMode::Toggle => !collection.active,
        };
        if collection.active == active {
            return false;
        }
        info!(
            "Collection {:?} {} by a macro",
            collection.name,
            if active { "enabled" } else { "disabled" }
        );
        collection.active = active;
        true
    }

    /// Arms every linked collection whose application is in the foreground and disarms the other
    /// linked ones. Returns true if any collection changed state.
    pub fn apply_foreground_process(&mut self, process: Option<&str>) -> bool {
        let mut changed = false;
        for collection in &mut self.data {
            if !collection.is_linked() {
                continue;
            }
            let should_be_active = process.is_some_and(|process| collection.is_linked_to(process));
            if collection.active != should_be_active {
                info!(
                    "Collection {:?} {} (foreground: {:?})",
                    collection.name,
                    if should_be_active { "armed" } else { "disarmed" },
                    process
                );
                collection.active = should_be_active;
                changed = true;
            }
        }
        changed
    }
}

/// Executes a given macro (according to its type).
///
/// Runs synchronously on the grab thread so that looping macros are registered in event order:
/// the release that stops an `OnHold` macro can never overtake the press that started it.
fn execute_macro(macros: Macro, context: &ExecutionContext) {
    match macros.macro_type {
        MacroType::Single => {
            info!("\nEXECUTING A SINGLE MACRO: {:#?}", macros.name);

            let context = context.clone();

            task::spawn(async move {
                let repeats = macros.repeat_count.unwrap_or(1).max(1);
                for _ in 0..repeats {
                    if let Err(error) = macros.execute(&context, 0).await {
                        error!("error executing macro: {}", error);
                        break;
                    }
                }
            });
        }
        MacroType::Toggle => {
            let trigger = TriggerKey::from(&macros.trigger);

            let flag = {
                let mut running = lock_or_recover(&context.running);

                if let Some(state) = running.remove(&trigger) {
                    info!("\nSTOPPING A TOGGLE MACRO: {:#?}", macros.name);
                    state.stop();
                    return;
                }

                info!("\nSTARTING A TOGGLE MACRO: {:#?}", macros.name);
                let flag = Arc::new(AtomicBool::new(true));
                running.insert(
                    trigger.clone(),
                    TriggerState::Running(LoopHandle {
                        running: flag.clone(),
                        stop_on_release: false,
                        swallow_release: false,
                        main_key: main_key_of(&macros.trigger),
                    }),
                );
                flag
            };

            spawn_macro_loop(macros, trigger, flag, context);
        }
        MacroType::OnHold => {
            let trigger = TriggerKey::from(&macros.trigger);
            let mut running = lock_or_recover(&context.running);

            // The OS auto-repeats a held trigger key, which re-matches the macro: ignore it.
            if running.contains_key(&trigger) {
                trace!(
                    "on-hold macro {:?} is already pending or running, ignoring re-trigger",
                    macros.name
                );
                return;
            }

            if macros.hold_threshold_ms == 0 {
                info!("\nSTARTING AN ON-HOLD MACRO: {:#?}", macros.name);
                start_on_hold_loop(&mut running, macros, trigger, false, context);
                return;
            }

            debug!(
                "Waiting {} ms to see whether {:?} is tapped or held",
                macros.hold_threshold_ms, macros.name
            );
            let armed = Arc::new(AtomicBool::new(true));
            let threshold = time::Duration::from_millis(macros.hold_threshold_ms);
            running.insert(
                trigger.clone(),
                TriggerState::Pending(PendingHold {
                    pressed_at: time::Instant::now(),
                    threshold,
                    tap_mode: macros.tap_mode,
                    armed: armed.clone(),
                    main_key: main_key_of(&macros.trigger),
                    macros,
                }),
            );
            spawn_hold_timer(trigger, armed, threshold, context);
        }
    }
}

/// Lifts the modifiers of a multi-key trigger so the sequence is not typed with them held.
fn lift_trigger_modifiers(macros: &Macro, context: &ExecutionContext) {
    if let TriggerEventType::KeyPressEvent { data, .. } = &macros.trigger {
        // A single key can't be a modifier, so there is nothing to lift for those.
        if data.len() > 1 {
            // This releases any trigger keys that have been held to make macros more reliable when used with modifier hotkeys.
            plugin::util::lift_keys(data, &context.channel)
                .unwrap_or_else(|err| error!("Error lifting keys: {}", err));
        }
    }
}

/// Registers an on-hold macro as running and starts its loop. Takes the locked registry so the
/// transition is atomic with respect to the release that will stop it.
fn start_on_hold_loop(
    running: &mut Registry,
    macros: Macro,
    trigger: TriggerKey,
    swallow_release: bool,
    context: &ExecutionContext,
) {
    lift_trigger_modifiers(&macros, context);

    let flag = Arc::new(AtomicBool::new(true));
    running.insert(
        trigger.clone(),
        TriggerState::Running(LoopHandle {
            running: flag.clone(),
            stop_on_release: true,
            swallow_release,
            main_key: main_key_of(&macros.trigger),
        }),
    );
    spawn_macro_loop(macros, trigger, flag, context);
}

/// Starts the loop of a pending on-hold macro once the hold threshold has elapsed, unless the
/// press was resolved (released, or discarded) in the meantime.
fn spawn_hold_timer(
    trigger: TriggerKey,
    armed: Arc<AtomicBool>,
    threshold: time::Duration,
    context: &ExecutionContext,
) {
    let context = context.clone();

    task::spawn(async move {
        tokio::time::sleep(threshold).await;

        let mut running = lock_or_recover(&context.running);

        let is_still_ours = matches!(
            running.get(&trigger),
            Some(TriggerState::Pending(pending))
                if Arc::ptr_eq(&pending.armed, &armed) && armed.load(Ordering::Relaxed)
        );
        if !is_still_ours {
            return;
        }

        let Some(TriggerState::Pending(pending)) = running.remove(&trigger) else {
            return;
        };

        info!(
            "\nSTARTING AN ON-HOLD MACRO after a {} ms hold: {:#?}",
            pending.threshold.as_millis(),
            pending.macros.name
        );
        let swallow_release = pending.tap_mode == TapMode::DeferredTap;
        start_on_hold_loop(&mut running, pending.macros, trigger, swallow_release, &context);
    });
}

/// Plays the sequence once (a hold that ended before its loop could start).
fn run_once(macros: Macro, context: &ExecutionContext) {
    lift_trigger_modifiers(&macros, context);

    let context = context.clone();
    task::spawn(async move {
        if let Err(error) = macros.execute(&context, 0).await {
            error!("error executing macro: {}", error);
        }
    });
}

/// Replays a deferred trigger press as one synthetic tap, so a tap still reaches the OS.
fn replay_tap(main_key: u32, context: &ExecutionContext) {
    let (press, release) = if let Some(key) = SCANCODE_TO_RDEV.get(&main_key) {
        (rdev::EventType::KeyPress(*key), rdev::EventType::KeyRelease(*key))
    } else if let Some(button) = BUTTON_TO_HID
        .iter()
        .find(|(_, hid)| **hid == main_key)
        .map(|(button, _)| *button)
    {
        // The left button is never grabbed (see the grab hook), so its press already went through.
        if button == rdev::Button::Left {
            return;
        }
        (
            rdev::EventType::ButtonPress(button),
            rdev::EventType::ButtonRelease(button),
        )
    } else {
        warn!("Can't replay a tap of unknown trigger key {:#x}", main_key);
        return;
    };

    let channel = context.channel.clone();
    task::spawn(async move {
        if channel.send(press).is_err() {
            error!("error replaying a tap: executor channel closed");
            return;
        }
        tokio::time::sleep(TAP_REPLAY_DURATION).await;
        if channel.send(release).is_err() {
            error!("error replaying a tap: executor channel closed");
        }
    });
}

/// Spawns a task that repeats the macro until `flag` is cleared or the backend stops listening,
/// then removes its registry entry (unless a newer loop already took over the trigger).
///
/// The events a macro injects come back through the grab hook, so a hook that stops seeing events
/// while the loop keeps injecting them is dead (Windows silently removes low-level hooks that stop
/// responding). The release that should end the loop would never arrive, so the loop stops itself.
fn spawn_macro_loop(
    macros: Macro,
    trigger: TriggerKey,
    flag: Arc<AtomicBool>,
    context: &ExecutionContext,
) {
    let context = context.clone();
    let running = context.running.clone();
    let is_listening = context.is_listening.clone();
    let hook_events = context.hook_events.clone();

    task::spawn(async move {
        let min_iteration = macros.min_loop_iteration();
        let injects_events = macros.injected_event_count() > 0;
        // A toggle can be limited to a number of loops; on-hold always runs until released.
        let max_iterations: Option<u64> = match macros.macro_type {
            MacroType::Toggle => macros.repeat_count.filter(|n| *n > 0).map(u64::from),
            _ => None,
        };
        let mut iterations: u64 = 0;
        let mut hook_stalled_since: Option<time::Instant> = None;

        while flag.load(Ordering::Relaxed)
            && is_listening.load(Ordering::Relaxed)
            && max_iterations.is_none_or(|max| iterations < max)
        {
            let started = time::Instant::now();
            let hook_events_before = hook_events.load(Ordering::Relaxed);

            if let Err(error) = macros.execute(&context, 0).await {
                error!("error executing looping macro: {}", error);
                break;
            }
            iterations += 1;

            if injects_events {
                if hook_events.load(Ordering::Relaxed) == hook_events_before {
                    let since = *hook_stalled_since.get_or_insert(started);
                    if since.elapsed() >= HOOK_STALL_TIMEOUT {
                        warn!(
                            "The input hook stopped seeing events, stopping looping macro {:?}",
                            macros.name
                        );
                        break;
                    }
                } else {
                    hook_stalled_since = None;
                }
            }

            if let Some(remaining) = min_iteration.checked_sub(started.elapsed()) {
                if flag.load(Ordering::Relaxed) {
                    tokio::time::sleep(remaining).await;
                }
            }
        }

        info!(
            "Macro {:?} stopped looping after {} iterations",
            macros.name, iterations
        );

        let mut running = lock_or_recover(&running);
        let is_own_entry = matches!(
            running.get(&trigger),
            Some(TriggerState::Running(handle)) if Arc::ptr_eq(&handle.running, &flag)
        );
        if is_own_entry {
            running.remove(&trigger);
        }
    });
}

/// Handles the release of a key or button for every trigger that contains it: a pending on-hold
/// press resolves to a tap or a hold, a running on-hold loop stops.
///
/// Returns true if the release must be swallowed because the OS never saw the matching press.
///
/// Runs on the grab thread for every key and button release system-wide, so it has to stay cheap.
fn on_trigger_release(context: &ExecutionContext, released_hid: u32) -> bool {
    let mut swallow = false;
    let mut running = lock_or_recover(&context.running);

    let affected: Vec<TriggerKey> = running
        .keys()
        .filter(|trigger| trigger.contains(released_hid))
        .cloned()
        .collect();

    for trigger in affected {
        match running.remove(&trigger) {
            Some(TriggerState::Pending(pending)) => {
                pending.armed.store(false, Ordering::Relaxed);
                let held_for = pending.pressed_at.elapsed();

                if held_for >= pending.threshold {
                    // Held past the threshold, released before the timer got to run: still a
                    // hold, so play the sequence once.
                    debug!(
                        "{:?} held {} ms, playing once",
                        pending.macros.name,
                        held_for.as_millis()
                    );
                    run_once(pending.macros, context);
                } else if pending.tap_mode == TapMode::DeferredTap {
                    debug!(
                        "{:?} released after {} ms, replaying the tap",
                        pending.macros.name,
                        held_for.as_millis()
                    );
                    replay_tap(pending.main_key, context);
                }

                if pending.tap_mode == TapMode::DeferredTap && released_hid == pending.main_key {
                    swallow = true;
                }
            }
            Some(TriggerState::Running(handle)) => {
                if handle.stop_on_release {
                    debug!(
                        "Stopping on-hold macro {:?} on release of {:#x}",
                        trigger, released_hid
                    );
                    handle.running.store(false, Ordering::Relaxed);
                    if handle.swallow_release && released_hid == handle.main_key {
                        swallow = true;
                    }
                } else {
                    // A toggle keeps looping through releases.
                    running.insert(trigger, TriggerState::Running(handle));
                }
            }
            None => {}
        }
    }

    swallow
}

/// Returns true if a pending or looping macro is triggered by the given key.
fn is_looping_trigger(context: &ExecutionContext, hid: u32) -> bool {
    lock_or_recover(&context.running)
        .keys()
        .any(|trigger| trigger.contains(hid))
}

/// Receives and executes a macro based on the trigger event.
/// Puts a mandatory 0-20 ms delay between each macro execution (depending on the platform).
///
/// Every event is announced in `injected` before it is sent so the grab hook, which sees it
/// synchronously while it is being sent, can tell it apart from physical input.
fn keypress_executor_sender(
    mut rchan_execute: UnboundedReceiver<rdev::EventType>,
    injected: InjectedEvents,
    pending_text: PendingText,
) {
    loop {
        let received_event = match &rchan_execute.blocking_recv() {
            Some(event) => *event,
            None => {
                error!("Failed to receive an event!");
                continue;
            }
        };

        if received_event == rdev::EventType::KeyPress(rdev::Key::Unknown(TEXT_SENTINEL)) {
            let text = lock_or_recover(&pending_text).pop_front();
            match text {
                Some(text) => plugin::typing::type_text(&text)
                    .unwrap_or_else(|err| error!("Error typing text: {}", err)),
                None => warn!("Text sentinel without pending text"),
            }
            continue;
        }

        lock_or_recover(&injected).push(received_event);

        plugin::util::direct_send_event(&received_event)
            .unwrap_or_else(|err| error!("Error directly sending an event to keyboard: {}", err));

        // The hook consumes the announcement while the event is sent. If it is still there the hook
        // never saw the event (it is gone, or the send failed): drop it so the list can't grow.
        {
            let mut injected = lock_or_recover(&injected);
            if let Some(position) = injected.iter().position(|event| *event == received_event) {
                injected.swap_remove(position);
            }
        }

        //Every OS requires a delay so the OS can catch up.
        thread::sleep(time::Duration::from_millis(delay::STANDARD_KEYPRESS_DELAY));
    }
}

/// A more efficient way using hashtable to check whether the trigger keys match the macro.
///
/// `pressed_events` - the keys pressed in HID format (use the conversion HID hashtable to get the number).
///
/// `trigger_overview` - Macros that need to be checked. Should be picked by matching the hashtable of triggers, and those should be checked here.
///
/// `context` - channel and shared state needed to execute the matched macros.
///
/// `is_repeat` - whether the press is an OS auto-repeat of a key that is already held down.
///
/// Returns true if the event should be grabbed (swallowed from the OS).
fn check_macro_execution_efficiently(
    pressed_events: Vec<u32>,
    trigger_overview: Vec<Macro>,
    context: &ExecutionContext,
    is_repeat: bool,
) -> bool {
    trace!("Got data: {:?}", trigger_overview);
    trace!("Got keys: {:?}", pressed_events);

    let mut output = false;
    for macros in &trigger_overview {
        let matched = match &macros.trigger {
            TriggerEventType::KeyPressEvent {
                data,
                allow_while_other_keys,
            } => match data.len() {
                // Strict: the trigger key is the only key down. Relaxed: the trigger key is
                // the one just pressed, whatever else is held (Shift, W while moving, ...).
                1 if *allow_while_other_keys => pressed_events.last() == data.first(),
                1 => pressed_events == *data,
                // This check makes sure the modifier keys (up to 3 keys in each trigger) can be of any order, and ensures the last key must match to the proper one.
                2..=4 => {
                    data[..(data.len() - 1)]
                        .iter()
                        .all(|x| pressed_events[..(pressed_events.len() - 1)].contains(x))
                        && pressed_events[pressed_events.len() - 1] == data[data.len() - 1]
                }
                _ => false,
            },
            TriggerEventType::MouseEvent { data } => {
                let event_to_check: Vec<u32> = vec![data.into()];

                trace!(
                    "CheckMacroExec: Converted mouse buttons to vec<u32>\n {:#?}",
                    event_to_check
                );

                event_to_check == pressed_events
            }
        };

        if !matched {
            continue;
        }

        // A macro scoped to applications stays inert (and lets the key through) elsewhere.
        if !macros.linked_processes.is_empty() {
            let foreground = lock_or_recover(&context.foreground).clone();
            if !macros.allowed_in_foreground(foreground.as_deref()) {
                trace!(
                    "Macro {:?} is scoped to {:?}, foreground is {:?}: ignoring",
                    macros.name, macros.linked_processes, foreground
                );
                continue;
            }
        }

        debug!("MATCHED MACRO {:?}: {:#?}", macros.macro_type, pressed_events);

        // A gated on-hold macro in pass-through mode lets the physical press reach the OS.
        let passes_press = macros.macro_type == MacroType::OnHold
            && macros.hold_threshold_ms > 0
            && macros.tap_mode == TapMode::PassThrough;
        output |= !passes_press;

        // Looping macro types act on the first press only: the OS auto-repeat of a held trigger
        // must neither restart an on-hold loop nor flip a toggle. The repeat is still grabbed.
        if is_repeat && macros.macro_type != MacroType::Single {
            trace!("Ignoring auto-repeat for macro {:?}", macros.name);
            continue;
        }

        // On-hold macros lift their modifiers once the hold is confirmed, see start_on_hold_loop.
        if macros.macro_type != MacroType::OnHold {
            lift_trigger_modifiers(macros, context);
        }

        let _ = context.commands.send(BackendCommand::MacroFired {
            name: macros.name.clone(),
        });
        execute_macro(macros.clone(), context);
    }

    output
}

#[derive(Debug, Clone, Default)]
struct KeysPressed(Arc<RwLock<Vec<rdev::Key>>>);

impl MacroBackend {
    /// Creates the data directory if not present in %appdata% (only in release build).
    pub fn generate_directories() -> Result<()> {
        #[cfg(not(debug_assertions))]
        {
            let conf_dir: Result<PathBuf> = match dirs::config_dir() {
                Some(config_path) => Ok(config_path),
                None => Err(anyhow::Error::msg(
                    "Cannot find config directory, cannot proceed.",
                )),
            };

            let conf_dir = conf_dir?.join(CONFIG_DIR);

            std::fs::create_dir_all(conf_dir.as_path())?;
        }
        Ok(())
    }

    /// Sets whether the backend should process keys that it listens to. Disabling disables the processing logic, but the app still grabs the keys.
    pub fn set_is_listening(&self, is_listening: bool) {
        self.is_listening.store(is_listening, Ordering::Relaxed);
        if !is_listening {
            self.stop_all_loops();
        }
    }

    /// Stops every pending or looping (`OnHold` / `Toggle`) macro after its current iteration.
    pub fn stop_all_loops(&self) {
        let mut running = lock_or_recover(&self.running);
        for state in running.values() {
            state.stop();
        }
        running.clear();
    }

    /// Stops the pending or looping macros whose trigger is no longer that of an active looping
    /// macro in the given lookup: they were edited, deactivated, deleted or their collection was
    /// disarmed.
    fn stop_loops_not_in(&self, triggers: &MacroTriggerLookup) {
        let looping: HashSet<TriggerKey> = triggers
            .values()
            .flatten()
            .filter(|macros| macros.macro_type != MacroType::Single)
            .map(|macros| TriggerKey::from(&macros.trigger))
            .collect();

        let mut running = lock_or_recover(&self.running);
        running.retain(|trigger, state| {
            let keep = looping.contains(trigger);
            if !keep {
                debug!("Stopping loop of trigger {:?}: no longer active", trigger);
                state.stop();
            }
            keep
        });
    }

    /// Sets the macros from the frontend to the files. This function is here to completely split the frontend off.
    ///
    /// Linked collections are armed or disarmed for the current foreground application first.
    /// Returns the data if that changed it, so the frontend can be told.
    pub async fn set_macros(&self, mut macros: MacroData) -> Result<Option<MacroData>> {
        let foreground = lock_or_recover(&self.foreground).clone();
        let adjusted = macros.apply_foreground_process(foreground.as_deref());

        macros.write_to_file()?;
        let triggers = macros.extract_triggers()?;
        // The macros just changed under any loop that is running: a looping macro may have been
        // edited, deactivated or deleted.
        self.stop_loops_not_in(&triggers);
        *self.triggers.write().await = triggers;
        *self.data.write().await = macros.clone();

        Ok(adjusted.then_some(macros))
    }

    /// Hands the receiving end of the macro command channel to the host. Can be taken once.
    pub fn take_command_receiver(&self) -> Option<UnboundedReceiver<BackendCommand>> {
        lock_or_recover(&self.command_receiver).take()
    }

    /// Health snapshot for the UI.
    pub fn status(&self) -> BackendStatus {
        BackendStatus {
            hook_healthy: self.hook_healthy.load(Ordering::Relaxed),
            hook_events: self.hook_events.load(Ordering::Relaxed),
            rehooks: rdev::rehook_count(),
            foreground: lock_or_recover(&self.foreground).clone(),
            listening: self.is_listening.load(Ordering::Relaxed),
        }
    }

    /// Enables, disables or toggles a collection on behalf of a macro. Returns the data if the
    /// state changed, so the frontend can be told.
    pub async fn set_collection_active(
        &self,
        name: &str,
        mode: system_event::CollectionMode,
    ) -> Result<Option<MacroData>> {
        let mut data = self.data.write().await;
        if !data.set_collection_active(name, mode) {
            return Ok(None);
        }

        data.write_to_file()?;
        let triggers = data.extract_triggers()?;
        self.stop_loops_not_in(&triggers);
        *self.triggers.write().await = triggers;

        Ok(Some(data.clone()))
    }

    /// Reports which application owns the foreground window (`None` if unknown) and arms or
    /// disarms the collections linked to applications accordingly.
    ///
    /// Returns the data if any collection changed state, so the frontend can be told.
    pub async fn set_foreground_process(&self, process: Option<String>) -> Result<Option<MacroData>> {
        *lock_or_recover(&self.foreground) = process.clone();

        let mut data = self.data.write().await;
        if !data.apply_foreground_process(process.as_deref()) {
            return Ok(None);
        }

        let triggers = data.extract_triggers()?;
        self.stop_loops_not_in(&triggers);
        *self.triggers.write().await = triggers;

        Ok(Some(data.clone()))
    }

    /// Sets the config from the frontend to the files. This function is here to completely split the frontend off.
    pub async fn set_config(&self, config: ApplicationConfig) -> Result<()> {
        config.write_to_file()?;
        *lock_or_recover(&self.pause_hotkey) = config.pause_hotkey.clone();
        *self.config.write().await = config;
        Ok(())
    }

    /// Initializes the entire backend and gets the whole grabbing system running.
    pub async fn init(&self) -> Result<()> {
        //? : io-uring async read files and write files
        //TODO: implement drop when the application ends to clean up the downed keys

        //==================================================

        foreground::request_fine_timer_resolution();

        let inner_triggers = self.triggers.clone();

        // Spawn the channels
        let (schan_execute, rchan_execute) = tokio::sync::mpsc::unbounded_channel();

        let context = ExecutionContext {
            channel: schan_execute,
            library: self.data.clone(),
            commands: self.command_sender.clone(),
            running: self.running.clone(),
            injected: InjectedEvents::default(),
            is_listening: self.is_listening.clone(),
            foreground: self.foreground.clone(),
            hook_healthy: self.hook_healthy.clone(),
            hook_events: self.hook_events.clone(),
            pending_text: PendingText::default(),
            pause_hotkey: self.pause_hotkey.clone(),
        };
        *lock_or_recover(&self.pause_hotkey) = self.config.read().await.pause_hotkey.clone();

        // Create the executor
        let executor_injected = context.injected.clone();
        let executor_text = context.pending_text.clone();
        thread::spawn(move || {
            keypress_executor_sender(rchan_execute, executor_injected, executor_text);
        });

        spawn_grab_thread(&context, &inner_triggers);
        spawn_hook_supervisor(context, inner_triggers);

        Err(anyhow::Error::msg("Error in grabbing thread!"))
    }
}

/// How often the supervisor asks the hook thread to re-install its hooks (Windows silently
/// removes low-level hooks that stopped responding, e.g. across a lock screen, see issue #228).
const HOOK_REHOOK_INTERVAL: time::Duration = time::Duration::from_secs(10);
/// How long the hook thread gets to acknowledge a re-hook before it is considered stuck.
const HOOK_ACK_TIMEOUT: time::Duration = time::Duration::from_secs(2);

/// Starts a thread running the input hook with a fresh callback.
fn spawn_grab_thread(context: &ExecutionContext, triggers: &Arc<RwLock<MacroTriggerLookup>>) {
    let callback = grab_callback(context.clone(), triggers.clone());

    // The callback spawns tasks, so the thread has to belong to the runtime.
    task::spawn_blocking(move || {
        if let Err(error) = rdev::grab(callback) {
            error!("Input hook stopped: {:?}", error);
        }
    });
}

/// Keeps the input hook alive: periodically re-installs it, and replaces the hook thread if it
/// stops responding.
fn spawn_hook_supervisor(context: ExecutionContext, triggers: Arc<RwLock<MacroTriggerLookup>>) {
    if !cfg!(target_os = "windows") {
        return;
    }

    task::spawn(async move {
        loop {
            tokio::time::sleep(HOOK_REHOOK_INTERVAL).await;

            // Re-installing while a trigger is held could lose its release: wait for quiet.
            if !lock_or_recover(&context.running).is_empty() {
                continue;
            }

            let before = rdev::rehook_count();
            let requested = rdev::request_rehook();
            if requested {
                tokio::time::sleep(HOOK_ACK_TIMEOUT).await;
            }

            if !requested || rdev::rehook_count() == before {
                warn!("The input hook thread is not responding, starting a new one");
                context.hook_healthy.store(false, Ordering::Relaxed);
                rdev::unhook();
                spawn_grab_thread(&context, &triggers);
            } else {
                context.hook_healthy.store(true, Ordering::Relaxed);
                debug!("Input hook re-installed");
            }
        }
    });
}

/// Builds the grab hook callback: the whole input processing pipeline.
fn grab_callback(
    context: ExecutionContext,
    inner_triggers: Arc<RwLock<MacroTriggerLookup>>,
) -> impl Fn(rdev::Event) -> Option<rdev::Event> {
    let keys_pressed: KeysPressed = KeysPressed::default();

    move |event: rdev::Event| {
                context.hook_events.fetch_add(1, Ordering::Relaxed);

                // Our own output (stamped by the rdev fork): let it through untouched, it is
                // neither a trigger nor a release.
                if event.injected {
                    trace!("Passing through injected event {:?}", event.event_type);
                    return Some(event);
                }

                // Same, for platforms where rdev can't stamp its output.
                {
                    let mut injected = lock_or_recover(&context.injected);
                    if let Some(position) = injected.iter().position(|e| *e == event.event_type) {
                        injected.swap_remove(position);
                        trace!("Passing through injected event {:?}", event.event_type);
                        return Some(event);
                    }
                }

                // The pause hotkey works whether macros are on or off, so it is checked before
                // the listening gate. Only the first press counts, not the auto-repeats.
                if let rdev::EventType::KeyPress(key) = event.event_type {
                    let hotkey = lock_or_recover(&context.pause_hotkey).clone();
                    if !hotkey.is_empty() {
                        let mut keys_pressed = keys_pressed.0.blocking_write();
                        let is_repeat = keys_pressed.contains(&key);
                        if !keys_pressed.contains(&key) {
                            keys_pressed.push(key);
                        }
                        let mut held: Vec<u32> = keys_pressed
                            .iter()
                            .map(|x| *SCANCODE_TO_HID.get(x).unwrap_or(&0))
                            .collect();
                        drop(keys_pressed);
                        held.sort_unstable();
                        let mut wanted = hotkey.clone();
                        wanted.sort_unstable();
                        if held == wanted {
                            if !is_repeat {
                                let listening = !context.is_listening.load(Ordering::Relaxed);
                                context.is_listening.store(listening, Ordering::Relaxed);
                                info!(
                                    "Pause hotkey: macro output {}",
                                    if listening { "enabled" } else { "disabled" }
                                );
                                let _ = context
                                    .commands
                                    .send(BackendCommand::ListeningChanged { listening });
                            }
                            return None;
                        }
                    }
                }

                if context.is_listening.load(Ordering::Relaxed) {
                    match event.event_type {
                        rdev::EventType::KeyPress(key) => {
                            debug!("Key Pressed RAW: {:?}", key);
                            let key_to_push = key;
                            let key_hid = *SCANCODE_TO_HID.get(&key).unwrap_or(&0);

                            let (is_repeat, pressed_keys_copy_converted): (bool, Vec<u32>) = {
                                let mut keys_pressed = keys_pressed.0.blocking_write();

                                // The OS auto-repeats a held key as further presses.
                                let is_repeat = keys_pressed.contains(&key_to_push);

                                keys_pressed.push(key_to_push);

                                *keys_pressed = keys_pressed.clone().into_iter().unique().collect();

                                let converted = keys_pressed
                                    .iter()
                                    .map(|x| *SCANCODE_TO_HID.get(x).unwrap_or(&0))
                                    // A held trigger of a running on-hold macro must not get in
                                    // the way of other triggers pressed while it is held.
                                    .filter(|hid| {
                                        *hid == key_hid || !is_looping_trigger(&context, *hid)
                                    })
                                    .collect();

                                (is_repeat, converted)
                            };

                            // A held trigger of a looping macro keeps auto-repeating: swallow the
                            // repeats outright so they can't leak to the focused application.
                            if is_repeat && is_looping_trigger(&context, key_hid) {
                                trace!("Swallowing auto-repeat of looping trigger {:?}", key);
                                return None;
                            }

                            debug!(
                                "Pressed Keys CONVERTED TO HID:  {:?}",
                                pressed_keys_copy_converted
                            );
                            debug!(
                                "Pressed Keys CONVERTED TO RDEV: {:?}",
                                pressed_keys_copy_converted
                                    .par_iter()
                                    .map(|x| *SCANCODE_TO_RDEV
                                        .get(x)
                                        .unwrap_or(&rdev::Key::Unknown(0)))
                                    .collect::<Vec<rdev::Key>>()
                            );

                            // Candidates are indexed by their first trigger key. Look them up
                            // by every held key so a trigger still matches with other keys down
                            // (multi-key triggers are indexed under each modifier).
                            let check_these_macros: Vec<Macro> = {
                                let trigger_list = inner_triggers.blocking_read();
                                let mut candidates: Vec<Macro> = Vec::new();
                                for hid in &pressed_keys_copy_converted {
                                    for candidate in trigger_list.get(hid).into_iter().flatten() {
                                        let duplicate = candidates.iter().any(|known| {
                                            known.name == candidate.name
                                                && TriggerKey::from(&known.trigger)
                                                    == TriggerKey::from(&candidate.trigger)
                                        });
                                        if !duplicate {
                                            candidates.push(candidate.clone());
                                        }
                                    }
                                }
                                candidates
                            };

                            // ? up the pressed keys here right away?

                            let should_grab = {
                                if !check_these_macros.is_empty() {
                                    check_macro_execution_efficiently(
                                        pressed_keys_copy_converted,
                                        check_these_macros,
                                        &context,
                                        is_repeat,
                                    )
                                } else {
                                    false
                                }
                            };

                            if should_grab {
                                None
                            } else {
                                Some(event)
                            }
                        }

                        rdev::EventType::KeyRelease(key) => {
                            keys_pressed.0.blocking_write().retain(|x| *x != key);

                            debug!("Key state: {:?}", keys_pressed.0.blocking_read());

                            if let Some(hid) = SCANCODE_TO_HID.get(&key) {
                                if on_trigger_release(&context, *hid) {
                                    return None;
                                }
                            }

                            Some(event)
                        }

                        rdev::EventType::ButtonPress(button) => {
                            debug!("Button pressed: {:?}", button);

                            let converted_button_to_u32: u32 =
                                BUTTON_TO_HID.get(&button).unwrap_or(&0x101).to_owned();

                            let trigger_list = inner_triggers.blocking_read().clone();

                            let check_these_macros =
                                match trigger_list.get(&converted_button_to_u32) {
                                    None => {
                                        vec![]
                                    }
                                    Some(data_found) => data_found.to_vec(),
                                };

                            let should_grab = check_macro_execution_efficiently(
                                vec![converted_button_to_u32],
                                check_these_macros,
                                &context,
                                false,
                            );

                            // Left mouse button never gets consumed to allow users to control their PC.
                            match (should_grab, button) {
                                (true, rdev::Button::Left) => Some(event),
                                (true, _) => None,
                                (false, _) => Some(event),
                            }
                        }
                        rdev::EventType::ButtonRelease(button) => {
                            debug!("Button released: {:?}", button);

                            if let Some(hid) = BUTTON_TO_HID.get(&button) {
                                if on_trigger_release(&context, *hid) {
                                    return None;
                                }
                            }

                            Some(event)
                        }
                        rdev::EventType::MouseMove { .. } => Some(event),
                        rdev::EventType::Wheel { .. } => Some(event),
                    }
                } else {
                    // Keep the held-key state current while paused, so the pause hotkey and the
                    // first presses after resuming are judged correctly.
                    match event.event_type {
                        rdev::EventType::KeyPress(key) => {
                            let mut keys_pressed = keys_pressed.0.blocking_write();
                            if !keys_pressed.contains(&key) {
                                keys_pressed.push(key);
                            }
                        }
                        rdev::EventType::KeyRelease(key) => {
                            keys_pressed.0.blocking_write().retain(|x| *x != key);
                        }
                        _ => {}
                    }
                    Some(event)
                }
    }
}

impl Default for MacroBackend {
    /// Generates a new state.
    fn default() -> Self {
        let macro_data =
            MacroData::read_data().unwrap_or_else(|err| panic!("Cannot get macro data! {}", err));

        let triggers = macro_data
            .extract_triggers()
            .expect("error extracting triggers");
        let (command_sender, command_receiver) = tokio::sync::mpsc::unbounded_channel();
        MacroBackend {
            data: Arc::new(RwLock::from(macro_data)),
            config: Arc::new(RwLock::from(
                ApplicationConfig::read_data().expect("error reading config"),
            )),
            triggers: Arc::new(RwLock::from(triggers)),
            is_listening: Arc::new(AtomicBool::new(true)),
            running: RunningMacros::default(),
            foreground: Arc::new(Mutex::new(None)),
            command_sender,
            command_receiver: Mutex::new(Some(command_receiver)),
            hook_events: Arc::new(AtomicU64::new(0)),
            hook_healthy: Arc::new(AtomicBool::new(true)),
            pause_hotkey: Arc::new(Mutex::new(Vec::new())),
        }
    }
}
