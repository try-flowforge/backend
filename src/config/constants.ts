/**
 * Centralized constants for the backend application
 */

export const WORKFLOW_CONSTANTS = {
    /** Maximum number of steps allowed per workflow execution (prevents infinite loops) */
    MAX_STEPS_PER_EXECUTION: 100,

    /** Default workflow timeout in milliseconds (5 minutes) */
    DEFAULT_TIMEOUT_MS: 5 * 60 * 1000,

    /** Maximum concurrent executions per workflow */
    DEFAULT_MAX_CONCURRENT_EXECUTIONS: 5,
} as const;

export const QUEUE_CONSTANTS = {
    /** Number of completed jobs to retain in queue */
    MAX_COMPLETED_JOBS_RETENTION: 1000,

    /** Hours to retain completed jobs */
    COMPLETED_JOBS_RETENTION_HOURS: 24,

    /** Number of failed jobs to retain in queue */
    MAX_FAILED_JOBS_RETENTION: 5000,

    /** Days to retain failed jobs */
    FAILED_JOBS_RETENTION_DAYS: 7,

    /** Default number of retry attempts */
    DEFAULT_RETRY_ATTEMPTS: 3,

    /** Base delay for exponential backoff (ms) */
    RETRY_BACKOFF_DELAY_MS: 2000,

    /** Jobs per second rate limit */
    MAX_JOBS_PER_SECOND: 200,
} as const;

export const DATABASE_CONSTANTS = {
    /** Minimum pool connections */
    POOL_MIN: 1,

    /** Maximum pool connections */
    POOL_MAX: 10,

    /** Idle connection timeout (ms) */
    IDLE_TIMEOUT_MS: 30000,

    /** Connection acquisition timeout (ms) */
    CONNECTION_TIMEOUT_MS: 5000,

    /** Statement execution timeout (ms) */
    STATEMENT_TIMEOUT_MS: 30000,
} as const;

export const RATE_LIMIT_CONSTANTS = {
    /** Maximum Safe creations per user per day */
    MAX_SAFE_CREATIONS_PER_DAY: 2,

    /** Maximum module enables per user per day */
    MAX_MODULE_ENABLES_PER_DAY: 2,

    /** Rate limit window duration (ms) - 24 hours */
    RATE_LIMIT_WINDOW_MS: 24 * 60 * 60 * 1000,

    /** API rate limit - requests per minute */
    API_RATE_LIMIT_PER_MINUTE: 4,
} as const;

export const SSE_CONSTANTS = {
    /** Heartbeat interval (ms) */
    HEARTBEAT_INTERVAL_MS: 10000,

    /** Maximum listeners per execution */
    MAX_LISTENERS_PER_EXECUTION: 10,

    /** Connection close delay after execution completes (ms) */
    CLOSE_DELAY_MS: 1000,

    /** Subscription token expiry (ms) - 1 hour */
    SUBSCRIPTION_TOKEN_EXPIRY_MS: 60 * 60 * 1000,
} as const;

export const SECURITY_CONSTANTS = {
    /** Request ID header name */
    REQUEST_ID_HEADER: 'X-Request-ID',

    /** Maximum request body size (bytes) */
    MAX_REQUEST_BODY_SIZE: '5mb',

    /** Token prefix for bearer authentication */
    BEARER_PREFIX: 'Bearer ',
} as const;

export const VALIDATION_CONSTANTS = {
    /** Maximum workflow name length */
    MAX_WORKFLOW_NAME_LENGTH: 255,

    /** Maximum workflow description length */
    MAX_WORKFLOW_DESCRIPTION_LENGTH: 2000,

    /** Maximum nodes per workflow */
    MAX_NODES_PER_WORKFLOW: 15,

    /** Minimum nodes per workflow */
    MIN_NODES_PER_WORKFLOW: 1,

    /** Maximum tags per workflow */
    MAX_TAGS_PER_WORKFLOW: 20,

    /** Maximum tag length */
    MAX_TAG_LENGTH: 20,
} as const;

export const TELEGRAM_CONSTANTS = {
    /** Verification code length */
    VERIFICATION_CODE_LENGTH: 8,

    /** Verification code expiry (minutes) */
    VERIFICATION_CODE_EXPIRY_MINUTES: 5,
} as const;

export const GAS_CONSTANTS = {
    /** Gas limit buffer percentage */
    GAS_LIMIT_BUFFER_PERCENT: 20,

    /** Default slippage tolerance percentage */
    DEFAULT_SLIPPAGE_TOLERANCE: 0.5,

    /** Default swap deadline (minutes) */
    DEFAULT_SWAP_DEADLINE_MINUTES: 20,
} as const;
