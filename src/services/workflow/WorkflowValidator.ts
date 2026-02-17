import {
    WorkflowDefinition,
    WorkflowNodeDefinition,
    WorkflowEdge,
    NodeType,
} from '../../types';
import { AppError } from '../../middleware/error-handler';

/**
 * Service for validating high-level workflow integrity (graph structure, template refs)
 */
export class WorkflowValidator {
    /**
     * Main validation entry point
     * @throws AppError if validation fails
     */
    public static validate(workflow: Partial<WorkflowDefinition>): void {
        const nodes = workflow.nodes || [];
        const edges = workflow.edges || [];

        this.checkTriggerIntegrity(nodes);
        this.checkGraphIntegrity(nodes, edges);
        this.validateTemplateReferences(nodes, edges);
    }

    /**
     * Ensure exactly one trigger node exists
     */
    private static checkTriggerIntegrity(nodes: WorkflowNodeDefinition[]): void {
        const triggerNodes = nodes.filter(
            (n) => n.type === NodeType.TRIGGER || n.type === ('trigger' as NodeType)
        );

        // if (triggerNodes.length === 0) {
        //     throw new AppError(400, 'Workflow must have exactly one trigger node', 'VALIDATION_FAILED', {
        //         field: 'nodes',
        //         reason: 'MISSING_TRIGGER',
        //     });
        // }

        if (triggerNodes.length > 1) {
            throw new AppError(400, 'Workflow cannot have multiple trigger nodes', 'VALIDATION_FAILED', {
                field: 'nodes',
                reason: 'MULTIPLE_TRIGGERS',
            });
        }
    }

    /**
     * Check for cycles and reachability using DFS
     */
    private static checkGraphIntegrity(nodes: WorkflowNodeDefinition[], edges: WorkflowEdge[]): void {
        if (nodes.length === 0) return;

        const adj = new Map<string, string[]>();
        nodes.forEach((n) => adj.set(n.id, []));
        edges.forEach((e) => {
            const neighbors = adj.get(e.sourceNodeId) || [];
            neighbors.push(e.targetNodeId);
            adj.set(e.sourceNodeId, neighbors);
        });

        const visted = new Set<string>();
        const recStack = new Set<string>();
        const reachable = new Set<string>();

        const trigger = nodes.find(
            (n) => n.type === NodeType.TRIGGER || n.type === ('trigger' as NodeType)
        );

        const dfs = (nodeId: string) => {
            visted.add(nodeId);
            recStack.add(nodeId);
            reachable.add(nodeId);

            const neighbors = adj.get(nodeId) || [];
            for (const neighborId of neighbors) {
                if (!visted.has(neighborId)) {
                    dfs(neighborId);
                } else if (recStack.has(neighborId)) {
                    throw new AppError(400, `Circular dependency detected at node ${neighborId}`, 'VALIDATION_FAILED', {
                        nodeId: neighborId,
                        reason: 'CIRCULAR_DEPENDENCY',
                    });
                }
            }
            recStack.delete(nodeId);
        };

        if (trigger) {
            dfs(trigger.id);
        }

        // Check for orphaned nodes (not reachable from trigger)
        // const orphanedNodes = nodes.filter((n) => !reachable.has(n.id));
        // if (orphanedNodes.length > 0) {
        //     throw new AppError(400, `Orphaned nodes detected: ${orphanedNodes.map(n => n.id).join(', ')}`, 'VALIDATION_FAILED', {
        //         field: 'nodes',
        //         reason: 'ORPHANED_NODES',
        //         nodeIds: orphanedNodes.map(n => n.id),
        //     });
        // }
    }

    /**
     * Validate template variables like {{blocks.NODE_ID.output}}
     */
    private static validateTemplateReferences(nodes: WorkflowNodeDefinition[], edges: WorkflowEdge[]): void {
        const nodeIds = new Set(nodes.map((n) => n.id));
        const templateRegex = /{{blocks\.([\w-]+)\.output}}/g;

        // Build ancestor map to verify topological ordering
        const ancestors = new Map<string, Set<string>>();
        nodes.forEach(n => ancestors.set(n.id, new Set()));

        // Helper to fill ancestors
        const adj = new Map<string, string[]>();
        nodes.forEach((n) => adj.set(n.id, []));
        edges.forEach((e) => {
            adj.get(e.sourceNodeId)?.push(e.targetNodeId);
        });

        const trigger = nodes.find(
            (n) => n.type === NodeType.TRIGGER || n.type === ('trigger' as NodeType)
        );

        if (trigger) {
            const fillAncestors = (nodeId: string, currentAncestors: Set<string>) => {
                ancestors.get(nodeId)?.forEach(a => currentAncestors.add(a));
                const neighbors = adj.get(nodeId) || [];
                for (const neighborId of neighbors) {
                    const nextAncestors = new Set(currentAncestors);
                    nextAncestors.add(nodeId);
                    const targetSet = ancestors.get(neighborId)!;
                    nextAncestors.forEach(a => targetSet.add(a));
                    fillAncestors(neighborId, nextAncestors);
                }
            };
            // This is a naive implementation, but fine for small DAGs. 
            // A better way would be topological sort.
            const queue: string[] = [trigger.id];
            while (queue.length > 0) {
                const currentId = queue.shift()!;
                const neighbors = adj.get(currentId) || [];
                for (const neighborId of neighbors) {
                    const targetSet = ancestors.get(neighborId)!;
                    ancestors.get(currentId)?.forEach(a => targetSet.add(a));
                    targetSet.add(currentId);
                    queue.push(neighborId);
                }
            }
        }

        nodes.forEach((node) => {
            const configStr = JSON.stringify(node.config);
            let match;
            while ((match = templateRegex.exec(configStr)) !== null) {
                const referencedNodeId = match[1];

                if (!nodeIds.has(referencedNodeId)) {
                    throw new AppError(400, `Node ${node.id} references non-existent node ${referencedNodeId}`, 'VALIDATION_FAILED', {
                        nodeId: node.id,
                        field: 'config',
                        referencedNodeId,
                    });
                }

                if (!ancestors.get(node.id)?.has(referencedNodeId)) {
                    throw new AppError(400, `Node ${node.id} references node ${referencedNodeId} which is not upstream`, 'VALIDATION_FAILED', {
                        nodeId: node.id,
                        field: 'config',
                        referencedNodeId,
                        reason: 'INVALID_FORWARD_REFERENCE',
                    });
                }
            }
        });
    }
}
