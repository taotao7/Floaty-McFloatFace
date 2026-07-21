import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./lib/disableContextMenu";

// Lazy import to surface module-level errors instead of a blank window.
const root = document.getElementById("root") as HTMLElement;

async function mount() {
  try {
    const { default: RecordingControlWindow } = await import("./windows/RecordingControlWindow");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <RecordingControlWindow />
      </React.StrictMode>,
    );
  } catch (err) {
    console.error("[recording] Failed to mount:", err);
    root.innerHTML = `<pre style="padding:20px;color:red;font-size:13px;">${err}\n${(err as Error)?.stack ?? ""}</pre>`;
  }
}

void mount();
