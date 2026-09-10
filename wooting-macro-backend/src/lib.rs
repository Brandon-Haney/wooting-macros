#[cfg(not(debug_assertions))]
use std::path::PathBuf;
use std::collections::HashMap as StdHashMap;
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
/// This is a macro struct. Includes all information a macro needs to run.
pub struct Macro {
    pub name: String,
    pub icon: String,
    pub sequence: Vec<ActionEventType>,
    pub macro_type: MacroType,
    pub trigger: TriggerEventType,
    pub active: bool,
}

impl Macro {
    /// This function is used to execute a macro. It is called by the macro checker.
    /// It spawns async tasks to execute said events specifically.
    /// Make sure to expand this if you implement new action types.
    async fn execute(&self, send_channel: UnboundedSender<rdev::EventType>) -> Result<()> {
        for action in &self.sequence {
            match action {
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
                    let action_copy = data.clone();
                    let channel_copy = send_channel.clone();
                    task::spawn(async move { action_copy.execute(channel_copy).await });
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
}

/// Macros currently looping (`OnHold` or `Toggle`), keyed by trigger identity.
///
/// This is a plain mutex rather than the async `RwLock`: it is touched from the grab thread, from
/// async tasks and from synchronous Tauri commands, and it is never held across an await.
pub type RunningMacros = Arc<Mutex<StdHashMap<TriggerKey, LoopHandle>>>;

/// Events the executor is about to inject into the OS (see `keypress_executor_sender`).
///
/// Injected events come back through the grab hook exactly like physical input, and `rdev` does
/// not flag them. Recognising them here keeps the macros' own output out of the pressed-key state:
/// otherwise a looping macro's key presses hide every other trigger (including the one that should
/// stop it) for the duration of each press, and a lifted modifier reads as the user releasing it.
type InjectedEvents = Arc<Mutex<Vec<rdev::EventType>>>;

/// Minimum duration of one loop iteration in milliseconds, see `Macro::min_loop_iteration`.
const MIN_LOOP_ITERATION_DELAY: u64 = 10;

/// How long a looping macro keeps injecting events without the grab hook seeing any of them
/// before it concludes the hook is gone and stops itself, see `spawn_macro_loop`.
const HOOK_STALL_TIMEOUT: time::Duration = time::Duration::from_secs(1);

/// Locks a mutex, recovering the data if another thread panicked while holding it.
fn lock_or_recover<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Everything the grab hook needs to start, stop and keep track of macro executions.
#[derive(Debug, Clone)]
struct ExecutionContext {
    /// Sender side of the executor channel, see `keypress_executor_sender`.
    channel: UnboundedSender<rdev::EventType>,
    running: RunningMacros,
    injected: InjectedEvents,
    is_listening: Arc<AtomicBool>,
    /// Counts every event the grab hook has seen, injected ones included. Looping macros use it
    /// as a liveness signal for the hook.
    hook_events: Arc<AtomicU64>,
}

/// State of the application in RAM (RWlock).
#[derive(Debug)]
pub struct MacroBackend {
    pub data: Arc<RwLock<MacroData>>,
    pub config: Arc<RwLock<ApplicationConfig>>,
    pub triggers: Arc<RwLock<MacroTriggerLookup>>,
    pub is_listening: Arc<AtomicBool>,
    pub running: RunningMacros,
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
}

/// Executes a given macro (according to its type).
///
/// Runs synchronously on the grab thread so that looping macros are registered in event order:
/// the release that stops an `OnHold` macro can never overtake the press that started it.
fn execute_macro(macros: Macro, context: &ExecutionContext) {
    match macros.macro_type {
        MacroType::Single => {
            info!("\nEXECUTING A SINGLE MACRO: {:#?}", macros.name);

            let cloned_channel = context.channel.clone();

            task::spawn(async move {
                if let Err(error) = macros.execute(cloned_channel).await {
                    error!("error executing macro: {}", error);
                }
            });
        }
        MacroType::Toggle => {
            let trigger = TriggerKey::from(&macros.trigger);

            let flag = {
                let mut running = lock_or_recover(&context.running);

                if let Some(handle) = running.remove(&trigger) {
                    info!("\nSTOPPING A TOGGLE MACRO: {:#?}", macros.name);
                    handle.running.store(false, Ordering::Relaxed);
                    return;
                }

                info!("\nSTARTING A TOGGLE MACRO: {:#?}", macros.name);
                let flag = Arc::new(AtomicBool::new(true));
                running.insert(
                    trigger.clone(),
                    LoopHandle {
                        running: flag.clone(),
                        stop_on_release: false,
                    },
                );
                flag
            };

            spawn_macro_loop(macros, trigger, flag, context);
        }
        MacroType::OnHold => {
            let trigger = TriggerKey::from(&macros.trigger);

            let flag = {
                let mut running = lock_or_recover(&context.running);

                // The OS auto-repeats a held trigger key, which re-matches the macro: ignore it.
                if running.contains_key(&trigger) {
                    trace!(
                        "on-hold macro {:?} is already running, ignoring re-trigger",
                        macros.name
                    );
                    return;
                }

                info!("\nSTARTING AN ON-HOLD MACRO: {:#?}", macros.name);
                let flag = Arc::new(AtomicBool::new(true));
                running.insert(
                    trigger.clone(),
                    LoopHandle {
                        running: flag.clone(),
                        stop_on_release: true,
                    },
                );
                flag
            };

            spawn_macro_loop(macros, trigger, flag, context);
        }
    }
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
    let channel = context.channel.clone();
    let running = context.running.clone();
    let is_listening = context.is_listening.clone();
    let hook_events = context.hook_events.clone();

    task::spawn(async move {
        let min_iteration = macros.min_loop_iteration();
        let injects_events = macros.injected_event_count() > 0;
        let mut iterations: u64 = 0;
        let mut hook_stalled_since: Option<time::Instant> = None;

        while flag.load(Ordering::Relaxed) && is_listening.load(Ordering::Relaxed) {
            let started = time::Instant::now();
            let hook_events_before = hook_events.load(Ordering::Relaxed);

            if let Err(error) = macros.execute(channel.clone()).await {
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
        let is_own_entry = running
            .get(&trigger)
            .is_some_and(|handle| Arc::ptr_eq(&handle.running, &flag));
        if is_own_entry {
            running.remove(&trigger);
        }
    });
}

/// Stops every running `OnHold` macro whose trigger includes the released key.
///
/// Runs on the grab thread for every key and button release system-wide, so it has to stay cheap.
fn stop_on_hold_macros(context: &ExecutionContext, released_hid: u32) {
    let mut running = lock_or_recover(&context.running);
    running.retain(|trigger, handle| {
        let stop = handle.stop_on_release && trigger.contains(released_hid);
        if stop {
            debug!(
                "Stopping on-hold macro {:?} on release of {:#x}",
                trigger, released_hid
            );
            handle.running.store(false, Ordering::Relaxed);
        }
        !stop
    });
}

/// Returns true if a currently looping macro is triggered by the given key.
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
) {
    loop {
        let received_event = match &rchan_execute.blocking_recv() {
            Some(event) => *event,
            None => {
                error!("Failed to receive an event!");
                continue;
            }
        };

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
            TriggerEventType::KeyPressEvent { data, .. } => match data.len() {
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

        debug!("MATCHED MACRO {:?}: {:#?}", macros.macro_type, pressed_events);
        output = true;

        // Looping macro types act on the first press only: the OS auto-repeat of a held trigger
        // must neither restart an on-hold loop nor flip a toggle. The repeat is still grabbed.
        if is_repeat && macros.macro_type != MacroType::Single {
            trace!("Ignoring auto-repeat for macro {:?}", macros.name);
            continue;
        }

        if let TriggerEventType::KeyPressEvent { data, .. } = &macros.trigger {
            // A single key can't be a modifier, so there is nothing to lift for those.
            if data.len() > 1 {
                // This releases any trigger keys that have been held to make macros more reliable when used with modifier hotkeys.
                plugin::util::lift_keys(data, &context.channel)
                    .unwrap_or_else(|err| error!("Error lifting keys: {}", err));
            }
        }

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

    /// Stops every looping (`OnHold` / `Toggle`) macro after its current iteration.
    pub fn stop_all_loops(&self) {
        let mut running = lock_or_recover(&self.running);
        for handle in running.values() {
            handle.running.store(false, Ordering::Relaxed);
        }
        running.clear();
    }

    /// Sets the macros from the frontend to the files. This function is here to completely split the frontend off.
    pub async fn set_macros(&self, macros: MacroData) -> Result<()> {
        macros.write_to_file()?;
        // The macros just changed under any loop that is running: a looping macro may have been
        // edited, deactivated or deleted.
        self.stop_all_loops();
        *self.triggers.write().await = macros.extract_triggers()?;
        *self.data.write().await = macros;
        Ok(())
    }

    /// Sets the config from the frontend to the files. This function is here to completely split the frontend off.
    pub async fn set_config(&self, config: ApplicationConfig) -> Result<()> {
        config.write_to_file()?;
        *self.config.write().await = config;
        Ok(())
    }

    /// Initializes the entire backend and gets the whole grabbing system running.
    pub async fn init(&self) -> Result<()> {
        //? : io-uring async read files and write files
        //TODO: implement drop when the application ends to clean up the downed keys

        //==================================================

        let inner_triggers = self.triggers.clone();

        // Spawn the channels
        let (schan_execute, rchan_execute) = tokio::sync::mpsc::unbounded_channel();

        let context = ExecutionContext {
            channel: schan_execute,
            running: self.running.clone(),
            injected: InjectedEvents::default(),
            is_listening: self.is_listening.clone(),
            hook_events: Arc::new(AtomicU64::new(0)),
        };

        // Create the executor
        let executor_injected = context.injected.clone();
        thread::spawn(move || {
            keypress_executor_sender(rchan_execute, executor_injected);
        });

        let _grabber = task::spawn_blocking(move || {
            let keys_pressed: KeysPressed = KeysPressed::default();

            rdev::grab(move |event: rdev::Event| {
                context.hook_events.fetch_add(1, Ordering::Relaxed);

                // Our own output: let it through untouched, it is neither a trigger nor a release.
                {
                    let mut injected = lock_or_recover(&context.injected);
                    if let Some(position) = injected.iter().position(|e| *e == event.event_type) {
                        injected.swap_remove(position);
                        trace!("Passing through injected event {:?}", event.event_type);
                        return Some(event);
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

                            let first_key: u32 = pressed_keys_copy_converted
                                .first()
                                .copied()
                                .unwrap_or_default();

                            let trigger_list = inner_triggers.blocking_read().clone();

                            let check_these_macros = trigger_list
                                .get(&first_key)
                                .cloned()
                                .unwrap_or_default()
                                .to_vec();

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
                                stop_on_hold_macros(&context, *hid);
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
                                stop_on_hold_macros(&context, *hid);
                            }

                            Some(event)
                        }
                        rdev::EventType::MouseMove { .. } => Some(event),
                        rdev::EventType::Wheel { .. } => Some(event),
                    }
                } else {
                    Some(event)
                }
            })
        });
        Err(anyhow::Error::msg("Error in grabbing thread!"))
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
        MacroBackend {
            data: Arc::new(RwLock::from(macro_data)),
            config: Arc::new(RwLock::from(
                ApplicationConfig::read_data().expect("error reading config"),
            )),
            triggers: Arc::new(RwLock::from(triggers)),
            is_listening: Arc::new(AtomicBool::new(true)),
            running: RunningMacros::default(),
        }
    }
}
