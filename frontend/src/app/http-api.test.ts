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
      },
    ]), { status: 200 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.listParticipants()).resolves.toEqual([
      {
        id: 'participant-001',
        username: 'participant01',
        participantCode: 'P-001',
        status: 'admin_locked',
        interviewStatus: 'not_started',
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
    }), { status: 200 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.disableParticipant('participant-001')).resolves.toMatchObject({
      id: 'participant-001',
      status: 'disabled',
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
    }), { status: 200 }))
    const api = new HttpAppApi(fetcher)

    await expect(api.unlockParticipant('participant-001')).resolves.toMatchObject({
      id: 'participant-001',
      status: 'active',
    })
    expect(fetcher.mock.calls[0][0]).toBe('/api/admin/participants/participant-001/unlock')
  })
})

describe('HttpAppApi research boundary', () => {
  it('does not call the unauthenticated legacy interview endpoints', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const api = new HttpAppApi(fetcher)
    const operations: Array<() => Promise<unknown>> = [
      () => api.getCurrentInterview(),
      () => api.sendMessage('interview-001', 'turn-001', '응답'),
      () => api.listInterviews(),
      () => api.getInterview('interview-001'),
      () => api.reviewScorecard({
        interviewId: 'interview-001',
        questionId: 'q1',
        action: 'approve',
      }),
      () => api.exportInterviewCsv('interview-001'),
    ]

    for (const operation of operations) {
      await expect(operation()).rejects.toMatchObject({ status: 501 })
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
})
