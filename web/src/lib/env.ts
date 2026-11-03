// Demo mode runs the whole UI on synthetic data when Supabase isn't configured,
// so the app can be previewed (and designed) before the backend exists.
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const isDemo = !supabaseUrl || !supabaseAnonKey;

export const DEMO_COOKIE = "wb_demo_role";
