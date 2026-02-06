import {
    NodeType,
    NodeExecutionInput,
    NodeExecutionOutput,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { pool } from '../../../config/database';
import { logger } from '../../../utils/logger';

/**
 * Wallet Node Processor
 * Handles execution of Wallet nodes in workflows
 * 
 * This processor retrieves the user's wallet information including
 * Safe wallet addresses for use in subsequent DeFi operations.
 */
export class WalletNodeProcessor implements INodeProcessor {
    getNodeType(): NodeType {
        return NodeType.WALLET;
    }

    async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
        const startTime = new Date();
        logger.info({ nodeId: input.nodeId }, 'Executing Wallet node');

        try {
            const userId = input.executionContext.userId;

            // Load user's wallet information from database
            const result = await pool.query<{
                id: string;
                address: string;
                safe_wallet_address_testnet: string | null;
                safe_wallet_address_mainnet: string | null;
                safe_wallet_address_eth_sepolia: string | null;
            }>(
                'SELECT id, address, safe_wallet_address_testnet, safe_wallet_address_mainnet, safe_wallet_address_eth_sepolia FROM users WHERE id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                throw new Error('User not found');
            }

            const user = result.rows[0];

            const output = {
                userId: user.id,
                eoaAddress: user.address,
                safeWalletAddressMainnet: user.safe_wallet_address_mainnet,
                safeWalletAddressTestnet: user.safe_wallet_address_testnet,
                safeWalletAddressEthSepolia: user.safe_wallet_address_eth_sepolia,
                // Default wallet: prefer Arbitrum Sepolia, then Ethereum Sepolia, then mainnet
                walletAddress:
                    user.safe_wallet_address_testnet ||
                    user.safe_wallet_address_eth_sepolia ||
                    user.safe_wallet_address_mainnet ||
                    user.address,
                timestamp: new Date().toISOString(),
            };

            const endTime = new Date();

            logger.info(
                {
                    nodeId: input.nodeId,
                    userId,
                    hasMainnetWallet: !!user.safe_wallet_address_mainnet,
                    hasEthSepoliaWallet: !!user.safe_wallet_address_eth_sepolia,
                },
                'Wallet node executed successfully'
            );

            return {
                nodeId: input.nodeId,
                success: true,
                output,
                metadata: {
                    startedAt: startTime,
                    completedAt: endTime,
                    duration: endTime.getTime() - startTime.getTime(),
                },
            };
        } catch (error) {
            const endTime = new Date();
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';

            logger.error(
                { nodeId: input.nodeId, error: errorMessage },
                'Wallet node execution failed'
            );

            return {
                nodeId: input.nodeId,
                success: false,
                output: null,
                error: {
                    message: errorMessage,
                    code: 'WALLET_NODE_EXECUTION_FAILED',
                },
                metadata: {
                    startedAt: startTime,
                    completedAt: endTime,
                    duration: endTime.getTime() - startTime.getTime(),
                },
            };
        }
    }

    async validate(_config: any): Promise<{ valid: boolean; errors?: string[] }> {
        // Wallet node doesn't require specific configuration
        // It uses the user ID from execution context
        return { valid: true };
    }
}
