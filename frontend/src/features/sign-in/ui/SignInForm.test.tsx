import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SignInForm } from './SignInForm'

const auth = vi.hoisted(() => ({
  identitySignIn: vi.fn(),
  startGuest: vi.fn(),
  identitySignUp: vi.fn(),
}))

vi.mock('@/shared/api', () => ({
  identityClient: {
    signIn: auth.identitySignIn,
    signUp: auth.identitySignUp,
    startGuest: auth.startGuest,
  },
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
    auth.identitySignIn.mockResolvedValue({ ok: true })
    renderForm()

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'editor@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() =>
      expect(auth.identitySignIn).toHaveBeenCalledWith({
        email: 'editor@example.com',
        password: 'correct-password',
      }),
    )
    expect(await screen.findByText('Studio opened')).toBeDefined()
  })

  test('opens the studio after synchronous HTTP 200 account creation', async () => {
    auth.identitySignUp.mockResolvedValue(new Response(null, { status: 200 }))
    renderForm()

    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Editor' } })
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'editor@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))

    await waitFor(() =>
      expect(auth.identitySignUp).toHaveBeenCalledWith({
        name: 'Editor',
        email: 'editor@example.com',
        password: 'correct-password',
      }),
    )
    expect(await screen.findByText('Studio opened')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('shows a generic error for invalid credentials', async () => {
    auth.identitySignIn.mockResolvedValue(new Response(null, { status: 401 }))
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
