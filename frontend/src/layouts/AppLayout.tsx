import { useState } from 'react'
import { AlertCircle, Bug, ClipboardList, KeyRound, LogOut, MessageSquare, Users, type LucideIcon } from 'lucide-react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'

import type { Role } from '@/app/contracts'
import { homeFor } from '@/app/home'
import { NavigationAnnouncement } from '@/app/navigation-announcement'
import { useSession } from '@/app/session-context'
import { Button } from '@/components/ui/button'

interface Tab {
  to: string
  label: string
  icon: LucideIcon
  // Paths, besides `to` itself, on which this tab is the current one.
  alsoCurrentUnder?: string
}

// One set of tabs per role, the same on every screen that role can open.
const TABS: Record<Role, Tab[]> = {
  admin: [
    { to: '/admin', label: '검토', icon: ClipboardList, alsoCurrentUnder: '/admin/interviews/' },
    { to: '/admin/participants', label: '참여자', icon: Users },
    { to: '/interview', label: '인터뷰 해보기', icon: MessageSquare },
    { to: '/account/password', label: '계정', icon: KeyRound },
  ],
  participant: [
    { to: '/interview', label: '인터뷰', icon: MessageSquare },
    { to: '/account/password', label: '계정', icon: KeyRound },
  ],
}

const NAVIGATION_NAME: Record<Role, string> = { admin: '관리자 탐색', participant: '참여자 탐색' }

export function AppLayout() {
  const { user, isLoggingOut, logout } = useSession()
  const [logoutError, setLogoutError] = useState(false)
  const { pathname } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const role: Role = user?.role ?? 'participant'
  const debugging = searchParams.get('debug') === '1'
  // Debugging belongs to the interview screen, and only an administrator has it.
  const offersDebugging = role === 'admin' && pathname === '/interview'

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
        <NavLink className="shrink-0 font-semibold text-foreground no-underline" to={homeFor(role)}>고립 챗봇</NavLink>
        <nav aria-label={NAVIGATION_NAME[role]} className="order-3 flex w-full items-center gap-1 sm:order-none sm:w-auto">
          {TABS[role].map(({ to, label, icon: Icon, alsoCurrentUnder }) => {
            const current = pathname === to || (alsoCurrentUnder !== undefined && pathname.startsWith(alsoCurrentUnder))
            return (
              <NavLink
                aria-current={current ? 'page' : undefined}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent ${current ? 'bg-accent font-medium' : ''}`}
                end
                key={to}
                to={to}
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </NavLink>
            )
          })}
        </nav>
        <div className="ml-auto flex min-w-0 max-w-full items-center gap-2 text-sm">
          {offersDebugging && (
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
