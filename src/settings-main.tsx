import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";

// Lazy import to catch module-level errors
const root = document.getElementById("root") as HTMLElement;

async function mount() {
  try {
    const { SettingsWindow } = await import("./windows/SettingsWindow");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <SettingsWindow />
      </React.StrictMode>,
    );
  } catch (err) {
    console.error("[settings] Failed to mount:", err);
    root.innerHTML = `<pre style="padding:20px;color:red;font-size:13px;">${err}\n${(err as Error)?.stack ?? ""}</pre>`;
  }
}

void mount();
