import { AlertCircle, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { useApi } from '@/app/api-context'
import { hasApiStatus } from '@/app/api-error'
import type { InterviewDetail, ParticipantInterview, SuggestedReply } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Chat } from '@/features/interview/Chat'
import { JudgmentFlow } from '@/features/interview/JudgmentFlow'

type InterviewPhase =
  | 'loading'
  | 'idle'
  | 'starting'
  | 'start_error'
  | 'active'
  | 'sending'
  | 'load_error'
  | 'send_error'
  | 'completed'

interface PendingTurn {
  clientTurnId: string
  content: string
  // True when the participant tapped a suggested reply; a retry keeps saying so.
  suggested?: boolean
}

function phaseFor(interview: ParticipantInterview): InterviewPhase {
  return interview.status === 'completed' ? 'completed' : 'active'
}

// The server answers a turn in one piece; the screen types it out so the
// interviewer's words arrive at reading pace instead of landing all at once.
const STREAM_TICK_MS = 28
const STREAM_CHARS_PER_TICK = 2
const STREAM_PAUSE_TICKS = 9

interface StreamCursor {
  index: number
  chars: number
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

interface InterviewPageProps {
  adminTools?: boolean
  debug?: boolean
  streamTick?: number
}

export function InterviewPage({ adminTools = false, debug = false, streamTick = STREAM_TICK_MS }: InterviewPageProps) {
  const api = useApi()
  const [answer, setAnswer] = useState('')
  const [pendingMessage, setPendingMessage] = useState<string | null>(null)
  const [interview, setInterview] = useState<ParticipantInterview | null>(null)
  const [loadError, setLoadError] = useState('인터뷰를 불러오지 못했습니다')
  const [phase, setPhase] = useState<InterviewPhase>('loading')
  const [confirmingRestart, setConfirmingRestart] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const [trace, setTrace] = useState<InterviewDetail | null>(null)
  const [traceError, setTraceError] = useState<string | null>(null)
  const traceRequest = useRef(0)
  // While the interviewer's new words are being typed out: the message being
  // typed and how much of it is on screen. null shows every message whole.
  const [stream, setStream] = useState<StreamCursor | null>(null)
  const mounted = useRef(false)
  const requestGeneration = useRef(0)
  const inFlight = useRef(false)
  const pendingTurn = useRef<PendingTurn | null>(null)

  const loadInterview = useCallback(async (): Promise<void> => {
    const operation = ++requestGeneration.current
    setPhase('loading')
    setLoadError('인터뷰를 불러오지 못했습니다')
    try {
      const detail = await api.getCurrentInterview()
      if (!mounted.current || operation !== requestGeneration.current) return
      setInterview(detail)
      setPhase(phaseFor(detail))
    } catch (error) {
      if (!mounted.current || operation !== requestGeneration.current) return
      if (hasApiStatus(error, 404)) {
        setInterview(null)
        setPhase('idle')
        return
      }
      if (hasApiStatus(error, 403)) setLoadError('이 인터뷰에 접근할 권한이 없습니다')
      setPhase('load_error')
    }
  }, [api])

  useEffect(() => {
    mounted.current = true
    void loadInterview()
    return () => {
      mounted.current = false
      requestGeneration.current += 1
    }
  }, [loadInterview])

  const showTrace = adminTools && debug
  const interviewId = interview?.id ?? null
  useEffect(() => {
    if (showTrace && interviewId) void refreshTrace(interviewId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshTrace is stable for a given api
  }, [showTrace, interviewId])

  async function startInterview(): Promise<void> {
    if (inFlight.current) return
    const operation = ++requestGeneration.current
    inFlight.current = true
    setPhase('starting')
    try {
      const detail = await api.startInterview()
      if (!mounted.current || operation !== requestGeneration.current) return
      setAnswer('')
      setPendingMessage(null)
      pendingTurn.current = null
      adopt(detail, { streamFrom: 0 })
    } catch {
      if (!mounted.current || operation !== requestGeneration.current) return
      setPhase('start_error')
    } finally {
      inFlight.current = false
    }
  }

  // The judgment flow comes from the administrator detail of this very
  // interview; a participant never asks for it and would be refused anyway.
  async function refreshTrace(interviewId: string): Promise<void> {
    const operation = ++traceRequest.current
    setTraceError(null)
    try {
      const detail = await api.getInterview(interviewId)
      if (!mounted.current || operation !== traceRequest.current) return
      setTrace(detail)
    } catch {
      if (!mounted.current || operation !== traceRequest.current) return
      setTraceError('판정 흐름을 불러오지 못했습니다')
    }
  }

  // streamFrom is the first message that is new to this screen; everything
  // before it is already known to the participant and appears whole.
  function adopt(detail: ParticipantInterview, options: { streamFrom?: number } = {}): void {
    setInterview(detail)
    setPhase(phaseFor(detail))
    const from = options.streamFrom
    const streams = from !== undefined && from < detail.messages.length && !prefersReducedMotion()
    setStream(streams ? { index: from, chars: 0 } : null)
    if (adminTools && debug) void refreshTrace(detail.id)
  }

  useEffect(() => {
    if (!stream || !interview) return
    const message = interview.messages[stream.index]
    if (!message) {
      setStream(null)
      return
    }
    // The participant's own words are never typed out.
    if (message.role !== 'assistant') {
      setStream({ index: stream.index + 1, chars: 0 })
      return
    }
    const finished = stream.chars >= message.content.length
    const timer = setTimeout(
      () => setStream((cursor) => {
        if (!cursor) return null
        return finished
          ? { index: cursor.index + 1, chars: 0 }
          : { ...cursor, chars: cursor.chars + STREAM_CHARS_PER_TICK }
      }),
      finished ? streamTick * STREAM_PAUSE_TICKS : streamTick,
    )
    return () => clearTimeout(timer)
  }, [stream, interview, streamTick])

  async function restartInterview(): Promise<void> {
    if (!interview || inFlight.current) return
    const operation = ++requestGeneration.current
    inFlight.current = true
    setRestarting(true)
    setRestartError(null)
    let archived = false
    try {
      await api.archiveInterview(interview.id)
      archived = true
      const detail = await api.startInterview()
      if (!mounted.current || operation !== requestGeneration.current) return
      setAnswer('')
      setPendingMessage(null)
      pendingTurn.current = null
      adopt(detail, { streamFrom: 0 })
      setConfirmingRestart(false)
    } catch {
      if (!mounted.current || operation !== requestGeneration.current) return
      if (archived) {
        // The old run is already filed away; offer a plain start instead of a retry that would conflict.
        setConfirmingRestart(false)
        setInterview(null)
        setPhase('start_error')
        return
      }
      setRestartError('다시 시작하지 못했습니다')
    } finally {
      inFlight.current = false
      if (mounted.current) setRestarting(false)
    }
  }

  function submitAnswer(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    const turn = pendingTurn.current ?? (() => {
      const content = answer.trim()
      return content ? { clientTurnId: crypto.randomUUID(), content } : null
    })()
    if (turn) void dispatchTurn(turn)
  }

  // A tapped reply is an answer like any other, unless it asks to be finished first.
  function pickSuggestion(reply: SuggestedReply): void {
    if (reply.send) {
      if (!pendingTurn.current) void dispatchTurn({ clientTurnId: crypto.randomUUID(), content: reply.text, suggested: true })
      return
    }
    setAnswer(`${reply.text}. `)
    document.getElementById('interview-answer')?.focus()
  }

  async function dispatchTurn(turn: PendingTurn): Promise<void> {
    if (!interview || inFlight.current) return

    pendingTurn.current = turn
    const operation = ++requestGeneration.current
    inFlight.current = true
    setPendingMessage(turn.content)
    setAnswer('')
    setPhase('sending')
    try {
      const detail = turn.suggested
        ? await api.sendMessage(interview.id, turn.clientTurnId, turn.content, true)
        : await api.sendMessage(interview.id, turn.clientTurnId, turn.content)
      if (!mounted.current || operation !== requestGeneration.current) return
      pendingTurn.current = null
      setPendingMessage(null)
      // Skip the participant's own message; type out what the interviewer says next.
      adopt(detail, { streamFrom: interview.messages.length + 1 })
    } catch {
      if (!mounted.current || operation !== requestGeneration.current) return
      setPhase('send_error')
    } finally {
      if (!mounted.current || operation !== requestGeneration.current) return
      inFlight.current = false
    }
  }

  if (phase === 'loading') {
    return <main aria-busy="true" className="mx-auto w-full max-w-3xl px-4 py-6"><p role="status">인터뷰를 불러오는 중</p></main>
  }

  if (phase === 'load_error') {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <p className="inline-flex items-center gap-2" role="alert"><AlertCircle aria-hidden="true" className="size-4" />{loadError}</p>
        <Button className="mt-4" onClick={() => void loadInterview()} type="button">
          <RefreshCw aria-hidden="true" />
          다시 시도
        </Button>
      </main>
    )
  }

  if (phase === 'idle' || phase === 'starting' || phase === 'start_error') {
    const starting = phase === 'starting'
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6">
        <h1 className="text-xl font-semibold">인터뷰</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          준비되셨으면 시작해 주세요. 진행자가 한 번에 한 가지씩 여쭙고, 답변은 언제든 이어서 하실 수 있습니다.
        </p>
        {phase === 'start_error' && <p className="mt-4 inline-flex items-center gap-2" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />인터뷰를 시작하지 못했습니다
        </p>}
        <Button
          aria-busy={starting}
          className="mt-5 min-h-11 sm:min-h-9"
          disabled={starting}
          onClick={() => void startInterview()}
          type="button"
        >
          <Play aria-hidden="true" />{phase === 'start_error' ? '다시 시도' : '인터뷰 시작'}
        </Button>
      </main>
    )
  }

