import React from "react";
import ReactDOM from "react-dom/client";
import "./styles.css";
import "./lib/disableContextMenu";
import { initTheme } from "./lib/theme";

initTheme();

const root = document.getElementById("root") as HTMLElement;

async function mount() {
  try {
    const { default: RegionSelectWindow } = await import("./windows/RegionSelectWindow");
    ReactDOM.createRoot(root).render(
      <React.StrictMode>
        <RegionSelectWindow />
      </React.StrictMode>,
    );
  } catch (err) {
    console.error("[region] Failed to mount:", err);
    root.innerHTML = `<pre style="padding:20px;color:red;font-size:13px;">${err}\n${(err as Error)?.stack ?? ""}</pre>`;
  }
}

void mount();
