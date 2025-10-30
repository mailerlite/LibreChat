const Sentry = require('@sentry/node');

const {
  SENTRY_DSN,
  SENTRY_ENVIRONMENT = 'production',
  SENTRY_RELEASE,
  SENTRY_TRACES_SAMPLE_RATE = '0.1',
  SENTRY_PROFILES_SAMPLE_RATE = '0.1',
  NODE_ENV = 'production',
  SENTRY_ENABLED = 'false',
} = process.env;

const isSentryEnabled =
  (typeof SENTRY_ENABLED === 'string' && SENTRY_ENABLED?.toLowerCase() === 'true') ||
  SENTRY_ENABLED === true;

/**
 * Initialize Sentry for error tracking and performance monitoring
 * @returns {boolean} Whether Sentry was successfully initialized
 */
function initializeSentry() {
  if (!isSentryEnabled) {
    console.log('Sentry is disabled. Set SENTRY_ENABLED=true to enable.');
    return false;
  }

  if (!SENTRY_DSN) {
    console.warn(
      'Sentry DSN not configured. Please set SENTRY_DSN environment variable to enable error tracking.',
    );
    return false;
  }

  try {
    Sentry.init({
      dsn: SENTRY_DSN,
      environment: SENTRY_ENVIRONMENT,
      release: SENTRY_RELEASE,

      // Performance Monitoring
      tracesSampleRate: parseFloat(SENTRY_TRACES_SAMPLE_RATE),

      // Profiling
      profilesSampleRate: parseFloat(SENTRY_PROFILES_SAMPLE_RATE),

      integrations: [
        // Automatically instrument Node.js libraries and frameworks
        Sentry.httpIntegration(),
        Sentry.expressIntegration(),
        Sentry.mongooseIntegration(),
        Sentry.redisIntegration(),
      ],

      // Don't send PII (Personally Identifiable Information)
      beforeSend(event, hint) {
        // Filter out sensitive data
        if (event.request?.headers) {
          delete event.request.headers.authorization;
          delete event.request.headers.cookie;
          delete event.request.headers['x-api-key'];
        }

        // Filter sensitive query parameters
        if (event.request?.query_string) {
          const sensitiveParams = ['token', 'password', 'api_key', 'apikey'];
          let queryString = event.request.query_string;
          sensitiveParams.forEach((param) => {
            const regex = new RegExp(`${param}=[^&]*`, 'gi');
            queryString = queryString.replace(regex, `${param}=[REDACTED]`);
          });
          event.request.query_string = queryString;
        }

        // Add custom logic to filter or modify events
        if (hint?.originalException?.message?.includes('fetch failed')) {
          // Don't send Meilisearch connection errors
          return null;
        }

        // Only filter out actual AbortError, not all errors containing "abort"
        if (hint?.originalException?.name === 'AbortError' ||
            hint?.originalException?.message === 'This operation was aborted' ||
            hint?.originalException?.message === 'The operation was aborted') {
          // Don't send AbortController errors
          return null;
        }

        return event;
      },

      // Don't capture these errors
      ignoreErrors: [
        // Network errors
        'ECONNREFUSED',
        'ENOTFOUND',
        'ETIMEDOUT',
        'ECONNRESET',
        // AbortController errors
        'AbortError',
        'This operation was aborted',
        // Common errors that don't need tracking
        'fetch failed',
        'GoogleGenerativeAI',
      ],

      // Enable debug mode in development
      debug: NODE_ENV === 'development',
    });

    return true;
  } catch (error) {
    console.error('Failed to initialize Sentry:', error);
    return false;
  }
}

// Always export Sentry, even if not initialized
// This prevents errors when checking Sentry.Handlers
module.exports = {
  initializeSentry,
  Sentry: Sentry || null,
  isSentryEnabled,
};

