import { Copy, KeyRound, RefreshCw, UserPlus } from 'lucide-react'
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

const passwordCharacters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%'

function generatePassword(): string {
  const values = new Uint32Array(18)
  crypto.getRandomValues(values)
  return Array.from(values, (value) => passwordCharacters[value % passwordCharacters.length]).join('')
}

export function ParticipantDialog({ mode, onOpenChange, onParticipantCreated, open, participant }: ParticipantDialogProps) {
  const api = useApi()
  const isCreate = mode === 'create'
  const [username, setUsername] = useState('')
  const [participantCode, setParticipantCode] = useState('')
  const [password, setPassword] = useState(() => isCreate ? generatePassword() : '')
  const [revealedPassword, setRevealedPassword] = useState<string | null>(null)
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
    setPassword('')
    setRevealedPassword(null)
    setError(null)
    setClipboardState('idle')
    setIsSubmitting(false)
  }

  function handleOpenChange(nextOpen: boolean): void {
    if (!nextOpen) clearSecretState()
    onOpenChange(nextOpen)
  }

  function regeneratePassword(): void {
    setPassword(generatePassword())
    setError(null)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (inFlight.current) return
    if (isCreate && (!username.trim() || !participantCode.trim() || password.length < 16)) {
      setError('입력 내용을 확인하세요')
      return
    }

    const currentOperation = ++operation.current
    inFlight.current = true
    setError(null)
    setIsSubmitting(true)
    try {
      if (isCreate) {
        const created = await api.createParticipant({ username: username.trim(), participantCode: participantCode.trim(), password })
        if (!mounted.current || currentOperation !== operation.current) return
        onParticipantCreated(created)
        setRevealedPassword(password)
      } else if (participant) {
        const result = await api.resetParticipantPassword(participant.id)
        if (!mounted.current || currentOperation !== operation.current) return
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
            <output aria-label="할당된 비밀번호" className="block break-all border border-border px-3 py-2 font-mono text-sm">{revealedPassword}</output>
            <Button onClick={() => void copyPassword()} type="button" variant="outline"><Copy aria-hidden="true" />복사</Button>
            {clipboardState !== 'idle' && <p aria-live="polite" role="status">{clipboardState === 'success' ? '복사했습니다' : '복사하지 못했습니다'}</p>}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
            {isCreate ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="participant-username">사용자 이름</Label>
                  <Input autoComplete="off" id="participant-username" onChange={(event) => setUsername(event.target.value)} value={username} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="participant-code">참여자 코드</Label>
                  <Input autoComplete="off" id="participant-code" onChange={(event) => setParticipantCode(event.target.value)} value={participantCode} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assigned-password">할당 비밀번호</Label>
                  <div className="flex gap-2">
                    <Input autoComplete="off" className="min-w-0 font-mono" id="assigned-password" onChange={(event) => setPassword(event.target.value)} value={password} />
                    <Button onClick={regeneratePassword} type="button" variant="outline"><RefreshCw aria-hidden="true" />비밀번호 생성</Button>
                  </div>
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
