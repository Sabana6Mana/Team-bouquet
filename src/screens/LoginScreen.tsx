import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackend } from '../context/BackendProvider'
import { consumeNativeAuthError } from '../lib/nativeRuntime'
import { isValidKoreanPhone } from '../lib/phone'

const RESEND_WAIT_SECONDS = 60

function formatPhoneNumber(value: string) {
  let digits = value.replace(/\D/g, '')
  if (digits.startsWith('0082')) digits = digits.slice(4)
  else if (digits.startsWith('82')) digits = digits.slice(2)
  if (digits.startsWith('10')) digits = `0${digits}`
  digits = digits.slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
}

export default function LoginScreen() {
  const backend = useBackend()
  const nav = useNavigate()
  const tokenInputRef = useRef<HTMLInputElement>(null)
  const [phone, setPhone] = useState('')
  const [token, setToken] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'error'
    text: string
  } | null>(() => {
    const nativeError = consumeNativeAuthError()
    return nativeError ? { tone: 'error', text: nativeError } : null
  })

  const phoneDigits = useMemo(() => phone.replace(/\D/g, ''), [phone])
  const validPhone = isValidKoreanPhone(phone)

  useEffect(() => {
    if (backend.phoneVerified) nav('/onboarding', { replace: true })
  }, [backend.phoneVerified, nav])

  useEffect(() => {
    if (!sent) return
    tokenInputRef.current?.focus()
  }, [sent])

  useEffect(() => {
    if (resendSeconds <= 0) return
    const timer = window.setInterval(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [resendSeconds])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setFeedback(null)
    try {
      await action()
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: error instanceof Error ? error.message : '인증 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
      })
    } finally {
      setBusy(false)
    }
  }

  const sendCode = async () => {
    if (!validPhone) {
      setFeedback({ tone: 'error', text: '010으로 시작하는 휴대폰 번호 11자리를 확인해 주세요.' })
      return
    }

    await run(async () => {
      await backend.sendPhoneOtp(phone)
      setSent(true)
      setToken('')
      setResendSeconds(RESEND_WAIT_SECONDS)
      setFeedback({ tone: 'success', text: '인증번호를 보냈습니다. 문자 메시지를 확인해 주세요.' })
    })
  }

  const verifyCode = async () => {
    if (token.length !== 6) {
      setFeedback({ tone: 'error', text: '문자로 받은 인증번호 6자리를 입력해 주세요.' })
      return
    }

    await run(async () => {
      await backend.verifyPhoneOtp(phone, token)
      setFeedback({ tone: 'success', text: '본인 인증이 완료되었습니다.' })
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sent) void verifyCode()
    else void sendCode()
  }

  const changePhone = () => {
    setSent(false)
    setToken('')
    setResendSeconds(0)
    setFeedback(null)
  }

  return (
    <div className="screen">
      <main className="pad stack" style={{ gap: 22, minHeight: '100%', justifyContent: 'center' }}>
        <div className="stack center" style={{ gap: 10, textAlign: 'center' }}>
          <div
            aria-hidden="true"
            style={{
              width: 64,
              height: 64,
              borderRadius: 20,
              display: 'grid',
              placeItems: 'center',
              background: 'linear-gradient(135deg,var(--court),var(--court-2))',
              fontSize: 30,
            }}
          >
            🏟️
          </div>
          <h1 className="h1">MATCHPOINT</h1>
          <p className="body" style={{ margin: 0 }}>운동의 시작, 본인 인증부터</p>
        </div>

        <div
          aria-label="가입 진행 단계"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto 1fr',
            alignItems: 'center',
            gap: 10,
            color: 'var(--muted)',
          }}
        >
          <div className="stack center" style={{ gap: 5, color: 'var(--green)' }}>
            <strong className="mono" style={{ fontSize: 13 }}>01</strong>
            <span className="small">휴대폰 인증</span>
          </div>
          <div aria-hidden="true" style={{ width: 38, height: 1, background: 'var(--line)' }} />
          <div className="stack center" style={{ gap: 5 }}>
            <strong className="mono" style={{ fontSize: 13 }}>02</strong>
            <span className="small">프로필 만들기</span>
          </div>
        </div>

        <section className="card stack" style={{ gap: 16 }} aria-labelledby="phone-auth-title">
          <div className="stack" style={{ gap: 6 }}>
            <h2 id="phone-auth-title" style={{ margin: 0, fontSize: 20 }}>휴대폰 본인 인증</h2>
            <p className="small" style={{ margin: 0, lineHeight: 1.55 }}>
              안전한 매칭을 위해 휴대폰 번호의 소유 여부만 확인합니다.
              이름·생년월일·통신사는 수집하지 않습니다.
            </p>
          </div>

          <form className="stack" style={{ gap: 12 }} onSubmit={handleSubmit} noValidate>
            <div className="stack" style={{ gap: 7 }}>
              <label className="label" htmlFor="phone-number">휴대폰 번호</label>
              <div style={{ position: 'relative' }}>
                <input
                  id="phone-number"
                  className="field mono"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="010-1234-5678"
                  value={phone}
                  disabled={busy || sent}
                  aria-describedby="phone-number-help"
                  aria-invalid={phoneDigits.length > 0 && !validPhone}
                  onChange={(event) => {
                    setPhone(formatPhoneNumber(event.target.value))
                    setFeedback(null)
                  }}
                  style={{ width: '100%', paddingRight: sent ? 68 : undefined }}
                />
                {sent && (
                  <button
                    type="button"
                    className="small"
                    disabled={busy}
                    onClick={changePhone}
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      border: 0,
                      padding: 4,
                      background: 'transparent',
                      color: 'var(--green)',
                      cursor: 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    변경
                  </button>
                )}
              </div>
              <span id="phone-number-help" className="small">숫자만 입력해도 자동으로 형식이 맞춰집니다.</span>
            </div>

            {sent && (
              <div className="stack" style={{ gap: 7 }}>
                <label className="label" htmlFor="phone-token">인증번호 6자리</label>
                <input
                  ref={tokenInputRef}
                  id="phone-token"
                  className="field mono"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="000000"
                  value={token}
                  disabled={busy}
                  aria-describedby="phone-token-help"
                  onChange={(event) => {
                    setToken(event.target.value.replace(/\D/g, '').slice(0, 6))
                    setFeedback(null)
                  }}
                  style={{ width: '100%', letterSpacing: token ? '0.3em' : undefined, fontSize: 18 }}
                />
                <div id="phone-token-help" style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                  <span className="small">문자가 오지 않았나요?</span>
                  <button
                    type="button"
                    className="small"
                    disabled={busy || resendSeconds > 0}
                    onClick={() => void sendCode()}
                    style={{
                      border: 0,
                      padding: 0,
                      background: 'transparent',
                      color: resendSeconds > 0 ? 'var(--muted)' : 'var(--green)',
                      cursor: resendSeconds > 0 ? 'default' : 'pointer',
                      fontWeight: 700,
                    }}
                  >
                    {resendSeconds > 0 ? `${resendSeconds}초 후 재전송` : '인증번호 다시 받기'}
                  </button>
                </div>
              </div>
            )}

            <button
              className="btn primary"
              type="submit"
              style={{ width: '100%', height: 54 }}
              disabled={busy || !validPhone || (sent && token.length !== 6)}
            >
              {busy ? '확인 중…' : sent ? '인증하고 프로필 만들기' : '인증번호 받기'}
            </button>
          </form>
        </section>

        <div aria-live="polite" aria-atomic="true" style={{ minHeight: feedback || backend.error ? undefined : 0 }}>
          {(feedback || backend.error) && (
            <div
              className="card"
              role={feedback?.tone === 'error' || backend.error ? 'alert' : 'status'}
              style={{
                color: feedback?.tone === 'success' && !backend.error ? 'var(--green)' : 'var(--red)',
                lineHeight: 1.5,
              }}
            >
              {feedback?.text ?? backend.error}
            </div>
          )}
        </div>

        <p className="small" style={{ margin: 0, textAlign: 'center', lineHeight: 1.55 }}>
          인증이 끝나면 닉네임과 캐릭터를 선택할 수 있습니다.
        </p>
      </main>
    </div>
  )
}

export function AuthCallbackScreen() {
  const backend = useBackend()
  const nav = useNavigate()

  useEffect(() => {
    if (backend.ready && backend.phoneVerified) nav('/onboarding', { replace: true })
    if (backend.ready && !backend.phoneVerified) nav('/login', { replace: true })
  }, [backend.phoneVerified, backend.ready, nav])

  return (
    <div className="screen">
      <div className="pad stack center" style={{ minHeight: '100%', justifyContent: 'center', gap: 12 }}>
        <div className="spinner" />
        <strong>로그인을 확인하는 중…</strong>
      </div>
    </div>
  )
}
