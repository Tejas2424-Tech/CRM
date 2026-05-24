import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CrmProvider } from "./context/CrmContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CrmProvider>
      <App />
    </CrmProvider>
  </StrictMode>
);
