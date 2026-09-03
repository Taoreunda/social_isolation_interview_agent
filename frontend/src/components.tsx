import { useState, useRef, useEffect, type FormEvent } from 'react';
import type { ChatMessage, ScorecardData, ScorecardSection, ScorecardItem, ExpertSummary } from './types';
import { submitExpertReview, bulkApproveReviews } from './api';

// ── Colors ──
export const SAGE = '#5B8A72';
export const SAGE_LIGHT = '#E8F2EC';
export const SAGE_MUTED = '#8FB5A0';
export const AMBER = '#C49B4A';
export const AMBER_LIGHT = '#FDF6E8';
export const CORAL = '#D4786A';
export const CORAL_LIGHT = '#FDF0EE';

export const E_QUESTIONS = ['E1', 'E2'];

// ── Status helpers ──
export function statusLabel(status: string | null): string {
  if (status === 'positive') return '충족';
  if (status === 'negative') return '미충족';
  if (status === 'recorded') return '기록됨';
  return '미평가';
}

export function statusColor(status: string | null): string {
  if (status === 'positive') return SAGE;
  if (status === 'negative') return CORAL;
  return 'var(--text-tertiary)';
}

// ── Chat Bubble ──
export function ChatBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
      padding: '4px 0',
    }}>
      {!isUser && (
        <div style={{
          width: 30, height: 30, borderRadius: '50%', background: SAGE_LIGHT,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, flexShrink: 0, marginRight: 8, marginTop: 4,
          color: SAGE, fontWeight: 600,
        }}>D</div>
      )}
      <div style={{
        maxWidth: '78%', padding: '11px 15px',
        borderRadius: isUser ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
        background: isUser ? SAGE : 'var(--bg-card)',
        color: isUser ? '#fff' : 'var(--text-primary)',
        fontSize: 14, lineHeight: 1.65,
        boxShadow: isUser ? 'none' : 'var(--shadow-sm)',
        border: isUser ? 'none' : '1px solid var(--border-light)',
        whiteSpace: 'pre-wrap' as const,
      }}>{msg.content}</div>
    </div>
  );
}

