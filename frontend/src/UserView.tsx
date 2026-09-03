import { useState, useEffect, useCallback } from 'react';
import type { ChatMessage } from './types';
import { startInterview, streamMessage, resetInterview, loadSession } from './api';
import { ChatPanel, SAGE, AMBER, CORAL, CORAL_LIGHT, SAGE_LIGHT } from './components';

const STORAGE_KEY = 'dabom_user_session_id';

type Phase = 'idle' | 'loading' | 'active' | 'complete';

export default function UserView() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [progress, setProgress] = useState({ answered: 0, total: 13, progress: 0 });
  const [phase, setPhase] = useState<Phase>('idle');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount: try to restore saved session, otherwise show idle landing
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      setPhase('idle');
      return;
    }
    setPhase('loading');
    (async () => {
      try {
        const detail = await loadSession(saved);
        setSessionId(saved);
        setMessages(detail.conversation.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })));
        setProgress({
          answered: detail.scorecard.answered,
          total: detail.scorecard.total,
          progress: detail.scorecard.progress,
        });
        setPhase(detail.interview_complete ? 'complete' : 'active');
      } catch {
        // Session expired (e.g., backend restart) — clear and show idle
        localStorage.removeItem(STORAGE_KEY);
        setSessionId(null);
        setPhase('idle');
      }
    })();
  }, []);

  const doStart = useCallback(async () => {
    setLoading(true);
    setError(null);
    setPhase('active');
    setMessages([{ role: 'assistant', content: '' }]);

    try {
      await startInterview(undefined, {
        onSessionId: (id) => {
          setSessionId(id);
          localStorage.setItem(STORAGE_KEY, id);
        },
        onToken: (token) => {
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + token };
            }
            return updated;
          });
        },
        onDone: (data) => {
          setMessages(data.conversation.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })));
          setProgress({
            answered: data.scorecard.answered,
            total: data.scorecard.total,
            progress: data.scorecard.progress,
          });
          if (data.interview_complete) setPhase('complete');
          setLoading(false);
        },
        onError: (errMsg) => {
          setError(errMsg);
          setMessages([{ role: 'assistant', content: `오류: ${errMsg}` }]);
          setLoading(false);
        },
      });
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  }, []);

  const handleSend = async (msg: string) => {
    if (!sessionId) return;
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);
    setError(null);
    setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

    try {
      await streamMessage(sessionId, msg, {
        onToken: (token) => {
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: last.content + token };
            }
            return updated;
          });
        },
        onDone: (data) => {
          setMessages(data.conversation.map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
          })));
          setProgress({
            answered: data.scorecard.answered,
            total: data.scorecard.total,
            progress: data.scorecard.progress,
          });
          if (data.interview_complete) setPhase('complete');
          setLoading(false);
        },
        onError: (errMsg) => {
          setError(errMsg);
          setMessages(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: `오류: ${errMsg}` };
            }
            return updated;
          });
          setLoading(false);
        },
      });
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  };

  const handleStartNew = async () => {
    if (phase === 'active' && progress.answered > 0) {
      const ok = window.confirm(
        '진행 중인 인터뷰가 있습니다. 새로 시작하면 현재 답변은 종료됩니다. 계속하시겠습니까?',
      );
      if (!ok) return;
    }
    if (sessionId) {
      try { await resetInterview(sessionId); } catch { /* ignore */ }
    }
    localStorage.removeItem(STORAGE_KEY);
    setSessionId(null);
    setMessages([]);
    setProgress({ answered: 0, total: 13, progress: 0 });
    setError(null);
    doStart();
  };

  // ── Render ──
  if (phase === 'loading') {
    return (
      <div style={{
        height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-tertiary)', fontSize: 13,
      }}>저장된 인터뷰를 불러오는 중...</div>
    );
  }

  if (phase === 'idle') {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 16,
        background: 'var(--bg-primary)', padding: 24,
      }}>
        <div style={{
          width: 64, height: 64, borderRadius: '50%', background: SAGE_LIGHT,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 28, color: SAGE, fontWeight: 700,
        }}>D</div>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
            사회적 고립 인터뷰
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            13문항 구조화 인터뷰입니다. 솔직하게 답변해 주세요. <br />
            언제든지 "새로 시작" 버튼으로 다시 시작할 수 있습니다.
          </p>
        </div>
        <button onClick={doStart} disabled={loading} style={{
          padding: '12px 32px', borderRadius: 10, border: 'none',
          background: SAGE, color: 'var(--surface)', fontSize: 14, fontWeight: 600,
          cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)',
          opacity: loading ? 0.6 : 1,
        }}>인터뷰 시작</button>
        {error && (
          <div style={{ color: CORAL, fontSize: 12, marginTop: 8 }}>{error}</div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--bg-primary)',
    }}>
      {/* Progress bar + 새로 시작 */}
      <div style={{
        padding: '12px 24px', borderBottom: '1px solid var(--border-light)',
        background: 'var(--bg-card)', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 12 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 500 }}>
            검사 진행
          </span>
          <span style={{ fontSize: 12, color: SAGE, fontWeight: 600, flex: 1 }}>
            {progress.answered}/{progress.total}
          </span>
          <button onClick={handleStartNew} disabled={loading} style={{
            padding: '5px 12px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'var(--bg-card)', fontSize: 11.5, color: 'var(--text-secondary)',
            cursor: loading ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-body)',
            opacity: loading ? 0.5 : 1,
          }}>새로 시작</button>
        </div>
        <div style={{ height: 6, borderRadius: 3, background: 'var(--border-light)', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 3,
            background: SAGE,
            width: `${progress.progress}%`, transition: 'width 0.3s',
          }} />
        </div>
      </div>

      {error && (
        <div style={{ padding: '8px 24px', background: CORAL_LIGHT, color: CORAL, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Chat */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <ChatPanel
          messages={messages}
          onSend={handleSend}
          loading={loading}
          readOnly={phase === 'complete'}
        />

        {phase === 'complete' && (
          <div style={{
            padding: '16px 24px', borderTop: '1px solid var(--border-light)',
            background: 'var(--bg-card)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              ✓ 검사가 완료되었습니다. 검사자에게 결과를 전달해 주세요.
            </div>
            <button onClick={handleStartNew} style={{
              padding: '8px 16px', borderRadius: 8, border: 'none',
              background: SAGE, color: 'var(--surface)', fontSize: 13, fontWeight: 500,
              cursor: 'pointer', fontFamily: 'var(--font-body)',
            }}>새 인터뷰 시작</button>
          </div>
        )}
      </div>
    </div>
  );
}
