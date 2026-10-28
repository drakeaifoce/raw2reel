/** A person detected in the footage by Muse Vision. */
export type Face = {
  id: string
  label: string
  /** Human-readable appearance count, e.g. "in 41 shots". */
  shots: string
  /** Placeholder avatar tint until real thumbnails are available. */
  tone: string
}