// ── Chat Panel (with optional readOnly mode) ──
export function ChatPanel({
  messages, onSend, loading, readOnly = false, placeholder = '답변을 입력하세요...',
}: {
  messages: ChatMessage[];
  onSend?: (msg: string) => void;
  loading: boolean;
  readOnly?: boolean;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading || !onSend) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      <div style={{
        flex: 1, overflowY: 'auto', padding: '20px 18px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        {messages.length === 0 && readOnly && (
          <div style={{
            color: 'var(--text-tertiary)', fontSize: 13, padding: 24, textAlign: 'center',
          }}>대화 내용이 없습니다.</div>
        )}
        {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
        <div ref={bottomRef} />
      </div>
      {!readOnly && (
        <form onSubmit={handleSubmit} style={{
          padding: '14px 18px', borderTop: '1px solid var(--border-light)',
          background: 'var(--bg-card)', display: 'flex', gap: 8,
        }}>
          <input type="text" value={input} onChange={e => setInput(e.target.value)}
            placeholder={placeholder} disabled={loading}
            style={{
              flex: 1, padding: '10px 14px', borderRadius: 12,
              border: '1.5px solid var(--border)', background: 'var(--bg-input)',
              fontSize: 14, fontFamily: 'var(--font-body)', color: 'var(--text-primary)',
              outline: 'none',
            }}
            onFocus={e => { e.target.style.borderColor = SAGE; e.target.style.boxShadow = 'var(--shadow-focus)'; }}
            onBlur={e => { e.target.style.borderColor = 'var(--border)'; e.target.style.boxShadow = 'none'; }}
          />
          <button type="submit" disabled={loading || !input.trim()} style={{
            padding: '10px 20px', borderRadius: 12, border: 'none',
            background: SAGE, color: '#fff', fontSize: 13.5, fontWeight: 500,
            fontFamily: 'var(--font-body)', cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}>전송</button>
        </form>
      )}
    </div>
  );
}

// ── Criteria Badge ──
export function CriteriaBadge({ label, value }: { label: string; value: boolean | null }) {
  const met = value === true;
  const unmet = value === false;
  return (
    <div style={{
      padding: '8px 12px', borderRadius: 8,
      background: met ? SAGE_LIGHT : unmet ? CORAL_LIGHT : 'var(--bg-primary)',
      border: `1px solid ${met ? SAGE_MUTED : unmet ? CORAL : 'var(--border-light)'}`,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    }}>
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
      <span style={{
        fontSize: 11.5, fontWeight: 600,
        color: met ? SAGE : unmet ? CORAL : 'var(--text-tertiary)',
      }}>{met ? '충족' : unmet ? '비충족' : '미산출'}</span>
    </div>
  );
}

// ── Item Card (with expert review accordion) ──
export function ItemCard({
  item, sessionId, onReviewSubmit, reviewEnabled = true,
}: {
  item: ScorecardItem;
  sessionId: string | null;
  onReviewSubmit: (scorecard: ScorecardData) => void;
  reviewEnabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [overrideStatus, setOverrideStatus] = useState<string>(
    item.status === 'positive' ? 'negative' : 'positive',
  );
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hasData = !!item.status;
  const isCurrent = item.is_current;
  const isE = E_QUESTIONS.includes(item.id);
  const review = item.expert_review;
  const isReviewed = !!review;
  const isOverridden = review?.action === 'override';

  let borderColor = 'var(--border-light)';
  let borderStyle = 'solid';
  if (isCurrent) borderColor = AMBER;
  else if (!hasData && !item.is_skipped) borderStyle = 'dashed';

  const handleApprove = async () => {
    if (!sessionId) return;
    setSubmitting(true);
    try {
      const result = await submitExpertReview(sessionId, item.id, 'approve');
      onReviewSubmit(result.scorecard);
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  const handleOverride = async () => {
    if (!sessionId) return;
    setSubmitting(true);
    try {
      const result = await submitExpertReview(
        sessionId, item.id, 'override', overrideStatus, rationale || undefined,
      );
      onReviewSubmit(result.scorecard);
      setExpanded(false);
      setRationale('');
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  return (
    <div style={{
      border: `1.5px ${borderStyle} ${borderColor}`,
      borderRadius: 10, padding: '10px 14px', marginBottom: 6,
      background: isCurrent ? AMBER_LIGHT : 'var(--bg-card)',
      transition: 'all 0.15s',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: hasData ? 6 : 0 }}>
        <span style={{
          fontWeight: 700, fontSize: 12.5, flexShrink: 0,
          color: isCurrent ? AMBER : SAGE,
          minWidth: 60,
        }}>{item.id}</span>
        <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1 }}>
          {item.question}
        </span>
        {isCurrent && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
            background: AMBER_LIGHT, color: AMBER, border: `1px solid ${AMBER}`,
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>진행중</span>
        )}
        {item.is_skipped && (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10,
            background: 'var(--bg-primary)', color: 'var(--text-tertiary)',
            whiteSpace: 'nowrap', flexShrink: 0,
          }}>스킵</span>
        )}
      </div>

      {hasData && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginLeft: 68 }}>
          {item.value && (
            <div style={{ marginBottom: 2 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>답변: </span>
              <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>{item.value}</span>
            </div>
          )}
          {item.rationale && (
            <div style={{ marginBottom: 4 }}>
              <span style={{ color: 'var(--text-tertiary)' }}>근거: </span>
              <span>{item.rationale}</span>
            </div>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ color: 'var(--text-tertiary)', fontSize: 11.5 }}>AI 판정:</span>
            <span style={{ color: statusColor(item.status), fontWeight: 600, fontSize: 11.5 }}>
              ● {statusLabel(item.status)}
            </span>
            {isOverridden && review && (
              <>
                <span style={{ color: 'var(--text-tertiary)', fontSize: 11.5 }}>&rarr;</span>
                <span style={{ fontSize: 11.5 }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>전문가: </span>
                  <span style={{ color: statusColor(review.expert_status), fontWeight: 600 }}>
                    ● {statusLabel(review.expert_status)}
                  </span>
                </span>
              </>
            )}
          </div>

          {isOverridden && review?.expert_rationale && (
            <div style={{ fontSize: 11.5, color: SAGE_MUTED, marginBottom: 4 }}>
              변경 사유: {review.expert_rationale}
            </div>
          )}

          {reviewEnabled && hasData && !item.is_skipped && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>전문가 검토:</span>
              {isReviewed ? (
                <span style={{
                  fontSize: 11, fontWeight: 600, color: SAGE,
                  padding: '2px 8px', borderRadius: 6, background: SAGE_LIGHT,
                }}>
                  {isOverridden ? '변경됨' : '동의'}
                </span>
              ) : (
                <>
                  <button onClick={handleApprove} disabled={submitting} style={{
                    fontSize: 11, padding: '3px 10px', borderRadius: 6,
                    border: `1px solid ${SAGE}`, background: 'white', color: SAGE,
                    cursor: 'pointer', fontWeight: 500,
                  }}>동의</button>
                  {!isE && (
                    <button onClick={() => setExpanded(!expanded)} disabled={submitting} style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 6,
                      border: '1px solid var(--border)', background: 'white',
                      color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 500,
                    }}>변경 {expanded ? '▴' : '▾'}</button>
                  )}
                </>
              )}
            </div>
          )}

          {expanded && !isReviewed && (
            <div style={{
              marginTop: 8, padding: '10px 12px', borderRadius: 8,
              background: 'var(--bg-primary)', border: '1px solid var(--border-light)',
            }}>
              <div style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 500 }}>판정 변경: </span>
                <label style={{ fontSize: 11.5, cursor: 'pointer', marginLeft: 8 }}>
                  <input
                    type="radio" name={`override-${item.id}`}
                    value="positive"
                    checked={overrideStatus === 'positive'}
                    onChange={() => setOverrideStatus('positive')}
                  /> 충족
                </label>
                <label style={{ fontSize: 11.5, cursor: 'pointer', marginLeft: 12 }}>
                  <input
                    type="radio" name={`override-${item.id}`}
                    value="negative"
                    checked={overrideStatus === 'negative'}
                    onChange={() => setOverrideStatus('negative')}
                  /> 미충족
                </label>
              </div>
              <div style={{ marginBottom: 8 }}>
                <input
                  type="text" placeholder="변경 사유를 입력하세요"
                  value={rationale} onChange={e => setRationale(e.target.value)}
                  style={{
                    width: '100%', padding: '6px 10px', borderRadius: 6, fontSize: 12,
                    border: '1px solid var(--border)', background: 'white',
                    fontFamily: 'var(--font-body)', outline: 'none', boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={handleOverride} disabled={submitting || overrideStatus === item.status} style={{
                  fontSize: 11, padding: '4px 12px', borderRadius: 6, border: 'none',
                  background: SAGE, color: 'white', cursor: 'pointer', fontWeight: 500,
                  opacity: overrideStatus === item.status ? 0.5 : 1,
                }}>적용</button>
                <button onClick={() => { setExpanded(false); setRationale(''); }} style={{
                  fontSize: 11, padding: '4px 12px', borderRadius: 6,
                  border: '1px solid var(--border)', background: 'white',
                  color: 'var(--text-secondary)', cursor: 'pointer',
                }}>취소</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section Block ──
export function SectionBlock({
  section, sessionId, onReviewSubmit, reviewEnabled = true,
}: {
  section: ScorecardSection;
  sessionId: string | null;
  onReviewSubmit: (scorecard: ScorecardData) => void;
  reviewEnabled?: boolean;
}) {
  const badge = section.criteria_met === true
    ? <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: SAGE_LIGHT, color: SAGE }}>충족</span>
    : section.criteria_met === false
    ? <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 10, background: CORAL_LIGHT, color: CORAL }}>비충족</span>
    : null;

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0 6px' }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: SAGE, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>{section.id}</span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{section.title}</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        {badge}
      </div>
      {section.items.map(item => (
        <ItemCard
          key={item.id}
          item={item}
          sessionId={sessionId}
          onReviewSubmit={onReviewSubmit}
          reviewEnabled={reviewEnabled}
        />
      ))}
    </div>
  );
}

