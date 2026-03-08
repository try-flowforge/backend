import { promisify } from 'util';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  ChainlinkPriceOutput,
  ChainlinkOracleConfig,
  LifiQuoteResult,
  LifiSwapWorkflowResult,
  SwapNodeConfig,
} from '../../types';
import { logger } from '../../utils/logger';

const execAsync = promisify(exec);

function getOracleWorkflowRootDir(): string {
  return path.resolve(
    process.cwd(),
    'src/services/cre/workflows/oracle',
  );
}

function getLifiSwapWorkflowRootDir(): string {
  return path.resolve(
    process.cwd(),
    'src/services/cre/workflows/lifi-swap',
  );
}

function getWorkflowArtifactsDir(workflowRootDir: string): string {
  return path.join(workflowRootDir, 'workflow');
}

function buildCreSimulateCmd(payloadPath: string, broadcast = false): string {
  const base = `cre workflow simulate ./workflow --target staging-settings --non-interactive`;
  const broadcastFlag = broadcast ? ' --broadcast' : '';
  return `${base}${broadcastFlag} --trigger-index 1 --http-payload @${payloadPath}`;
}

async function writeWorkflowArtifacts<T>(
  artifactsDir: string,
  executionId: string,
  result: T,
): Promise<void> {
  const outputFile = path.join(artifactsDir, `result-${executionId}.json`);
  await fs.writeFile(outputFile, JSON.stringify(result, null, 2), 'utf8');

  const workflowResultFile = path.join(artifactsDir, 'result-workflow.json');
  await fs.writeFile(
    workflowResultFile,
    JSON.stringify(result, null, 2),
    'utf8',
  );
}

async function parseSimulationResult<T>(stdout: string): Promise<T> {
  const marker = 'Workflow Simulation Result:';
  const idx = stdout.lastIndexOf(marker);
  if (idx === -1) {
    throw new Error('Unable to find Workflow Simulation Result in CRE CLI output');
  }

  const after = stdout.slice(idx + marker.length).trim();
  const firstLine = after.split('\n').find((l) => l.trim().length > 0);
  if (!firstLine) {
    throw new Error('No result payload found after Workflow Simulation Result');
  }

  const outer = JSON.parse(firstLine) as string;
  return JSON.parse(outer) as T;
}

export async function simulateOracleCli(
  config: ChainlinkOracleConfig,
  executionId: string,
): Promise<ChainlinkPriceOutput[]> {
  const workflowRootDir = getOracleWorkflowRootDir();
  const artifactsDir = getWorkflowArtifactsDir(workflowRootDir);

  const payload = {
    executionId,
    chainName: 'ethereum-mainnet-arbitrum-1',
    feeds: [
      {
        name: 'price',
        address: config.aggregatorAddress,
      },
    ],
    staleAfterSeconds: config.staleAfterSeconds,
  };

  const payloadPath = path.join(artifactsDir, `payload-${executionId}.json`);
  await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8');

  const cmd = buildCreSimulateCmd(payloadPath);

  logger.info(
    { executionId, cmd, cwd: workflowRootDir },
    'Running CRE oracle CLI simulation',
  );

  const { stdout, stderr } = await execAsync(cmd, { cwd: workflowRootDir });

  if (stderr && stderr.trim().length > 0) {
    logger.warn({ executionId, stderr }, 'CRE oracle simulation stderr');
  }

  const resultWrapper = await parseSimulationResult<{ results: ChainlinkPriceOutput[] }>(
    stdout,
  );

  await writeWorkflowArtifacts(artifactsDir, executionId, resultWrapper);

  return resultWrapper.results;
}

