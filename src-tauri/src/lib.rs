use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::Mutex,
    thread,
};

use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Listener, Manager, State};

#[derive(Default)]
struct AppState {
    rpc: Mutex<Option<RpcProcess>>,
}

struct RpcProcess {
    child: Child,
    stdin: ChildStdin,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRpcOptions {
    cwd: Option<String>,
    continue_recent: Option<bool>,
    pi_command: Option<String>,
}

#[tauri::command]
fn start_rpc(app: AppHandle, state: State<AppState>, options: StartRpcOptions) -> Result<(), String> {
    stop_existing(&state)?;

    let mut command = Command::new(options.pi_command.unwrap_or_else(|| "pi".to_string()));
    command.arg("--mode").arg("rpc");
    if options.continue_recent.unwrap_or(false) {
        command.arg("--continue");
    }
    if let Some(cwd) = options.cwd.as_deref().filter(|cwd| !cwd.trim().is_empty()) {
        command.current_dir(cwd);
    }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = command.spawn().map_err(|err| format!("Failed to start pi RPC process: {err}"))?;
    let stdin = child.stdin.take().ok_or_else(|| "Failed to open pi RPC stdin".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Failed to open pi RPC stdout".to_string())?;
    let stderr = child.stderr.take().ok_or_else(|| "Failed to open pi RPC stderr".to_string())?;

    let stdout_app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => match serde_json::from_str::<Value>(&line) {
                    Ok(value) => {
                        let _ = stdout_app.emit("pi-rpc", value);
                    }
                    Err(err) => {
                        let _ = stdout_app.emit("pi-rpc-error", format!("Invalid JSON from pi: {err}: {line}"));
                    }
                },
                Ok(_) => {}
                Err(err) => {
                    let _ = stdout_app.emit("pi-rpc-error", format!("Failed reading pi stdout: {err}"));
                    break;
                }
            }
        }
        let _ = stdout_app.emit("pi-rpc-exit", ());
    });

    let stderr_app = app.clone();
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if let Ok(line) = line {
                let _ = stderr_app.emit("pi-rpc-stderr", line);
            }
        }
    });

    *state.rpc.lock().map_err(|_| "RPC state lock poisoned".to_string())? = Some(RpcProcess { child, stdin });
    Ok(())
}

#[tauri::command]
fn send_rpc(state: State<AppState>, command: Value) -> Result<(), String> {
    let mut guard = state.rpc.lock().map_err(|_| "RPC state lock poisoned".to_string())?;
    let rpc = guard.as_mut().ok_or_else(|| "pi RPC process is not running".to_string())?;
    let line = serde_json::to_string(&command).map_err(|err| format!("Failed to serialize RPC command: {err}"))?;
    rpc.stdin
        .write_all(line.as_bytes())
        .and_then(|_| rpc.stdin.write_all(b"\n"))
        .and_then(|_| rpc.stdin.flush())
        .map_err(|err| format!("Failed writing pi RPC command: {err}"))
}

#[tauri::command]
fn stop_rpc(state: State<AppState>) -> Result<(), String> {
    stop_existing(&state)
}

fn stop_existing(state: &State<AppState>) -> Result<(), String> {
    if let Some(mut rpc) = state.rpc.lock().map_err(|_| "RPC state lock poisoned".to_string())?.take() {
        let _ = rpc.child.kill();
        let _ = rpc.child.wait();
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![start_rpc, send_rpc, stop_rpc])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let close_handle = app_handle.clone();
            app_handle.listen("tauri://close-requested", move |_| {
                let state = close_handle.state::<AppState>();
                let _ = stop_existing(&state);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running pi-ui");
}
