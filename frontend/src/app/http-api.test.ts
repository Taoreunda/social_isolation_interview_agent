import { afterEach, describe, expect, it, vi } from 'vitest'

import { HttpAppApi } from './http-api'

afterEach(() => {
  document.cookie = 'dabom_csrf=; Max-Age=0; Path=/'
})

describe('HttpAppApi authentication', () => {
  it('logs in through the server session endpoint with cookies enabled', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: 'user-001',
      username: 'participant01',
      role: 'participant',
      participantCode: 'P-001',
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    }))
    const api = new HttpAppApi(fetcher)
    const signal = new AbortController().signal

    const currentUser = await api.login({
      username: ' participant01 ',
      password: 'research-password',
      remember: true,
    }, signal)

    expect(currentUser).toEqual({
      id: 'user-001',
      username: 'participant01',
      role: 'participant',
      participantCode: 'P-001',
    })
    expect(fetcher).toHaveBeenCalledOnce()
    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/auth/login')
    expect(init).toMatchObject({
      cache: 'no-store',
      credentials: 'include',
      method: 'POST',
      signal,
    })
    expect(new Headers(init?.headers).get('Content-Type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({
      username: ' participant01 ',
      password: 'research-password',
      remember: true,
    })
  })

  it('restores an authenticated server session', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: 'admin-001',
      username: 'researcher',
      role: 'admin',
      participantCode: null,
    }), { status: 200 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.getCurrentUser()).resolves.toEqual({
      id: 'admin-001',
      username: 'researcher',
      role: 'admin',
      participantCode: null,
    })
    expect(fetcher).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({
      cache: 'no-store',
      credentials: 'include',
      method: 'GET',
    }))
  })

  it('treats an unauthorized session lookup as a guest', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.getCurrentUser()).resolves.toBeNull()
  })

  it('preserves non-authentication failures during session lookup', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ detail: '필수 서비스를 사용할 수 없습니다.' }),
      { headers: { 'Content-Type': 'application/json' }, status: 503 },
    ))
    const api = new HttpAppApi(fetcher)

    await expect(api.getCurrentUser()).rejects.toMatchObject({
      message: '필수 서비스를 사용할 수 없습니다.',
      status: 503,
    })
  })

  it('logs out with the CSRF cookie mirrored into the request header', async () => {
    document.cookie = 'dabom_csrf=csrf-token%2Bvalue; Path=/'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.logout()).resolves.toBeUndefined()

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/auth/logout')
    expect(init).toMatchObject({ credentials: 'include', method: 'POST' })
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('csrf-token+value')
  })

  it('changes a password with the backend camel-case contract and CSRF protection', async () => {
    document.cookie = 'dabom_csrf=change-token; Path=/'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const api = new HttpAppApi(fetcher)

    await api.changePassword('current-password', 'replacement-password')

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/auth/password')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('change-token')
    expect(JSON.parse(String(init?.body))).toEqual({
      currentPassword: 'current-password',
      newPassword: 'replacement-password',
    })
  })

  it('does not send a state change when the CSRF cookie is unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = new HttpAppApi(fetcher)

    await expect(api.logout()).rejects.toMatchObject({ status: 403 })
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('HttpAppApi participant administration', () => {
  it('maps account records without inventing interview data', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify([
      {
        id: 'participant-001',
        username: 'participant01',
        participantCode: 'P-001',
        status: 'admin_locked',
        interviewStatus: 'active',
      },
    ]), { status: 200 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.listParticipants()).resolves.toEqual([
      {
        id: 'participant-001',
        username: 'participant01',
        participantCode: 'P-001',
        status: 'admin_locked',
        interviewStatus: 'active',
      },
    ])
    expect(fetcher).toHaveBeenCalledWith('/api/admin/participants', expect.objectContaining({
      credentials: 'include',
      method: 'GET',
    }))
  })

  it('creates a participant with the administrator-assigned password', async () => {
    document.cookie = 'dabom_csrf=create-token; Path=/'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      participant: {
        id: 'participant-002',
        username: 'participant02',
        participantCode: 'P-002',
        status: 'active',
        interviewStatus: 'not_started',
      },
      assignedPassword: null,
    }), { status: 201 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.createParticipant({
      username: 'participant02',
      participantCode: 'P-002',
      password: 'assigned-password',
    })).resolves.toEqual({
      id: 'participant-002',
      username: 'participant02',
      participantCode: 'P-002',
      status: 'active',
      interviewStatus: 'not_started',
    })

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/admin/participants')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('create-token')
    expect(JSON.parse(String(init?.body))).toEqual({
      username: 'participant02',
      participantCode: 'P-002',
      password: 'assigned-password',
      generatePassword: false,
    })
  })

  it('requests a server-generated password when resetting a participant', async () => {
    document.cookie = 'dabom_csrf=reset-token; Path=/'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      assignedPassword: 'one-time-password',
    }), { status: 200 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.resetParticipantPassword('participant/001')).resolves.toEqual({
      assignedPassword: 'one-time-password',
    })

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/admin/participants/participant%2F001/password')
    expect(JSON.parse(String(init?.body))).toEqual({ generatePassword: true })
  })

  it('returns the committed account state after disabling a participant', async () => {
    document.cookie = 'dabom_csrf=disable-token; Path=/'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: 'participant-001',
      username: 'participant01',
      participantCode: 'P-001',
      status: 'disabled',
      interviewStatus: 'completed',
    }), { status: 200 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.disableParticipant('participant-001')).resolves.toMatchObject({
      id: 'participant-001',
      status: 'disabled',
      interviewStatus: 'completed',
    })
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/participants/participant-001/disable')
  })

  it('returns the active account after an administrator unlock', async () => {
    document.cookie = 'dabom_csrf=unlock-token; Path=/'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: 'participant-001',
      username: 'participant01',
      participantCode: 'P-001',
      status: 'active',
      interviewStatus: 'active',
    }), { status: 200 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.unlockParticipant('participant-001')).resolves.toMatchObject({
      id: 'participant-001',
      status: 'active',
      interviewStatus: 'active',
    })
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/participants/participant-001/unlock')
  })
})

