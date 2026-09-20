import { PenLine, Send, SendHorizontal } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'

import type { InterviewMessage, SuggestedReply } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'

interface ChatProps {
  actions?: ReactNode
  answer: string
  isSending: boolean
  messages: InterviewMessage[]
  onAnswerChange: (answer: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onSuggestion?: (reply: SuggestedReply) => void
  pendingMessage: string | null
  progress: number
  retrying: boolean
  showComposer: boolean
  // Reviewer views say which answers were tapped from the suggested replies.
  showSources?: boolean
  suggestions?: SuggestedReply[]
  title?: ReactNode
  typing?: boolean
}

// Replies longer than this are sentences and read better stacked than wrapped.
const LONG_REPLY = 8

function roleName(role: InterviewMessage['role']): string {
  return role === 'assistant' ? '인터뷰 진행자' : '참여자'
}

function bubbleClass(role: InterviewMessage['role']): string {
  const shared = 'max-w-[85%] whitespace-pre-wrap rounded-lg px-4 py-2.5 text-sm leading-6 sm:max-w-[70%]'
  return role === 'user'
    ? `${shared} bg-primary text-primary-foreground`
    : `${shared} bg-muted`
}

// Enter sends; Shift+Enter keeps a line break. A Korean syllable still being
// composed (isComposing, or the 229 keyCode older engines report) is never sent.
function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>): void {
  if (event.key !== 'Enter' || event.shiftKey) return
  if (event.nativeEvent.isComposing || event.keyCode === 229) return
  event.preventDefault()
  const form = event.currentTarget.form
  if (!form) return
  if (typeof form.requestSubmit === 'function') form.requestSubmit()
  else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
}

export function Chat({
  actions,
  answer,
  isSending,
  messages,
  onAnswerChange,
  onSubmit,
  onSuggestion,
  pendingMessage,
  progress,
  retrying,
  showComposer,
  showSources = false,
  suggestions = [],
  title,
  typing = false,
}: ChatProps) {
  const submitLabel = retrying ? '다시 시도' : '답변 전송'
  const offerSuggestions = showComposer && !isSending && !retrying && !typing && suggestions.length > 0
  const conversation = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = conversation.current
    if (node) node.scrollTop = node.scrollHeight
    // The last message grows while it is being typed out; keep it in view as it wraps.
  }, [messages.length, messages[messages.length - 1]?.content.length, pendingMessage, isSending, typing])

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border pb-3">
        {title}
        <Progress
          aria-label="진행률"
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={progress}
          className="h-1.5 min-w-16 flex-1"
          value={progress}
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{progress}%</span>
        {actions}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-4" ref={conversation}>
        <ol aria-label="인터뷰 대화" className="space-y-3">
          {messages.map((message) => (
            <li
              aria-label={`${roleName(message.role)} 메시지`}
              className={message.role === 'user' ? 'flex flex-col items-end' : 'flex justify-start'}
              key={message.id}
            >
              <p className={bubbleClass(message.role)}>
                {message.content}
              </p>
              {showSources && message.source === 'suggested' && (
                <span className="mt-1 text-xs text-muted-foreground">보기에서 선택</span>
              )}
            </li>
          ))}
          {pendingMessage !== null && <li aria-label="참여자 메시지" className="flex justify-end">
            <p className={bubbleClass('user')}>{pendingMessage}</p>
          </li>}
          {isSending && <li className="flex justify-start">
            <p className={`${bubbleClass('assistant')} text-muted-foreground`} role="status">답변을 생성하는 중</p>
          </li>}
        </ol>
      </div>
      {offerSuggestions && <div
        aria-label="추천 답변"
        className="border-t border-border pt-3"
        // A new key for every turn replays the entrance, even when two questions share a set.
        key={`${messages.length}:${suggestions.map((reply) => reply.text).join('|')}`}
        role="group"
      >
        <p className="text-right text-xs text-muted-foreground">아래에서 고르거나 직접 입력하세요</p>
        {/* They sit on the participant's side and share the shape of the participant's
            bubble: replies not yet sent. Sentences stack; short values wrap on a row. */}
        <div
          className={suggestions.some((reply) => reply.text.length > LONG_REPLY)
            ? 'mt-2 flex flex-col items-end gap-2'
            : 'mt-2 flex flex-wrap justify-end gap-2'}
          data-testid="reply-list"
        >
          {suggestions.map((reply, index) => (
            <button
              className="group inline-flex min-h-11 max-w-[85%] items-center gap-2 rounded-lg border border-primary bg-background px-4 py-2 text-left text-sm leading-6 font-medium text-primary shadow-[0_1px_0_0_var(--accent)] transition-[color,background-color,transform,box-shadow] animate-in fade-in slide-in-from-bottom-2 zoom-in-95 fill-mode-both duration-300 hover:-translate-y-0.5 hover:bg-primary hover:text-primary-foreground active:translate-y-0 active:scale-95 active:shadow-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none motion-reduce:animate-none motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:min-h-10"
              key={reply.text}
              onClick={() => onSuggestion?.(reply)}
              style={{ animationDelay: `${150 + index * 70}ms` }}
              type="button"
            >
              <span>{reply.text}</span>
              {reply.send
                ? <SendHorizontal aria-hidden="true" className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
                : <span className="inline-flex shrink-0 items-center gap-1 text-xs font-normal opacity-70 group-hover:opacity-100">
                    <PenLine aria-hidden="true" className="size-3.5" />이어서 입력
                  </span>}
            </button>
          ))}
        </div>
      </div>}
      {showComposer && <form className={`flex min-w-0 items-end gap-2 pt-3 ${offerSuggestions ? '' : 'border-t border-border'}`} onSubmit={onSubmit}>
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="interview-answer">답변 입력</label>
          <Textarea
            className="h-16 min-h-16 field-sizing-fixed resize-none"
            disabled={isSending || retrying || typing}
            id="interview-answer"
            onChange={(event) => onAnswerChange(event.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="답변 입력"
            rows={2}
            value={answer}
          />
        </div>
        <Button
          aria-busy={isSending}
          aria-label={submitLabel}
          className={retrying ? undefined : 'size-11 sm:size-9'}
          disabled={isSending || typing || (!retrying && !answer.trim())}
          size={retrying ? 'default' : 'icon'}
          type="submit"
        >
          <Send aria-hidden="true" />
          <span className={retrying ? undefined : 'sr-only'}>{submitLabel}</span>
        </Button>
      </form>}
    </>
  )
}
