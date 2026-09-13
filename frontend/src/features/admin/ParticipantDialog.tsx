import { Copy, KeyRound, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'

import { useApi } from '@/app/api-context'
import type { ParticipantRecord } from '@/app/contracts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type ParticipantDialogMode = 'create' | 'reset'
type ClipboardState = 'idle' | 'success' | 'error'

interface ParticipantDialogProps {
  mode: ParticipantDialogMode
  onOpenChange: (open: boolean) => void
  onParticipantCreated: (participant: ParticipantRecord) => void
  open: boolean
  participant?: ParticipantRecord
}

export function ParticipantDialog({ mode, onOpenChange, onParticipantCreated, open, participant }: ParticipantDialogProps) {
  const api = useApi()
  const isCreate = mode === 'create'
  const [username, setUsername] = useState('')
  const [participantCode, setParticipantCode] = useState('')
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null)
  const [revealedFor, setRevealedFor] = useState<ParticipantRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clipboardState, setClipboardState] = useState<ClipboardState>('idle')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mounted = useRef(false)
  const operation = useRef(0)
  const inFlight = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      operation.current += 1
    }
  }, [])

  function clearSecretState(): void {
    operation.current += 1
    setUsername('')
    setParticipantCode('')
    setRevealedPassword(null)
    setRevealedFor(null)
    setError(null)
    setClipboardState('idle')
    setIsSubmitting(false)
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) clearSecretState()
    onOpenChange(nextOpen)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (inFlight.current) return

    const currentOperation = ++operation.current
    inFlight.current = true
    setError(null)
    setIsSubmitting(true)
    try {
      if (isCreate) {
        const created = await api.createParticipant({
          username: username.trim() || undefined,
          participantCode: participantCode.trim() || undefined,
        })
        if (!mounted.current || currentOperation !== operation.current) return
        onParticipantCreated(created.participant)
        setRevealedFor(created.participant)
        setRevealedPassword(created.assignedPassword ?? '')
      } else if (participant) {
        const result = await api.resetParticipantPassword(participant.id)
        if (!mounted.current || currentOperation !== operation.current) return
        setRevealedFor(participant)
        setRevealedPassword(result.assignedPassword)
      }
    } catch {
      if (mounted.current && currentOperation === operation.current) {
        setError(isCreate ? '계정을 만들지 못했습니다' : '비밀번호를 재설정하지 못했습니다')
      }
    } finally {
      inFlight.current = false
      if (mounted.current && currentOperation === operation.current) setIsSubmitting(false)
    }
  }

  async function copyPassword(): Promise<void> {
    if (!revealedPassword) return
    setClipboardState('idle')
    try {
      if (!window.navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
      await window.navigator.clipboard.writeText(revealedPassword)
      if (mounted.current) setClipboardState('success')
    } catch {
      if (mounted.current) setClipboardState('error')
    }
  }

  const title = isCreate ? '계정 생성' : '비밀번호 재설정'
  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {revealedPassword ? (
          <div className="space-y-3">
            {revealedFor && <dl className="grid gap-1 text-sm">
              <div className="flex gap-2"><dt className="text-muted-foreground">참여자 코드</dt><dd className="font-medium">{revealedFor.participantCode}</dd></div>
              <div className="flex gap-2"><dt className="text-muted-foreground">사용자 이름</dt><dd className="font-medium">{revealedFor.username}</dd></div>
            </dl>}
            <p className="text-sm text-muted-foreground">할당 비밀번호</p>
            <output aria-label="할당된 비밀번호" className="block break-all border border-border px-3 py-2 font-mono text-sm">{revealedPassword}</output>
            <p className="text-sm text-muted-foreground">이 화면을 닫으면 다시 볼 수 없습니다.</p>
            <Button onClick={() => void copyPassword()} type="button" variant="outline"><Copy aria-hidden="true" />복사</Button>
            {clipboardState !== 'idle' && <p aria-live="polite" role="status">{clipboardState === 'success' ? '복사했습니다' : '복사하지 못했습니다'}</p>}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            {isCreate ? (
              <>
                <p className="text-sm text-muted-foreground">
                  비워 두면 다음 연구 코드와 비밀번호를 자동으로 배정합니다.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="participant-code">참여자 코드</Label>
                  <Input autoComplete="off" id="participant-code" onChange={(event) => setParticipantCode(event.target.value)} placeholder="자동 배정" value={participantCode} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="participant-username">사용자 이름</Label>
                  <Input autoComplete="off" id="participant-username" onChange={(event) => setUsername(event.target.value)} placeholder="자동 배정 (코드의 소문자)" value={username} />
                </div>
              </>
            ) : <p className="text-sm">{participant?.participantCode}</p>}
            {error && <p role="alert">{error}</p>}
            <DialogFooter>
              <Button disabled={isSubmitting} onClick={() => handleOpenChange(false)} type="button" variant="outline">취소</Button>
              <Button aria-busy={isSubmitting} disabled={isSubmitting} type="submit">
                {isCreate ? <UserPlus aria-hidden="true" /> : <KeyRound aria-hidden="true" />}{isCreate ? '생성' : '재설정'}
              </Button>
            </DialogFooter>
          </form>
        )}
        {revealedPassword && <DialogFooter><Button onClick={() => handleOpenChange(false)} type="button">닫기</Button></DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}
