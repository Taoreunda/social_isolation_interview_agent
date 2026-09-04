import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { ApiProvider } from '@/app/api-context'
import { createDefaultApi } from '@/app/default-api'
import { RequireGuest, RequireRole } from '@/app/route-guards'
import { SessionProvider, useSession } from '@/app/session-context'
import { AdminLayout } from '@/layouts/AdminLayout'
import { ParticipantLayout } from '@/layouts/ParticipantLayout'
import { AdminDashboardPage } from '@/pages/AdminDashboardPage'
import { InterviewPage } from '@/pages/InterviewPage'
import { InterviewReviewPage } from '@/pages/InterviewReviewPage'
import { LoginPage } from '@/pages/LoginPage'
import { ParticipantsPage } from '@/pages/ParticipantsPage'
import { PasswordPage } from '@/pages/PasswordPage'

const defaultApi = createDefaultApi()

function DefaultRoute() {
  const { user } = useSession()
  const destination = user ? (user.role === 'admin' ? '/admin' : '/interview') : '/login'
  return <Navigate replace to={destination} />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<RequireGuest><LoginPage /></RequireGuest>} />
      <Route element={<RequireRole role="participant"><ParticipantLayout /></RequireRole>}>
        <Route path="/interview" element={<InterviewPage />} />
        <Route path="/account/password" element={<PasswordPage />} />
      </Route>
      <Route element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
        <Route path="/admin" element={<AdminDashboardPage />} />
        <Route path="/admin/participants" element={<ParticipantsPage />} />
        <Route path="/admin/interviews/:interviewId" element={<InterviewReviewPage />} />
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
