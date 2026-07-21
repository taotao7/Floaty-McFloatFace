import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import KeyboardWindow from "./windows/KeyboardWindow";
import "./styles.css";
import "./lib/disableContextMenu";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KeyboardWindow />
  </StrictMode>
);
