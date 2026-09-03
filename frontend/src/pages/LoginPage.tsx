import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSession } from '@/app/session-context'
import type { Role } from '@/app/contracts'

function homeFor(role: Role): string {
  return role === 'admin' ? '/admin' : '/interview'
}

export function LoginPage() {
  const { login } = useSession()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const mounted = useRef(false)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const abortController = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      abortController.current?.abort()
      mounted.current = false
      generation.current += 1
    }
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (inFlight.current) return

    if (!username || !password) {
      setError('입력 내용을 확인하세요')
      return
    }

    const operation = ++generation.current
    const controller = new AbortController()
    abortController.current = controller
    inFlight.current = true
    setError(null)
    setIsSubmitting(true)
    try {
      const user = await login({ username, password, remember }, controller.signal)
      if (!mounted.current || operation !== generation.current) return
      navigate(homeFor(user.role), { replace: true })
    } catch {
      if (!mounted.current || operation !== generation.current) return
      setError('로그인에 실패했습니다')
    } finally {
      if (abortController.current === controller) abortController.current = null
      if (!mounted.current || operation !== generation.current) return
      inFlight.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm items-center px-4">
      <form className="w-full space-y-5" onSubmit={(event) => void handleSubmit(event)}>
        <p className="font-semibold text-foreground">Dabom</p>
        <h1 className="text-2xl font-semibold">로그인</h1>
        <div className="space-y-2">
          <Label htmlFor="username">사용자 이름</Label>
          <Input
            autoComplete="username"
            id="username"
            onChange={(event) => setUsername(event.target.value)}
            value={username}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">비밀번호</Label>
          <Input
            autoComplete="current-password"
            id="password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            checked={remember}
            id="remember"
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          <Label htmlFor="remember">자동 로그인</Label>
        </div>
        {error && <p role="alert">{error}</p>}
        <Button aria-busy={isSubmitting} className="w-full" disabled={isSubmitting} type="submit">
          로그인
        </Button>
      </form>
    </main>
  )
}
