import { useProjectStore } from '@/entities/project'
import { GenerateReelButton } from '@/features/generate-reel'
import { FacePicker } from '@/features/select-faces'
import { TrackPicker } from '@/features/select-track'
import { FootagePicker } from '@/features/upload-footage'
import { Card } from '@/shared/ui/card'
import { StepTitle } from '@/shared/ui/step-title'
import styles from './EditSetup.module.css'

/** Left column of the studio: the three setup steps and the generate action. */
export function EditSetup() {
  const hasVideo = useProjectStore((state) => state.video !== null)
  const hasFaces = useProjectStore((state) => state.faceIds.length > 0)
  const hasTrack = useProjectStore((state) => state.trackId !== null)

  return (
    <section aria-label="Edit setup" className={styles.setup}>
      <Card>
        <StepTitle step={1} complete={hasVideo}>
          Footage
        </StepTitle>
        <FootagePicker />
      </Card>

      <Card>
        <StepTitle step={2} complete={hasFaces}>
          Who stays in frame?
        </StepTitle>
        <FacePicker />
      </Card>

      <Card>
        <StepTitle step={3} complete={hasTrack}>
          Soundtrack
        </StepTitle>
        <TrackPicker />
      </Card>

      <GenerateReelButton />
    </section>
  )
}
