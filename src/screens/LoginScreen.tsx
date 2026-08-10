import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBackend } from '../context/BackendProvider'

export default function LoginScreen() {
  const backend = useBackend()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [token, setToken] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (backend.user) nav('/onboarding', { replace: true })
  }, [backend.user, nav])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setMessage(null)
    try {
      await action()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '로그인에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen">
      <div className="pad stack" style={{ gap: 20, minHeight: '100%', justifyContent: 'center' }}>
        <div className="stack center" style={{ gap: 10, textAlign: 'center' }}>
          <div
            style={{
              width: 64, height: 64, borderRadius: 20, display: 'grid', placeItems: 'center',
              background: 'linear-gradient(135deg,var(--court),var(--court-2))', fontSize: 30,
            }}
          >
            🏟️
          </div>
          <h1 className="h1">MATCHPOINT</h1>
          <p className="body">실제 플레이어와 매칭하려면 로그인해 주세요.</p>
        </div>

        <div className="stack" style={{ gap: 10 }}>
          <button
            className="btn"
            style={{ width: '100%', height: 54, background: '#FEE500', color: '#191919', borderColor: '#FEE500' }}
            disabled={busy || !backend.kakaoEnabled}
            onClick={() => void run(backend.signInWithKakao)}
          >
            {backend.kakaoEnabled ? '카카오로 시작하기' : '카카오 로그인 · 설정 필요'}
          </button>
          {!backend.kakaoEnabled && (
            <p className="small" style={{ textAlign: 'center', color: 'var(--gold)' }}>
              REST API 키와 Client Secret 설정 후 카카오 로그인이 활성화됩니다.
            </p>
          )}
          <button
            className="btn primary"
            style={{ width: '100%', height: 54 }}
            disabled={busy}
            onClick={() => void run(backend.signInAnonymously)}
          >
            게스트 베타로 시작하기
          </button>
          <p className="small" style={{ textAlign: 'center' }}>
            게스트 베타는 로컬·초대 테스트용입니다. 운영 전에는 카카오 로그인을 사용하세요.
          </p>
        </div>

        <div className="divider" />

        <div className="card stack" style={{ gap: 10 }}>
          <span className="label">이메일 OTP로 확인하기</span>
          <input
            className="field"
            type="email"
            placeholder="tester@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          {sent && (
            <input
              className="field mono"
              inputMode="numeric"
              maxLength={6}
              placeholder="6자리 인증번호"
              value={token}
              onChange={(event) => setToken(event.target.value.replace(/\D/g, ''))}
            />
          )}
          <button
            className="btn"
            disabled={busy || !email.includes('@') || (sent && token.length !== 6)}
            onClick={() => void run(async () => {
              if (!sent) {
                await backend.sendEmailOtp(email)
                setSent(true)
                setMessage('이메일로 인증번호 또는 로그인 링크를 보냈습니다.')
                return
              }
              await backend.verifyEmailOtp(email, token)
            })}
          >
            {sent ? '인증번호 확인' : '인증 메일 보내기'}
          </button>
        </div>

        {(message || backend.error) && (
          <div className="card" style={{ color: message?.includes('보냈') ? 'var(--green)' : 'var(--red)' }}>
            {message ?? backend.error}
          </div>
        )}
      </div>
    </div>
  )
}

export function AuthCallbackScreen() {
  const backend = useBackend()
  const nav = useNavigate()

  useEffect(() => {
    if (backend.ready && backend.user) nav('/onboarding', { replace: true })
    if (backend.ready && !backend.user) nav('/login', { replace: true })
  }, [backend.ready, backend.user, nav])

  return (
    <div className="screen">
      <div className="pad stack center" style={{ minHeight: '100%', justifyContent: 'center', gap: 12 }}>
        <div className="spinner" />
        <strong>로그인을 확인하는 중…</strong>
      </div>
    </div>
  )
}