describe('HttpAppApi protected interviews', () => {
  const participantInterview = {
    id: 'interview-001',
    status: 'active',
    progress: 8,
    updatedAt: '2026-09-05T03:00:00Z',
    messages: [{
      id: 'message-001',
      role: 'assistant',
      content: '첫 질문입니다.',
      createdAt: '2026-09-05T03:00:00Z',
    }],
  }

  const interviewDetail = {
    ...participantInterview,
    participantCode: 'P-001',
    reviewStatus: 'unreviewed',
    scorecard: [{
      questionId: 'A1',
      question: '질문',
      value: null,
      rationale: null,
      aiStatus: null,
      expertStatus: null,
      expertRationale: null,
    }],
  }

  it('loads the current interview and starts one with CSRF only after a 404', async () => {
    document.cookie = 'dabom_csrf=start-token; Path=/'
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ detail: 'not found' }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(participantInterview), { status: 201 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.getCurrentInterview()).resolves.toEqual(participantInterview)

    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][0]).toBe('/api/interviews/current')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', credentials: 'include' })
    expect(fetcher.mock.calls[1][0]).toBe('/api/interviews')
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get('X-CSRF-Token')).toBe('start-token')
  })

  it('does not start a new interview for non-404 current-interview failures', async () => {
    document.cookie = 'dabom_csrf=start-token; Path=/'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ detail: '로그인이 필요합니다.' }),
      { status: 401 },
    ))
    const api = new HttpAppApi(fetcher)

    await expect(api.getCurrentInterview()).rejects.toMatchObject({ status: 401 })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('submits a client turn to the protected interview resource', async () => {
    document.cookie = 'dabom_csrf=message-token; Path=/'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify(participantInterview),
      { status: 200 },
    ))
    const api = new HttpAppApi(fetcher)

    await api.sendMessage('interview/001', 'turn-001', '응답')

    const [url, init] = fetcher.mock.calls[0]
    expect(url).toBe('/api/interviews/interview%2F001/messages')
    expect(new Headers(init?.headers).get('X-CSRF-Token')).toBe('message-token')
    expect(JSON.parse(String(init?.body))).toEqual({ clientTurnId: 'turn-001', content: '응답' })
  })

  it('uses the protected administrator list, detail, review, and CSV endpoints', async () => {
    document.cookie = 'dabom_csrf=review-token; Path=/'
    const csv = 'interviewId,participantCode\ninterview-001,P-001'
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([interviewDetail]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(interviewDetail), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(interviewDetail), { status: 200 }))
      .mockResolvedValueOnce(new Response(csv, { headers: { 'Content-Type': 'text/csv' }, status: 200 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.listInterviews()).resolves.toEqual([interviewDetail])
    await expect(api.getInterview('interview/001')).resolves.toEqual(interviewDetail)
    await expect(api.reviewScorecard({
      interviewId: 'interview/001',
      questionId: 'A/1',
      action: 'override',
      expertStatus: 'negative',
      rationale: '검토 근거',
    })).resolves.toEqual(interviewDetail)
    const blob = await api.exportInterviewCsv('interview/001')
    await expect(blob.text()).resolves.toBe(csv)

    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      '/api/admin/interviews',
      '/api/admin/interviews/interview%2F001',
      '/api/admin/interviews/interview%2F001/scorecard/A%2F1',
      '/api/admin/interviews/interview%2F001/csv',
    ])
    expect(JSON.parse(String(fetcher.mock.calls[2][1]?.body))).toEqual({
      action: 'override',
      expertStatus: 'negative',
      rationale: '검토 근거',
    })
    expect(new Headers(fetcher.mock.calls[2][1]?.headers).get('X-CSRF-Token')).toBe('review-token')
    expect(new Headers(fetcher.mock.calls[3][1]?.headers).get('X-CSRF-Token')).toBe('review-token')

    const legacyPaths = ['/api/start', '/api/stream', '/api/sessions', '/api/review', '/api/csv']
    expect(fetcher.mock.calls.every(([url]) => legacyPaths.every((path) => !String(url).startsWith(path)))).toBe(true)
  })
})
