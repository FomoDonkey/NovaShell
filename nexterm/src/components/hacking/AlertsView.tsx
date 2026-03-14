import { AlertTriangle, Shield, Info, Trash2, X } from "lucide-react";
import { useAppStore } from "../../store/appStore";

export function AlertsView() {
  const alerts = useAppStore((s) => s.hackingAlerts);
  const clearHackingAlerts = useAppStore((s) => s.clearHackingAlerts);
  const dismissHackingAlert = useAppStore((s) => s.dismissHackingAlert);

  const severityIcon = (severity: string) => {
    switch (severity) {
      case "critical": return <AlertTriangle size={11} />;
      case "warning": return <Shield size={11} />;
      default: return <Info size={11} />;
    }
  };

  const severityColor = (severity: string) => {
    switch (severity) {
      case "critical": return "#ff0040";
      case "warning": return "#ffaf00";
      default: return "#00d4ff";
    }
  };

  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const warningCount = alerts.filter((a) => a.severity === "warning").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <AlertTriangle size={12} style={{ color: "#ffaf00" }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>
          Security Alerts
        </span>
        {alerts.length > 0 && (
          <button
            onClick={clearHackingAlerts}
            style={{
              background: "var(--bg-active)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              padding: "2px 6px",
              fontSize: 9,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 3,
            }}
          >
            <Trash2 size={9} />
            Clear All
          </button>
        )}
      </div>

      {/* Summary */}
      {alerts.length > 0 && (
        <div style={{ display: "flex", gap: 6 }}>
          {criticalCount > 0 && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 10,
              background: "rgba(255, 0, 64, 0.1)",
              border: "1px solid rgba(255, 0, 64, 0.2)",
              fontSize: 9,
              color: "#ff0040",
              fontWeight: 700,
            }}>
              <AlertTriangle size={9} />
              {criticalCount} Critical
            </div>
          )}
          {warningCount > 0 && (
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 10,
              background: "rgba(255, 175, 0, 0.1)",
              border: "1px solid rgba(255, 175, 0, 0.2)",
              fontSize: 9,
              color: "#ffaf00",
              fontWeight: 700,
            }}>
              <Shield size={9} />
              {warningCount} Warning
            </div>
          )}
        </div>
      )}

      {/* Alert List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {alerts.map((alert) => (
          <div
            key={alert.id}
            style={{
              padding: "8px 10px",
              background: "var(--bg-tertiary)",
              border: `1px solid ${severityColor(alert.severity)}33`,
              borderLeft: `3px solid ${severityColor(alert.severity)}`,
              borderRadius: "var(--radius-sm)",
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
            }}
          >
            <span style={{ color: severityColor(alert.severity), flexShrink: 0, marginTop: 1 }}>
              {severityIcon(alert.severity)}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 3,
              }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)" }}>
                  {alert.title}
                </span>
                <span style={{
                  fontSize: 8,
                  padding: "1px 5px",
                  borderRadius: 6,
                  background: severityColor(alert.severity) + "22",
                  color: severityColor(alert.severity),
                  fontWeight: 700,
                  textTransform: "uppercase",
                }}>
                  {alert.severity}
                </span>
              </div>
              <div style={{ fontSize: 10, color: "var(--text-secondary)", wordBreak: "break-word" }}>
                {alert.details}
              </div>
              <div style={{ fontSize: 8, color: "var(--text-muted)", marginTop: 3 }}>
                {new Date(alert.timestamp).toLocaleTimeString()} | {alert.category}
              </div>
            </div>
            <button
              onClick={() => dismissHackingAlert(alert.id)}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: 2,
                flexShrink: 0,
              }}
            >
              <X size={10} />
            </button>
          </div>
        ))}

        {alerts.length === 0 && (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            color: "var(--text-muted)",
          }}>
            <Shield size={28} style={{ opacity: 0.3 }} />
            <span style={{ fontSize: 11 }}>No alerts</span>
            <span style={{ fontSize: 9, opacity: 0.6 }}>Run a recon scan to detect security issues</span>
          </div>
        )}
      </div>
    </div>
  );
}
