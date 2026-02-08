/**
 * Validation Schemas for API Requests
 * Uses Joi for schema definition and validation
 */

import Joi from 'joi';
import { VALIDATION_CONSTANTS } from '../config/constants';

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

/**
 * Schema for workflow node
 */
const workflowNodeSchema = Joi.object({
    id: Joi.string().required(),
    type: Joi.string().required(),
    name: Joi.string().max(255),
    description: Joi.string().max(1000),
    config: Joi.object().default({}),
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
        .valid(11155111, 421614, 42161) // Ethereum Sepolia, Arbitrum Sepolia, Arbitrum Mainnet
        .required()
        .messages({
            'any.only': 'Chain ID must be 11155111 (Ethereum Sepolia), 421614 (Arbitrum Sepolia), or 42161 (Arbitrum Mainnet)',
        }),
});

/**
 * Schema for enabling a module
 */
export const enableModuleSchema = Joi.object({
    chainId: Joi.number()
        .valid(11155111, 421614, 42161)
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

/**
 * Schema for recording ENS subdomain registration (grant sponsorship allowance).
 * Chain ID: 1 = Ethereum mainnet, 11155111 = Ethereum Sepolia.
 */
export const registerSubdomainSchema = Joi.object({
    ensName: Joi.string().required().max(255).messages({
        'string.empty': 'ENS name is required',
    }),
    ownerAddress: Joi.string()
        .pattern(/^0x[a-fA-F0-9]{40}$/)
        .required()
        .messages({
            'string.pattern.base': 'Invalid owner address format',
        }),
    expiry: Joi.date().iso().required().messages({
        'date.format': 'expiry must be ISO 8601 date',
    }),
    durationSeconds: Joi.number().integer().min(1).required().messages({
        'number.min': 'durationSeconds must be at least 1',
    }),
    chainId: Joi.number()
        .valid(1, 11155111)
        .required()
        .messages({
            'any.only': 'Chain ID must be 1 (Ethereum mainnet) or 11155111 (Ethereum Sepolia)',
        }),
});

// ===========================================
// SWAP SCHEMAS
// ===========================================

/** Supported chains for swap/lending/oracle (includes BASE for LiFi cross-chain) */
const SUPPORTED_CHAINS = ['ARBITRUM', 'ARBITRUM_SEPOLIA', 'ETHEREUM_SEPOLIA', 'BASE'] as const;
/** Swap providers */
const SWAP_PROVIDERS = ['UNISWAP', 'UNISWAP_V4', 'RELAY', 'ONEINCH', 'LIFI'] as const;
/** Lending providers */
const LENDING_PROVIDERS = ['AAVE', 'COMPOUND'] as const;

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
