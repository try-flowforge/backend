import { promisify } from 'util';
import { exec } from 'child_process';
import * as path from 'path';
import * as fs from 'fs/promises';
import {
  ChainlinkPriceOutput,
  ChainlinkOracleConfig,
} from '../../types';
import { logger } from '../../utils/logger';

const execAsync = promisify(exec);

function getOracleWorkflowDir(): string {
  return path.resolve(
    process.cwd(),
    'src/services/cre/workflows/oracle',
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
  const workflowDir = getOracleWorkflowDir();

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

  const payloadPath = path.join(workflowDir, `payload-${executionId}.json`);
  await fs.writeFile(payloadPath, JSON.stringify(payload), 'utf8');

  const cmd = `cre workflow simulate ./workflow --target staging-settings --non-interactive --trigger-index 1 --http-payload @${payloadPath}`;

  logger.info(
    { executionId, cmd, cwd: workflowDir },
    'Running CRE oracle CLI simulation',
  );

  const { stdout, stderr } = await execAsync(cmd, { cwd: workflowDir });

  if (stderr && stderr.trim().length > 0) {
    logger.warn({ executionId, stderr }, 'CRE oracle simulation stderr');
  }

  const resultWrapper = await parseSimulationResult<{ results: ChainlinkPriceOutput[] }>(
    stdout,
  );

  const outputFile = path.join(workflowDir, `result-${executionId}.json`);
  await fs.writeFile(
    outputFile,
    JSON.stringify(resultWrapper, null, 2),
    'utf8',
  );

  // Also write a stable workflow-level result file for debugging
  const workflowResultFile = path.join(
    workflowDir,
    'workflow',
    'result-workflow.json',
  );
  await fs.writeFile(
    workflowResultFile,
    JSON.stringify(resultWrapper, null, 2),
    'utf8',
  );

  return resultWrapper.results;
}
