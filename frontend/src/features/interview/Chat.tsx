import { Send } from 'lucide-react'
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
  suggestions?: SuggestedReply[]
  title?: ReactNode
  typing?: boolean
}

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
  }, [messages.length, pendingMessage, isSending, typing])

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
              className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
              key={message.id}
            >
              <p className={bubbleClass(message.role)}>
                {message.content}
              </p>
            </li>
          ))}
          {pendingMessage !== null && <li aria-label="참여자 메시지" className="flex justify-end">
            <p className={bubbleClass('user')}>{pendingMessage}</p>
          </li>}
          {typing && <li className="flex justify-start">
            <p aria-label="진행자가 입력하는 중" className={`${bubbleClass('assistant')} inline-flex items-center gap-1`} role="status">
              {[0, 1, 2].map((dot) => (
                <span
                  aria-hidden="true"
                  className="size-1.5 animate-pulse rounded-full bg-foreground/50 motion-reduce:animate-none"
                  key={dot}
                  style={{ animationDelay: `${dot * 200}ms` }}
                />
              ))}
            </p>
          </li>}
          {isSending && <li className="flex justify-start">
            <p className={`${bubbleClass('assistant')} text-muted-foreground`} role="status">답변을 생성하는 중</p>
          </li>}
        </ol>
      </div>
      {offerSuggestions && <div aria-label="추천 답변" className="flex flex-wrap gap-2 border-t border-border pt-3" role="group">
        {suggestions.map((reply) => (
          <button
            className="min-h-11 rounded-full border border-primary bg-primary/10 px-4 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:min-h-9"
            key={reply.text}
            onClick={() => onSuggestion?.(reply)}
            type="button"
          >
            {reply.text}
          </button>
        ))}
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
