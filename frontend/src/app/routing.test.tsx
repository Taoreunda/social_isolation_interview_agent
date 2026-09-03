import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { ApiProvider } from './api-context'
import type { AppApi } from './contracts'
import { MockAppApi } from '../mocks/mock-api'
import { AdminLayout } from '../layouts/AdminLayout'
import { ParticipantLayout } from '../layouts/ParticipantLayout'
import { RequireGuest, RequireRole } from './route-guards'
import { SessionProvider } from './session-context'

function createStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  }
}

function installBrowserStorage(): void {
  Object.defineProperties(window, {
    localStorage: { configurable: true, value: createStorage() },
    sessionStorage: { configurable: true, value: createStorage() },
  })
}

function renderRoutes(api: AppApi, entry: string) {
  return render(
    <ApiProvider api={api}>
      <SessionProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/login" element={<RequireGuest><p>Login</p></RequireGuest>} />
            <Route element={<RequireRole role="participant"><ParticipantLayout /></RequireRole>}>
              <Route path="/interview" element={<p>Interview</p>} />
            </Route>
            <Route element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
              <Route path="/admin" element={<p>Admin</p>} />
            </Route>
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </MemoryRouter>
      </SessionProvider>
    </ApiProvider>,
  )
}

describe('role-protected routes', () => {
  beforeEach(() => {
    installBrowserStorage()
  })

  it('redirects a guest from /interview to /login', async () => {
    renderRoutes(new MockAppApi(), '/interview')

    expect(await screen.findByText('Login')).toBeInTheDocument()
  })

  it('redirects a participant away from /admin', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: false })

    renderRoutes(api, '/admin')

    expect(await screen.findByText('Interview')).toBeInTheDocument()
  })

  it('redirects an admin away from /interview', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'admin', password: 'research123!', remember: false })

    renderRoutes(api, '/interview')

    expect(await screen.findByText('Admin')).toBeInTheDocument()
  })

  it('restores the remembered mock user after remount', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: true })
    const firstMount = renderRoutes(api, '/interview')

    expect(await screen.findByText('Interview')).toBeInTheDocument()
    firstMount.unmount()

    renderRoutes(api, '/interview')

    expect(await screen.findByText('Interview')).toBeInTheDocument()
  })

  it('clears the route session on logout', async () => {
    const api = new MockAppApi()
    await api.login({ username: 'participant01', password: 'research123!', remember: true })
    render(
      <ApiProvider api={api}>
        <SessionProvider>
          <MemoryRouter initialEntries={['/interview']}>
            <Routes>
              <Route element={<RequireRole role="participant"><ParticipantLayout /></RequireRole>}>
                <Route path="/interview" element={<p>Interview</p>} />
              </Route>
              <Route path="/login" element={<p>Login</p>} />
            </Routes>
          </MemoryRouter>
        </SessionProvider>
      </ApiProvider>,
    )

    await screen.findByText('Interview')
    await userEvent.setup().click(screen.getByRole('button', { name: '로그아웃' }))

    expect(await screen.findByText('Login')).toBeInTheDocument()
    expect(await api.getCurrentUser()).toBeNull()
  })
})
