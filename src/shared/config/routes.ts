export const routes = {
  login: '/',
  studio: '/studio',
} as const

export type AppRoute = (typeof routes)[keyof typeof routes]
