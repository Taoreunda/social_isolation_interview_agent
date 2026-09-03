export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export function hasApiStatus(error: unknown, status: number): error is ApiError {
  return error instanceof ApiError && error.status === status
}
