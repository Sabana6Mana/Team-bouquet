import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim()

export const backendConfig = Object.freeze({
  configured: Boolean(supabaseUrl && supabaseKey),
  kakaoEnabled: import.meta.env.VITE_KAKAO_LOGIN_ENABLED === 'true',
  url: supabaseUrl ?? null,
})

/**
 * A nullable client keeps the demo frontend usable before `.env.local` exists.
 * Feature code should call `requireSupabase()` when it actually needs backend IO.
 */
export const supabase: SupabaseClient<Database> | null = backendConfig.configured
  ? createClient<Database>(supabaseUrl!, supabaseKey!, {
      auth: {
        persistSession: typeof window !== 'undefined',
        autoRefreshToken: typeof window !== 'undefined',
        detectSessionInUrl: typeof window !== 'undefined',
      },
    })
  : null

export class BackendNotConfiguredError extends Error {
  constructor() {
    super(
      'Supabase is not configured. Set VITE_SUPABASE_URL and '
        + 'VITE_SUPABASE_PUBLISHABLE_KEY in .env.local.',
    )
    this.name = 'BackendNotConfiguredError'
  }
}

export function requireSupabase(): SupabaseClient<Database> {
  if (!supabase) throw new BackendNotConfiguredError()
  return supabase
}
