import { useState } from 'react'
import { AlertCircle, ClipboardList, KeyRound, LogOut } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { NavigationAnnouncement } from '@/app/navigation-announcement'
import { useSession } from '@/app/session-context'

export function ParticipantLayout() {
  const { user, isLoggingOut, logout } = useSession()
  const [logoutError, setLogoutError] = useState(false)

  async function handleLogout(): Promise<void> {
    setLogoutError(false)
    try {
      await logout()
    } catch {
      setLogoutError(true)
    }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <NavLink className="shrink-0 font-semibold text-foreground no-underline" to="/interview">Dabom</NavLink>
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
        </nav>
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-2 text-sm">
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
      <div className="flex-1"><Outlet /></div>
    </div>
  )
}
