import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTheme } from "./lib/theme";
import "./styles.css";

initTheme();

const root = document.getElementById("root");
if (root === null) throw new Error("missing #root");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
