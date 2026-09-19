import { useState } from 'react'
import { AlertCircle, Bug, ClipboardList, KeyRound, LogOut } from 'lucide-react'
import { NavLink, Outlet, useSearchParams } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { NavigationAnnouncement } from '@/app/navigation-announcement'
import { useSession } from '@/app/session-context'

export function ParticipantLayout() {
  const { user, isLoggingOut, logout } = useSession()
  const [logoutError, setLogoutError] = useState(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const debugging = searchParams.get('debug') === '1'

  // The switch only changes the address; the interview screen reads it from there.
  function toggleDebugging(): void {
    const next = new URLSearchParams(searchParams)
    if (debugging) next.delete('debug')
    else next.set('debug', '1')
    setSearchParams(next, { replace: true })
  }

  async function handleLogout(): Promise<void> {
    setLogoutError(false)
    try {
      await logout()
    } catch {
      setLogoutError(true)
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <NavLink className="shrink-0 font-semibold text-foreground no-underline" to="/interview">고립 챗봇</NavLink>
        <nav aria-label="참여자 탐색" className="order-3 flex w-full items-center gap-1 sm:order-none sm:w-auto">
          <NavLink
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
            to="/interview"
          >
            <ClipboardList aria-hidden="true" className="size-4" />
            인터뷰
          </NavLink>
          <NavLink
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
            to="/account/password"
          >
            <KeyRound aria-hidden="true" className="size-4" />
            계정
          </NavLink>
          {user?.role === 'admin' && (
            <NavLink
              className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
              to="/admin"
            >
              <ClipboardList aria-hidden="true" className="size-4" />
              검토
            </NavLink>
          )}
        </nav>
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-2 text-sm">
          {user?.role === 'admin' && (
            <Button
              aria-pressed={debugging}
              className="shrink-0"
              onClick={toggleDebugging}
              size="sm"
              type="button"
              variant={debugging ? 'secondary' : 'ghost'}
            >
              <Bug aria-hidden="true" />
              디버깅
            </Button>
          )}
          <span className="min-w-0 truncate" title={user?.username}>{user?.username}</span>
          <Button
            aria-busy={isLoggingOut}
            className="shrink-0"
            disabled={isLoggingOut}
            onClick={() => void handleLogout()}
            size="sm"
            variant="outline"
          >
            <LogOut aria-hidden="true" />
            로그아웃
          </Button>
        </div>
        {logoutError && (
          <p className="inline-flex w-full items-center gap-1" role="alert">
            <AlertCircle aria-hidden="true" className="size-4" />
            로그아웃 실패
          </p>
        )}
      </header>
      <NavigationAnnouncement />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto"><Outlet /></div>
    </div>
  )
}
