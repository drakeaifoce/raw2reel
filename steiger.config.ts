import fsd from '@feature-sliced/steiger-plugin'
import { defineConfig } from 'steiger'

export default defineConfig([
  ...fsd.configs.recommended,
  {
    rules: {
      // The studio is split into features/widgets up front: each slice is a unit
      // the backend integration will hook into, even if it has a single consumer
      // today. Re-enable once the app grows to catch genuinely unneeded slices.
      'fsd/insignificant-slice': 'off',
    },
  },
])
