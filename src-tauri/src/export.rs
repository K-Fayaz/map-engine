// Video export: streams raw RGBA frames rendered in the webview (see
// src/map/timelineResolver.ts + worldRenderer.ts) to a bundled ffmpeg
// sidecar's stdin, which encodes them into an MP4 as they arrive. No frame
// ever touches disk individually -- see the video-export plan's decision to
// stream rather than write a PNG sequence.
//
// Only Rust spawns/writes to/kills the ffmpeg process -- the frontend never
// gets direct shell access (see tauri-plugin-shell's own commands, which
// this app's capabilities deliberately do NOT grant to the webview). The
// four commands below are this app's own, narrow surface instead.

use std::sync::Mutex;

use tauri::{
    async_runtime::Receiver,
    ipc::{InvokeBody, Request},
    AppHandle, State,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};

struct ExportSession {
    child: Option<CommandChild>,
    rx: Receiver<CommandEvent>,
    output_path: String,
}

// A single in-flight export at a time -- the UI disables the Export control
// while one is running (see exportStore.ts), so this is a correctness
// backstop, not a queue.
pub struct ExportState(Mutex<Option<ExportSession>>);

impl Default for ExportState {
    fn default() -> Self {
        ExportState(Mutex::new(None))
    }
}

#[tauri::command]
pub fn start_export(
    app: AppHandle,
    state: State<ExportState>,
    width: u32,
    height: u32,
    fps: u32,
    output_path: String,
    // Local filesystem path to the reference audio clip (audioStore.ts), or
    // None when no clip is loaded. ffmpeg opens this file itself, as its
    // own OS process -- these bytes never pass through the frontend/IPC.
    audio_path: Option<String>,
) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_some() {
        return Err("an export is already in progress".into());
    }

    let size_arg = format!("{width}x{height}");
    let fps_arg = fps.to_string();

    // Video (stdin, rawvideo) is always input 0. When an audio clip is
    // present it's appended as input 1, with explicit -map/-c:a so the
    // muxer knows what to do with two inputs; with no clip this is exactly
    // the single-input command that always existed here, unchanged.
    //
    // Deliberately no -shortest: video's frame count is already fixed by
    // the piped rawvideo input regardless of audio length, so a shorter
    // clip simply finishes and the rest of the video continues in silence
    // on its own -- and a longer clip is explicitly left unhandled for now
    // (not a case this pass needs to cover).
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-f".into(),
        "rawvideo".into(),
        "-pix_fmt".into(),
        "rgba".into(),
        "-s".into(),
        size_arg,
        "-r".into(),
        fps_arg.clone(),
        "-i".into(),
        "-".into(),
    ];
    if let Some(audio_path) = &audio_path {
        args.push("-i".into());
        args.push(audio_path.clone());
    }
    args.extend([
        // Untagged HD (>=720 lines) output leaves players to guess the
        // RGB<->YUV matrix used, and most (VLC included) guess BT.709
        // for anything HD-sized -- but ffmpeg's default conversion
        // during the pix_fmt change actually uses BT.601 coefficients.
        // That mismatch is exactly what washed out/shifted our colors
        // in VLC despite the frames being correct going in (confirmed
        // via a controlled round-trip test: tagging alone, without
        // also forcing the real conversion matrix, made it worse --
        // both have to agree). `scale=out_color_matrix=bt709` forces
        // the actual conversion; the three tags below make sure any
        // spec-compliant player decodes with the same matrix instead
        // of guessing.
        "-vf".into(),
        "scale=out_color_matrix=bt709".into(),
        "-colorspace".into(),
        "bt709".into(),
        "-color_primaries".into(),
        "bt709".into(),
        "-color_trc".into(),
        "bt709".into(),
        "-c:v".into(),
        "libx264".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
    ]);
    if audio_path.is_some() {
        args.extend([
            "-map".into(),
            "0:v:0".into(),
            "-map".into(),
            "1:a:0".into(),
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            "192k".into(),
        ]);
    }
    args.push("-movflags".into());
    args.push("+faststart".into());
    args.push(output_path.clone());

    let (rx, child) = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    *guard = Some(ExportSession {
        child: Some(child),
        rx,
        output_path,
    });
    Ok(())
}

// Plain (non-async) command -- Tauri runs these on a blocking-safe thread,
// so a write that blocks because ffmpeg is still catching up on a slow
// machine just makes this call (and the JS export loop awaiting it) take
// longer. That's the intended backpressure: never drop a frame, never
// stall the rest of the app.
//
// Takes `Request` rather than a plain `bytes: Vec<u8>` parameter -- the
// frontend passes the raw pixel buffer directly as `invoke`'s `args` (see
// exportPipeline.ts), which Tauri's IPC transfers as a raw binary body
// rather than JSON. A named `Vec<u8>` parameter only ever binds against a
// JSON object key, which a raw body has none of -- `Request::body()` is
// the actual way to reach a raw payload.
#[tauri::command]
pub fn write_frame(state: State<ExportState>, request: Request<'_>) -> Result<(), String> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes,
        InvokeBody::Json(_) => return Err("write_frame expects a raw binary body".into()),
    };

    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let session = guard.as_mut().ok_or("no export in progress")?;
    let child = session.child.as_mut().ok_or("export already finishing")?;
    child.write(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn finish_export(state: State<'_, ExportState>) -> Result<(), String> {
    let mut session = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.take().ok_or("no export in progress")?
    };

    // Dropping the child closes its stdin pipe (its only handle to it) --
    // ffmpeg sees EOF, finishes encoding whatever's buffered, muxes the
    // trailer, and exits on its own. We don't kill it; we let it finish.
    session.child.take();

    loop {
        match session.rx.recv().await {
            Some(CommandEvent::Terminated(payload)) => {
                return if payload.code == Some(0) {
                    Ok(())
                } else {
                    Err(format!("ffmpeg exited with status {:?}", payload.code))
                };
            }
            Some(CommandEvent::Error(err)) => return Err(err),
            Some(_) => continue, // stdout/stderr chatter, not needed here
            None => return Err("ffmpeg process ended unexpectedly".into()),
        }
    }
}

#[tauri::command]
pub fn cancel_export(state: State<ExportState>) -> Result<(), String> {
    let session = {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        guard.take()
    };
    let Some(mut session) = session else {
        return Ok(()); // nothing running -- not an error, just a no-op
    };

    if let Some(child) = session.child.take() {
        // Best-effort -- the process may have already exited on its own.
        let _ = child.kill();
    }
    let _ = std::fs::remove_file(&session.output_path);
    Ok(())
}
