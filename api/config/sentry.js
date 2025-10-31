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

        // Comprehensive check for MCP errors
        // Winston transport may put messages in different places, so check all locations
        const getErrorMessage = () => {
          // Check event.message (string or object)
          if (typeof event.message === 'string') {
            return event.message;
          }
          if (typeof event.message === 'object' && event.message?.formatted) {
            return event.message.formatted;
          }
          
          // Check exception values
          if (event.exception?.values?.[0]?.value) {
            return event.exception.values[0].value;
          }
          
          // Check extra/contexts (Winston may put log data here)
          if (event.extra?.message) {
            return event.extra.message;
          }
          if (event.contexts?.log?.message) {
            return event.contexts.log.message;
          }
          
          // Check original exception
          if (hint?.originalException?.message) {
            return hint.originalException.message;
          }
          
          return '';
        };

        const errorMessage = getErrorMessage();
        const isMCPError = errorMessage.includes('[MCP]');

        // Allow MCP errors through - they're important for debugging
        // If it's an MCP error, always capture it regardless of error type
        if (isMCPError) {
          // Add Sentry tags for better filtering and organization
          event.tags = {
            ...event.tags,
            'mcp.error': true,
          };

          // Extract server name from error message if possible
          const serverMatch = errorMessage.match(/\[MCP\](?:\[User: [^\]]+\])?\[([^\]]+)\]/);
          if (serverMatch) {
            event.tags['mcp.server'] = serverMatch[1];
          }

          // Extract tool name from error message if possible
          const toolMatch = errorMessage.match(/\[([^\]]+)\]\s+(?:tool call failed|Error calling MCP tool)/i);
          if (toolMatch) {
            event.tags['mcp.tool'] = toolMatch[1];
          }

          // Extract user ID if present
          const userMatch = errorMessage.match(/\[User:\s*([^\]]+)\]/);
          if (userMatch) {
            event.user = {
              ...event.user,
              id: userMatch[1],
            };
          }

          return event;
        }

        // Filter non-MCP errors
        if (hint?.originalException?.message?.includes('fetch failed')) {
          // Don't send Meilisearch connection errors
          return null;
        }

        // Filter out network errors only if they're NOT MCP-related
        // Check error code from multiple possible locations
        const errorCode = hint?.originalException?.code || 
                         hint?.originalException?.errno;
        // Also check if the error message contains network error codes
        const hasNetworkErrorCode = errorMessage && 
          ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'].some(code => 
            errorMessage.includes(code)
          );
        
        const networkErrors = ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET'];
        if ((errorCode && networkErrors.includes(errorCode)) || hasNetworkErrorCode) {
          // Network error but not MCP-related - filter it out
          return null;
        }

        // Only filter out actual AbortError from frontend AbortController, not transport errors
        if (
          hint?.originalException?.name === 'AbortError' ||
          errorMessage === 'This operation was aborted' ||
          errorMessage === 'The operation was aborted'
        ) {
          // Don't send frontend AbortController errors
          return null;
        }

        return event;
      },

      // Minimal ignoreErrors - we handle filtering in beforeSend to allow MCP errors through
      // Network errors are filtered in beforeSend only if they're not MCP-related
      ignoreErrors: [
        // Common errors that don't need tracking (non-MCP)
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

