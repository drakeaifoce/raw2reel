import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { GuestRegistration } from './GuestRegistration'

const api = vi.hoisted(() => ({ signUp: vi.fn() }))
vi.mock('@/shared/api', () => ({
  authClient: { useSession: () => ({ data: { user: { isAnonymous: true } } }) },
  identityClient: { signUp: api.signUp },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('GuestRegistration', () => {
  test('requests an authenticated guest upgrade and explains media continuity', async () => {
    api.signUp.mockResolvedValue(new Response(null, { status: 200 }))
    render(<GuestRegistration />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Guest Editor' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'guest@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(api.signUp).toHaveBeenCalledWith({
        name: 'Guest Editor',
        email: 'guest@example.com',
        password: 'Password1!',
        upgrade: true,
      }),
    )
    expect((await screen.findByRole('status')).textContent).toContain('signed in')
  })
})
