/** A person detected in the footage by Muse Vision. */
export type Face = {
  id: string
  label: string
  /** Human-readable appearance count, e.g. "in 41 shots". */
  shots: string
  /** Avatar tint, shown behind the preview or instead of it. */
  tone: string
  /** Face crop from the footage, when Muse Vision produced one. */
  thumbnailUrl?: string
}
