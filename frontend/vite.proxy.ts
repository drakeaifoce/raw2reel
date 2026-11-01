export const rewriteApiPath = (path: string) => path.replace(/^\/api(?=\/|$)/, '') || '/'
