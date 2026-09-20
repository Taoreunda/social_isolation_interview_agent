import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'

import type { Role } from './contracts'
import { homeFor } from './home'
import { useSession } from './session-context'

export function RequireGuest({ children }: { children: ReactNode }) {
  const { user } = useSession()
  return user ? <Navigate to={homeFor(user.role)} replace /> : children
}

export function RequireRole({ role, children }: { role: Role | Role[]; children: ReactNode }) {
  const { user } = useSession()
  if (!user) return <Navigate to="/login" replace />
  const allowed = Array.isArray(role) ? role : [role]
  return allowed.includes(user.role) ? children : <Navigate to={homeFor(user.role)} replace />
}
