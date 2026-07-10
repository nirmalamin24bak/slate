// Public surface of the onboarding draft module (spec/02 §A). Pure.

export {
  bmrPreview,
  cmFromFtIn,
  DEFAULT_DRAFT,
  dobFromAge,
  ftInFromCm,
  GOAL_REJECTION_MESSAGE,
  toKitchenPatch,
  toProfilePatch,
  validateGoal,
} from './draft';
export type { BmrPreview, BodyDraft, KitchenDraft, OnboardingDraft } from './draft';
