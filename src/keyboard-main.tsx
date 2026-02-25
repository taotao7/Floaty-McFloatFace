import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import KeyboardWindow from "./windows/KeyboardWindow";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <KeyboardWindow />
  </StrictMode>
);
