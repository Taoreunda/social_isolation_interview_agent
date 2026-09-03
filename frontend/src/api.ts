import type { InterviewResponse, ScorecardData, SessionSummary, SessionDetail } from './types';

const BASE = '/api';

export interface StartStreamCallbacks {
  onSessionId: (sessionId: string) => void;
  onToken: (token: string) => void;
  onDone: (data: {
    conversation: Array<{ role: string; content: string }>;
    scorecard: ScorecardData;
    interview_complete: boolean;
    final_diagnosis: string | null;
  }) => void;
  onError: (error: string) => void;
}

export async function startInterview(
  sessionId: string | undefined,
  callbacks: StartStreamCallbacks,
): Promise<void> {
  const res = await fetch(`${BASE}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId || null }),
  });
  if (!res.ok) { callbacks.onError(`Start failed: ${res.status}`); return; }

  const reader = res.body?.getReader();
  if (!reader) { callbacks.onError('No response body'); return; }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'session') callbacks.onSessionId(data.session_id);
        else if (data.type === 'token') callbacks.onToken(data.content);
        else if (data.type === 'done') callbacks.onDone(data);
        else if (data.type === 'error') callbacks.onError(data.message);
      } catch { /* skip */ }
    }
  }
}

export async function sendMessage(sessionId: string, message: string): Promise<InterviewResponse> {
  const res = await fetch(`${BASE}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) throw new Error(`Message failed: ${res.status}`);
  return res.json();
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onDone: (data: {
    conversation: Array<{ role: string; content: string }>;
    scorecard: ScorecardData;
    interview_complete: boolean;
    final_diagnosis: string | null;
  }) => void;
  onError: (error: string) => void;
}

export async function streamMessage(
  sessionId: string,
  message: string,
  callbacks: StreamCallbacks,
): Promise<void> {
  const res = await fetch(`${BASE}/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!res.ok) {
    callbacks.onError(`Stream failed: ${res.status}`);
    return;
  }
  const reader = res.body?.getReader();
  if (!reader) { callbacks.onError('No response body'); return; }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try {
        const data = JSON.parse(line.slice(6));
        if (data.type === 'token') {
          callbacks.onToken(data.content);
        } else if (data.type === 'done') {
          callbacks.onDone(data);
        } else if (data.type === 'error') {
          callbacks.onError(data.message);
        }
      } catch { /* skip malformed lines */ }
    }
  }
}

export async function resetInterview(sessionId: string): Promise<void> {
  await fetch(`${BASE}/reset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

export function csvDownloadUrl(sessionId: string): string {
  return `${BASE}/csv/${sessionId}`;
}

export async function submitExpertReview(
  sessionId: string,
  questionId: string,
  action: 'approve' | 'override',
  expertStatus?: string,
  expertRationale?: string,
): Promise<{ status: string; scorecard: ScorecardData }> {
  const res = await fetch(`${BASE}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      question_id: questionId,
      action,
      expert_status: expertStatus || null,
      expert_rationale: expertRationale || null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `Review failed: ${res.status}`);
  }
  return res.json();
}

export async function bulkApproveReviews(
  sessionId: string,
): Promise<{ status: string; approved_items: string[]; scorecard: ScorecardData }> {
  const res = await fetch(`${BASE}/review/bulk-approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) throw new Error(`Bulk approve failed: ${res.status}`);
  return res.json();
}

export async function listSessions(): Promise<{ sessions: SessionSummary[] }> {
  const res = await fetch(`${BASE}/sessions`);
  if (!res.ok) throw new Error(`List sessions failed: ${res.status}`);
  return res.json();
}

export async function loadSession(sessionId: string): Promise<SessionDetail> {
  const res = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `Load session failed: ${res.status}`);
  }
  return res.json();
}
