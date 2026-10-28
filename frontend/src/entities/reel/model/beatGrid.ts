export type BeatSegment = {
  /** Relative segment length. */
  grow: number
  emphasis: 'strong' | 'medium' | 'weak'
}

const SEGMENT_LENGTHS = [3, 2, 2, 4, 1, 2, 3, 1, 2, 2, 4, 2, 1, 3]
const EMPHASIS_CYCLE: BeatSegment['emphasis'][] = ['strong', 'medium', 'weak']

/** Placeholder cut timeline until real edit data comes from the backend. */
export const MOCK_BEAT_SEGMENTS: BeatSegment[] = SEGMENT_LENGTHS.map((grow, i) => ({
  grow,
  emphasis: EMPHASIS_CYCLE[i % EMPHASIS_CYCLE.length] ?? 'weak',
}))
