import PostHog from 'posthog-react-native';
import Constants from 'expo-constants';

const projectToken = Constants.expoConfig?.extra?.posthogApiKey as string | undefined;
const host =
  (Constants.expoConfig?.extra?.posthogHost as string | undefined) || 'https://us.i.posthog.com';
const isPostHogConfigured = !!projectToken && projectToken.length > 0;

export const posthog = new PostHog(projectToken || 'placeholder_key', {
  host,
  disabled: !isPostHogConfigured,
  captureAppLifecycleEvents: true,
  flushAt: 20,
  flushInterval: 10000,
  maxBatchSize: 100,
  maxQueueSize: 1000,
  preloadFeatureFlags: true,
  sendFeatureFlagEvent: true,
  featureFlagsRequestTimeoutMs: 10000,
  requestTimeout: 10000,
  fetchRetryCount: 3,
  fetchRetryDelay: 3000,
});

if (__DEV__) {
  posthog.debug();
}
