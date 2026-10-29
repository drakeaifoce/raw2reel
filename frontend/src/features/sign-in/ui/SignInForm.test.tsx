import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SignInForm } from './SignInForm'

const auth = vi.hoisted(() => ({
  signIn: vi.fn(),
  signInAnonymous: vi.fn(),
  startGuest: vi.fn(),
  signUp: vi.fn(),
}))

vi.mock('@/shared/api', () => ({
  authClient: {
    signIn: { email: auth.signIn, anonymous: auth.signInAnonymous },
    signUp: { email: auth.signUp },
  },
  identityClient: { startGuest: auth.startGuest },
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderForm() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<SignInForm />} />
        <Route path="/studio" element={<p>Studio opened</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SignInForm', () => {
  test('starts a guest session and explains its retention risk', async () => {
    auth.startGuest.mockResolvedValue({ ok: true })
    renderForm()

    expect(screen.getByText(/Guest work can be lost/)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Continue as guest' }))

    await waitFor(() => expect(auth.startGuest).toHaveBeenCalledOnce())
    expect(await screen.findByText('Studio opened')).toBeDefined()
  })

  test('signs in with email and password, then opens the studio', async () => {
    auth.signIn.mockResolvedValue({ data: {}, error: null })
    renderForm()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'editor@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() =>
      expect(auth.signIn).toHaveBeenCalledWith({
        email: 'editor@example.com',
        password: 'correct-password',
      }),
    )
    expect(await screen.findByText('Studio opened')).toBeDefined()
  })

  test('creates an account with name, email and password', async () => {
    auth.signUp.mockResolvedValue({ data: {}, error: null })
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Editor' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'editor@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(auth.signUp).toHaveBeenCalledWith({
        name: 'Editor',
        email: 'editor@example.com',
        password: 'correct-password',
      }),
    )
  })

  test('shows a generic error for invalid credentials', async () => {
    auth.signIn.mockResolvedValue({ data: null, error: { message: 'specific internal error' } })
    renderForm()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'editor@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Unable to authenticate. Check your details and try again.',
    )
    expect(screen.queryByText('specific internal error')).toBeNull()
  })
})
