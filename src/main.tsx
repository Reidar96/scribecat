import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SessionGate } from "./components/web/SessionGate";

import "@/i18n";
import "@/store/useThemeStore";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SessionGate>
      <App />
    </SessionGate>
  </React.StrictMode>,
);
