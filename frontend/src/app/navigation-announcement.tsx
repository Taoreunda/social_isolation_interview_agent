import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

interface AnnouncementState {
  announcement?: string
  announcementConsumed?: boolean
}

function readAnnouncement(state: unknown): AnnouncementState {
  return state && typeof state === 'object' ? state as AnnouncementState : {}
}

export function NavigationAnnouncement() {
  const location = useLocation()
  const navigate = useNavigate()
  const [announcement, setAnnouncement] = useState<string | null>(null)

  useEffect(() => {
    const state = readAnnouncement(location.state)
    if (state.announcement === '변경했습니다' && !state.announcementConsumed) {
      setAnnouncement(state.announcement)
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: { ...state, announcementConsumed: true } },
      )
      return
    }
    if (!state.announcementConsumed) setAnnouncement(null)
  }, [location.hash, location.pathname, location.search, location.state, navigate])

  return announcement ? <p role="status">{announcement}</p> : null
}
