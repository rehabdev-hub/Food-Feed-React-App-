// src/supabaseClient.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ✅ Runtime checks for safety
if (!supabaseUrl) {
  throw new Error("❌ Missing VITE_SUPABASE_URL in .env file");
}
if (!supabaseAnonKey) {
  throw new Error("❌ Missing VITE_SUPABASE_ANON_KEY in .env file");
}

// ✅ Initialize Supabase client with auth persistence
const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ✅ Export both (default + named)
export default supabase;   // use:  import supabase from "../supabaseClient";
export { supabase };       // or:   import { supabase } from "../supabaseClient";
