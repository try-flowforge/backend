import {
  NodeType,
  NodeExecutionInput,
  NodeExecutionOutput,
} from "../../../types";
import { INodeProcessor } from "../interfaces/INodeProcessor";
import { logger } from "../../../utils/logger";

/**
 * Operator types for Switch conditions
 */
export type SwitchOperator =
  | "equals"
  | "notEquals"
  | "contains"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "isEmpty"
  | "regex";

/**
 * A single case in the Switch node
 */
export interface SwitchCase {
  id: string; // Unique identifier for the case (e.g., "case_1", "default")
  label: string; // Human-readable label (e.g., "Case 1", "Default")
  operator: SwitchOperator;
  compareValue: string; // Value to compare against (ignored for 'default' case)
  isDefault?: boolean; // True for the default case
}

/**
 * Switch Node Configuration
 */
export interface SwitchNodeConfig {
  valuePath: string; // Path to value to test (e.g., "input.status")
  cases: SwitchCase[]; // Array of cases (max 5, including default)
}

/**
 * Maximum number of cases allowed per Switch node
 */
export const MAX_SWITCH_CASES = 5;

/**
 * Switch Node Processor
 * Handles multi-branch conditional routing in workflows
 *
 * The Switch node evaluates a value against multiple cases:
 * - Each case has its own condition (operator + compareValue)
 * - The first matching case's ID is returned as branchToFollow
 * - If no case matches, the default case is used
 */
export class SwitchNodeProcessor implements INodeProcessor {
  getNodeType(): NodeType {
    return NodeType.SWITCH;
  }

