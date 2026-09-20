import type { Role } from './contracts'

/** Where a signed-in account lands: the review queue for staff, the interview for a participant. */
export function homeFor(role: Role | undefined): string {
  return role === 'admin' || role === 'reviewer' ? '/admin' : '/interview'
}
