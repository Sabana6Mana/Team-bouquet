import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../store/useApp'
import { SPORT_LIST } from '../lib/game'
import { StepDots } from '../components/ui'
import PlayerAvatar from '../components/PlayerAvatar'
import { CHARACTERS, DEFAULT_CHARACTER, characterById, type CharacterId } from '../data/characters'
import type { SportId } from '../types'
import { useBackend } from '../context/BackendProvider'

const CARRIERS = ['SKT', 'KT', 'LG U+', '알뜰폰']

export default function Onboarding() {
  const backend = useBackend()
  const [step, setStep] = useState(backend.enabled ? 1 : 0)
  const signUp = useApp((s) => s.signUp)
  const setInterests = useApp((s) => s.setInterests)
  const nav = useNavigate()
  const [saving, setSaving] = useState(false)
  const [checkingNickname, setCheckingNickname] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [birth, setBirth] = useState('')
  const [carrier, setCarrier] = useState('SKT')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [nickname, setNickname] = useState('')
  const [characterId, setCharacterId] = useState<CharacterId>(DEFAULT_CHARACTER.id)
  const [picked, setPicked] = useState<SportId[]>([])
  const character = characterById(characterId)

  const canVerify = name.trim() && birth.length >= 6 && phone.length >= 10 && (!sent || code.length === 6)

  return (
    <div className="screen">
      <div className="pad stack" style={{ gap: 22, minHeight: '100%' }}>
        <div className="row spread">
          <div className="row" style={{ gap: 9 }}>
            <div
              style={{
                width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center',
                background: 'linear-gradient(135deg,var(--court),var(--court-2))', fontSize: 15,
              }}
            >
              🏟️
            </div>
            <strong style={{ letterSpacing: 1.5, fontSize: 14 }}>MATCHPOINT</strong>
          </div>
          <StepDots total={backend.enabled ? 2 : 3} current={backend.enabled ? step - 1 : step} />
        </div>

        {!backend.enabled && step === 0 && (
          <div className="stack fade-in" style={{ gap: 18, flex: 1 }}>
            <div className="stack" style={{ gap: 8 }}>
              <h1 className="h1">본인인증으로<br />시작하기</h1>
              <p className="body">
                안전한 매칭을 위해 실명 확인이 필요합니다.
                <br />
                <span style={{ color: 'var(--gold)' }}>※ 데모 버전으로 실제 인증은 진행되지 않습니다.</span>
              </p>
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <input className="field" placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
              <input
                className="field mono" placeholder="주민등록번호 앞 6자리 (예: 000101)" inputMode="numeric" maxLength={6}
                value={birth} onChange={(e) => setBirth(e.target.value.replace(/\D/g, ''))}
              />
              <div className="row" style={{ gap: 7 }}>
                {CARRIERS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCarrier(c)}
                    className="chip"
                    style={{
                      flex: 1, height: 40, justifyContent: 'center',
                      borderColor: carrier === c ? 'var(--cyan)' : 'var(--line)',
                      color: carrier === c ? 'var(--cyan)' : 'var(--muted)',
                      background: carrier === c ? 'rgba(47, 125, 70,0.12)' : 'var(--surface)',
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <input
                className="field mono" placeholder="휴대폰 번호 (- 없이)" inputMode="numeric" maxLength={11}
                value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))}
              />
              {sent && (
                <div className="row fade-in" style={{ gap: 8 }}>
                  <input
                    className="field mono grow" placeholder="인증번호 6자리" inputMode="numeric" maxLength={6}
                    value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                  <span className="chip" style={{ color: 'var(--red)' }}>02:59</span>
                </div>
              )}
              {sent && (
                <p className="small" style={{ color: 'var(--cyan)' }}>
                  데모 인증번호는 아무 숫자 6자리나 입력하면 됩니다.
                </p>
              )}
            </div>

            <div className="grow" />
            <button
              className="btn primary"
              disabled={!canVerify}
              onClick={() => (sent ? setStep(1) : setSent(true))}
            >
              {sent ? '인증 완료' : '인증번호 받기'}
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="stack fade-in" style={{ gap: 18, flex: 1 }}>
            <div className="stack" style={{ gap: 8 }}>
              <h1 className="h1">플레이어 이름을<br />정해주세요</h1>
              <p className="body">
                전광판과 리더보드에 표시되는 이름입니다.
                {backend.enabled && <><br /><span style={{ color: 'var(--green)' }}>전화번호는 인증에만 사용하며 공개 프로필에는 저장하지 않습니다.</span></>}
              </p>
            </div>
            <input
              className="field" placeholder="닉네임 (2~12자)" maxLength={12}
              value={nickname} onChange={(e) => {
                setNickname(e.target.value)
                setError(null)
              }}
            />
            <div className="stack" style={{ gap: 9 }}>
              <span className="label">캐릭터 선택</span>
              <div
                role="radiogroup"
                aria-label="플레이어 캐릭터"
                style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 9 }}
              >
                {CHARACTERS.map((option) => {
                  const selected = option.id === characterId
                  return (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setCharacterId(option.id)}
                      className="card stack"
                      style={{
                        minWidth: 0,
                        gap: 7,
                        alignItems: 'center',
                        padding: 11,
                        borderColor: selected ? 'var(--cyan)' : 'var(--line)',
                        background: selected ? 'rgba(47, 125, 70, 0.10)' : 'var(--surface)',
                      }}
                    >
                      <PlayerAvatar
                        className="avatar lg"
                        avatarUrl={option.avatarUrl}
                        fallback={option.fallback}
                        aria-hidden="true"
                      />
                      <strong style={{ fontSize: 12 }}>{option.label}</strong>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="card stack" style={{ gap: 12 }}>
              <span className="label">미리보기</span>
              <div className="row" style={{ gap: 12 }}>
                <PlayerAvatar
                  className="avatar lg"
                  avatarUrl={character.avatarUrl}
                  fallback={character.fallback}
                  aria-hidden="true"
                />
                <div className="stack" style={{ gap: 4 }}>
                  <strong style={{ fontSize: 17 }}>{nickname || '플레이어'}</strong>
                  <span className="small mono" style={{ color: 'var(--gold)' }}>ELO 1200 · 배치 대기</span>
                </div>
              </div>
            </div>
            <div className="grow" />
            <button
              className="btn primary"
              disabled={nickname.trim().length < 2 || checkingNickname}
              onClick={() => {
                void (async () => {
                  setCheckingNickname(true)
                  setError(null)
                  try {
                    if (backend.enabled && !(await backend.checkNickname(nickname))) {
                      setError('이미 사용 중인 닉네임입니다. 다른 이름을 골라 주세요.')
                      return
                    }
                    signUp({
                      name: backend.enabled ? '' : name,
                      birth: backend.enabled ? '' : birth,
                      carrier: backend.enabled ? '' : carrier,
                      phone: backend.enabled ? '' : phone,
                      nickname: nickname.trim(),
                    }, character.avatarUrl)
                    setStep(2)
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : '닉네임 확인에 실패했습니다.')
                  } finally {
                    setCheckingNickname(false)
                  }
                })()
              }}
            >
              {checkingNickname ? '닉네임 확인 중…' : '계정 생성하기'}
            </button>
            {error && <p className="small" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>
        )}

        {step === 2 && (
          <div className="stack fade-in" style={{ gap: 18, flex: 1 }}>
            <div className="stack" style={{ gap: 8 }}>
              <h1 className="h1">관심 종목을<br />선택해주세요</h1>
              <p className="body">선택한 종목의 경기와 근처 시설을 먼저 보여드립니다. (중복 선택 가능)</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 11 }}>
              {SPORT_LIST.map((s) => {
                const on = picked.includes(s.id)
                return (
                  <button
                    key={s.id}
                    onClick={() => setPicked((p) => (on ? p.filter((x) => x !== s.id) : [...p, s.id]))}
                    className="card stack"
                    style={{
                      gap: 8, alignItems: 'flex-start', padding: 16, textAlign: 'left',
                      borderColor: on ? s.color : 'var(--line)',
                      background: on ? `${s.color}14` : 'var(--surface)',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span style={{ fontSize: 32 }}>{s.emoji}</span>
                    <strong style={{ fontSize: 15, color: on ? s.color : 'var(--text)' }}>{s.label}</strong>
                    <span className="small" style={{ fontSize: 11 }}>
                      {s.modes.join(' · ')}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="grow" />
            <button
              className="btn primary"
              disabled={picked.length === 0 || saving}
              onClick={() => {
                void (async () => {
                  setSaving(true)
                  setError(null)
                  try {
                    if (backend.enabled) {
                      await backend.saveProfile(nickname.trim(), picked, character.avatarUrl)
                    }
                    setInterests(picked)
                    nav('/', { replace: true })
                  } catch (caught) {
                    setError(caught instanceof Error ? caught.message : '프로필 저장에 실패했습니다.')
                  } finally {
                    setSaving(false)
                  }
                })()
              }}
            >
              {saving ? '프로필 저장 중…' : `시작하기${picked.length > 0 ? ` (${picked.length})` : ''}`}
            </button>
            {error && <p className="small" style={{ color: 'var(--red)' }}>{error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
