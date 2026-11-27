import { createClient } from "@supabase/supabase-js";

const runtimeConfig = typeof window === "undefined"
  ? undefined
  : window.__SAFENET_RUNTIME_CONFIG__;
const supabaseUrl = (
  runtimeConfig?.supabaseUrl
  || (import.meta.env.DEV
    ? import.meta.env.VITE_SUPABASE_DEVELOPMENT_URL
    : import.meta.env.VITE_SUPABASE_URL)
)?.trim();
const supabasePublishableKey = (
  runtimeConfig?.supabasePublishableKey
  || (import.meta.env.DEV
    ? import.meta.env.VITE_SUPABASE_DEVELOPMENT_PUBLISHABLE_KEY
    : import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
)?.trim();

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error(
    import.meta.env.DEV
      ? "Missing development Supabase URL or publishable key."
      : "Missing production Supabase URL or publishable key.",
  );
}

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    flowType: "pkce",
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
