/**
 * Validation Schemas for API Requests
 * Uses Joi for schema definition and validation
 */

import Joi from 'joi';
import { VALIDATION_CONSTANTS } from '../config/constants';
import {
    SAFE_RELAY_CHAIN_IDS,
    getSafeRelayChainLabels,
} from '../config/chain-registry';

const SAFE_RELAY_CHAIN_ERROR = `Chain ID must be one of: ${getSafeRelayChainLabels().join(', ')}`;

// ===========================================
// CORE CONSTANTS
// ===========================================

/** Supported chains for swap/lending/oracle (includes BASE for LiFi cross-chain) */
const SUPPORTED_CHAINS = ['ARBITRUM', 'ARBITRUM_SEPOLIA'] as const;
/** Swap providers */
const SWAP_PROVIDERS = ['UNISWAP_V4', 'LIFI'] as const;
/** Lending providers */
const LENDING_PROVIDERS = ['AAVE', 'COMPOUND'] as const;
/** Ostium networks */
const OSTIUM_NETWORKS = ['testnet', 'mainnet'] as const;

// ===========================================
// COMMON SCHEMAS
// ===========================================

export const uuidSchema = Joi.string().uuid({ version: 'uuidv4' });

export const paginationSchema = Joi.object({
    limit: Joi.number().integer().min(1).max(100).default(50),
    offset: Joi.number().integer().min(0).default(0),
});

export const idParamSchema = Joi.object({
    id: uuidSchema.required(),
});

export const idWithVersionParamSchema = Joi.object({
    id: uuidSchema.required(),
    versionNumber: Joi.number().integer().min(1).required(),
});

// ===========================================
// WORKFLOW SCHEMAS
// ===========================================

/**
 * Schema for node position
 */
const nodePositionSchema = Joi.object({
    x: Joi.number().required(),
    y: Joi.number().required(),
});

// ===========================================
// BLOCK CONFIG SCHEMAS
// ===========================================

// ===========================================
// BLOCK CONFIG SCHEMAS
// ===========================================

/**
 * Token info schema (used inside swap/lending block configs)
 */
const blockTokenInfoSchema = Joi.object({
    address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    symbol: Joi.string().allow(''),
    decimals: Joi.number().integer().min(0).max(18),
    name: Joi.string().allow(''),
}).unknown(true);

/**
 * Swap inputConfig sub-schema (matches SwapInputConfig TypeScript type)
 */
const swapInputConfigBlockSchema = Joi.object({
    sourceToken: blockTokenInfoSchema.required(),
    destinationToken: blockTokenInfoSchema.required(),
    amount: Joi.string().required(),
    swapType: Joi.string().valid('EXACT_INPUT', 'EXACT_OUTPUT').required(),
    walletAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    slippageTolerance: Joi.number().min(0).max(50),
    toChain: Joi.string().valid(...SUPPORTED_CHAINS),
}).unknown(true);

/**
 * Swap block config schema (matches SwapNodeConfig TypeScript type)
 * Frontend sends: { provider, chain, inputConfig: { sourceToken, destinationToken, ... }, ... }
 */
const swapBlockConfigSchema = Joi.object({
    provider: Joi.string().valid(...SWAP_PROVIDERS).required(),
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required(),
    inputConfig: swapInputConfigBlockSchema.required(),
    toChain: Joi.string().valid(...SUPPORTED_CHAINS),
    simulateFirst: Joi.boolean().default(true),
    autoRetryOnFailure: Joi.boolean().default(true),
    maxRetries: Joi.number().integer().min(0).max(10).default(3),
}).unknown(true);

/**
 * Lending block config schema
 */
const lendingBlockConfigSchema = Joi.object({
    provider: Joi.string().valid(...LENDING_PROVIDERS).required(),
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required(),
    operation: Joi.string().valid('SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY', 'ENABLE_COLLATERAL', 'DISABLE_COLLATERAL').required(),
    asset: Joi.object({
        address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).allow('').required(),
        symbol: Joi.string().allow(''),
        decimals: Joi.number().integer().min(0).max(18),
    }).required(),
    amount: Joi.string().allow('').required(),
    walletAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).allow(''),
    interestRateMode: Joi.string().allow(''),
}).unknown(true);

/**
 * Slack block config schema
 */