  async execute(input: NodeExecutionInput): Promise<NodeExecutionOutput> {
    const startTime = new Date();
    logger.info({ nodeId: input.nodeId }, "Executing SWITCH node");

    try {
      const config: SwitchNodeConfig = input.nodeConfig;

      // Validate configuration
      const validation = await this.validate(config);
      if (!validation.valid) {
        throw new Error(
          `Invalid SWITCH configuration: ${validation.errors?.join(", ")}`
        );
      }

      // Get the value to test from input data
      const testValue = this.getValueByPath(input.inputData, config.valuePath);

      // Find the first matching case (excluding default)
      let matchedCase: SwitchCase | undefined;
      const nonDefaultCases = config.cases.filter((c) => !c.isDefault);
      const defaultCase = config.cases.find((c) => c.isDefault);

      for (const switchCase of nonDefaultCases) {
        const matches = this.evaluateCondition(
          testValue,
          switchCase.operator,
          switchCase.compareValue
        );

        if (matches) {
          matchedCase = switchCase;
          break;
        }
      }

      // If no case matched, use default
      if (!matchedCase && defaultCase) {
        matchedCase = defaultCase;
      }

      const branchToFollow = matchedCase?.id || "default";
      const endTime = new Date();

      logger.info(
        {
          nodeId: input.nodeId,
          valuePath: config.valuePath,
          testValue,
          matchedCaseId: branchToFollow,
          matchedCaseLabel: matchedCase?.label,
        },
        "SWITCH condition evaluated"
      );

      // Return the branch to follow
      return {
        nodeId: input.nodeId,
        success: true,
        output: {
          matchedCaseId: branchToFollow,
          matchedCaseLabel: matchedCase?.label || "Default",
          branchToFollow,
          evaluatedValue: testValue,
          casesEvaluated: nonDefaultCases.length,
        },
        metadata: {
          startedAt: startTime,
          completedAt: endTime,
          duration: endTime.getTime() - startTime.getTime(),
        },
      };
    } catch (error) {
      const endTime = new Date();
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";

      logger.error(
        {
          nodeId: input.nodeId,
          error: errorMessage,
        },
        "SWITCH node execution failed"
      );

      return {
        nodeId: input.nodeId,
        success: false,
        output: {
          matchedCaseId: null,
          error: errorMessage,
        },
        error: {
          message: errorMessage,
          code: "SWITCH_NODE_EXECUTION_FAILED",
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
   * Safely get a nested value from an object using a dot-separated path
   * e.g., getValueByPath({ input: { status: "active" } }, "input.status") => "active"
   */
  private getValueByPath(obj: any, path: string): any {
    if (!path) return undefined;

    const parts = path.split(".");
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
    operator: SwitchOperator,
    rightValue: string
  ): boolean {
    // Handle isEmpty operator specially
    if (operator === "isEmpty") {
      return (
        leftValue === null ||
        leftValue === undefined ||
        leftValue === "" ||
        (Array.isArray(leftValue) && leftValue.length === 0)
      );
    }

    // Convert right value to appropriate type
    let rightVal: any = rightValue;

    // Try to parse as number if possible
    if (!isNaN(Number(rightValue)) && rightValue !== "") {
      rightVal = Number(rightValue);
    }

    // Evaluate based on operator
    switch (operator) {
      case "equals":
        return leftValue == rightVal; // Loose equality
      case "notEquals":
        return leftValue != rightVal;
      case "contains":
        if (typeof leftValue === "string") {
          return leftValue.includes(String(rightVal));
        }
        if (Array.isArray(leftValue)) {
          return leftValue.includes(rightVal);
        }
        return false;
      case "gt":
        return Number(leftValue) > Number(rightVal);
      case "lt":
        return Number(leftValue) < Number(rightVal);
      case "gte":
        return Number(leftValue) >= Number(rightVal);
      case "lte":
        return Number(leftValue) <= Number(rightVal);
      case "regex":
        try {
          const regex = new RegExp(rightValue);
          return regex.test(String(leftValue));
        } catch {
          return false;
        }
      default:
        return false;
    }
  }

  async validate(config: any): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    // Validate valuePath
    if (!config.valuePath || typeof config.valuePath !== "string") {
      errors.push("Value path is required and must be a string");
    }

    // Validate cases array
    if (!config.cases || !Array.isArray(config.cases)) {
      errors.push("Cases array is required");
    } else {
      // Check case count limit
      if (config.cases.length > MAX_SWITCH_CASES) {
        errors.push(`Maximum ${MAX_SWITCH_CASES} cases allowed`);
      }

      // Check for exactly one default case
      const defaultCases = config.cases.filter((c: SwitchCase) => c.isDefault);
      if (defaultCases.length === 0) {
        errors.push("A default case is required");
      } else if (defaultCases.length > 1) {
        errors.push("Only one default case is allowed");
      }

      // Validate each case
      const validOperators: SwitchOperator[] = [
        "equals",
        "notEquals",
        "contains",
        "gt",
        "lt",
        "gte",
        "lte",
        "isEmpty",
        "regex",
      ];

      for (let i = 0; i < config.cases.length; i++) {
        const switchCase = config.cases[i];

        if (!switchCase.id) {
          errors.push(`Case ${i + 1}: ID is required`);
        }

        if (!switchCase.label) {
          errors.push(`Case ${i + 1}: Label is required`);
        }

        // Non-default cases need valid operator and compareValue
        if (!switchCase.isDefault) {
          if (
            !switchCase.operator ||
            !validOperators.includes(switchCase.operator)
          ) {
            errors.push(
              `Case ${i + 1}: Operator must be one of: ${validOperators.join(
                ", "
              )}`
            );
          }

          // CompareValue is required for non-isEmpty operators
          if (switchCase.operator !== "isEmpty") {
            if (
              switchCase.compareValue === undefined ||
              switchCase.compareValue === null
            ) {
              errors.push(
                `Case ${i + 1}: Compare value is required for this operator`
              );
            }
          }
        }
      }
    }

    if (errors.length > 0) {
      logger.warn(
        { errors, config },
        "SWITCH node configuration validation failed"
      );
      return { valid: false, errors };
    }

    return { valid: true };
  }
}
