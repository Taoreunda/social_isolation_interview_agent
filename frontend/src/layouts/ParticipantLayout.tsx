import { ClipboardList, LogOut } from 'lucide-react'
import { NavLink, Outlet } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useSession } from '@/app/session-context'

export function ParticipantLayout() {
  const { user, logout } = useSession()

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <NavLink className="font-semibold text-foreground no-underline" to="/interview">Dabom</NavLink>
        <nav aria-label="참여자 탐색" className="flex items-center gap-1">
          <NavLink
            className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
            to="/interview"
          >
            <ClipboardList aria-hidden="true" className="size-4" />
            인터뷰
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <span>{user?.username}</span>
          <Button onClick={() => void logout()} size="sm" variant="outline">
            <LogOut aria-hidden="true" />
            로그아웃
          </Button>
        </div>
      </header>
      <main className="flex-1"><Outlet /></main>
    </div>
  )
}