// ── Expert Summary Panel ──
export function ExpertSummaryPanel({
  summary, aiDiagnosis, sessionId, onBulkApprove,
}: {
  summary: ExpertSummary;
  aiDiagnosis: string | null;
  sessionId: string | null;
  onBulkApprove: (scorecard: ScorecardData) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const diagnosisChanged = summary.expert_diagnosis !== null && summary.expert_diagnosis !== aiDiagnosis;

  const handleBulkApprove = async () => {
    if (!sessionId) return;
    setSubmitting(true);
    try {
      const result = await bulkApproveReviews(sessionId);
      onBulkApprove(result.scorecard);
    } catch { /* ignore */ }
    setSubmitting(false);
  };

  return (
    <div style={{
      margin: '12px 0', padding: '12px 14px', borderRadius: 10,
      border: '1px solid var(--border)', background: 'var(--bg-primary)',
    }}>
      <div style={{
        fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 10,
        borderBottom: '1px solid var(--border-light)', paddingBottom: 6,
      }}>전문가 검토 요약</div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-tertiary)' }}>검토 완료</span>
          <span style={{ fontWeight: 600 }}>{summary.reviewed_count}/{summary.total_reviewable}</span>
        </div>

        {summary.unreviewed_items.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>미검토</span>
            <span style={{ color: AMBER, fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>
              {summary.unreviewed_items.join(', ')}
            </span>
          </div>
        )}

        {aiDiagnosis && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>AI 진단</span>
            <span style={{ fontWeight: 600 }}>{aiDiagnosis}</span>
          </div>
        )}

        {summary.expert_diagnosis && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-tertiary)' }}>전문가 진단</span>
            <span style={{ fontWeight: 600, color: diagnosisChanged ? CORAL : SAGE }}>
              {summary.expert_diagnosis}
              {diagnosisChanged && <span style={{ fontSize: 10, marginLeft: 4 }}>(변경됨)</span>}
            </span>
          </div>
        )}
      </div>

      {summary.unreviewed_items.length > 0 && (
        <button onClick={handleBulkApprove} disabled={submitting} style={{
          marginTop: 10, width: '100%', padding: '8px 0', borderRadius: 8,
          border: `1px solid ${SAGE}`, background: SAGE_LIGHT, color: SAGE,
          fontSize: 12, fontWeight: 600, cursor: 'pointer',
          fontFamily: 'var(--font-body)',
        }}>전체 승인</button>
      )}
    </div>
  );
}

