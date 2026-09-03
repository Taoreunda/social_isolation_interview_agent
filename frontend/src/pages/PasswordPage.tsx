import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { useApi } from '@/app/api-context'
import type { Role } from '@/app/contracts'
import { useSession } from '@/app/session-context'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function homeFor(role: Role | undefined): string {
  return role === 'admin' ? '/admin' : '/interview'
}

export function PasswordPage() {
  const api = useApi()
  const { user } = useSession()
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function returnHome(): void {
    navigate(homeFor(user?.role), { replace: true })
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (isSubmitting) return

    if (newPassword.length < 10 || newPassword.length > 128) {
      setError('새 비밀번호는 10~128자여야 합니다')
      return
    }
    if (newPassword !== confirmation) {
      setError('새 비밀번호가 일치하지 않습니다')
      return
    }

    setError(null)
    setIsSubmitting(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      navigate(homeFor(user?.role), {
        replace: true,
        state: { announcement: '변경했습니다' },
      })
    } catch {
      setError('변경에 실패했습니다')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm items-center px-4">
      <form className="w-full space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        <h1 className="text-2xl font-semibold">비밀번호 변경</h1>
        <div className="space-y-2">
          <Label htmlFor="current-password">현재 비밀번호</Label>
          <Input
            autoComplete="current-password"
            id="current-password"
            onChange={(event) => setCurrentPassword(event.target.value)}
            type="password"
            value={currentPassword}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password">새 비밀번호</Label>
          <Input
            autoComplete="new-password"
            id="new-password"
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            value={newPassword}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="new-password-confirmation">새 비밀번호 확인</Label>
          <Input
            autoComplete="new-password"
            id="new-password-confirmation"
            onChange={(event) => setConfirmation(event.target.value)}
            type="password"
            value={confirmation}
          />
        </div>
        {error && <p role="alert">{error}</p>}
        <div className="flex gap-2">
          <Button aria-busy={isSubmitting} disabled={isSubmitting} type="submit">
            변경
          </Button>
          <Button disabled={isSubmitting} onClick={returnHome} type="button" variant="outline">
            취소
          </Button>
        </div>
      </form>
    </main>
  )
}
