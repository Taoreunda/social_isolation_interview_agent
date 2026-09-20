import { Send } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { FormEvent, KeyboardEvent, ReactNode } from 'react'

import type { InterviewMessage } from '@/app/contracts'
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
  pendingMessage: string | null
  progress: number
  retrying: boolean
  showComposer: boolean
  title?: ReactNode
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
  pendingMessage,
  progress,
  retrying,
  showComposer,
  title,
}: ChatProps) {
  const submitLabel = retrying ? '다시 시도' : '답변 전송'
  const conversation = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = conversation.current
    if (node) node.scrollTop = node.scrollHeight
  }, [messages.length, pendingMessage, isSending])

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
          {isSending && <li className="flex justify-start">
            <p className={`${bubbleClass('assistant')} text-muted-foreground`} role="status">답변을 생성하는 중</p>
          </li>}
        </ol>
      </div>
      {showComposer && <form className="flex min-w-0 items-end gap-2 border-t border-border pt-3" onSubmit={onSubmit}>
        <div className="min-w-0 flex-1">
          <label className="sr-only" htmlFor="interview-answer">답변 입력</label>
          <Textarea
            className="h-16 min-h-16 field-sizing-fixed resize-none"
            disabled={isSending || retrying}
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
          disabled={isSending || (!retrying && !answer.trim())}
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
