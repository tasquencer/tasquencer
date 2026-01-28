"use client";

import "@xyflow/react/dist/style.css";

import {
  Background,
  type Connection,
  type EdgeTypes,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import {
  type WorkflowEdge,
  type WorkflowNode,
  workflowStructureToNodesAndEdges,
} from "./workflow-visualizer/nodes-edges.js";

import { ConditionNode } from "./workflow-visualizer/condition-node.js";
import {
  type ExtractedWorkflowStructure,
  type TaskState,
} from "@repo/tasquencer";
import { FloatingEdge } from "./workflow-visualizer/floating-edge.js";
import { TaskNode } from "./workflow-visualizer/task-node.js";
import dagre from "dagre";
import { useCallback, useEffect, useState, useMemo } from "react";
import { Button } from "@repo/ui/components/button";
import { ButtonGroup } from "@repo/ui/components/button-group";
import { ArrowDownFromLine, ArrowRightFromLine } from "lucide-react";
import {
  TaskClickContext,
  CancellationRegionHoverContext,
} from "./workflow-visualizer/contexts.js";

type Direction = "TB" | "LR";

const DEFAULT_NODE_DIMENSIONS = { width: 250, height: 32 } as const;

const nodeDimensionsByType = {
  task: { width: 250, height: 32 },
  condition: { width: 120, height: 28 },
} as const;

function getNodeDimensions(nodeType: "condition" | "task" | undefined) {
  if (!nodeType) {
    return DEFAULT_NODE_DIMENSIONS;
  }
  return nodeDimensionsByType[nodeType] ?? DEFAULT_NODE_DIMENSIONS;
}

function getLaidOutElements(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  direction: Direction = "TB"
) {
  const isHorizontal = direction === "LR";
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    rankdir: direction,
    nodesep: 120,
    edgesep: 120,
    ranksep: 70,
  });

  nodes.forEach((node) => {
    const nodeDimensions = getNodeDimensions(node.type);
    dagreGraph.setNode(node.id, {
      width: nodeDimensions.width,
      height: nodeDimensions.height,
    });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const newNodes: WorkflowNode[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const nodeDimensions = getNodeDimensions(node.type);
    const newNode = {
      ...node,
      targetPosition: isHorizontal ? Position.Left : Position.Top,
      sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
      // We are shifting the dagre node position (anchor=center center) to the top left
      // so it matches the React Flow node anchor point (top left).
      position: {
        x: nodeWithPosition.x - nodeDimensions.width / 2,
        y: nodeWithPosition.y - nodeDimensions.height / 2,
      },
    };

    return newNode;
  });

  return { nodes: newNodes, edges };
}

const nodeTypes = {
  task: TaskNode,
  condition: ConditionNode,
};

const edgeTypes: EdgeTypes = {
  floating: FloatingEdge,
};

type WorkflowRuntimeState = {
  conditions: Record<string, { marking: number }>;
  tasks: Record<string, { state: TaskState; generation: number }>;
};

/**
 * WorkflowVisualizerCore - Pure presentation component
 *
 * Renders a workflow structure with optional state overlay.
 * Delegates all navigation logic to parent components.
 */
