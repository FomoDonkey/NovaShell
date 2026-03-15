use serde::{Deserialize, Serialize};
use ssh2::Session;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::{Arc, Mutex};

pub struct SftpSession {
    session: Arc<Mutex<Session>>,
    _tcp: TcpStream, // Keep TCP alive
}

/// Normalize a remote SFTP path to always use forward slashes.
/// On Windows, std::path::Path and PathBuf use backslashes which break SFTP.
fn normalize_remote_path(path: &str) -> String {
    path.replace('\\', "/")
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RemoteFileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub permissions: u32,
    pub modified: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct TransferProgress {
    pub filename: String,
    pub transferred: u64,
    pub total: u64,
    pub done: bool,
}

impl SftpSession {
    pub fn new(
        host: &str,
        port: u16,
        username: &str,
        password: Option<&str>,
        private_key: Option<&str>,
        session_id: &str,
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
        )
        .map_err(|e| format!("TCP connection failed to {}: {}", addr, e))?;

        tcp.set_nodelay(true)
            .map_err(|e| format!("TCP_NODELAY error: {}", e))?;

        let mut session =
            Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;

        session.set_tcp_stream(tcp.try_clone().map_err(|e| e.to_string())?);
        session.set_timeout(15000);
        session
            .handshake()
            .map_err(|e| format!("SSH handshake failed: {}", e))?;

        session.set_keepalive(true, 30);

        // Authenticate
        if let Some(key_content) = private_key {
            let temp_dir = std::env::temp_dir();
            let key_path = temp_dir.join(format!("novashell_sftp_key_{}", session_id));
            std::fs::write(&key_path, key_content)
                .map_err(|e| format!("Failed to write temp key: {}", e))?;

            let result =
                session.userauth_pubkey_file(username, None, &key_path, password);

            let _ = std::fs::remove_file(&key_path);
            result.map_err(|e| format!("Public key auth failed: {}", e))?;
        } else if let Some(pass) = password {
            session
                .userauth_password(username, pass)
                .map_err(|e| format!("Password auth failed: {}", e))?;
        } else {
            return Err("No authentication method provided".to_string());
        }

        if !session.authenticated() {
            return Err("Authentication failed".to_string());
        }

        // Set longer timeout for SFTP operations
        session.set_timeout(30000);

        Ok(SftpSession {
            session: Arc::new(Mutex::new(session)),
            _tcp: tcp,
        })
    }

    fn with_sftp<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&ssh2::Sftp) -> Result<T, String>,
    {
        let session = self
            .session
            .lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let sftp = session
            .sftp()
            .map_err(|e| format!("SFTP subsystem error: {}", e))?;
        f(&sftp)
    }

    pub fn list_dir(&self, path: &str) -> Result<Vec<RemoteFileEntry>, String> {
        let normalized = normalize_remote_path(path);
        self.with_sftp(|sftp| {
            let entries = sftp
                .readdir(Path::new(&normalized))
                .map_err(|e| format!("Cannot list {}: {}", normalized, e))?;

            let mut result: Vec<RemoteFileEntry> = entries
                .into_iter()
                .filter_map(|(pathbuf, stat)| {
                    let name = pathbuf.file_name()?.to_string_lossy().to_string();
                    if name == "." || name == ".." {
                        return None;
                    }
                    // Always use forward slashes for remote SFTP paths
                    let full_path = normalize_remote_path(&pathbuf.to_string_lossy());
                    Some(RemoteFileEntry {
                        name,
                        path: full_path,
                        is_dir: stat.is_dir(),
                        size: stat.size.unwrap_or(0),
                        permissions: stat.perm.unwrap_or(0),
                        modified: stat.mtime.unwrap_or(0),
                    })
                })
                .collect();

            // Directories first, then alphabetical
            result.sort_by(|a, b| {
                b.is_dir
                    .cmp(&a.is_dir)
                    .then(a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            });

            Ok(result)
        })
    }

    pub fn download_file(&self, remote_path: &str, local_path: &str) -> Result<u64, String> {
        let normalized_remote = normalize_remote_path(remote_path);
        let session = self
            .session
            .lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let sftp = session
            .sftp()
            .map_err(|e| format!("SFTP subsystem error: {}", e))?;

        let mut remote_file = sftp
            .open(Path::new(&normalized_remote))
            .map_err(|e| format!("Cannot open remote file {}: {}", normalized_remote, e))?;

        // Create parent directories if needed
        if let Some(parent) = Path::new(local_path).parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Cannot create local dir: {}", e))?;
        }

        let mut local_file = std::fs::File::create(local_path)
            .map_err(|e| format!("Cannot create local file {}: {}", local_path, e))?;

        let mut buf = [0u8; 32768];
        let mut total: u64 = 0;

        loop {
            match remote_file.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    local_file
                        .write_all(&buf[..n])
                        .map_err(|e| format!("Write error: {}", e))?;
                    total += n as u64;
                }
                Err(e) => return Err(format!("Read error: {}", e)),
            }
        }

        Ok(total)
    }

    pub fn upload_file(&self, local_path: &str, remote_path: &str) -> Result<u64, String> {
        let normalized_remote = normalize_remote_path(remote_path);
        let session = self
            .session
            .lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let sftp = session
            .sftp()
            .map_err(|e| format!("SFTP subsystem error: {}", e))?;

        let mut local_file = std::fs::File::open(local_path)
            .map_err(|e| format!("Cannot open local file {}: {}", local_path, e))?;

        let mut remote_file = sftp
            .create(Path::new(&normalized_remote))
            .map_err(|e| format!("Cannot create remote file {}: {}", normalized_remote, e))?;

        let mut buf = [0u8; 32768];
        let mut total: u64 = 0;

        loop {
            match local_file.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    remote_file
                        .write_all(&buf[..n])
                        .map_err(|e| format!("Upload write error: {}", e))?;
                    total += n as u64;
                }
                Err(e) => return Err(format!("Read error: {}", e)),
            }
        }

        Ok(total)
    }

    pub fn mkdir(&self, path: &str) -> Result<(), String> {
        let normalized = normalize_remote_path(path);
        self.with_sftp(|sftp| {
            sftp.mkdir(Path::new(&normalized), 0o755)
                .map_err(|e| format!("Cannot create directory {}: {}", normalized, e))
        })
    }

    pub fn delete_file(&self, path: &str) -> Result<(), String> {
        let normalized = normalize_remote_path(path);
        self.with_sftp(|sftp| {
            sftp.unlink(Path::new(&normalized))
                .map_err(|e| format!("Cannot delete {}: {}", normalized, e))
        })
    }

    pub fn delete_dir(&self, path: &str) -> Result<(), String> {
        let normalized = normalize_remote_path(path);
        self.with_sftp(|sftp| {
            sftp.rmdir(Path::new(&normalized))
                .map_err(|e| format!("Cannot remove directory {}: {}", normalized, e))
        })
    }

    pub fn rename(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        let old_normalized = normalize_remote_path(old_path);
        let new_normalized = normalize_remote_path(new_path);
        self.with_sftp(|sftp| {
            sftp.rename(Path::new(&old_normalized), Path::new(&new_normalized), None)
                .map_err(|e| format!("Cannot rename {} to {}: {}", old_normalized, new_normalized, e))
        })
    }

    pub fn stat(&self, path: &str) -> Result<RemoteFileEntry, String> {
        let normalized = normalize_remote_path(path);
        self.with_sftp(|sftp| {
            let stat = sftp
                .stat(Path::new(&normalized))
                .map_err(|e| format!("Cannot stat {}: {}", normalized, e))?;
            let name = Path::new(&normalized)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| normalized.clone());
            Ok(RemoteFileEntry {
                name,
                path: normalized.clone(),
                is_dir: stat.is_dir(),
                size: stat.size.unwrap_or(0),
                permissions: stat.perm.unwrap_or(0),
                modified: stat.mtime.unwrap_or(0),
            })
        })
    }

    pub fn read_text_file(&self, remote_path: &str, max_size: u64) -> Result<String, String> {
        let normalized = normalize_remote_path(remote_path);
        let session = self
            .session
            .lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let sftp = session
            .sftp()
            .map_err(|e| format!("SFTP subsystem error: {}", e))?;

        let stat = sftp
            .stat(Path::new(&normalized))
            .map_err(|e| format!("Cannot stat {}: {}", normalized, e))?;

        if stat.size.unwrap_or(0) > max_size {
            return Err(format!(
                "File too large ({}B > {}B)",
                stat.size.unwrap_or(0),
                max_size
            ));
        }

        let mut file = sftp
            .open(Path::new(&normalized))
            .map_err(|e| format!("Cannot open {}: {}", normalized, e))?;

        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|e| format!("Read error: {}", e))?;
        Ok(content)
    }

    pub fn home_dir(&self) -> Result<String, String> {
        self.with_sftp(|sftp| {
            let realpath = sftp
                .realpath(Path::new("."))
                .map_err(|e| format!("Cannot resolve home: {}", e))?;
            Ok(normalize_remote_path(&realpath.to_string_lossy()))
        })
    }

    /// Write text content to a remote file (create or overwrite)
    pub fn write_text_file(&self, remote_path: &str, content: &str) -> Result<(), String> {
        let normalized = normalize_remote_path(remote_path);
        let session = self.session.lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let sftp = session.sftp()
            .map_err(|e| format!("SFTP subsystem error: {}", e))?;

        let mut file = sftp.create(Path::new(&normalized))
            .map_err(|e| format!("Cannot create {}: {}", normalized, e))?;
        file.write_all(content.as_bytes())
            .map_err(|e| format!("Write error: {}", e))?;
        Ok(())
    }

    pub fn is_connected(&self) -> bool {
        self.session.lock().map(|s| s.authenticated()).unwrap_or(false)
    }

    /// Recursively download a remote directory to a local path
    pub fn download_dir(&self, remote_dir: &str, local_dir: &str) -> Result<u64, String> {
        let entries = self.list_dir(remote_dir)?;

        std::fs::create_dir_all(local_dir)
            .map_err(|e| format!("Cannot create local directory {}: {}", local_dir, e))?;

        let mut total: u64 = 0;
        for entry in entries {
            let local_path = Path::new(local_dir).join(&entry.name);
            let local_str = local_path.to_string_lossy().to_string();

            if entry.is_dir {
                total += self.download_dir(&entry.path, &local_str)?;
            } else {
                total += self.download_file(&entry.path, &local_str)?;
            }
        }
        Ok(total)
    }

    /// Recursively upload a local directory to a remote path
    pub fn upload_dir(&self, local_dir: &str, remote_dir: &str) -> Result<u64, String> {
        let normalized_remote = normalize_remote_path(remote_dir);
        // Create remote directory (ignore error if it already exists)
        let _ = self.mkdir(&normalized_remote);

        let entries = std::fs::read_dir(local_dir)
            .map_err(|e| format!("Cannot read local directory {}: {}", local_dir, e))?;

        let mut total: u64 = 0;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Read dir entry error: {}", e))?;
            let metadata = entry.metadata().map_err(|e| format!("Metadata error: {}", e))?;
            let name = entry.file_name().to_string_lossy().to_string();
            let local_path = entry.path().to_string_lossy().to_string();
            let remote_path = format!("{}/{}", normalized_remote, name);

            if metadata.is_dir() {
                total += self.upload_dir(&local_path, &remote_path)?;
            } else {
                total += self.upload_file(&local_path, &remote_path)?;
            }
        }
        Ok(total)
    }
}

impl Drop for SftpSession {
    fn drop(&mut self) {
        if let Ok(session) = self.session.lock() {
            let _ = session.disconnect(None, "SFTP session closed", None);
        }
    }
}