  if (!interview) return null

  // With the panel open the page becomes two columns: the chat centred in what
  // remains, the panel a sidebar on the right edge running the full height.
  const mainClass = showTrace
    ? 'flex min-h-0 w-full flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:grid-rows-[minmax(0,1fr)]'
    : 'mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pt-4 pb-4'
  const chatColumnClass = showTrace
    ? 'mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-4 pt-4 pb-4'
    : 'flex min-h-0 flex-1 flex-col'
  const tracePanel = showTrace ? (
    <section
      aria-label="디버깅"
      className="flex max-h-80 min-h-0 flex-col border-t border-border bg-muted/30 px-4 pt-4 pb-4 lg:max-h-none lg:border-t-0 lg:border-l lg:overflow-y-auto lg:px-5"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">디버깅</span>
        {phase !== 'completed' && <Button
          className="ml-auto min-h-11 shrink-0 text-muted-foreground sm:min-h-9"
          disabled={phase === 'sending'}
          onClick={() => {
            setRestartError(null)
            setConfirmingRestart(true)
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RotateCcw aria-hidden="true" />처음부터 다시
        </Button>}
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
        {traceError && <p className="inline-flex items-center gap-2 text-sm" role="alert">
          <AlertCircle aria-hidden="true" className="size-4" />{traceError}
        </p>}
        {!traceError && (trace
          ? <JudgmentFlow detail={trace} />
          : <p className="text-sm text-muted-foreground">판정 흐름을 불러오는 중</p>)}
      </div>
    </section>
  ) : null

  if (phase === 'completed') {
    return (
      <main className={mainClass}>
        <div className={chatColumnClass} data-chat-column="">
        <Chat
          actions={<Button
            className="min-h-11 sm:min-h-9"
            onClick={() => void startInterview()}
            size="sm"
            type="button"
            variant="outline"
          >
            <Play aria-hidden="true" />새 인터뷰 시작
          </Button>}
          answer=""
          isSending={false}
          messages={interview.messages}
          onAnswerChange={() => undefined}
          onSubmit={() => undefined}
          pendingMessage={null}
          progress={interview.progress}
          retrying={false}
          showComposer={false}
          title={<h1 className="shrink-0 text-sm font-semibold">완료했습니다</h1>}
        />
        </div>
        {tracePanel}
      </main>
    )
  }

  const retrying = phase === 'send_error'
  const visibleMessages = stream === null
    ? interview.messages
    : [
        ...interview.messages.slice(0, stream.index),
        ...(stream.chars > 0 && interview.messages[stream.index]
          ? [{ ...interview.messages[stream.index], content: interview.messages[stream.index].content.slice(0, stream.chars) }]
          : []),
      ]
  return (
    <main className={mainClass}>
      <div className={chatColumnClass} data-chat-column="">
      {retrying && <p className="mb-3 inline-flex items-center gap-2 text-sm" role="alert"><AlertCircle aria-hidden="true" className="size-4" />답변을 보내지 못했습니다</p>}
      <Chat
        title={<h1 className="shrink-0 text-sm font-semibold">인터뷰 진행 중</h1>}
        answer={answer}
        isSending={phase === 'sending'}
        messages={visibleMessages}
        typing={stream !== null}
        onAnswerChange={setAnswer}
        onSubmit={submitAnswer}
        onSuggestion={pickSuggestion}
        suggestions={interview.suggestedReplies}
        pendingMessage={pendingMessage}
        progress={interview.progress}
        retrying={retrying}
        showComposer
      />
      <Dialog
        onOpenChange={(open) => { if (!open && !restarting) setConfirmingRestart(false) }}
        open={confirmingRestart}
      >
        <DialogContent>
          <DialogHeader><DialogTitle>처음부터 다시</DialogTitle></DialogHeader>
          <p className="text-sm leading-6">지금 인터뷰는 보관되고 새 인터뷰가 시작됩니다.</p>
          {restartError && <p className="inline-flex items-center gap-2" role="alert">
            <AlertCircle aria-hidden="true" className="size-4" />{restartError}
          </p>}
          <DialogFooter>
            <Button disabled={restarting} onClick={() => setConfirmingRestart(false)} type="button" variant="outline">취소</Button>
            <Button aria-busy={restarting} disabled={restarting} onClick={() => void restartInterview()} type="button">
              <RotateCcw aria-hidden="true" />다시 시작
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
      {tracePanel}
    </main>
  )
}
