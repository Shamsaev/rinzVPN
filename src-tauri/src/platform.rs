//! Всё, что зависит от Windows: системный прокси, права администратора,
//! Job Object (чтобы ядра умирали вместе с приложением) и скрытие консоли.
//! На других ОС — заглушки, чтобы проект собирался и там.

use std::process::Command;

pub const PROXY_BYPASS: &str = "localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.20.*;172.21.*;172.22.*;172.23.*;172.24.*;172.25.*;172.26.*;172.27.*;172.28.*;172.29.*;172.30.*;172.31.*;192.168.*;<local>";

/// Скрыть окно консоли у дочернего процесса.
pub fn hide_console(cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    let _ = cmd;
}

pub fn exe_name(base: &str) -> String {
    if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    }
}

// ---------------- системный прокси ----------------

#[derive(Clone, Debug, Default)]
#[allow(dead_code)] // на не-Windows поля только пишутся
pub struct ProxySnapshot {
    pub enable: u32,
    pub server: String,
    pub bypass: String,
}

#[cfg(windows)]
mod sysproxy_impl {
    use super::*;
    use winreg::enums::*;
    use winreg::RegKey;

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    fn key() -> std::io::Result<RegKey> {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (k, _) = hkcu.create_subkey(KEY)?;
        Ok(k)
    }

    fn refresh() {
        use windows_sys::Win32::Networking::WinInet::{
            InternetSetOptionW, INTERNET_OPTION_REFRESH, INTERNET_OPTION_SETTINGS_CHANGED,
        };
        unsafe {
            InternetSetOptionW(std::ptr::null(), INTERNET_OPTION_SETTINGS_CHANGED, std::ptr::null(), 0);
            InternetSetOptionW(std::ptr::null(), INTERNET_OPTION_REFRESH, std::ptr::null(), 0);
        }
    }

    pub fn read() -> std::io::Result<ProxySnapshot> {
        let k = key()?;
        Ok(ProxySnapshot {
            enable: k.get_value("ProxyEnable").unwrap_or(0),
            server: k.get_value("ProxyServer").unwrap_or_default(),
            bypass: k.get_value("ProxyOverride").unwrap_or_default(),
        })
    }

    pub fn write(s: &ProxySnapshot) -> std::io::Result<()> {
        let k = key()?;
        k.set_value("ProxyEnable", &s.enable)?;
        k.set_value("ProxyServer", &s.server)?;
        k.set_value("ProxyOverride", &s.bypass)?;
        refresh();
        Ok(())
    }
}

#[cfg(not(windows))]
mod sysproxy_impl {
    use super::*;
    pub fn read() -> std::io::Result<ProxySnapshot> {
        Ok(ProxySnapshot::default())
    }
    pub fn write(_s: &ProxySnapshot) -> std::io::Result<()> {
        Ok(())
    }
}

pub use sysproxy_impl::{read as read_proxy, write as write_proxy};

pub fn our_proxy_server(http_port: u16) -> String {
    format!("127.0.0.1:{http_port}")
}

/// Включает системный прокси и возвращает то, что было до нас.
pub fn enable_proxy(http_port: u16) -> std::io::Result<ProxySnapshot> {
    let before = read_proxy()?;
    write_proxy(&ProxySnapshot {
        enable: 1,
        server: our_proxy_server(http_port),
        bypass: PROXY_BYPASS.to_string(),
    })?;
    Ok(before)
}

// ---------------- права администратора ----------------

#[cfg(windows)]
pub fn is_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            &mut elevation as *mut _ as *mut _,
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        );
        CloseHandle(token);
        ok != 0 && elevation.TokenIsElevated != 0
    }
}

#[cfg(not(windows))]
pub fn is_elevated() -> bool {
    true
}

/// Перезапускает приложение с запросом прав администратора (UAC).
#[cfg(windows)]
pub fn relaunch_as_admin(args: &str) -> Result<(), String> {
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let verb = wide("runas");
    let file = wide(&exe.to_string_lossy());
    let params = wide(args);
    let res = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            verb.as_ptr(),
            file.as_ptr(),
            params.as_ptr(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if (res as isize) <= 32 {
        return Err("Запуск от имени администратора отменён".into());
    }
    Ok(())
}

#[cfg(not(windows))]
pub fn relaunch_as_admin(_args: &str) -> Result<(), String> {
    Err("Доступно только в Windows".into())
}

// ---------------- Job Object ----------------

/// Job Object с флагом KILL_ON_JOB_CLOSE: если Nebo упадёт или его убьют
/// через диспетчер задач, Windows сама завершит xray и sing-box,
/// и TUN-интерфейс не останется висеть.
#[cfg(windows)]
pub struct KillOnCloseJob(windows_sys::Win32::Foundation::HANDLE);

#[cfg(windows)]
unsafe impl Send for KillOnCloseJob {}
#[cfg(windows)]
unsafe impl Sync for KillOnCloseJob {}

#[cfg(windows)]
impl KillOnCloseJob {
    pub fn new() -> Option<Self> {
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            Some(Self(job))
        }
    }

    pub fn assign(&self, child: &std::process::Child) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;
        unsafe {
            AssignProcessToJobObject(self.0, child.as_raw_handle() as _);
        }
    }
}

#[cfg(not(windows))]
pub struct KillOnCloseJob;

#[cfg(not(windows))]
impl KillOnCloseJob {
    pub fn new() -> Option<Self> {
        Some(Self)
    }
    pub fn assign(&self, _child: &std::process::Child) {}
}
