import { facesFromAnalysis } from '@/entities/face/@x/project'
import { ApiError, createAnalysis, getAnalysis, jobErrorMessage, type Analysis } from '@/shared/api'
import { useProjectStore } from './store'

const POLL_MS = 4000
/** Consecutive failed polls tolerated before giving up, e.g. during a deploy. */
const MAX_POLL_ERRORS = 3

let currentRun = 0

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Starts Muse Vision face discovery for uploaded footage and polls until it settles.
 * Results are dropped if the footage changed or a newer run started meanwhile.
 */
export async function analyzeFootage(mediaId: string) {
  const run = ++currentRun
  const { setAnalysis, setDetectedFaces } = useProjectStore.getState()
  const isCurrent = () =>
    run === currentRun && useProjectStore.getState().video?.mediaId === mediaId

  setAnalysis({ status: 'running' })
  try {
    let analysis: Analysis = await createAnalysis(mediaId)
    let pollErrors = 0
    while (analysis.status === 'queued' || analysis.status === 'preparing') {
      await wait(POLL_MS)
      if (!isCurrent()) return
      try {
        analysis = await getAnalysis(analysis.id)
        pollErrors = 0
      } catch (error) {
        if (error instanceof ApiError && error.status !== 0 && error.status < 500) throw error
        if (++pollErrors >= MAX_POLL_ERRORS) throw error
      }
    }
    if (!isCurrent()) return

    if (analysis.status === 'failed') {
      setAnalysis({
        status: 'failed',
        message: jobErrorMessage(analysis.error) ?? 'Muse Vision could not analyse this video.',
      })
    } else if (analysis.people.length === 0) {
      setAnalysis({ status: 'failed', message: 'Muse Vision found no people in this video.' })
    } else {
      setDetectedFaces(analysis.id, facesFromAnalysis(analysis.people))
    }
  } catch (error) {
    if (!isCurrent()) return
    const message = error instanceof ApiError ? error.message : 'Face detection failed.'
    setAnalysis({ status: 'failed', message })
  }
}
