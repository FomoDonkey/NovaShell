// RDP launcher — opens the platform's native Remote Desktop client
// (mstsc.exe on Windows, Microsoft Remote Desktop via .rdp file on macOS,
// xfreerdp on Linux) with credentials pre-injected so the user gets a
// one-click experience equivalent to the SSH save flow.

use std::process::Command;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

// Reject characters that could escape arg boundaries, corrupt .rdp parsing,
// or break URL/credential injection. `Command::arg()` quotes correctly for
// CreateProcess, but we still don't want CR/LF/NUL/quote inside identifiers.
fn validate_field(field: &str, name: &str) -> Result<(), String> {
    if field.is_empty() {
        return Err(format!("{} cannot be empty", name));
    }
    for c in field.chars() {
        if c == '\0' || c == '\r' || c == '\n' || c == '"' {
            return Err(format!("{} contains illegal character", name));
        }
    }
    Ok(())
}

fn validate_host(host: &str) -> Result<(), String> {
    validate_field(host, "host")?;
    if host.contains(' ') || host.contains('\t') {
        return Err("host cannot contain whitespace".into());
    }
    if host.contains('\\') || host.contains('/') {
        return Err("host cannot contain '\\' or '/'".into());
    }
    Ok(())
}

#[cfg(any(windows, target_os = "macos"))]
fn build_rdp_file(
    full_address: &str,
    username: &str,
    fullscreen: bool,
    width: Option<u32>,
    height: Option<u32>,
    multimon: bool,
    admin: bool,
) -> String {
    let mut s = String::new();
    s.push_str(&format!("full address:s:{}\r\n", full_address));
    s.push_str(&format!("username:s:{}\r\n", username));
    s.push_str(&format!("screen mode id:i:{}\r\n", if fullscreen { 2 } else { 1 }));
    if !fullscreen {
        s.push_str(&format!("desktopwidth:i:{}\r\n", width.unwrap_or(1280)));
        s.push_str(&format!("desktopheight:i:{}\r\n", height.unwrap_or(800)));
    }
    s.push_str(&format!("use multimon:i:{}\r\n", if multimon { 1 } else { 0 }));
    s.push_str("session bpp:i:32\r\n");
    s.push_str("compression:i:1\r\n");
    s.push_str("audiomode:i:0\r\n");
    s.push_str("redirectclipboard:i:1\r\n");
    s.push_str("redirectprinters:i:0\r\n");
    s.push_str("redirectsmartcards:i:0\r\n");
    s.push_str("disable wallpaper:i:0\r\n");
    s.push_str("allow desktop composition:i:1\r\n");
    s.push_str("allow font smoothing:i:1\r\n");
    s.push_str("authentication level:i:2\r\n");
    s.push_str("prompt for credentials:i:0\r\n");
    s.push_str("negotiate security layer:i:1\r\n");
    if admin {
        s.push_str("administrative session:i:1\r\n");
    }
    s
}

// On Windows, check whether a credential already exists for TERMSRV/<host>
// without parsing localized output. We send `cmdkey /list:TERMSRV/<host>` and
// count occurrences of the literal target string in stdout. The header line
// echoes the target back once whether or not an entry exists; a matching
// entry adds a second occurrence in the detail block. This is locale-safe.
#[cfg(windows)]
fn termsrv_credential_exists(host: &str) -> bool {
    let needle = format!("TERMSRV/{}", host);
    let mut cmd = Command::new("cmdkey");
    cmd.arg(format!("/list:TERMSRV/{}", host))
        .creation_flags(CREATE_NO_WINDOW);
    match cmd.output() {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.matches(&needle).count() > 1
        }
        Err(_) => false,
    }
}