export function WorkflowVisualizerCore({
  structure,
  state,
  onTaskClick,
  breadcrumbSlot,
  showLayoutControls = true,
}: {
  structure: ExtractedWorkflowStructure;
  state?: WorkflowRuntimeState | null;
  onTaskClick?: (task: ExtractedWorkflowStructure["tasks"][number]) => void;
  breadcrumbSlot?: React.ReactNode;
  showLayoutControls?: boolean;
}) {
  const reactFlow = useReactFlow();
  const [layoutDirection, setLayoutDirection] = useState<Direction>("TB");

  const [hoveredCancellationOwner, setHoveredCancellationOwner] = useState<
    string | null
  >(null);

  const {
    nodes: initialNodes,
    edges: initialEdges,
    cancellationMembership,
  } = useMemo(
    () => workflowStructureToNodesAndEdges(structure, state),
    [structure, state]
  );

  const { nodes: laidOutNodes, edges: laidOutEdges } = useMemo(
    () => getLaidOutElements(initialNodes, initialEdges, layoutDirection),
    [initialNodes, initialEdges, layoutDirection]
  );
  const [nodes, setNodes, onNodesChange] =
    useNodesState<WorkflowNode>(laidOutNodes);
  const [edges, setEdges, onEdgesChange] =
    useEdgesState<WorkflowEdge>(laidOutEdges);

  const scheduleFitView = useCallback(() => {
    requestAnimationFrame(() => {
      reactFlow.fitView({
        duration: 500,
        interpolate: "smooth",
      });
    });
  }, [reactFlow]);

  // Update nodes and edges when structure or state changes
  useEffect(() => {
    setNodes(laidOutNodes);
    setEdges(laidOutEdges);
    setHoveredCancellationOwner(null);
    scheduleFitView();
  }, [laidOutNodes, laidOutEdges, scheduleFitView, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const onLayout = useCallback(
    (direction: Direction) => {
      setLayoutDirection(direction);
      scheduleFitView();
    },
    [scheduleFitView]
  );

  return (
    <TaskClickContext.Provider value={onTaskClick || null}>
      <CancellationRegionHoverContext.Provider
        value={{
          hoveredOwner: hoveredCancellationOwner,
          setHovered: setHoveredCancellationOwner,
          membership: cancellationMembership,
        }}
      >
        <div className="w-full h-full">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onConnect={onConnect}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            maxZoom={1}
          >
            {breadcrumbSlot && (
              <Panel position="top-left">{breadcrumbSlot}</Panel>
            )}

            {showLayoutControls && (
              <Panel position="top-right">
                <ButtonGroup>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onLayout("TB")}
                  >
                    <ArrowDownFromLine className="size-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onLayout("LR")}
                  >
                    <ArrowRightFromLine className="size-4" />
                  </Button>
                </ButtonGroup>
              </Panel>
            )}
            <Background />
          </ReactFlow>
        </div>
      </CancellationRegionHoverContext.Provider>
    </TaskClickContext.Provider>
  );
}

type NavigationHistoryItem = {
  structure: ExtractedWorkflowStructure;
  taskName?: string;
};

type DynamicCompositeTask = Extract<
  ExtractedWorkflowStructure["tasks"][number],
  { type: "dynamicCompositeTask" }
>;

/**
 * StandaloneWorkflowVisualizer - Wrapper with internal navigation
 *
 * For viewing workflow structures without timeline integration.
 * Manages its own navigation state with simple Back button.
 */
function StandaloneWorkflowVisualizer({
  structure,
  state,
}: {
  structure: ExtractedWorkflowStructure;
  state?: WorkflowRuntimeState;
}) {
  const reactFlow = useReactFlow();
  const [navigationHistory, setNavigationHistory] = useState<
    NavigationHistoryItem[]
  >([{ structure }]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [pendingDynamicTask, setPendingDynamicTask] =
    useState<DynamicCompositeTask | null>(null);
  const [pendingDynamicChildWorkflowName, setPendingDynamicChildWorkflowName] =
    useState<string | null>(null);
  const scheduleFitView = useCallback(() => {
    requestAnimationFrame(() => {
      reactFlow.fitView({
        duration: 500,
        interpolate: "smooth",
      });
    });
  }, [reactFlow]);

  // Reset navigation when external structure changes
  useEffect(() => {
    setNavigationHistory([{ structure }]);
    setCurrentIndex(0);
    setPendingDynamicTask(null);
    setPendingDynamicChildWorkflowName(null);
    scheduleFitView();
  }, [structure, scheduleFitView]);

  const currentStructure = navigationHistory[currentIndex]!;

  const navigateToChildWorkflow = useCallback(
    (childWorkflow: ExtractedWorkflowStructure, taskName: string) => {
      setPendingDynamicTask(null);
      setPendingDynamicChildWorkflowName(null);
      const newHistory = navigationHistory.slice(0, currentIndex + 1);
      newHistory.push({ structure: childWorkflow, taskName });
      setNavigationHistory(newHistory);
      setCurrentIndex(newHistory.length - 1);
      scheduleFitView();
    },
    [navigationHistory, currentIndex, scheduleFitView]
  );

  const handleTaskClick = useCallback(
    (task: ExtractedWorkflowStructure["tasks"][number]) => {
      if (task.type === "compositeTask") {
        navigateToChildWorkflow(task.childWorkflow, task.name);
        return;
      }

      if (task.type === "dynamicCompositeTask") {
        if (task.childWorkflows.length === 0) {
          return;
        }
        if (task.childWorkflows.length === 1) {
          navigateToChildWorkflow(task.childWorkflows[0]!, task.name);
          return;
        }

        setPendingDynamicTask(task);
        setPendingDynamicChildWorkflowName(task.childWorkflows[0]?.name ?? null);
      }
    },
    [navigateToChildWorkflow]
  );

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setPendingDynamicTask(null);
      setPendingDynamicChildWorkflowName(null);
      scheduleFitView();
    }
  }, [currentIndex, scheduleFitView]);

  const handleOpenDynamicChildWorkflow = useCallback(() => {
    if (!pendingDynamicTask) return;

    const selectedChild =
      pendingDynamicTask.childWorkflows.find(
        (workflow: { name?: string }) =>
          workflow.name === pendingDynamicChildWorkflowName
      ) ?? pendingDynamicTask.childWorkflows[0];

    if (!selectedChild) return;

    setPendingDynamicTask(null);
    setPendingDynamicChildWorkflowName(null);
    navigateToChildWorkflow(selectedChild, pendingDynamicTask.name);
  }, [
    pendingDynamicTask,
    pendingDynamicChildWorkflowName,
    navigateToChildWorkflow,
  ]);

  const handleCancelDynamicPicker = useCallback(() => {
    setPendingDynamicTask(null);
    setPendingDynamicChildWorkflowName(null);
  }, []);

  const canGoBack = currentIndex > 0;
  const currentTaskName = currentStructure.taskName;

  const breadcrumb = canGoBack || pendingDynamicTask ? (
    <div className="flex flex-col gap-2">
      {canGoBack ? (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleBack}>
            ← Back
          </Button>
          {currentTaskName && (
            <span className="text-sm text-muted-foreground">
              Inside: {currentTaskName}
            </span>
          )}
        </div>
      ) : null}
      {pendingDynamicTask ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-background/80 px-2 py-1.5 backdrop-blur">
          <span className="text-sm text-muted-foreground">
            Select workflow for{" "}
            <span className="font-medium text-foreground">
              {pendingDynamicTask.name}
            </span>
            :
          </span>
          <select
            className="border rounded px-1.5 py-1 text-sm bg-background"
            value={
              pendingDynamicChildWorkflowName ??
              pendingDynamicTask.childWorkflows[0]?.name ??
              ""
            }
            onChange={(e) => setPendingDynamicChildWorkflowName(e.target.value)}
          >
            {pendingDynamicTask.childWorkflows.map(
              (workflow: { name?: string }) => (
              <option key={workflow.name} value={workflow.name}>
                {workflow.name}
              </option>
              )
            )}
          </select>
          <Button size="sm" onClick={handleOpenDynamicChildWorkflow}>
            Open
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancelDynamicPicker}
          >
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <WorkflowVisualizerCore
      structure={currentStructure.structure}
      state={state}
      onTaskClick={handleTaskClick}
      breadcrumbSlot={breadcrumb}
      showLayoutControls={true}
    />
  );
}

/**
 * WorkflowVisualizer - Public API
 *
 * Wraps StandaloneWorkflowVisualizer with ReactFlowProvider.
 * Use this for viewing workflow structures without timeline integration.
 */
export function WorkflowVisualizer({
  structure,
  state,
}: {
  structure: ExtractedWorkflowStructure;
  state?: WorkflowRuntimeState;
}) {
  return (
    <ReactFlowProvider>
      <StandaloneWorkflowVisualizer structure={structure} state={state} />
    </ReactFlowProvider>
  );
}
