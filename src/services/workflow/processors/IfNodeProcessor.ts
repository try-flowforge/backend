import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
} from '../../../types';
import { INodeProcessor } from '../interfaces/INodeProcessor';
import { logger } from '../../../utils/logger';

/**
 * Operator types for If conditions
 */
export type IfOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'isEmpty';

/**
 * If Node Configuration
 */
export interface IfNodeConfig {
  leftPath: string;      // Path to value to test (e.g., "input.amount")
  operator: IfOperator;  // Comparison operator
  rightValue: string;    // Value to compare against
}

/**
 * If Node Processor
 * Handles conditional branching in workflows
 * 
 * The If node evaluates a condition and determines which branch to follow:
 * - Returns branchToFollow: "true" or "false"
 * - The execution engine uses this to select the correct outgoing edge
 */
export class IfNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.IF;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, 'Executing IF node');

    try {
      const config: IfNodeConfig = this.normalizeConfig(input.nodeConfig);

      // Validate configuration
      const validation = await this.validate(config);
      if (!validation.valid) {
        throw new Error(`Invalid IF configuration: ${validation.errors?.join(', ')}`);
      }

      // Get the value to test - either from path lookup or as literal value
      const leftValue = this.resolveValue(input.inputData, config.leftPath);

      // Evaluate the condition
      const conditionResult = this.evaluateCondition(
        leftValue,
        config.operator,
        config.rightValue
      );

      const endTime = new Date();

      logger.info(
        {
          nodeId: input.nodeId,
          leftPath: config.leftPath,
          leftValue,
          operator: config.operator,
          rightValue: config.rightValue,
          result: conditionResult,
        },
        'IF condition evaluated'
      );

      // Return the branch to follow
      return {
        nodeId: input.nodeId,
        success: true,
        output: {
          conditionResult,
          branchToFollow: conditionResult ? 'true' : 'false',
          evaluatedLeft: leftValue,
          operator: config.operator,
          evaluatedRight: config.rightValue,
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

      logger.error(
        {
          nodeId: input.nodeId,
          error: errorMessage,
        },
        'IF node execution failed'
      );

      return {
        nodeId: input.nodeId,
        success: false,
        output: {
          conditionResult: false,
          error: errorMessage,
        },
        error: {
          message: errorMessage,
          code: 'IF_NODE_EXECUTION_FAILED',
        },
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    }
  }

  /**
   * Normalize config: if planner (or client) sent condition as string (e.g. "ETH/USD < 1750"),
   * parse into leftPath, operator, rightValue so validation and execution succeed.
   */
  private normalizeConfig(raw: any): IfNodeConfig {
    const hasStructured =
      typeof raw?.leftPath === 'string' &&
      raw?.operator &&
      (raw?.operator === 'isEmpty' || raw?.rightValue !== undefined);
    if (hasStructured) {
      return raw as IfNodeConfig;
    }
    const conditionStr = typeof raw?.condition === 'string' ? raw.condition.trim() : '';
    if (conditionStr) {
      const parsed = this.parseConditionString(conditionStr);
      if (parsed) {
        return {
          leftPath: parsed.leftPath,
          operator: parsed.operator as IfOperator,
          rightValue: parsed.rightValue,
        };
      }
    }
    return (raw ?? {}) as IfNodeConfig;
  }

  private parseConditionString(
    condition: string,
  ): { leftPath: string; operator: string; rightValue: string } | null {
    const opMatch = condition.match(/\s*(<=|>=|==|!=|<|>|=)\s*/);
    if (!opMatch) return null;
    const opMap: Record<string, string> = {
      '<': 'lt',
      '>': 'gt',
      '<=': 'lte',
      '>=': 'gte',
      '==': 'equals',
      '=': 'equals',
      '!=': 'notEquals',
    };
    const operator = opMap[opMatch[1]];
    if (!operator) return null;
    const [left, right] = condition.split(opMatch[0], 2).map((s) => s.trim());
    if (left === undefined || right === undefined) return null;
    const leftPath = /^[A-Z0-9]+\/[A-Z0-9]+$/i.test(left) ? 'formattedAnswer' : left;
    return { leftPath, operator, rightValue: right };
  }

  /**
   * Resolve a value - either as a path lookup from input data or as a literal value
   * 
   * If the value looks like a path (contains dots or matches a key in input data),
   * it tries to resolve it from input data. Otherwise, it treats it as a literal value.
   * 
   * Examples:
   * - "input.amount" -> looks up inputData.input.amount
   * - "amount" -> looks up inputData.amount, falls back to "amount" as literal
   * - "100" -> treated as literal value 100
   * - "hello" -> treated as literal value "hello"
   */
  private resolveValue(inputData: any, valueOrPath: string): any {
    if (!valueOrPath) return undefined;

    // First, try to resolve as a path from input data
    let resolved = this.getValueByPath(inputData, valueOrPath);

    // If path didn't resolve and it looks like a price-feed label (planner sent "ETH/USD price", "ETHUSD", etc.),
    // or path is "formattedAnswer" (oracle output key), resolve the actual price from oracle output.
    if (resolved === undefined && (this.looksLikePriceFeedPath(valueOrPath) || valueOrPath.trim() === 'formattedAnswer')) {
      resolved =
        this.getValueByPath(inputData, 'formattedAnswer') ??
        this.getValueByPath(inputData, 'price');
      // Fallback: price may live only in inputData.blocks (e.g. when direct merge is empty)
      if (resolved === undefined && inputData?.blocks && typeof inputData.blocks === 'object') {
        for (const block of Object.values(inputData.blocks) as any[]) {
          if (block && typeof block === 'object') {
            const v = block.formattedAnswer ?? block.price;
            if (v !== undefined && v !== null) {
              resolved = v;
              break;
            }
          }
        }
      }
    }

    if (resolved !== undefined) {
      return resolved;
    }

    // Otherwise, treat the value as a literal
    if (!isNaN(Number(valueOrPath)) && valueOrPath !== '') {
      return Number(valueOrPath);
    }

    return valueOrPath;
  }

  /** True if leftPath looks like a price feed label (e.g. "ETH/USD price", "ETHUSD", "ETH/USD") from the planner. */
  private looksLikePriceFeedPath(path: string): boolean {
    if (!path || typeof path !== 'string') return false;
    const s = path.trim();
    // "ETH/USD", "ETHUSD", "ETH/USD price", "BTC/USD", "price", etc.
    return (
      /^[A-Z0-9]+\/[A-Z0-9]+$/i.test(s) ||
      /^[A-Z0-9]+\/[A-Z0-9]+\s+price$/i.test(s) ||
      /^[A-Z0-9]+USD$/i.test(s) ||
      s.toLowerCase() === 'price'
    );
  }

  /**
   * Safely get a nested value from an object using a dot-separated path
   * e.g., getValueByPath({ input: { amount: 100 } }, "input.amount") => 100
   */
  private getValueByPath(obj: any, path: string): any {
    if (!path) return undefined;

    const parts = path.split('.');
    let current: any = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = current[part];
    }

    return current;
  }

  /**
   * Evaluate a condition
   */
  private evaluateCondition(
    leftValue: any,
    operator: IfOperator,
    rightValue: string
  ): boolean {
    // Handle isEmpty operator specially
    if (operator === 'isEmpty') {
      return (
        leftValue === null ||
        leftValue === undefined ||
        leftValue === '' ||
        (Array.isArray(leftValue) && leftValue.length === 0)
      );
    }

    // Convert right value to appropriate type
    let rightVal: any = rightValue;

    // Try to parse as number if possible
    if (!isNaN(Number(rightValue)) && rightValue !== '') {
      rightVal = Number(rightValue);
    }

    // Evaluate based on operator
    switch (operator) {
      case 'equals':
        return leftValue == rightVal; // Loose equality
      case 'notEquals':
        return leftValue != rightVal;
      case 'contains':
        if (typeof leftValue === 'string') {
          return leftValue.includes(String(rightVal));
        }
        if (Array.isArray(leftValue)) {
          return leftValue.includes(rightVal);
        }
        return false;
      case 'gt':
        return Number(leftValue) > Number(rightVal);
      case 'lt':
        return Number(leftValue) < Number(rightVal);
      case 'gte':
        return Number(leftValue) >= Number(rightVal);
      case 'lte':
        return Number(leftValue) <= Number(rightVal);
      default:
        return false;
    }
  }

  async validate(config: any): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    // Validate leftPath
    if (!config.leftPath || typeof config.leftPath !== 'string') {
      errors.push('Left path is required and must be a string');
    }

    // Validate operator
    const validOperators: IfOperator[] = [
      'equals',
      'notEquals',
      'contains',
      'gt',
      'lt',
      'gte',
      'lte',
      'isEmpty',
    ];

    if (!config.operator || !validOperators.includes(config.operator)) {
      errors.push(
        `Operator must be one of: ${validOperators.join(', ')}`
      );
    }

    // Validate rightValue (not required for isEmpty)
    if (config.operator !== 'isEmpty') {
      if (config.rightValue === undefined || config.rightValue === null) {
        errors.push('Right value is required for this operator');
      }
    }

    if (errors.length > 0) {
      logger.warn(
        { errors, config },
        'IF node configuration validation failed'
      );
      return { valid: false, errors };
    }

    return { valid: true };
  }
}

