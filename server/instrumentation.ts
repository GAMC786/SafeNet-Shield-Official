import { initializeGlitchTip } from "./glitchtip";

// This module is imported before Express so the SDK can install its request
// instrumentation before the framework is evaluated.
initializeGlitchTip();