use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};
use tauri::Emitter;

pub struct PtySession {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    _reader_thread: Option<JoinHandle<()>>,
    running: Arc<Mutex<bool>>,
}

impl Drop for PtySession {
    fn drop(&mut self) {
        if let Ok(mut running) = self.running.lock() {
            *running = false;
        }
        // Wait briefly for reader thread to finish
        if let Some(handle) = self._reader_thread.take() {
            let _ = handle.join();
        }
    }
}

impl PtySession {
    pub fn new(
        shell_path: &str,
        session_id: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<Self, Box<dyn std::error::Error>> {
        let pty_system = native_pty_system();

        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let mut cmd = CommandBuilder::new(shell_path);
        let cwd = dirs::home_dir()
            .or_else(|| std::env::current_dir().ok())
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        cmd.cwd(cwd);

        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("CLICOLOR", "1");
        cmd.env("CLICOLOR_FORCE", "1");
        cmd.env("FORCE_COLOR", "3");

        let _child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        let running = Arc::new(Mutex::new(true));
        let running_clone = Arc::clone(&running);
        let sid = session_id.to_string();

        let reader_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut batch = String::new();
            let mut last_flush = Instant::now();
            let flush_interval = Duration::from_millis(33); // ~30fps — safe for multiple tabs without flooding WebView
            let event_name = format!("pty-data-{}", sid);
            let exit_event = format!("pty-exit-{}", sid);
            let error_event = format!("pty-error-{}", sid);

            loop {
                if let Ok(r) = running_clone.lock() {
                    if !*r {
                        break;
                    }
                }

                match reader.read(&mut buf) {
                    Ok(0) => {
                        // Flush remaining data before exit
                        if !batch.is_empty() {
                            let _ = app_handle.emit(&event_name, std::mem::take(&mut batch));
                        }
                        let _ = app_handle.emit(&exit_event, ());
                        break;
                    }
                    Ok(n) => {
                        batch.push_str(&String::from_utf8_lossy(&buf[..n]));
                        // Flush batch if enough time has passed or batch is large
                        if last_flush.elapsed() >= flush_interval || batch.len() > 8192 {
                            let _ = app_handle.emit(&event_name, std::mem::take(&mut batch));
                            last_flush = Instant::now();
                        }
                    }
                    Err(e) => {
                        if !batch.is_empty() {
                            let _ = app_handle.emit(&event_name, std::mem::take(&mut batch));
                        }
                        let msg = format!("PTY read error: {}", e);
                        let _ = app_handle.emit(&error_event, msg);
                        break;
                    }
                }
            }
        });

        Ok(PtySession {
            master: Arc::new(Mutex::new(pair.master)),
            writer: Arc::new(Mutex::new(writer)),
            _reader_thread: Some(reader_thread),
            running,
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), Box<dyn std::error::Error>> {
        let mut writer = self.writer.lock()
            .map_err(|e| format!("Writer lock poisoned: {}", e))?;
        writer.write_all(data)?;
        writer.flush()?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<(), Box<dyn std::error::Error>> {
        let master = self.master.lock()
            .map_err(|e| format!("Master lock poisoned: {}", e))?;
        master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;
        Ok(())
    }
}
