use serde::{Deserialize, Serialize};
use sysinfo::System;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Serialize, Deserialize, Clone)]
pub struct SystemStats {
    pub cpu_usage: f32,
    pub memory_used: u64,
    pub memory_total: u64,
    pub memory_percent: f32,
    pub processes_count: usize,
    pub hostname: String,
    pub os_name: String,
    pub uptime: u64,
}

// Refresh process count only every 10th call (~10 min at 60s intervals)
// to avoid the heavy enumerate-all-processes syscall on every poll
static CALL_COUNTER: AtomicUsize = AtomicUsize::new(0);
static CACHED_PROCESS_COUNT: AtomicUsize = AtomicUsize::new(0);

pub fn get_stats(sys: &mut System) -> SystemStats {
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let count = CALL_COUNTER.fetch_add(1, Ordering::Relaxed);
    let processes_count = if count % 10 == 0 {
        sys.refresh_processes();
        let n = sys.processes().len();
        CACHED_PROCESS_COUNT.store(n, Ordering::Relaxed);
        n
    } else {
        CACHED_PROCESS_COUNT.load(Ordering::Relaxed)
    };

    let memory_used = sys.used_memory();
    let memory_total = sys.total_memory();

    SystemStats {
        cpu_usage: sys.global_cpu_info().cpu_usage(),
        memory_used,
        memory_total,
        memory_percent: if memory_total > 0 {
            (memory_used as f32 / memory_total as f32) * 100.0
        } else {
            0.0
        },
        processes_count,
        hostname: System::host_name().unwrap_or_default(),
        os_name: System::long_os_version().unwrap_or_default(),
        uptime: System::uptime(),
    }
}
