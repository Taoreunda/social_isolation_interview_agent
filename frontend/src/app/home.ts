import type { Role } from './contracts'

/** Where a signed-in account lands: the queue for an administrator, the interview for a participant. */
export function homeFor(role: Role | undefined): string {
  return role === 'admin' ? '/admin' : '/interview'
}
