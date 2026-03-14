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
        self.with_sftp(|sftp| {
            let remote_path = Path::new(path);
            let entries = sftp
                .readdir(remote_path)
                .map_err(|e| format!("Cannot list {}: {}", path, e))?;

            let mut result: Vec<RemoteFileEntry> = entries
                .into_iter()
                .filter_map(|(pathbuf, stat)| {
                    let name = pathbuf.file_name()?.to_string_lossy().to_string();
                    if name == "." || name == ".." {
                        return None;
                    }
                    Some(RemoteFileEntry {
                        name,
                        path: pathbuf.to_string_lossy().to_string(),
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
        let session = self
            .session
            .lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let sftp = session
            .sftp()
            .map_err(|e| format!("SFTP subsystem error: {}", e))?;

        let mut remote_file = sftp
            .open(Path::new(remote_path))
            .map_err(|e| format!("Cannot open remote file {}: {}", remote_path, e))?;

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
            .create(Path::new(remote_path))
            .map_err(|e| format!("Cannot create remote file {}: {}", remote_path, e))?;

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
        self.with_sftp(|sftp| {
            sftp.mkdir(Path::new(path), 0o755)
                .map_err(|e| format!("Cannot create directory {}: {}", path, e))
        })
    }

    pub fn delete_file(&self, path: &str) -> Result<(), String> {
        self.with_sftp(|sftp| {
            sftp.unlink(Path::new(path))
                .map_err(|e| format!("Cannot delete {}: {}", path, e))
        })
    }

    pub fn delete_dir(&self, path: &str) -> Result<(), String> {
        self.with_sftp(|sftp| {
            sftp.rmdir(Path::new(path))
                .map_err(|e| format!("Cannot remove directory {}: {}", path, e))
        })
    }

    pub fn rename(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        self.with_sftp(|sftp| {
            sftp.rename(Path::new(old_path), Path::new(new_path), None)
                .map_err(|e| format!("Cannot rename {} to {}: {}", old_path, new_path, e))
        })
    }

    pub fn stat(&self, path: &str) -> Result<RemoteFileEntry, String> {
        self.with_sftp(|sftp| {
            let stat = sftp
                .stat(Path::new(path))
                .map_err(|e| format!("Cannot stat {}: {}", path, e))?;
            let name = Path::new(path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string());
            Ok(RemoteFileEntry {
                name,
                path: path.to_string(),
                is_dir: stat.is_dir(),
                size: stat.size.unwrap_or(0),
                permissions: stat.perm.unwrap_or(0),
                modified: stat.mtime.unwrap_or(0),
            })
        })
    }

    pub fn read_text_file(&self, remote_path: &str, max_size: u64) -> Result<String, String> {
        let session = self
            .session
            .lock()
            .map_err(|e| format!("Session lock error: {}", e))?;
        let sftp = session
            .sftp()
            .map_err(|e| format!("SFTP subsystem error: {}", e))?;

        let stat = sftp
            .stat(Path::new(remote_path))
            .map_err(|e| format!("Cannot stat {}: {}", remote_path, e))?;

        if stat.size.unwrap_or(0) > max_size {
            return Err(format!(
                "File too large ({}B > {}B)",
                stat.size.unwrap_or(0),
                max_size
            ));
        }

        let mut file = sftp
            .open(Path::new(remote_path))
            .map_err(|e| format!("Cannot open {}: {}", remote_path, e))?;

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
            Ok(realpath.to_string_lossy().to_string())
        })
    }

    pub fn is_connected(&self) -> bool {
        self.session.lock().map(|s| s.authenticated()).unwrap_or(false)
    }
}

impl Drop for SftpSession {
    fn drop(&mut self) {
        if let Ok(session) = self.session.lock() {
            let _ = session.disconnect(None, "SFTP session closed", None);
        }
    }
}
