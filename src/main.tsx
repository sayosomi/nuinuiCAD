import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppLayout } from "./components/AppLayout";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppLayout />
  </StrictMode>
);