export async function simulateLifiQuoteCli(
  config: SwapNodeConfig,
  executionId: string,
): Promise<LifiQuoteResult> {
  const workflowRootDir = getLifiSwapWorkflowRootDir();
  const artifactsDir = getWorkflowArtifactsDir(workflowRootDir);

  const payload = {
    executionId,
    chain: config.chain,
    chainSelectorName:
      config.chain === 'ARBITRUM'
        ? 'ethereum-mainnet-arbitrum-1'
        : 'ethereum-testnet-sepolia-arbitrum-1',
    provider: 'LIFI',
    inputConfig: config.inputConfig,
  };

  const payloadPath = path.join(artifactsDir, `payload-${executionId}.json`);
  await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8');

  const cmd = buildCreSimulateCmd(payloadPath);

  logger.info(
    { executionId, cmd, cwd: workflowRootDir },
    'Running CRE LI.FI quote CLI simulation',
  );

  const { stdout, stderr } = await execAsync(cmd, { cwd: workflowRootDir });

  if (stderr && stderr.trim().length > 0) {
    logger.warn({ executionId, stderr }, 'CRE LI.FI quote simulation stderr');
  }

  const result = await parseSimulationResult<LifiQuoteResult>(stdout);

  await writeWorkflowArtifacts(artifactsDir, executionId, result);

  return result;
}

export async function executeLifiSwapCli(
  config: SwapNodeConfig & {
    safeModuleAddress: string;
    rpcUrl?: string;
  },
  executionId: string,
): Promise<LifiSwapWorkflowResult> {
  const workflowRootDir = getLifiSwapWorkflowRootDir();
  const artifactsDir = getWorkflowArtifactsDir(workflowRootDir);

  const payload = {
    executionId,
    chain: config.chain,
    chainSelectorName:
      config.chain === 'ARBITRUM'
        ? 'ethereum-mainnet-arbitrum-1'
        : 'ethereum-testnet-sepolia-arbitrum-1',
    provider: 'LIFI',
    safeModuleAddress: config.safeModuleAddress,
    rpcUrl: config.rpcUrl,
    inputConfig: config.inputConfig,
  };

  const payloadPath = path.join(artifactsDir, `payload-${executionId}.json`);
  await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8');

  const cmd = buildCreSimulateCmd(payloadPath, true);

  logger.info(
    { executionId, cmd, cwd: workflowRootDir },
    'Running CRE LI.FI swap CLI execution',
  );

  const CRE_SWAP_EXEC_TIMEOUT_MS = 60_000;
  let stdout: string;
  let stderr: string;
  try {
    const result = await execAsync(cmd, {
      cwd: workflowRootDir,
      env: process.env,
      timeout: CRE_SWAP_EXEC_TIMEOUT_MS,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: unknown) {
    const errorWithOutput = err as { stdout?: string; stderr?: string; killed?: boolean; message?: string };
    const timeoutStdout = errorWithOutput.stdout?.trim();
    const timeoutStderr = errorWithOutput.stderr?.trim();
    const isTimeout =
      err instanceof Error &&
      ((err as { killed?: boolean }).killed === true || /timeout|ETIMEDOUT|timed out/i.test(err.message));
    if (isTimeout) {
      logger.warn(
        {
          executionId,
          timeoutMs: CRE_SWAP_EXEC_TIMEOUT_MS,
          stdoutTail: timeoutStdout ? timeoutStdout.slice(-4000) : undefined,
          stderrTail: timeoutStderr ? timeoutStderr.slice(-4000) : undefined,
        },
        'CRE LI.FI swap execution timed out',
      );
      throw new Error(
        `CRE LI.FI swap execution timed out after ${CRE_SWAP_EXEC_TIMEOUT_MS / 1000}s. Check RPC and chain congestion.`,
      );
    }
    throw err;
  }

  if (stderr && stderr.trim().length > 0) {
    logger.warn({ executionId, stderr }, 'CRE LI.FI swap execution stderr');
  }

  const result = await parseSimulationResult<LifiSwapWorkflowResult>(stdout);

  await writeWorkflowArtifacts(artifactsDir, executionId, result);

  return result;
}