const slackBlockConfigSchema = Joi.object({
    connectionId: Joi.string().uuid().required(),
    message: Joi.string().allow('').required().max(4000),
    connectionType: Joi.string().valid('webhook', 'oauth').required(),
    channelId: Joi.string().allow('').when('connectionType', {
        is: 'oauth',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
}).unknown(true);

/**
 * Telegram block config schema
 */
const telegramBlockConfigSchema = Joi.object({
    connectionId: Joi.string().uuid().required(),
    chatId: Joi.string().allow('').required(),
    message: Joi.string().allow('').required().max(4096),
}).unknown(true);

/**
 * Oracle block config schema
 * Frontend sends: { provider, chain, aggregatorAddress|priceFeedId, staleAfterSeconds, ... }
 */
const oracleBlockConfigSchema = Joi.object({
    provider: Joi.string().valid('CHAINLINK', 'PYTH').required(),
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required(),
    // Chainlink uses aggregatorAddress, Pyth uses priceFeedId
    aggregatorAddress: Joi.string().allow('').when('provider', { is: 'CHAINLINK', then: Joi.required(), otherwise: Joi.optional() }),
    priceFeedId: Joi.string().allow('').when('provider', { is: 'PYTH', then: Joi.required(), otherwise: Joi.optional() }),
    staleAfterSeconds: Joi.number().integer().min(0).default(3600),
    description: Joi.string().allow(''),
}).unknown(true);

/**
 * Mail/Email block config schema
 * Frontend sends: { to, subject, body }
 */
const mailBlockConfigSchema = Joi.object({
    to: Joi.string().allow('').required(),
    subject: Joi.string().allow('').required(),
    body: Joi.string().allow('').required(),
}).unknown(true);

/**
 * AI Transform (LLM) block config schema
 * Frontend sends: { provider, model, userPromptTemplate, outputSchema, temperature, maxOutputTokens }
 */
const llmTransformBlockConfigSchema = Joi.object({
    provider: Joi.string().required(),
    model: Joi.string().required(),
    userPromptTemplate: Joi.string().allow('').required(),
    outputSchema: Joi.object().allow(null),
    temperature: Joi.number().min(0).max(2),
    maxOutputTokens: Joi.number().integer(),
}).unknown(true);

/**
 * Trigger block config schema
 */
const triggerBlockConfigSchema = Joi.object({
    triggerType: Joi.string().valid('CRON', 'WEBHOOK', 'MANUAL', 'EVENT').required(),
    cronExpression: Joi.string().when('triggerType', { is: 'CRON', then: Joi.required() }),
    webhookPath: Joi.string().when('triggerType', { is: 'WEBHOOK', then: Joi.required() }),
}).unknown(true);

/**
 * Control (IF/Switch) block config schema
 */
const controlBlockConfigSchema = Joi.object({
    // Generic for now, can be expanded based on specific logic
}).unknown(true);

/**
 * API block config schema
 */
const apiBlockConfigSchema = Joi.object({
    url: Joi.string().uri({ scheme: ['http', 'https'] }).required(),
    method: Joi.string().valid('GET', 'POST', 'PUT', 'DELETE', 'PATCH').required(),
    headers: Joi.array().items(Joi.object({
        key: Joi.string().required(),
        value: Joi.string().required(),
    })).optional(),
    queryParams: Joi.array().items(Joi.object({
        key: Joi.string().required(),
        value: Joi.string().required(),
    })).optional(),
    body: Joi.string().allow('').optional(),
    auth: Joi.object({
        type: Joi.string().valid('none', 'basic', 'bearer', 'apiKey').required(),
        username: Joi.string().allow('').optional(),
        password: Joi.string().allow('').optional(),
        token: Joi.string().allow('').optional(),
        apiKeyHeader: Joi.string().allow('').optional(),
        apiKeyValue: Joi.string().allow('').optional(),
        apiKeyType: Joi.string().valid('header', 'query').optional(),
    }).optional(),
}).unknown(true);

/**
 * Perps block config schema (Ostium)
 */
const perpsBlockConfigSchema = Joi.object({
    provider: Joi.string().valid('OSTIUM').default('OSTIUM'),
    network: Joi.string().valid(...OSTIUM_NETWORKS).required(),
    action: Joi.string()
        .valid('MARKETS', 'PRICE', 'BALANCE', 'LIST_POSITIONS', 'OPEN_POSITION', 'CLOSE_POSITION', 'UPDATE_SL', 'UPDATE_TP')
        .required(),
    market: Joi.string().max(50).when('action', {
        is: Joi.valid('OPEN_POSITION'),
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    base: Joi.string().max(20).when('action', {
        is: 'PRICE',
        then: Joi.optional(),
        otherwise: Joi.optional(),
    }),
    quote: Joi.string().max(20),
    address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/),
    traderAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/),
    side: Joi.string().valid('long', 'short').when('action', {
        is: 'OPEN_POSITION',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    collateral: Joi.number().positive().when('action', {
        is: 'OPEN_POSITION',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    leverage: Joi.number().positive().when('action', {
        is: 'OPEN_POSITION',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    pairId: Joi.number().integer().min(0).when('action', {
        is: Joi.valid('CLOSE_POSITION', 'UPDATE_SL', 'UPDATE_TP'),
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    tradeIndex: Joi.number().integer().min(0).when('action', {
        is: Joi.valid('CLOSE_POSITION', 'UPDATE_SL', 'UPDATE_TP'),
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    slPrice: Joi.number().positive().when('action', {
        is: 'UPDATE_SL',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    tpPrice: Joi.number().positive().when('action', {
        is: 'UPDATE_TP',
        then: Joi.required(),
        otherwise: Joi.optional(),
    }),
    idempotencyKey: Joi.string().max(128),
    outputMapping: Joi.object().pattern(Joi.string(), Joi.string()),
}).custom((value, helpers) => {
    if (value.action === 'PRICE' && !value.base && !value.market) {
        return helpers.error('any.custom', {
            customMessage: 'For PRICE action, either base or market is required',
        });
    }
    return value;
}).messages({
    'any.custom': '{{#customMessage}}',
}).unknown(true);

/**
 * Permissive schema for blocks that don't have strict validation yet
 */
const permissiveBlockConfigSchema = Joi.object({}).unknown(true);

/**
 * Start block schema — triggerType is optional, defaults to MANUAL
 */
const startBlockConfigSchema = triggerBlockConfigSchema.keys({
    triggerType: Joi.string().valid('CRON', 'WEBHOOK', 'MANUAL', 'EVENT').optional().default('MANUAL'),
});

/**
 * Time block node config (schedule / recurrence when used as a workflow node)
 */
const timeBlockNodeConfigSchema = Joi.object({
    runAt: Joi.date().iso().optional(),
    timezone: Joi.string().max(64).allow('', null).optional(),
    recurrence: Joi.object({
        type: Joi.string().valid('NONE', 'INTERVAL', 'CRON').default('NONE'),
        intervalSeconds: Joi.number().integer().min(1),
        cronExpression: Joi.string().max(256),
        untilAt: Joi.date().iso(),
        maxRuns: Joi.number().integer().min(1).max(100000),
    }).optional(),
    stopConditions: Joi.object({
        untilAt: Joi.date().iso(),
    }).optional(),
}).unknown(true);

/**
 * Schema for workflow node with type-specific config validation
 * Backend types are UPPERCASE (from normalizeNodeType in the registry)
 */
const workflowNodeSchema = Joi.object({
    id: Joi.string().required(),
    type: Joi.string().required(),
    name: Joi.string().max(255),
    description: Joi.string().max(1000),
    config: Joi.alternatives().conditional('type', [
        // DeFi
        { is: 'SWAP', then: swapBlockConfigSchema },
        { is: 'LENDING', then: lendingBlockConfigSchema },
        // Social / Messaging
        { is: 'SLACK', then: slackBlockConfigSchema },
        { is: 'TELEGRAM', then: telegramBlockConfigSchema },
        { is: 'EMAIL', then: mailBlockConfigSchema },
        // Oracle
        { is: 'CHAINLINK_PRICE_ORACLE', then: oracleBlockConfigSchema },
        { is: 'PYTH_PRICE_ORACLE', then: oracleBlockConfigSchema },
        { is: 'PRICE_ORACLE', then: oracleBlockConfigSchema },
        // AI
        { is: 'LLM_TRANSFORM', then: llmTransformBlockConfigSchema },
        // Perps
        { is: 'PERPS', then: perpsBlockConfigSchema },
        // Triggers
        { is: 'TRIGGER', then: triggerBlockConfigSchema },
        { is: 'START', then: startBlockConfigSchema },
        { is: 'TIME_BLOCK', then: timeBlockNodeConfigSchema },
        // Control
        { is: 'IF', then: controlBlockConfigSchema },
        { is: 'SWITCH', then: controlBlockConfigSchema },
        // Permissive (wallet, api, etc.)
        { is: 'WALLET', then: permissiveBlockConfigSchema },
        { is: 'API', then: apiBlockConfigSchema },
    ]).default({}),
    position: nodePositionSchema,
    metadata: Joi.object().default({}),
});

/**
 * Schema for workflow edge
 */
const workflowEdgeSchema = Joi.object({
    id: Joi.string(),
    sourceNodeId: Joi.string().required(),
    targetNodeId: Joi.string().required(),
    sourceHandle: Joi.string().allow(null),
    targetHandle: Joi.string().allow(null),
    condition: Joi.object(),
    dataMapping: Joi.object(),
});

/**
 * Schema for creating a workflow
 */
export const createWorkflowSchema = Joi.object({
    name: Joi.string()
        .required()
        .max(VALIDATION_CONSTANTS.MAX_WORKFLOW_NAME_LENGTH)
        .messages({
            'string.empty': 'Workflow name is required',
            'string.max': `Workflow name must be at most ${VALIDATION_CONSTANTS.MAX_WORKFLOW_NAME_LENGTH} characters`,
        }),
    description: Joi.string()
        .max(VALIDATION_CONSTANTS.MAX_WORKFLOW_DESCRIPTION_LENGTH)
        .allow('')
        .default(''),
    nodes: Joi.array()
        .items(workflowNodeSchema)
        .min(VALIDATION_CONSTANTS.MIN_NODES_PER_WORKFLOW)
        .max(VALIDATION_CONSTANTS.MAX_NODES_PER_WORKFLOW)
        .required()
        .messages({
            'array.min': 'At least one node is required',
            'array.max': `Maximum ${VALIDATION_CONSTANTS.MAX_NODES_PER_WORKFLOW} nodes allowed per workflow`,
        }),
    edges: Joi.array()
        .items(workflowEdgeSchema)
        .default([]),
    triggerNodeId: Joi.string().allow(null),
    category: Joi.string().max(50),
    tags: Joi.array()
        .items(Joi.string().max(VALIDATION_CONSTANTS.MAX_TAG_LENGTH))
        .max(VALIDATION_CONSTANTS.MAX_TAGS_PER_WORKFLOW)
        .default([]),
    isPublic: Joi.boolean().default(false),
}).custom((value, helpers) => {
    // When isPublic is true, enforce description and tags requirements
    if (value.isPublic) {
        if (!value.description || value.description.trim() === '') {
            return helpers.error('any.invalid', {
                message: 'Description is required when publishing a workflow publicly',
            });
        }
        if (!value.tags || value.tags.length === 0) {
            return helpers.error('any.invalid', {
                message: 'At least one tag is required when publishing a workflow publicly',
            });
        }
    }
    return value;
});

/**
 * Schema for updating a workflow
 */
export const updateWorkflowSchema = Joi.object({
    name: Joi.string().max(VALIDATION_CONSTANTS.MAX_WORKFLOW_NAME_LENGTH),
    description: Joi.string().max(VALIDATION_CONSTANTS.MAX_WORKFLOW_DESCRIPTION_LENGTH).allow(''),
    isActive: Joi.boolean(),
    isDraft: Joi.boolean(),
    category: Joi.string().max(50).allow(null),
    tags: Joi.array()
        .items(Joi.string().max(VALIDATION_CONSTANTS.MAX_TAG_LENGTH))
        .max(VALIDATION_CONSTANTS.MAX_TAGS_PER_WORKFLOW),
    isPublic: Joi.boolean(),
}).min(1).messages({
    'object.min': 'At least one field must be provided for update',
}).custom((value, helpers) => {
    // When isPublic is being set to true, enforce description and tags requirements
    if (value.isPublic) {
        if (value.description !== undefined && (!value.description || value.description.trim() === '')) {
            return helpers.error('any.invalid', {
                message: 'Description is required when publishing a workflow publicly',
            });
        }
        if (value.tags !== undefined && (!value.tags || value.tags.length === 0)) {
            return helpers.error('any.invalid', {
                message: 'At least one tag is required when publishing a workflow publicly',
            });
        }
    }
    return value;
});

/**
 * Schema for executing a workflow
 */
export const executeWorkflowSchema = Joi.object({
    initialInput: Joi.object().default({}),
});

/**
 * Schema for listing workflows
 */
export const listWorkflowsQuerySchema = Joi.object({
    category: Joi.string().max(50),
    isActive: Joi.boolean(),
    limit: Joi.number().integer().min(1).max(100).default(50),
    offset: Joi.number().integer().min(0).default(0),
});

/**
 * Schema for listing public workflows (unauthenticated)
 */
export const listPublicWorkflowsQuerySchema = Joi.object({
    q: Joi.string().max(200).allow(''),
    tag: Joi.string().max(VALIDATION_CONSTANTS.MAX_TAG_LENGTH),
    limit: Joi.number().integer().min(1).max(100).default(50),
    offset: Joi.number().integer().min(0).default(0),
});

/**
 * Schema for full update workflow (including nodes and edges)
 */
export const fullUpdateWorkflowSchema = Joi.object({
    name: Joi.string().max(VALIDATION_CONSTANTS.MAX_WORKFLOW_NAME_LENGTH),
    description: Joi.string().max(VALIDATION_CONSTANTS.MAX_WORKFLOW_DESCRIPTION_LENGTH).allow(''),
    nodes: Joi.array()
        .items(workflowNodeSchema)
        .min(VALIDATION_CONSTANTS.MIN_NODES_PER_WORKFLOW)
        .max(VALIDATION_CONSTANTS.MAX_NODES_PER_WORKFLOW)
        .required(),
    edges: Joi.array()
        .items(workflowEdgeSchema)
        .default([]),
    triggerNodeId: Joi.string().allow(null),
    category: Joi.string().max(50),
    tags: Joi.array()
        .items(Joi.string().max(VALIDATION_CONSTANTS.MAX_TAG_LENGTH))
        .max(VALIDATION_CONSTANTS.MAX_TAGS_PER_WORKFLOW),
    isPublic: Joi.boolean(),
}).custom((value, helpers) => {
    // When isPublic is true, enforce description and tags requirements
    if (value.isPublic) {
        if (!value.description || value.description.trim() === '') {
            return helpers.error('any.invalid', {
                message: 'Description is required when publishing a workflow publicly',
            });
        }
        if (!value.tags || value.tags.length === 0) {
            return helpers.error('any.invalid', {
                message: 'At least one tag is required when publishing a workflow publicly',
            });
        }
    }
    return value;
});

// ===========================================
// USER SCHEMAS
// ===========================================

/**
 * Schema for creating a user
 */
export const createUserSchema = Joi.object({
    id: Joi.string().required(),
    address: Joi.string()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required()
        .messages({
            'string.pattern.base': 'Invalid Ethereum address format',
        }),
    email: Joi.string().email().required(),
    onboarded_at: Joi.date().default(() => new Date()),
});

// ===========================================
// RELAY SCHEMAS
// ===========================================

/**
 * Schema for creating a Safe wallet
 */
export const createSafeSchema = Joi.object({
    chainId: Joi.number()
        .valid(...SAFE_RELAY_CHAIN_IDS)
        .required()
        .messages({
            'any.only': SAFE_RELAY_CHAIN_ERROR,
        }),
});

export const syncSafeFromTxSchema = Joi.object({
    chainId: Joi.number()
        .valid(...SAFE_RELAY_CHAIN_IDS)
        .required(),
    txHash: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
});

/**
 * Schema for enabling a module
 */
export const enableModuleSchema = Joi.object({
    chainId: Joi.number()
        .valid(...SAFE_RELAY_CHAIN_IDS)
        .required(),
    safeAddress: Joi.string()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required()
        .messages({
            'string.pattern.base': 'Invalid Safe address format',
        }),
    safeTxData: Joi.object({
        to: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
        value: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
        data: Joi.string().required(),
        operation: Joi.number().valid(0, 1).required(),
        safeTxGas: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
        baseGas: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
        gasPrice: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
        gasToken: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
        refundReceiver: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    }).required(),
    signatures: Joi.string().required(),
});

// ===========================================
// TIME BLOCK SCHEMAS
// ===========================================

export const createTimeBlockSchema = Joi.object({
    workflowId: uuidSchema.required(),
    runAt: Joi.date().iso().required(),
    timezone: Joi.string().max(64).allow('', null),
    recurrence: Joi.object({
        type: Joi.string().valid('NONE', 'INTERVAL', 'CRON').default('NONE'),
        intervalSeconds: Joi.number().integer().min(1),
        cronExpression: Joi.string().max(256),
        untilAt: Joi.date().iso(),
        maxRuns: Joi.number().integer().min(1).max(100000),
    }).default({ type: 'NONE' }),
}).custom((value, helpers) => {
    const type = value.recurrence?.type || 'NONE';
    if (type === 'INTERVAL' && !value.recurrence.intervalSeconds) {
        return helpers.error('any.invalid', { message: 'intervalSeconds is required for INTERVAL recurrence' });
    }
    if (type === 'CRON' && !value.recurrence.cronExpression) {
        return helpers.error('any.invalid', { message: 'cronExpression is required for CRON recurrence' });
    }
    return value;
});

export const listTimeBlocksQuerySchema = Joi.object({
    status: Joi.string().valid('ACTIVE', 'PAUSED', 'CANCELLED', 'COMPLETED'),
    limit: Joi.number().integer().min(1).max(100).default(50),
    offset: Joi.number().integer().min(0).default(0),
});

// ===========================================
// SWAP SCHEMAS
// ===========================================


/** Params: provider + chain (for quote, build-transaction) */
export const swapProviderChainParamsSchema = Joi.object({
    provider: Joi.string().valid(...SWAP_PROVIDERS).required().messages({
        'any.only': `provider must be one of: ${SWAP_PROVIDERS.join(', ')}`,
    }),
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required().messages({
        'any.only': `chain must be one of: ${SUPPORTED_CHAINS.join(', ')}`,
    }),
});

/** Params: chain only (for GET /providers/:chain) */
export const swapChainParamsSchema = Joi.object({
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required().messages({
        'any.only': `chain must be one of: ${SUPPORTED_CHAINS.join(', ')}`,
    }),
});

/** Params: chain + token address (for GET /providers/:chain/token/:address) */
export const swapChainTokenParamsSchema = Joi.object({
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required().messages({
        'any.only': `chain must be one of: ${SUPPORTED_CHAINS.join(', ')}`,
    }),
    address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required().messages({
        'string.pattern.base': 'address must be a valid 0x-prefixed 40-char hex',
    }),
});

/** Lending: provider + chain */
export const lendingProviderChainParamsSchema = Joi.object({
    provider: Joi.string().valid(...LENDING_PROVIDERS).required().messages({
        'any.only': `provider must be one of: ${LENDING_PROVIDERS.join(', ')}`,
    }),
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required().messages({
        'any.only': `chain must be one of: ${SUPPORTED_CHAINS.join(', ')}`,
    }),
});

/** Lending: chain only */
export const lendingChainParamsSchema = Joi.object({
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required().messages({
        'any.only': `chain must be one of: ${SUPPORTED_CHAINS.join(', ')}`,
    }),
});

/** Lending: provider + chain + walletAddress (position, account) */
export const lendingPositionParamsSchema = Joi.object({
    provider: Joi.string().valid(...LENDING_PROVIDERS).required(),
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required(),
    walletAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
});

/** Lending: provider + chain + asset address */
export const lendingAssetParamsSchema = Joi.object({
    provider: Joi.string().valid(...LENDING_PROVIDERS).required(),
    chain: Joi.string().valid(...SUPPORTED_CHAINS).required(),
    asset: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
});

/**
 * Token info schema
 */
const tokenInfoSchema = Joi.object({
    address: Joi.string()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required(),
    symbol: Joi.string(),
    decimals: Joi.number().integer().min(0).max(18),
    name: Joi.string(),
});

/**
 * Schema for swap input configuration
 */
export const swapInputConfigSchema = Joi.object({
    sourceToken: tokenInfoSchema.required(),
    destinationToken: tokenInfoSchema.required(),
    amount: Joi.string().required(),
    swapType: Joi.string().valid('EXACT_INPUT', 'EXACT_OUTPUT').required(),
    walletAddress: Joi.string()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required(),
    toChain: Joi.string().valid(...SUPPORTED_CHAINS).optional().messages({
        'any.only': `toChain must be one of: ${SUPPORTED_CHAINS.join(', ')}`,
    }),
    slippageTolerance: Joi.number().min(0).max(50).default(0.5),
    deadline: Joi.number().integer(),
    maxPriorityFeePerGas: Joi.string(),
    maxFeePerGas: Joi.string(),
    gasLimit: Joi.string(),
    recipient: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/),
    enablePartialFill: Joi.boolean().default(false),
    simulateFirst: Joi.boolean().default(true),
});

/** Body for POST /swaps/execute-with-signature/:provider/:chain */
export const swapExecuteWithSignatureBodySchema = Joi.object({
    config: swapInputConfigSchema.required(),
    signature: Joi.string().required(),
    nodeExecutionId: Joi.string().uuid().required(),
});

/** Body for POST /swaps/report-client-tx (mainnet user-funded flow) */
export const swapReportClientTxBodySchema = Joi.object({
    swapExecutionId: Joi.string().uuid().required(),
    txHash: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
});

// ===========================================
// LENDING BODY SCHEMAS
// ===========================================

const lendingTokenInfoSchema = Joi.object({
    address: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    symbol: Joi.string(),
    decimals: Joi.number().integer().min(0).max(18),
    name: Joi.string(),
});

/** Body for POST /lending/quote/:provider/:chain */
export const lendingQuoteBodySchema = Joi.object({
    operation: Joi.string()
        .valid('SUPPLY', 'WITHDRAW', 'BORROW', 'REPAY', 'ENABLE_COLLATERAL', 'DISABLE_COLLATERAL')
        .required(),
    asset: lendingTokenInfoSchema.required(),
    amount: Joi.string().required(),
    walletAddress: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
    interestRateMode: Joi.string().valid('STABLE', 'VARIABLE'),
    onBehalfOf: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/),
    maxPriorityFeePerGas: Joi.string(),
    maxFeePerGas: Joi.string(),
    gasLimit: Joi.string(),
    simulateFirst: Joi.boolean().default(true),
    referralCode: Joi.number().integer().min(0),
});

// ===========================================
// TELEGRAM SCHEMAS
// ===========================================

/**
 * Schema for creating a Telegram connection
 */
export const createTelegramConnectionSchema = Joi.object({
    chatId: Joi.string().required(),
    chatTitle: Joi.string().required(),
    chatType: Joi.string().valid('private', 'group', 'supergroup', 'channel').required(),
    name: Joi.string().max(100).default(''),
});

/**
 * Schema for sending a Telegram message
 */
export const sendTelegramMessageSchema = Joi.object({
    connectionId: uuidSchema.required(),
    text: Joi.string().max(4096).required(),
    parseMode: Joi.string().valid('HTML', 'Markdown', 'MarkdownV2'),
});

// ===========================================
// SLACK SCHEMAS
// ===========================================

/**
 * Schema for Slack webhook connection
 */
export const createSlackWebhookSchema = Joi.object({
    name: Joi.string().max(100).required(),
    webhookUrl: Joi.string().uri({ scheme: ['https'] }).required(),
});

/**
 * Schema for sending Slack message
 */
export const sendSlackMessageSchema = Joi.object({
    connectionId: uuidSchema.required(),
    message: Joi.string().max(4000).required(),
    channelId: Joi.string(),
});

// ===========================================
// OSTIUM SCHEMAS
// ===========================================

const ostiumNetworkSchema = Joi.string().valid(...OSTIUM_NETWORKS).required().messages({
    'any.only': `network must be one of: ${OSTIUM_NETWORKS.join(', ')}`,
});

const ethAddressSchema = Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).optional();

export const ostiumMarketsListSchema = Joi.object({
    network: ostiumNetworkSchema,
});

export const ostiumPriceSchema = Joi.object({
    network: ostiumNetworkSchema,
    base: Joi.string().min(1).max(20).required(),
    quote: Joi.string().min(1).max(20).default('USD'),
});

export const ostiumBalanceSchema = Joi.object({
    network: ostiumNetworkSchema,
    address: ethAddressSchema,
});

export const ostiumPositionsListSchema = Joi.object({
    network: ostiumNetworkSchema,
    traderAddress: ethAddressSchema,
});

export const ostiumPositionOpenSchema = Joi.object({
    network: ostiumNetworkSchema,
    market: Joi.string().min(1).max(50).required(),
    side: Joi.string().valid('long', 'short').required(),
    collateral: Joi.number().positive().required(),
    leverage: Joi.number().positive().required(),
    orderType: Joi.string().valid('market', 'limit', 'stop').default('market'),
    triggerPrice: Joi.number().positive().optional(),
    slippage: Joi.number().min(0).max(10).optional(),
    slPrice: Joi.number().positive().optional(),
    tpPrice: Joi.number().positive().optional(),
    traderAddress: ethAddressSchema,
    idempotencyKey: Joi.string().max(128).optional(),
});

export const ostiumPositionCloseSchema = Joi.object({
    network: ostiumNetworkSchema,
    pairId: Joi.number().integer().min(0).required(),
    tradeIndex: Joi.number().integer().min(0).required(),
    closePercentage: Joi.number().min(0).max(100).optional(),
    traderAddress: ethAddressSchema,
    idempotencyKey: Joi.string().max(128).optional(),
});

export const ostiumPositionUpdateSlSchema = Joi.object({
    network: ostiumNetworkSchema,
    pairId: Joi.number().integer().min(0).required(),
    tradeIndex: Joi.number().integer().min(0).required(),
    slPrice: Joi.number().positive().required(),
    traderAddress: ethAddressSchema,
});

export const ostiumPositionUpdateTpSchema = Joi.object({
    network: ostiumNetworkSchema,
    pairId: Joi.number().integer().min(0).required(),
    tradeIndex: Joi.number().integer().min(0).required(),
    tpPrice: Joi.number().positive().required(),
    traderAddress: ethAddressSchema,
});

export const ostiumPositionMetricsSchema = Joi.object({
    network: ostiumNetworkSchema,
    pairId: Joi.number().integer().min(0).required(),
    tradeIndex: Joi.number().integer().min(0).required(),
    traderAddress: ethAddressSchema,
});

export const ostiumOrderCancelSchema = Joi.object({
    network: ostiumNetworkSchema,
    orderId: Joi.string().required(),
    traderAddress: ethAddressSchema,
});

export const ostiumOrderUpdateSchema = Joi.object({
    network: ostiumNetworkSchema,
    orderId: Joi.string().required(),
    triggerPrice: Joi.number().positive().optional(),
    slPrice: Joi.number().positive().optional(),
    tpPrice: Joi.number().positive().optional(),
    traderAddress: ethAddressSchema,
});

export const ostiumOrderTrackSchema = Joi.object({
    network: ostiumNetworkSchema,
    orderId: Joi.string().required(),
});

export const ostiumHistorySchema = Joi.object({
    network: ostiumNetworkSchema,
    traderAddress: ethAddressSchema,
    limit: Joi.number().integer().min(1).max(100).optional(),
});

export const ostiumFaucetSchema = Joi.object({
    network: ostiumNetworkSchema,
    traderAddress: ethAddressSchema,
});

export const ostiumMarketFundingSchema = Joi.object({
    network: ostiumNetworkSchema,
    pairId: Joi.number().integer().min(0).required(),
    periodHours: Joi.number().integer().min(1).max(720).optional(),
});

export const ostiumMarketDetailsSchema = Joi.object({
    network: ostiumNetworkSchema,
    pairId: Joi.number().integer().min(0).required(),
});

export const ostiumDelegationPrepareSchema = Joi.object({
    network: ostiumNetworkSchema,
    delegateAddress: ethAddressSchema,
});

export const ostiumDelegationExecuteSchema = Joi.object({
    network: ostiumNetworkSchema,
    signature: Joi.string().min(10).required(),
    delegateAddress: ethAddressSchema,
});

export const ostiumDelegationStatusSchema = Joi.object({
    network: ostiumNetworkSchema,
    delegateAddress: ethAddressSchema,
});

export const ostiumReadinessSchema = Joi.object({
    network: ostiumNetworkSchema,
});

export const ostiumSetupOverviewSchema = Joi.object({
    network: ostiumNetworkSchema,
});

export const ostiumAllowancePrepareSchema = Joi.object({
    network: ostiumNetworkSchema,
});

export const ostiumAllowanceExecuteSchema = Joi.object({
    network: ostiumNetworkSchema,
    signature: Joi.string().min(10).required(),
    safeTxHash: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
    safeTxData: Joi.object({
        to: Joi.string().pattern(/^0x[a-fA-F0-9]{40}$/).required(),
        value: Joi.string().pattern(/^\d+$/).required(),
        data: Joi.string().pattern(/^0x[a-fA-F0-9]*$/).required(),
        operation: Joi.number().valid(0, 1).required(),
    }).required(),
});
