module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    posthogApiKey: process.env.EXPO_PUBLIC_POSTHOG_API_KEY,
    posthogHost: process.env.EXPO_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
  },
});
