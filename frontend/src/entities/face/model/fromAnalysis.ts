import { analysisThumbnailUrl, type AnalysisPerson } from '@/shared/api'
import { pluralize } from '@/shared/lib'
import type { Face } from './types'

const TONES = ['#8FA8D9', '#D9A98F', '#A8D98F', '#C9A0D9', '#8FD9C9', '#D98F9E']

/** Turns people found by Muse Vision into selectable faces, most visible first. */
export function facesFromAnalysis(people: AnalysisPerson[]): Face[] {
  return [...people]
    .sort((a, b) => b.observationCount - a.observationCount)
    .map((person, index) => ({
      id: person.id,
      label: person.label,
      shots: `seen ${pluralize(person.observationCount, 'time')}`,
      tone: TONES[index % TONES.length] ?? '#8FA8D9',
      thumbnailUrl: person.thumbnailUrl && analysisThumbnailUrl(person.thumbnailUrl),
    }))
}
