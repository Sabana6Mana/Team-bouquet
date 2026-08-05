import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null; stack: string }

/**
 * 렌더링 중 예외가 나면 React는 트리 전체를 언마운트해 화면이 하얗게 된다.
 * 무엇이 터졌는지 화면에서 바로 확인할 수 있도록 잡아 둔다.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[MATCHPOINT] 화면 렌더링 오류', error, info.componentStack)
    this.setState({ stack: info.componentStack ?? '' })
  }

  render() {
    const { error, stack } = this.state
    if (!error) return this.props.children

    return (
      <div
        className="stack"
        style={{
          width: 'min(100%, 460px)', minHeight: '100dvh',
          padding: 20, gap: 14, background: 'var(--bg)',
          overflowY: 'auto',
        }}
      >
        <div className="stack" style={{ gap: 6 }}>
          <span style={{ fontSize: 34 }}>⚠️</span>
          <h1 className="h1">화면을 그리지 못했습니다</h1>
          <p className="body">
            아래 내용을 개발자에게 전달해 주세요. 새로고침하면 다시 시도합니다.
          </p>
        </div>

        <div
          className="card mono"
          style={{ fontSize: 11.5, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
        >
          <strong style={{ color: 'var(--red)' }}>{error.name}: {error.message}</strong>
          {stack && (
            <div style={{ marginTop: 10, color: 'var(--muted)', maxHeight: 260, overflow: 'auto' }}>
              {stack.trim()}
            </div>
          )}
        </div>

        <div className="row" style={{ gap: 8 }}>
          <button className="btn primary grow" onClick={() => location.reload()}>
            새로고침
          </button>
          <button
            className="btn grow"
            onClick={() => {
              // 잘못 저장된 로컬 상태 때문에 계속 터지는 경우를 대비한 탈출구
              try { localStorage.removeItem('matchpoint-v1') } catch { /* 무시 */ }
              location.href = '/'
            }}
          >
            저장 데이터 초기화
          </button>
        </div>
      </div>
    )
  }
}