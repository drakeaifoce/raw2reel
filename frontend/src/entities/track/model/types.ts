/** A soundtrack the edit is cut to. */
export type Track = {
  id: string
  title: string
  mood: string
  /** Performer of a released sample, shown instead of the mood. */
  artist?: string
  /** Known tempo of a preset; unknown for user uploads. */
  bpm?: number
  /** Stored audio sent to the renderer; a sample gets one once it is uploaded. */
  mediaId?: string
  /** Bundled audio of a sample preset, playable and uploadable. */
  src?: string
  /** Original file name of a sample, matching its copy in the backend catalog. */
  fileName?: string
}
