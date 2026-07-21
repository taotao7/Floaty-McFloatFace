import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./lib/disableContextMenu";

const root = document.getElementById("root") as HTMLElement;

async function mount() {
  try {
    const { default: CursorOverlayWindow } = await import("./windows/CursorOverlayWindow");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <CursorOverlayWindow />
      </React.StrictMode>,
    );
  } catch (err) {
    console.error("[cursor] Failed to mount:", err);
    root.innerHTML = `<pre style="padding:20px;color:red;font-size:13px;">${err}\n${(err as Error)?.stack ?? ""}</pre>`;
  }
}

void mount();
