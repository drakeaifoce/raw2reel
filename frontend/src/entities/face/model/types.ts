/** A person detected in the footage. */
export type Face = {
  id: string
  label: string
  /** Human-readable appearance count, e.g. "in 41 shots". */
  shots: string
  /** Avatar tint, shown behind the preview or instead of it. */
  tone: string
  /** Face crop from the footage, when face discovery produced one. */
  thumbnailUrl?: string
}
