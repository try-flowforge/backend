/**
 * Template Engine
 * Shared utility for templating messages with {{path}} syntax
 * Supports static text mixed with dynamic values from previous nodes
 */

import { logger } from './logger';

/**
 * Template a string by replacing {{path}} placeholders with values from data
 * 
 * @param template - Template string with {{path}} placeholders
 * @param data - Data object containing values to substitute
 * @returns Templated string with placeholders replaced
 * 
 * @example
 * template("Hello {{name}}, you have {{count}} messages", { name: "John", count: 5 })
 * // Returns: "Hello John, you have 5 messages"
 * 
 * @example
 * template("Transaction: {{swap.txHash}}", { swap: { txHash: "0x123..." } })
 * // Returns: "Transaction: 0x123..."
 */
export function templateString(template: string, data: Record<string, any>): string {
  if (!template || typeof template !== 'string') {
    return template;
  }

  if (!data || typeof data !== 'object') {
    logger.warn({ template }, 'Template data is not an object, returning template as-is');
    return template;
  }

  // Replace {{path}} placeholders
  return template.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const trimmedPath = path.trim();
    const value = getValueByPath(data, trimmedPath);
    
    if (value === undefined || value === null) {
      logger.debug(
        { path: trimmedPath, template },
        'Template placeholder not found, leaving as-is'
      );
      return match; // Leave placeholder unchanged if value not found
    }
    
    // Convert value to string
    return formatValue(value);
  });
}

/**
 * Get nested value from object by dot-notation path
 * 
 * @param obj - Object to traverse
 * @param path - Dot-notation path (e.g., "swap.txHash" or "json.summary")
 * @returns Value at path or undefined
 * 
 * @example
 * getValueByPath({ swap: { txHash: "0x123" } }, "swap.txHash")
 * // Returns: "0x123"
 */
function getValueByPath(obj: any, path: string): any {
  if (!path) {
    return undefined;
  }

  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    return current[key];
  }, obj);
}

/**
 * Format a value for display in template
 * Handles arrays, objects, and primitives
 * 
 * @param value - Value to format
 * @returns Formatted string representation
 */
function formatValue(value: any): string {
  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(item => formatValue(item)).join(', ');
  }
  
  // Handle objects (but not null, which is an object in JS)
  if (typeof value === 'object' && value !== null) {
    // Try to find a meaningful string representation
    if (value.toString && value.toString() !== '[object Object]') {
      return value.toString();
    }
    // For plain objects, return JSON
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return '[Object]';
    }
  }
  
  // Handle primitives
  return String(value);
}

/**
 * Validate template syntax and check for available data
 * Useful for debugging template issues
 * 
 * @param template - Template string to validate
 * @param data - Data object to check against
 * @returns Validation result with missing paths
 */
export function validateTemplate(
  template: string,
  data: Record<string, any>
): { valid: boolean; missingPaths: string[] } {
  if (!template || typeof template !== 'string') {
    return { valid: false, missingPaths: [] };
  }

  const missingPaths: string[] = [];
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  let match;

  while ((match = placeholderRegex.exec(template)) !== null) {
    const path = match[1].trim();
    const value = getValueByPath(data, path);
    
    if (value === undefined || value === null) {
      missingPaths.push(path);
    }
  }

  return {
    valid: missingPaths.length === 0,
    missingPaths,
  };
}
