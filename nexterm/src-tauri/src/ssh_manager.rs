use ssh2::Session;
use std::io::Read;
use std::net::TcpStream;
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use tauri::Emitter;

pub struct SshSession {
    session: Arc<Mutex<Session>>,
    channel: Arc<Mutex<ssh2::Channel>>,
    _reader_thread: Option<JoinHandle<()>>,
    running: Arc<Mutex<bool>>,
}

impl Drop for SshSession {
    fn drop(&mut self) {
        if let Ok(mut running) = self.running.lock() {
            *running = false;
        }
        if let Some(handle) = self._reader_thread.take() {
            let _ = handle.join();
        }
        if let Ok(session) = self.session.lock() {
            let _ = session.disconnect(None, "Session closed", None);
        }
    }
}

impl SshSession {
    pub fn new(
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        session_id: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<Self, String> {
        let addr = format!("{}:{}", host, port);

        use std::net::ToSocketAddrs;
        let socket_addr = addr
            .to_socket_addrs()
            .map_err(|e| format!("Cannot resolve {}: {}", addr, e))?
            .next()
            .ok_or_else(|| format!("Could not resolve host: {}", host))?;

        let tcp = TcpStream::connect_timeout(
            &socket_addr,
            std::time::Duration::from_secs(15),
        ).map_err(|e| format!("TCP connection failed to {}: {}", addr, e))?;

        // Enable TCP keepalive to detect stale connections
        tcp.set_nodelay(true)
            .map_err(|e| format!("Failed to set TCP_NODELAY: {}", e))?;
        tcp.set_read_timeout(Some(std::time::Duration::from_secs(30)))
            .map_err(|e| format!("Failed to set read timeout: {}", e))?;

        let mut session = Session::new()
            .map_err(|e| format!("Failed to create SSH session: {}", e))?;

        session.set_tcp_stream(tcp);
        session.set_timeout(15000); // 15s timeout for SSH operations
        session.handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Enable SSH keepalive: send keepalive every 30s, allow 3 missed responses
        session.set_keepalive(true, 30);

        // Authenticate
        if let Some(key_content) = private_key {
            let temp_dir = std::env::temp_dir();
            let key_path = temp_dir.join(format!("novashell_ssh_key_{}", session_id));
            std::fs::write(&key_path, key_content)
                .map_err(|e| format!("Failed to write temp key: {}", e))?;

            let result = session.userauth_pubkey_file(
                username,
                None,
                &key_path,
                password,
            );

            let _ = std::fs::remove_file(&key_path);
            result.map_err(|e| format!("Public key auth failed: {}", e))?;
        } else if let Some(pass) = password {
            session.userauth_password(username, pass)
                .map_err(|e| format!("Password auth failed: {}", e))?;
        } else {
            return Err("No authentication method provided".to_string());
        }

        if !session.authenticated() {
            return Err("Authentication failed".to_string());
        }

        // Open a channel with PTY
        let mut channel = session.channel_session()
            .map_err(|e| format!("Failed to open channel: {}", e))?;

        channel.request_pty("xterm-256color", None, Some((80, 24, 0, 0)))
            .map_err(|e| format!("Failed to request PTY: {}", e))?;

        channel.shell()
            .map_err(|e| format!("Failed to start shell: {}", e))?;

        // Keep session in BLOCKING mode — use read timeout for non-blocking behavior
        // This avoids the race condition of switching blocking/non-blocking between threads
        session.set_blocking(true);
        session.set_timeout(100); // 100ms timeout for reads — returns WouldBlock-like error if no data

        let session = Arc::new(Mutex::new(session));
        let channel = Arc::new(Mutex::new(channel));

        let running = Arc::new(Mutex::new(true));
        let running_clone = Arc::clone(&running);
        let channel_clone = Arc::clone(&channel);
        let session_clone = Arc::clone(&session);
        let sid = session_id.to_string();

        // Pre-build event names to avoid repeated allocations
        let data_event = format!("ssh-data-{}", sid);
        let exit_event = format!("ssh-exit-{}", sid);
        let error_event = format!("ssh-error-{}", sid);

        let reader_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut consecutive_errors: u32 = 0;
            let max_consecutive_errors: u32 = 50; // ~5 seconds of continuous errors

            loop {
                if let Ok(r) = running_clone.lock() {
                    if !*r {
                        break;
                    }
                } else {
                    break; // Mutex poisoned, exit cleanly
                }

                let result = {
                    let mut ch = match channel_clone.lock() {
                        Ok(ch) => ch,
                        Err(_) => break,
                    };

                    if ch.eof() {
                        let _ = app_handle.emit(&exit_event, ());
                        break;
                    }

                    ch.read(&mut buf)
                };

                match result {
                    Ok(0) => {
                        let _ = app_handle.emit(&exit_event, ());
                        break;
                    }
                    Ok(n) => {
                        consecutive_errors = 0;
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(&data_event, data);
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut => {
                        // No data available — this is normal with timeout-based reading
                        consecutive_errors = 0;

                        // Send keepalive ping periodically
                        if let Ok(session) = session_clone.lock() {
                            let _ = session.keepalive_send();
                        }

                        std::thread::sleep(std::time::Duration::from_millis(10));
                    }
                    Err(e) => {
                        consecutive_errors += 1;
                        if consecutive_errors >= max_consecutive_errors {
                            let msg = format!("SSH connection lost: {}", e);
                            let _ = app_handle.emit(&error_event, msg);
                            break;
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                }
            }
        });

        Ok(SshSession {
            session,
            channel,
            _reader_thread: Some(reader_thread),
            running,
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<(), String> {
        // Lock BOTH session and channel together to avoid race conditions
        let session = self.session.lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let mut channel = self.channel.lock()
            .map_err(|e| format!("Channel lock error: {}", e))?;

        // Temporarily increase timeout for write operation
        session.set_timeout(5000);

        use std::io::Write;
        channel.write_all(data)
            .map_err(|e| format!("SSH write error: {}", e))?;
        channel.flush()
            .map_err(|e| format!("SSH flush error: {}", e))?;

        // Restore short timeout for reader
        session.set_timeout(100);

        Ok(())
    }

    pub fn resize(&self, cols: u32, rows: u32) -> Result<(), String> {
        let session = self.session.lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let mut channel = self.channel.lock()
            .map_err(|e| format!("Channel lock error: {}", e))?;

        session.set_timeout(5000);
        channel.request_pty_size(cols, rows, None, None)
            .map_err(|e| format!("SSH resize error: {}", e))?;
        session.set_timeout(100);

        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        if let Ok(channel) = self.channel.lock() {
            !channel.eof()
        } else {
            false
        }
    }
}

// ──────────── Log Stream (tail -f over SSH) ────────────

pub struct LogStream {
    running: Arc<Mutex<bool>>,
    _reader_thread: Option<JoinHandle<()>>,
}

impl Drop for LogStream {
    fn drop(&mut self) {
        if let Ok(mut r) = self.running.lock() { *r = false; }
        if let Some(h) = self._reader_thread.take() { let _ = h.join(); }
    }
}

impl LogStream {
    pub fn new(
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        command: &str,
        stream_id: &str,
        app_handle: tauri::AppHandle,
    ) -> Result<Self, String> {
        let addr = format!("{}:{}", host, port);

        use std::net::ToSocketAddrs;
        let socket_addr = addr
            .to_socket_addrs()
            .map_err(|e| format!("Cannot resolve {}: {}", addr, e))?
            .next()
            .ok_or_else(|| format!("Could not resolve host: {}", host))?;

        let tcp = TcpStream::connect_timeout(&socket_addr, std::time::Duration::from_secs(10))
            .map_err(|e| format!("TCP failed: {}", e))?;
        tcp.set_nodelay(true).ok();

        let mut session = Session::new().map_err(|e| format!("Session error: {}", e))?;
        session.set_tcp_stream(tcp);
        session.set_timeout(15000);
        session.handshake().map_err(|e| format!("Handshake failed: {}", e))?;
        session.set_keepalive(true, 30);

        // Authenticate
        if let Some(key_content) = private_key {
            let temp_dir = std::env::temp_dir();
            let key_path = temp_dir.join(format!("novashell_logstream_{}", stream_id));
            std::fs::write(&key_path, key_content).map_err(|e| format!("Key write error: {}", e))?;
            let result = session.userauth_pubkey_file(username, None, &key_path, password);
            let _ = std::fs::remove_file(&key_path);
            result.map_err(|e| format!("Key auth failed: {}", e))?;
        } else if let Some(pass) = password {
            session.userauth_password(username, pass).map_err(|e| format!("Auth failed: {}", e))?;
        } else {
            return Err("No auth method".to_string());
        }

        if !session.authenticated() { return Err("Authentication failed".to_string()); }

        // Execute the tail -f command (no PTY needed)
        let mut channel = session.channel_session().map_err(|e| format!("Channel error: {}", e))?;
        channel.exec(command).map_err(|e| format!("Exec error: {}", e))?;

        session.set_blocking(true);
        session.set_timeout(500); // 500ms read timeout

        let running = Arc::new(Mutex::new(true));
        let running_clone = Arc::clone(&running);
        let data_event = format!("log-stream-data-{}", stream_id);

        let reader_thread = std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if let Ok(r) = running_clone.lock() { if !*r { break; } } else { break; }
                match channel.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(&data_event, data);
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut => {
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                    Err(_) => break,
                }
            }
            let _ = session.disconnect(None, "Log stream closed", None);
        });

        Ok(LogStream { running, _reader_thread: Some(reader_thread) })
    }
}

/// Test SSH connection without keeping it open
pub fn test_ssh_connection(
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
) -> Result<String, String> {
    let addr = format!("{}:{}", host, port);

    use std::net::ToSocketAddrs;
    let socket_addr = addr
        .to_socket_addrs()
        .map_err(|e| format!("Cannot resolve {}: {}", addr, e))?
        .next()
        .ok_or_else(|| format!("Could not resolve host: {}", host))?;

    let tcp = TcpStream::connect_timeout(
        &socket_addr,
        std::time::Duration::from_secs(10),
    ).map_err(|e| format!("Connection failed to {}: {}", addr, e))?;

    let mut session = Session::new()
        .map_err(|e| format!("Session creation failed: {}", e))?;

    session.set_tcp_stream(tcp);
    session.set_timeout(10000);
    session.handshake()
        .map_err(|e| format!("Handshake failed: {}", e))?;

    if let Some(key_content) = private_key {
        let temp_dir = std::env::temp_dir();
        let key_path = temp_dir.join(format!("novashell_ssh_test_{}", uuid::Uuid::new_v4()));
        std::fs::write(&key_path, key_content)
            .map_err(|e| format!("Failed to write temp key: {}", e))?;

        let result = session.userauth_pubkey_file(username, None, &key_path, password);
        let _ = std::fs::remove_file(&key_path);
        result.map_err(|e| format!("Key auth failed: {}", e))?;
    } else if let Some(pass) = password {
        session.userauth_password(username, pass)
            .map_err(|e| format!("Password auth failed: {}", e))?;
    } else {
        return Err("No authentication method provided".to_string());
    }

    if session.authenticated() {
        let _ = session.disconnect(None, "Test complete", None);
        Ok("Connection successful".to_string())
    } else {
        Err("Authentication failed".to_string())
    }
}

/// Execute a command on a remote server via a temporary SSH connection.
/// Returns (stdout, exit_code). Creates and closes its own session.
pub fn exec_command(
    host: &str,
    port: u16,
    username: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    command: &str,
) -> Result<(String, i32), String> {
    let addr = format!("{}:{}", host, port);

    use std::net::ToSocketAddrs;
    let socket_addr = addr
        .to_socket_addrs()
        .map_err(|e| format!("Cannot resolve {}: {}", addr, e))?
        .next()
        .ok_or_else(|| format!("Could not resolve host: {}", host))?;

    let tcp = TcpStream::connect_timeout(
        &socket_addr,
        std::time::Duration::from_secs(10),
    ).map_err(|e| format!("Connection failed to {}: {}", addr, e))?;

    let mut session = Session::new()
        .map_err(|e| format!("Session creation failed: {}", e))?;

    session.set_tcp_stream(tcp);
    session.set_timeout(15000);
    session.handshake()
        .map_err(|e| format!("Handshake failed: {}", e))?;

    // Authenticate
    if let Some(key_content) = private_key {
        let temp_dir = std::env::temp_dir();
        let key_path = temp_dir.join(format!("novashell_exec_{}", uuid::Uuid::new_v4()));
        std::fs::write(&key_path, key_content)
            .map_err(|e| format!("Failed to write temp key: {}", e))?;
        let result = session.userauth_pubkey_file(username, None, &key_path, password);
        let _ = std::fs::remove_file(&key_path);
        result.map_err(|e| format!("Key auth failed: {}", e))?;
    } else if let Some(pass) = password {
        session.userauth_password(username, pass)
            .map_err(|e| format!("Password auth failed: {}", e))?;
    } else {
        return Err("No authentication method provided".to_string());
    }

    if !session.authenticated() {
        return Err("Authentication failed".to_string());
    }

    // Execute command
    let mut channel = session.channel_session()
        .map_err(|e| format!("Channel error: {}", e))?;
    channel.exec(command)
        .map_err(|e| format!("Exec error: {}", e))?;

    let mut stdout = String::new();
    channel.read_to_string(&mut stdout)
        .map_err(|e| format!("Read error: {}", e))?;

    channel.wait_close().ok();
    let exit_code = channel.exit_status().unwrap_or(-1);

    let _ = session.disconnect(None, "Exec complete", None);

    Ok((stdout, exit_code))
}
