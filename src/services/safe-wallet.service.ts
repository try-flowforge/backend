import { ethers } from "ethers";
import { getRelayerService } from "./relayer.service";
import { logger } from "../utils/logger";
import {
    getChainConfig,
    SUPPORTED_CHAINS,
    SupportedChainId,
} from "../config/config";

export interface SafeWalletResult {
    success: boolean;
    safeAddress?: string;
    txHash?: string | null;
    error?: string;
    alreadyExists?: boolean;
}

export interface MultiChainSafeResult {
    testnet?: SafeWalletResult;
    ethSepolia?: SafeWalletResult;
    mainnet?: SafeWalletResult;
}

/**
 * Service for creating and managing Safe wallets
 */
export class SafeWalletService {
    /**
     * Check if user already has a Safe wallet on a specific chain
     */
    static async getExistingSafeWallet(
        userAddress: string,
        chainId: SupportedChainId
    ): Promise<string | null> {
        try {
            const chainConfig = getChainConfig(chainId);
            const factoryAddress = chainConfig.factoryAddress;

            const relayerService = getRelayerService();
            const provider = relayerService.getProvider(chainId);

            const factoryContract = new ethers.Contract(
                factoryAddress,
                ["function getSafeWallets(address user) view returns (address[])"],
                provider
            );

            const existingSafes = await factoryContract.getSafeWallets(userAddress);

            if (existingSafes.length > 0) {
                return existingSafes[0];
            }

            return null;
        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    userAddress,
                    chainId,
                },
                "Failed to check for existing Safe wallet"
            );
            return null;
        }
    }

    /**
     * Create a Safe wallet for a user on a specific chain
     * Returns existing wallet if one already exists (idempotent)
     */
    static async createSafeForUser(
        userAddress: string,
        chainId: SupportedChainId
    ): Promise<SafeWalletResult> {
        try {
            const chainConfig = getChainConfig(chainId);

            logger.info(
                {
                    userAddress,
                    chainId,
                    chainName: chainConfig.name,
                },
                "Checking for existing Safe wallet"
            );

            // Check for existing wallet first (idempotency)
            const existingSafe = await this.getExistingSafeWallet(userAddress, chainId);

            if (existingSafe) {
                logger.info(
                    {
                        userAddress,
                        safeAddress: existingSafe,
                        chainId,
                        chainName: chainConfig.name,
                    },
                    "User already has a Safe wallet"
                );

                return {
                    success: true,
                    safeAddress: existingSafe,
                    txHash: null,
                    alreadyExists: true,
                };
            }

            logger.info(
                {
                    userAddress,
                    chainId,
                    chainName: chainConfig.name,
                },
                "Creating new Safe wallet"
            );

            // Encode createSafeWallet(address) call
            const iface = new ethers.Interface([
                "function createSafeWallet(address owner) returns (address)",
            ]);
            const data = iface.encodeFunctionData("createSafeWallet", [userAddress]);

            // Send via relayer
            const relayerService = getRelayerService();
            const { txHash, receipt } = await relayerService.sendTransaction(
                chainId,
                chainConfig.factoryAddress,
                data
            );

            // Parse SafeWalletCreated event to get Safe address
            const eventTopic = ethers.id("SafeWalletCreated(address,address,uint256)");
            const log = receipt.logs.find((l: { topics: readonly string[] }) => l.topics[0] === eventTopic);

            if (!log) {
                logger.error(
                    {
                        txHash,
                        userAddress,
                        chainId,
                    },
                    "SafeWalletCreated event not found in receipt"
                );

                return {
                    success: false,
                    error: "Failed to retrieve Safe address from transaction",
                };
            }

            // Safe address is the 3rd topic (indexed parameter)
            const safeAddress = ethers.getAddress("0x" + log.topics[2].slice(-40));

            logger.info(
                {
                    userAddress,
                    safeAddress,
                    txHash,
                    chainId,
                    chainName: chainConfig.name,
                },
                "Safe wallet created successfully"
            );

            return {
                success: true,
                safeAddress,
                txHash,
                alreadyExists: false,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);

            logger.error(
                {
                    error: errorMessage,
                    userAddress,
                    chainId,
                },
                "Failed to create Safe wallet"
            );

            return {
                success: false,
                error: errorMessage,
            };
        }
    }

    /**
     * Create Safe wallets for a user on both testnet and mainnet
     * Continues even if one chain fails
     */
    static async createSafesForUserOnAllChains(
        userAddress: string
    ): Promise<MultiChainSafeResult> {
        const results: MultiChainSafeResult = {};

        // Create on testnet (Arbitrum Sepolia)
        try {
            results.testnet = await this.createSafeForUser(
                userAddress,
                SUPPORTED_CHAINS.ARBITRUM_SEPOLIA
            );
        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    userAddress,
                    chain: "testnet",
                },
                "Failed to create testnet Safe wallet"
            );
            results.testnet = {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }

        // Create on Ethereum Sepolia
        try {
            results.ethSepolia = await this.createSafeForUser(
                userAddress,
                SUPPORTED_CHAINS.ETHEREUM_SEPOLIA
            );
        } catch (error) {
            logger.error(
                {
                    error: error instanceof Error ? error.message : String(error),
                    userAddress,
                    chain: "ethSepolia",
                },
                "Failed to create Ethereum Sepolia Safe wallet"
            );
            results.ethSepolia = {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            };
        }

        // Mainnet Safes are not created on user creation (cost control).
        // They are created on-demand when the user switches to mainnet and
        // requests a Safe via POST /relay/create-safe.

        return results;
    }
}
