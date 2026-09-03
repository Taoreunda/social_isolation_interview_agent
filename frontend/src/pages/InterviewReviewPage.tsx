import { AlertCircle, Download, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'

import { useApi } from '@/app/api-context'
import type { InterviewDetail, ReviewScorecardInput } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { ScorecardReview } from '@/features/admin/ScorecardReview'

function csvName(code: string): string { return `${code.replace(/[^A-Za-z0-9._-]/g, '_') || 'interview'}.csv` }

export function InterviewReviewPage() {
  const api = useApi(); const { interviewId = '' } = useParams(); const [detail, setDetail] = useState<InterviewDetail | null>(null); const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading'); const [exportError, setExportError] = useState<string | null>(null); const [exporting, setExporting] = useState(false)
  const mounted = useRef(false); const latestInterviewId = useRef(interviewId); const loadGeneration = useRef(0); const reviewLocks = useRef(new Map<string, symbol>()); const exportInFlight = useRef(false); const revokeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  latestInterviewId.current = interviewId
  const revoke = useCallback((url: string) => { const timer = revokeTimers.current.get(url); if (timer) clearTimeout(timer); revokeTimers.current.delete(url); if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url) }, [])
  const load = useCallback(async () => { const current = ++loadGeneration.current; setPhase('loading'); try { const loaded = await api.getInterview(interviewId); if (!mounted.current || current !== loadGeneration.current || latestInterviewId.current !== interviewId) return; setDetail(loaded); setPhase('ready') } catch { if (mounted.current && current === loadGeneration.current && latestInterviewId.current === interviewId) setPhase('error') } }, [api, interviewId])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; loadGeneration.current += 1; for (const url of revokeTimers.current.keys()) revoke(url); reviewLocks.current.clear() } }, [load, revoke])
  async function reviewScorecard(input: ReviewScorecardInput): Promise<boolean> {
    const key = `${input.interviewId}:${input.questionId}`; if (reviewLocks.current.has(key)) return false
    const token = Symbol(key); reviewLocks.current.set(key, token)
    try { const committed = await api.reviewScorecard(input); if (mounted.current && latestInterviewId.current === input.interviewId) { setDetail(committed); return true }; return false } finally { if (reviewLocks.current.get(key) === token) reviewLocks.current.delete(key) }
  }
  async function exportCsv(): Promise<void> {
    if (exportInFlight.current || !detail) return
    if (typeof document === 'undefined' || !document.body || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function' || typeof URL.revokeObjectURL !== 'function') { setExportError('CSV를 다운로드할 수 없습니다'); return }
    exportInFlight.current = true; setExporting(true); setExportError(null); let url: string | null = null; let link: HTMLAnchorElement | null = null
    try { const blob = await api.exportInterviewCsv(detail.id); if (!mounted.current || latestInterviewId.current !== detail.id) return; url = URL.createObjectURL(blob); link = document.createElement('a'); link.href = url; link.download = csvName(detail.participantCode); document.body.appendChild(link); link.click(); link.remove(); link = null; const completedUrl = url; revokeTimers.current.set(completedUrl, setTimeout(() => revoke(completedUrl), 0)); url = null } catch { if (link) link.remove(); if (url) revoke(url); if (mounted.current) setExportError('CSV를 다운로드하지 못했습니다') } finally { exportInFlight.current = false; if (mounted.current) setExporting(false) }
  }
  if (phase === 'loading') return <main aria-busy="true" className="mx-auto w-full max-w-6xl px-4 py-6"><p role="status">인터뷰를 불러오는 중</p></main>
  if (phase === 'error') return <main className="mx-auto w-full max-w-6xl px-4 py-6"><p className="inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />인터뷰를 불러오지 못했습니다</p><Button className="mt-3" onClick={() => void load()} type="button" variant="outline"><RefreshCw aria-hidden="true" />다시 시도</Button></main>
  if (!detail) return null
  return <main className="mx-auto w-full max-w-6xl px-4 py-6"><div className="flex flex-wrap items-center gap-3"><div><h1 className="text-xl font-semibold">인터뷰 검토</h1><p className="mt-1 text-sm text-muted-foreground">{detail.participantCode}</p></div><Button className="ml-auto min-h-11 sm:min-h-9" aria-busy={exporting} disabled={exporting} onClick={() => void exportCsv()} type="button" variant="outline"><Download aria-hidden="true" />CSV 다운로드</Button></div>{exportError && <p className="mt-3 inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />{exportError}</p>}<div className="mt-6 grid gap-8 lg:grid-cols-2" data-testid="review-split"><section aria-labelledby="transcript-heading"><h2 className="text-lg font-semibold" id="transcript-heading">대화</h2><ol className="mt-3 divide-y divide-border border-y border-border">{detail.messages.map((message) => <li className="py-3" key={message.id}><p className="text-sm font-medium">{message.role === 'user' ? '참여자' : '진행자'}</p><p aria-label={message.role === 'user' ? '참여자 메시지' : '진행자 메시지'} className="mt-1 whitespace-pre-wrap break-words">{message.content}</p></li>)}</ol></section><section aria-labelledby="scorecard-heading"><h2 className="text-lg font-semibold" id="scorecard-heading">점수표</h2><div className="mt-3"><ScorecardReview interviewId={detail.id} key={detail.id} scorecard={detail.scorecard} onReview={reviewScorecard} /></div></section></div></main>
}
