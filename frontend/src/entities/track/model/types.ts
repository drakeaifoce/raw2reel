/** A soundtrack the edit is cut to. */
export type Track = {
  id: string
  title: string
  mood: string
  /** Known tempo of a preset; unknown for user uploads. */
  bpm?: number
  /** Stored audio sent to the renderer; presets have none yet. */
  mediaId?: string
}