pub fn launch_rdp(
    host: String,
    port: Option<u16>,
    username: String,
    domain: Option<String>,
    password: Option<String>,
    fullscreen: Option<bool>,
    width: Option<u32>,
    height: Option<u32>,
    multimon: Option<bool>,
    admin: Option<bool>,
) -> Result<(), String> {
    validate_host(&host)?;
    validate_field(&username, "username")?;
    if let Some(d) = &domain {
        validate_field(d, "domain")?;
        // When domain is set explicitly, refuse a username that already
        // carries its own domain prefix — otherwise we'd build "DOM\\dom\\user"
        // and mstsc would parse the wrong domain.
        if !d.is_empty() && (username.contains('\\') || username.contains('/')) {
            return Err("when domain is set, username must not contain '\\' or '/'".into());
        }
    }
    if let Some(p) = password.as_ref() {
        if p.contains('\0') || p.contains('\r') || p.contains('\n') {
            return Err("password contains illegal characters".into());
        }
    }
    let port_num = port.unwrap_or(3389);
    if port_num == 0 {
        return Err("port must be > 0".into());
    }
    let host_port = format!("{}:{}", host, port_num);

    // Windows accepts both "user@domain" and "domain\\user". cmdkey + mstsc
    // both prefer the backslash form for AD/Windows accounts.
    let full_user = match &domain {
        Some(d) if !d.is_empty() => format!("{}\\{}", d, username),
        _ => username.clone(),
    };

    #[cfg(windows)]
    {
        // We only inject credentials if the user provided a password AND the
        // OS doesn't already have a credential under TERMSRV/<host>. Skipping
        // when an entry exists avoids destroying the user's manually-saved
        // credentials at cleanup time.
        let we_injected = if let Some(pass) = password.as_ref() {
            if termsrv_credential_exists(&host) {
                false
            } else {
                let mut cmd = Command::new("cmdkey");
                cmd.arg(format!("/generic:TERMSRV/{}", host))
                    .arg(format!("/user:{}", full_user))
                    .arg(format!("/pass:{}", pass))
                    .creation_flags(CREATE_NO_WINDOW);
                let out = cmd.output().map_err(|e| format!("cmdkey: {}", e))?;
                if !out.status.success() {
                    let stderr = String::from_utf8_lossy(&out.stderr);
                    return Err(format!("cmdkey failed: {}", stderr.trim()));
                }
                true
            }
        } else {
            false
        };

        // Write a temp .rdp file so mstsc picks up resolution / fullscreen.
        let rdp_content = build_rdp_file(
            &host_port,
            &full_user,
            fullscreen.unwrap_or(false),
            width,
            height,
            multimon.unwrap_or(false),
            admin.unwrap_or(false),
        );
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("novashell-{}.rdp", uuid::Uuid::new_v4()));
        std::fs::write(&temp_file, rdp_content)
            .map_err(|e| format!("write rdp file: {}", e))?;

        let mut mstsc = Command::new("mstsc");
        mstsc.arg(&temp_file);
        if admin.unwrap_or(false) {
            mstsc.arg("/admin");
        }
        mstsc.creation_flags(CREATE_NO_WINDOW);
        mstsc.spawn().map_err(|e| format!("mstsc spawn: {}", e))?;

        // Cleanup runs on a detached thread. mstsc reads the credential during
        // connection establishment (typically <2s, occasionally longer on slow
        // networks); 10s is a safe upper bound. We only delete the cmdkey
        // entry if WE created it — never touch the user's pre-existing creds.
        let host_for_cleanup = host.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(10));
            let _ = std::fs::remove_file(&temp_file);
            if we_injected {
                let mut c = Command::new("cmdkey");
                c.arg(format!("/delete:TERMSRV/{}", host_for_cleanup))
                    .creation_flags(CREATE_NO_WINDOW);
                let _ = c.output();
            }
        });

        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        // Microsoft Remote Desktop on macOS reliably opens .rdp files via
        // `open -a`. Earlier versions of this code used `rdp://` URLs but
        // those expose URL-injection risk through the host/user fields and
        // the URL grammar Microsoft accepts is undocumented.
        let _ = password; // MRD on macOS prompts for password; cannot pass it.
        let rdp_content = build_rdp_file(
            &host_port,
            &full_user,
            fullscreen.unwrap_or(false),
            width,
            height,
            multimon.unwrap_or(false),
            admin.unwrap_or(false),
        );
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("novashell-{}.rdp", uuid::Uuid::new_v4()));
        std::fs::write(&temp_file, rdp_content)
            .map_err(|e| format!("write rdp file: {}", e))?;

        Command::new("open")
            .arg("-a")
            .arg("Microsoft Remote Desktop")
            .arg(&temp_file)
            .spawn()
            .map_err(|e| format!("open: {}", e))?;

        // Delete the temp file after a delay so MRD has time to read it
        let temp_file_cleanup = temp_file.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(10));
            let _ = std::fs::remove_file(&temp_file_cleanup);
        });
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        use std::io::Write;
        use std::process::Stdio;
        let _ = (multimon, admin);
        let mut cmd = Command::new("xfreerdp");
        cmd.arg(format!("/v:{}", host_port))
            .arg(format!("/u:{}", username));
        if let Some(d) = &domain {
            cmd.arg(format!("/d:{}", d));
        }
        // `/p:` would put the password on the process command line, visible
        // to any local user via /proc/<pid>/cmdline. Use `/from-stdin` so
        // xfreerdp reads from stdin instead.
        let pipe_password = password.is_some();
        if pipe_password {
            cmd.arg("/from-stdin").stdin(Stdio::piped());
        }
        if fullscreen.unwrap_or(false) {
            cmd.arg("/f");
        } else if let (Some(w), Some(h)) = (width, height) {
            cmd.arg(format!("/size:{}x{}", w, h));
        }
        cmd.arg("/cert:tofu");
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("xfreerdp not available: {}. Install xfreerdp or remmina.", e))?;
        if pipe_password {
            if let (Some(pass), Some(stdin)) = (password.as_ref(), child.stdin.as_mut()) {
                let _ = writeln!(stdin, "{}", pass);
            }
        }
        return Ok(());
    }
}
