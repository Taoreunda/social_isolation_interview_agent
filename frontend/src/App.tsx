import { BrowserRouter, Navigate, Outlet, Route, Routes, useSearchParams } from 'react-router-dom'

import { ApiProvider } from '@/app/api-context'
import { createDefaultApi } from '@/app/default-api'
import { homeFor } from '@/app/home'
import { RequireGuest, RequireRole } from '@/app/route-guards'
import { SessionProvider, useSession } from '@/app/session-context'
import { AppLayout } from '@/layouts/AppLayout'
import { AdminDashboardPage } from '@/pages/AdminDashboardPage'
import { InterviewPage } from '@/pages/InterviewPage'
import { InterviewReviewPage } from '@/pages/InterviewReviewPage'
import { InterviewTranscriptPage } from '@/pages/InterviewTranscriptPage'
import { LoginPage } from '@/pages/LoginPage'
import { ParticipantsPage } from '@/pages/ParticipantsPage'
import { PasswordPage } from '@/pages/PasswordPage'

const defaultApi = createDefaultApi()

function InterviewRoute() {
  const { user } = useSession()
  const [searchParams] = useSearchParams()
  return <InterviewPage adminTools={user?.role === 'admin'} debug={searchParams.get('debug') === '1'} />
}

function DefaultRoute() {
  const { user } = useSession()
  const destination = user ? homeFor(user.role) : '/login'
  return <Navigate replace to={destination} />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<RequireGuest><LoginPage /></RequireGuest>} />
      {/* Every signed-in screen shares one layout, so the tabs never change under the user. */}
      <Route element={<RequireRole role={['participant', 'admin']}><AppLayout /></RequireRole>}>
        <Route path="/interview" element={<InterviewRoute />} />
        <Route path="/account/password" element={<PasswordPage />} />
        <Route element={<RequireRole role="admin"><Outlet /></RequireRole>}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/participants" element={<ParticipantsPage />} />
          <Route path="/admin/interviews/:interviewId" element={<InterviewReviewPage />} />
          <Route path="/admin/interviews/:interviewId/transcript" element={<InterviewTranscriptPage />} />
        </Route>
      </Route>
      <Route path="*" element={<DefaultRoute />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ApiProvider api={defaultApi}>
      <SessionProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </SessionProvider>
    </ApiProvider>
  )
}
