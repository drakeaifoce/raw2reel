import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router'
import { SignOutLink } from './SignOutLink'

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  resetProject: vi.fn(),
  resetReel: vi.fn(),
}))

vi.mock('@/shared/api', () => ({ identityClient: { signOut: mocks.signOut } }))
vi.mock('@/entities/project', () => ({ useProjectStore: () => mocks.resetProject }))
vi.mock('@/entities/reel', () => ({ useReelStore: () => mocks.resetReel }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

test('revokes the session, clears editor state and returns to login', async () => {
  mocks.signOut.mockResolvedValue({ ok: true })
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <Routes>
        <Route path="/" element={<p>Login page</p>} />
        <Route path="/studio" element={<SignOutLink />} />
      </Routes>
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

  // Ждём перехода, а не факта вызова signOut: вызов происходит до await внутри
  // обработчика, а сброс состояния и переход — только после него. Ожидание
  // вызова синхронизировало не то, и проверка страницы входа успевала раньше
  // перерисовки — тест падал примерно в каждом третьем полном прогоне.
  expect(await screen.findByText('Login page')).toBeDefined()
  expect(mocks.signOut).toHaveBeenCalledOnce()
  expect(mocks.resetProject).toHaveBeenCalledOnce()
  expect(mocks.resetReel).toHaveBeenCalledOnce()
})

test('keeps local state when the server cannot revoke the session', async () => {
  mocks.signOut.mockResolvedValue({ ok: false })
  render(
    <MemoryRouter initialEntries={['/studio']}>
      <SignOutLink />
    </MemoryRouter>,
  )

  fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))

  expect(await screen.findByRole('alert')).toBeDefined()
  expect(screen.queryByText('internal detail')).toBeNull()
  expect(mocks.resetProject).not.toHaveBeenCalled()
  expect(mocks.resetReel).not.toHaveBeenCalled()
})
