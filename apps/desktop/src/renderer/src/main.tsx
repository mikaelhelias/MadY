import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { hydrateUserLibrary } from "./shell/durableStore";
import { installErrorCapture, installInteractionCapture } from "./shell/bugReport";
import { migrateTemplatesIntoPresets } from "./shell/migrateTemplates";

// Start capturing runtime errors before anything else mounts, so a failure during
// startup is still in the ring buffer if the user files a report. The interaction
// trail starts alongside: clicks and drags recorded globally, so a report about a
// control that does nothing carries the gesture that hit it (sent only with explicit consent).
installErrorCapture();
installInteractionCapture();

const container = document.getElementById("root");
if (!container) throw new Error("root element missing");

function mount(): void {
  createRoot(container!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

// Restore the durable style library (custom presets/templates/default) from the
// userData file before the app reads localStorage, so a wipe / fresh origin
// doesn't start blank. Best-effort + time-boxed so startup never blocks on it.
void Promise.race([
  hydrateUserLibrary().catch(() => {}),
  new Promise<void>((r) => setTimeout(r, 1500)),
])
  .finally(() => {
    // Saved "My templates" become presets (per-type sections) — after the keys are in place,
    // and again on a later boot if the userData restore brought templates in late.
    const report = migrateTemplatesIntoPresets();
    if (report.refused.length) console.warn("[presets] templates not converted (the preset list is full):", report.refused);
    mount();
  });
