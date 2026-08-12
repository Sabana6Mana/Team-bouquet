import { App as NativeApp } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { supabase } from '../backend/client'

export const NATIVE_AUTH_REDIRECT = 'com.teambouquet.matchpoint://auth/callback'
const NATIVE_AUTH_ERROR_KEY = 'matchpoint-native-auth-error'

export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform()
}

function navigateNative(path: string) {
  window.history.replaceState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

function rememberNativeAuthError(message: string) {
  window.sessionStorage.setItem(NATIVE_AUTH_ERROR_KEY, message)
  navigateNative('/login')
}

export function consumeNativeAuthError(): string | null {
  const message = window.sessionStorage.getItem(NATIVE_AUTH_ERROR_KEY)
  if (message) window.sessionStorage.removeItem(NATIVE_AUTH_ERROR_KEY)
  return message
}

async function handleNativeAuthUrl(url: string) {
  if (!url.startsWith(NATIVE_AUTH_REDIRECT)) return

  try {
    await Browser.close()
  } catch {
    // Android Custom Tabs closes itself when the deep link returns to the app.
  }

  if (!supabase) {
    rememberNativeAuthError('Supabase 연결 정보가 없어 로그인을 완료할 수 없습니다.')
    return
  }

  const callback = new URL(url)
  const error = callback.searchParams.get('error_description')
    ?? callback.searchParams.get('error')
  if (error) {
    rememberNativeAuthError(decodeURIComponent(error.replace(/\+/g, ' ')))
    return
  }

  const code = callback.searchParams.get('code')
  if (code) {
    const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
    if (exchangeError) {
      rememberNativeAuthError(exchangeError.message)
      return
    }
    navigateNative('/auth/callback')
    return
  }

  // Hosted projects may still use an implicit callback. Supporting both keeps
  // the native shell compatible while the project migrates fully to PKCE.
  const fragment = new URLSearchParams(callback.hash.replace(/^#/, ''))
  const accessToken = fragment.get('access_token')
  const refreshToken = fragment.get('refresh_token')
  if (accessToken && refreshToken) {
    const { error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (sessionError) {
      rememberNativeAuthError(sessionError.message)
      return
    }
    navigateNative('/auth/callback')
    return
  }

  rememberNativeAuthError('로그인 응답에 인증 코드가 없습니다. 다시 시도해 주세요.')
}

export async function openNativeAuth(url: string): Promise<void> {
  await Browser.open({ url })
}

/** Register native deep-link and Android hardware-back behavior once. */
export async function initializeNativeRuntime(): Promise<void> {
  if (!isNativeApp()) return

  await NativeApp.addListener('appUrlOpen', ({ url }) => {
    void handleNativeAuthUrl(url)
  })

  await NativeApp.addListener('backButton', ({ canGoBack }) => {
    const isRoot = window.location.pathname === '/'
    if (!isRoot && canGoBack) {
      window.history.back()
      return
    }
    void NativeApp.minimizeApp()
  })

  const launch = await NativeApp.getLaunchUrl()
  if (launch?.url) await handleNativeAuthUrl(launch.url)
}

export async function getDeviceCoords(): Promise<{ lat: number; lng: number } | null> {
  if (isNativeApp()) {
    let permission = await Geolocation.checkPermissions()
    if (permission.location === 'prompt' || permission.location === 'prompt-with-rationale') {
      permission = await Geolocation.requestPermissions()
    }
    if (permission.location !== 'granted' && permission.coarseLocation !== 'granted') return null

    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 8000,
    })
    return { lat: position.coords.latitude, lng: position.coords.longitude }
  }

  if (!navigator.geolocation) return null
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000 },
    )
  })
}
