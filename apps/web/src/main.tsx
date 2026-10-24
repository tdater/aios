import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { setPlatform } from "./platform";
import { isNativeShell, nativePlatform } from "./platform/capacitor";
import "./styles.css";

if (isNativeShell()) setPlatform(nativePlatform());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
