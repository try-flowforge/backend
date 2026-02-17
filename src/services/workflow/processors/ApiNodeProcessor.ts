import {
    NodeType,
    NodeExecutionInput,
    NodeExecutionOutput,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { logger } from '../../../utils/logger';
import { templateString } from '../../../utils/template-engine';
import axios, { AxiosRequestConfig } from 'axios';

export interface ApiNodeConfig {
    url: string;
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    headers?: Array<{ key: string; value: string }>;
    queryParams?: Array<{ key: string; value: string }>;
    body?: string;
    auth?: {
        type: 'none' | 'basic' | 'bearer' | 'apiKey';
        username?: string;
        password?: string;
        token?: string;
        apiKeyHeader?: string;
        apiKeyValue?: string;
        apiKeyType?: 'header' | 'query';
    };
}

export class ApiNodeProcessor implements INodeProcessor {
    getNodeType(): NodeType {
        return NodeType.API;
    }

    async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
        const startTime = new Date();
        logger.info({ nodeId: input.nodeId }, 'Executing API node');

        try {
            const config: ApiNodeConfig = input.nodeConfig;

            // Validate URL
            if (!config.url) {
                throw new Error('URL is required');
            }

            // Template URL
            const url = templateString(config.url, input.inputData);

            // Template Headers
            const headers: Record<string, string> = {};
            if (config.headers) {
                for (const { key, value } of config.headers) {
                    if (key && value) {
                        headers[key] = templateString(value, input.inputData);
                    }
                }
            }

            // Template Query Params
            const params: Record<string, string> = {};
            if (config.queryParams) {
                for (const { key, value } of config.queryParams) {
                    if (key && value) {
                        params[key] = templateString(value, input.inputData);
                    }
                }
            }

            // Template Body
            let data = config.body;
            if (data && typeof data === 'string') {
                // Try to template the whole body string
                data = templateString(data, input.inputData);
                try {
                    // If it's valid JSON, parse it so axios handles content-type correctly if not set
                    data = JSON.parse(data);
                } catch (e) {
                    // Keep as string if not valid JSON
                }
            }

            // Auth
            if (config.auth) {
                if (config.auth.type === 'basic' && config.auth.username && config.auth.password) {
                    const authString = Buffer.from(
                        `${templateString(config.auth.username, input.inputData)}:${templateString(config.auth.password, input.inputData)}`
                    ).toString('base64');
                    headers['Authorization'] = `Basic ${authString}`;
                } else if (config.auth.type === 'bearer' && config.auth.token) {
                    headers['Authorization'] = `Bearer ${templateString(config.auth.token, input.inputData)}`;
                } else if (config.auth.type === 'apiKey' && config.auth.apiKeyHeader && config.auth.apiKeyValue) {
                    const key = config.auth.apiKeyHeader;
                    const value = templateString(config.auth.apiKeyValue, input.inputData);
                    if (config.auth.apiKeyType === 'query') {
                        params[key] = value;
                    } else {
                        headers[key] = value;
                    }
                }
            }

            logger.info({ nodeId: input.nodeId, url, method: config.method }, 'Making API request');

            const axiosConfig: AxiosRequestConfig = {
                method: config.method,
                url,
                headers,
                params,
                data,
                validateStatus: () => true, // Don't throw on error status
            };

            const response = await axios(axiosConfig);

            const endTime = new Date();
            const success = response.status >= 200 && response.status < 300;

            return {
                nodeId: input.nodeId,
                success,
                output: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: response.headers,
                    data: response.data,
                },
                error: success ? undefined : {
                    message: `API request failed with status ${response.status}`,
                    code: 'API_REQUEST_FAILED',
                    details: response.data
                },
                metadata: {
                    startedAt: startTime,
                    completedAt: endTime,
                    duration: endTime.getTime() - startTime.getTime(),
                },
            };

        } catch (error) {
            const endTime = new Date();
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logger.error({ nodeId: input.nodeId, error: errorMessage }, 'API node execution failed');

            return {
                nodeId: input.nodeId,
                success: false,
                output: {},
                error: {
                    message: errorMessage,
                    code: 'API_EXECUTION_FAILED',
                },
                metadata: {
                    startedAt: startTime,
                    completedAt: endTime,
                    duration: endTime.getTime() - startTime.getTime(),
                },
            };
        }
    }

    async validate(config: any): Promise<{ valid: boolean; errors?: string[] }> {
        const errors: string[] = [];

        if (!config.url || typeof config.url !== 'string') {
            errors.push('URL is required');
        }

        if (!config.method || typeof config.method !== 'string') {
            errors.push('Method is required');
        }

        if (config.method && !['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(config.method)) {
            errors.push('Invalid HTTP method');
        }

        if (errors.length > 0) {
            return { valid: false, errors };
        }

        return { valid: true };
    }
}