// ── Drag Handle ──
export function DragHandle({ onResize }: { onResize: (newWidth: number) => void }) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const containerRight = document.documentElement.clientWidth;
    const onMouseMove = (ev: MouseEvent) => {
      const newWidth = containerRight - ev.clientX;
      onResize(Math.max(320, Math.min(800, newWidth)));
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        width: 6, cursor: 'col-resize', background: 'transparent',
        flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderLeft: '1px solid var(--border-light)',
      }}
      title="드래그하여 크기 조절"
    >
      <div style={{ width: 2, height: 40, borderRadius: 1, background: 'var(--border)' }} />
    </div>
  );
}

// ── Scorecard Panel ──
export function ScorecardPanel({
  data, sessionId, onScorecardUpdate, reviewEnabled = true,
}: {
  data: ScorecardData;
  sessionId: string | null;
  onScorecardUpdate: (scorecard: ScorecardData) => void;
  reviewEnabled?: boolean;
}) {
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px 18px' }}>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--text-tertiary)', marginBottom: 5, fontWeight: 500 }}>
          <span>진행률</span>
          <span style={{ color: SAGE, fontWeight: 600 }}>{data.answered}/{data.total} ({data.progress}%)</span>
        </div>
        <div style={{ height: 5, borderRadius: 3, background: 'var(--border-light)', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 3, background: `linear-gradient(90deg, ${AMBER}, ${SAGE})`, width: `${data.progress}%`, transition: 'width 0.3s' }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 16 }}>
        <CriteriaBadge label="A 재택" value={data.criteria.A} />
        <CriteriaBadge label="B 상호작용" value={data.criteria.B} />
        <CriteriaBadge label="C 사회적 지지" value={data.criteria.C} />
        <CriteriaBadge label="D 기능 손상" value={data.criteria.D} />
      </div>

      {data.sections.map(s => (
        <SectionBlock
          key={s.id}
          section={s}
          sessionId={sessionId}
          onReviewSubmit={onScorecardUpdate}
          reviewEnabled={reviewEnabled}
        />
      ))}

      {data.diagnosis && (
        <div style={{
          background: data.diagnosis === '히키코모리' ? '#ffebee' : data.diagnosis === '사회적 고립' ? '#fff3e0' : '#e8f5e9',
          borderLeft: `4px solid ${data.diagnosis === '히키코모리' ? '#f44336' : data.diagnosis === '사회적 고립' ? '#ff9800' : '#4caf50'}`,
          padding: '10px 14px', margin: '8px 0', borderRadius: 4,
        }}>
          <strong>AI 진단: {data.diagnosis}</strong>
        </div>
      )}

      {data.early_stop && (
        <div style={{ background: '#fff3e0', borderLeft: '4px solid #ff9800', padding: '8px 14px', margin: '4px 0', borderRadius: 4, fontSize: '0.9em' }}>
          조기종료 (A, B, C 모두 비충족)
        </div>
      )}

      {data.report && (
        <div style={{ marginTop: 8, padding: 10, background: '#f9f9f9', borderRadius: 6, fontSize: '0.9em' }}>
          <strong>교차검토 보고서</strong><br />{data.report}
        </div>
      )}

      {data.expert_summary && (
        <ExpertSummaryPanel
          summary={data.expert_summary}
          aiDiagnosis={data.diagnosis}
          sessionId={sessionId}
          onBulkApprove={onScorecardUpdate}
        />
      )}
    </div>
  );
}
