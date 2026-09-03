import { useState, useEffect, useCallback, useRef } from 'react';
import type { ChatMessage, ScorecardData, SessionSummary, SessionDetail } from './types';
import { listSessions, loadSession, csvDownloadUrl } from './api';
import { ChatPanel, ScorecardPanel, DragHandle, CORAL, CORAL_LIGHT } from './components';

function SessionPicker({
  sessions, selectedId, onSelect, onRefresh, loading,
}: {
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  loading: boolean;
}) {
  return (
    <div style={{
      padding: '12px 24px', borderBottom: '1px solid var(--border-light)',
      background: 'var(--bg-card)', display: 'flex', alignItems: 'center', gap: 10,
      flexShrink: 0,
    }}>
      <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 500 }}>
        세션:
      </span>
      <select
        value={selectedId || ''}
        onChange={e => onSelect(e.target.value)}
        disabled={loading}
        style={{
          flex: 1, padding: '7px 10px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--bg-input)',
          fontSize: 12.5, fontFamily: 'var(--font-body)', color: 'var(--text-primary)',
          maxWidth: 600, cursor: 'pointer',
        }}
      >
        <option value="">{sessions.length === 0 ? '저장된 세션 없음' : '— 세션 선택 —'}</option>
        {sessions.map(s => {
          const status = s.interview_complete ? '완료' : '진행중';
          const updated = s.updated_at ? s.updated_at.replace('T', ' ').slice(0, 16) : '';
          const diag = s.diagnosis ? ` · ${s.diagnosis}` : '';
          return (
            <option key={s.session_id} value={s.session_id}>
              {s.session_id} · {status} {s.answered}/{s.total} · 검토 {s.reviewed_count}/{s.reviewable_count}{diag} · {updated}
            </option>
          );
        })}
      </select>
      <button onClick={onRefresh} disabled={loading} style={{
        padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)',
        background: 'var(--bg-card)', fontSize: 12, color: 'var(--text-secondary)',
        cursor: 'pointer', fontFamily: 'var(--font-body)',
      }}>새로고침</button>
      {selectedId && (
        <a
          href={csvDownloadUrl(selectedId)}
          target="_blank" rel="noreferrer"
          style={{
            padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)',
            background: 'var(--bg-card)', fontSize: 12, color: 'var(--text-secondary)',
            textDecoration: 'none', fontFamily: 'var(--font-body)',
          }}
        >CSV</a>
      )}
    </div>
  );
}

const REVIEWER_STORAGE_KEY = 'dabom_reviewer_selected_id';

export default function ReviewerView({ active = true }: { active?: boolean }) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [scorecard, setScorecard] = useState<ScorecardData | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(520);

  const handleResize = useCallback((newWidth: number) => {
    setSidebarWidth(newWidth);
  }, []);

  const refreshSessions = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      const data = await listSessions();
      setSessions(data.sessions);
    } catch (e) {
      setError(String(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  // Mount once: load list + restore previously selected session if any
  useEffect(() => {
    (async () => {
      await refreshSessions();
      const saved = localStorage.getItem(REVIEWER_STORAGE_KEY);
      if (!saved) return;
      try {
        const d = await loadSession(saved);
        setSelectedId(saved);
        setDetail(d);
        setScorecard(d.scorecard);
      } catch {
        localStorage.removeItem(REVIEWER_STORAGE_KEY);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tab activation: refresh session list (but keep selected detail intact).
  // Skip the very first activation since mount-effect already fetched.
  const initialRender = useRef(true);
  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false;
      return;
    }
    if (active) {
      refreshSessions();
    }
  }, [active, refreshSessions]);

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id || null);
    if (!id) {
      localStorage.removeItem(REVIEWER_STORAGE_KEY);
      setDetail(null);
      setScorecard(null);
      return;
    }
    localStorage.setItem(REVIEWER_STORAGE_KEY, id);
    setDetailLoading(true);
    setError(null);
    try {
      const d = await loadSession(id);
      setDetail(d);
      setScorecard(d.scorecard);
    } catch (e) {
      setError(String(e));
      setDetail(null);
      setScorecard(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleScorecardUpdate = (newScorecard: ScorecardData) => {
    setScorecard(newScorecard);
  };

  const messages: ChatMessage[] = (detail?.conversation || []).map(m => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <SessionPicker
        sessions={sessions}
        selectedId={selectedId}
        onSelect={handleSelect}
        onRefresh={refreshSessions}
        loading={listLoading}
      />

      {error && (
        <div style={{ padding: '8px 24px', background: CORAL_LIGHT, color: CORAL, fontSize: 13 }}>
          {error}
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {!detail && !detailLoading && (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-tertiary)', fontSize: 13, padding: 24, textAlign: 'center',
            }}>
              {sessions.length === 0
                ? '저장된 세션이 없습니다. 사용자 탭에서 인터뷰를 진행해 주세요.'
                : '검토할 세션을 위에서 선택하세요.'}
            </div>
          )}
          {detailLoading && (
            <div style={{
              height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-tertiary)', fontSize: 13,
            }}>로딩 중...</div>
          )}
          {detail && (
            <ChatPanel messages={messages} loading={false} readOnly />
          )}
        </div>

        {detail && (
          <>
            <DragHandle onResize={handleResize} />
            <div style={{
              width: sidebarWidth, minWidth: sidebarWidth, overflow: 'hidden',
              background: 'var(--bg-card)',
            }}>
              <div style={{ width: sidebarWidth, height: '100%' }}>
                {scorecard && (
                  <ScorecardPanel
                    data={scorecard}
                    sessionId={selectedId}
                    onScorecardUpdate={handleScorecardUpdate}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>

    </div>
  );
}
