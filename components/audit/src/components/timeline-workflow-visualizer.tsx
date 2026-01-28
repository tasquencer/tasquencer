"use client";

import {
  useMemo,
  useEffect,
  useRef,
  useCallback,
  useReducer,
  useState,
} from "react";
import { WorkflowVisualizerCore } from "./workflow-visualizer.js";
import { Slider } from "@repo/ui/components/slider";
import { Button } from "@repo/ui/components/button";
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  ChevronRight,
  ChevronLeft,
} from "lucide-react";
import { format } from "date-fns";
import type {
  ExtractedWorkflowStructure,
  AuditTracesDoc,
  AuditSpansDoc,
} from "@repo/tasquencer";
import { SpansView } from "./audit/spans-view.js";
import { ReactFlowProvider } from "@xyflow/react";
import { Badge } from "@repo/ui/components/badge";
import { ButtonGroup } from "@repo/ui/components/button-group";

// ============================================================================
// Types
// ============================================================================

// Types for callback return values
export type KeyEvent = {
  timestamp: number;
  description: string;
  spanId?: string;
  workflowName?: string;
};

type TaskState =
  | "started"
  | "completed"
  | "failed"
  | "canceled"
  | "disabled"
  | "enabled";

export type WorkflowState = {
  conditions: Record<string, { marking: number }>;
  tasks: Record<string, { state: TaskState; generation: number }>;
};

export type WorkflowInstance = {
  workflowId: string;
  workflowName: string;
  state: string;
  generation: number;
};

interface TimelineWorkflowVisualizerProps {
  traceId: string;
  structure: ExtractedWorkflowStructure;
  trace?: AuditTracesDoc;
  // Data props
  keyEvents: KeyEvent[];
  rootSpans: AuditSpansDoc[];
  // Callback props
  onLoadChildren: (parentSpanId: string) => Promise<AuditSpansDoc[]>;
  onFetchWorkflowState: (params: {
    workflowId?: string;
    timestamp: number;
  }) => Promise<WorkflowState | null>;
  onFetchChildInstances: (params: {
    taskName: string;
    workflowName?: string;
    timestamp: number;
  }) => Promise<WorkflowInstance[]>;
}

type NavigationHistoryItem = {
  workflowName: string;
  workflowId?: string;
  structure: ExtractedWorkflowStructure;
  taskName?: string;
  taskType?: "compositeTask" | "dynamicCompositeTask";
};

type NavigationState = {
  history: NavigationHistoryItem[];
  currentIndex: number;
  selectedTask?: ExtractedWorkflowStructure["tasks"][number] | null;
  selectedChildWorkflowName?: string;
  navigationCounter: number;
};

type NavigationAction =
  | { type: "TIMELINE_NAVIGATE"; path: NavigationHistoryItem[] }
  | { type: "BREADCRUMB_NAVIGATE"; index: number }
  | {
      type: "SET_SELECTED_TASK";
      task: ExtractedWorkflowStructure["tasks"][number] | null;
    }
  | { type: "SET_SELECTED_CHILD_WORKFLOW"; workflowName?: string }
  | {
      type: "SELECT_INSTANCE";
      workflowId: string;
      taskName: string;
      childWorkflow: ExtractedWorkflowStructure;
    }
  | {
      type: "PROCEED_WITHOUT_INSTANCE";
      taskName: string;
      childWorkflow: ExtractedWorkflowStructure;
    }
  | { type: "CLOSE_MODAL" };

type TimelineState = {
  currentEventIndex: number;
  isPlaying: boolean;
};

type TimelineAction =
  | { type: "NEXT" }
  | { type: "PREV" }
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "TOGGLE_PLAY_PAUSE" }
  | { type: "SEEK"; index: number }
  | { type: "TICK" };

// ============================================================================
// Navigation Reducer
// ============================================================================

function navigationReducer(
  state: NavigationState,
  action: NavigationAction
): NavigationState {
  console.log("[REDUCER]", action.type, {
    currentWorkflow: state.history[state.currentIndex]?.workflowName,
    currentIndex: state.currentIndex,
    hasPendingModal: false,
  });

  switch (action.type) {
    case "TIMELINE_NAVIGATE":
      console.log(
        "[REDUCER] TIMELINE_NAVIGATE to:",
        action.path[action.path.length - 1]?.workflowName
      );
      return {
        ...state,
        history: action.path,
        currentIndex: action.path.length - 1,
        selectedTask: null,
        selectedChildWorkflowName: undefined,
        navigationCounter: state.navigationCounter + 1,
      };

    case "BREADCRUMB_NAVIGATE":
      console.log(
        "[REDUCER] BREADCRUMB_NAVIGATE to index:",
        action.index,
        "workflow:",
        state.history[action.index]?.workflowName
      );
      return {
        ...state,
        currentIndex: action.index,
        selectedTask: null,
        selectedChildWorkflowName: undefined,
        navigationCounter: state.navigationCounter + 1,
      };

    case "SELECT_INSTANCE": {
      const newHistory = state.history.slice(0, state.currentIndex + 1);
      newHistory.push({
        workflowName: action.childWorkflow.name,
        workflowId: action.workflowId,
        structure: action.childWorkflow,
        taskName: action.taskName,
      });
      return {
        history: newHistory,
        currentIndex: newHistory.length - 1,
        selectedTask: null,
        selectedChildWorkflowName: undefined,
        navigationCounter: state.navigationCounter + 1,
      };
    }

    case "PROCEED_WITHOUT_INSTANCE": {
      const newHistory = state.history.slice(0, state.currentIndex + 1);
      newHistory.push({
        workflowName: action.childWorkflow.name,
        workflowId: undefined,
        structure: action.childWorkflow,
        taskName: action.taskName,
      });
      return {
        history: newHistory,
        currentIndex: newHistory.length - 1,
        selectedTask: null,
        selectedChildWorkflowName: undefined,
        navigationCounter: state.navigationCounter + 1,
      };
    }

    case "SET_SELECTED_TASK":
      return {
        ...state,
        selectedTask: action.task,
        selectedChildWorkflowName: undefined,
      };

    case "SET_SELECTED_CHILD_WORKFLOW":
      return {
        ...state,
        selectedChildWorkflowName: action.workflowName,
      };

    default:
      return state;
  }
}

// ============================================================================
// Timeline Reducer
// ============================================================================

function createTimelineReducer(totalEvents: number) {
  return function timelineReducer(
    state: TimelineState,
    action: TimelineAction
  ): TimelineState {
    switch (action.type) {
      case "NEXT":
        if (state.currentEventIndex < totalEvents - 1) {
          return {
            currentEventIndex: state.currentEventIndex + 1,
            isPlaying: false,
          };
        }
        return state;

      case "PREV":
        if (state.currentEventIndex > 0) {
          return {
            currentEventIndex: state.currentEventIndex - 1,
            isPlaying: false,
          };
        }
        return state;

      case "PLAY":
        return { ...state, isPlaying: true };

      case "PAUSE":
        return { ...state, isPlaying: false };

      case "TOGGLE_PLAY_PAUSE":
        return { ...state, isPlaying: !state.isPlaying };

      case "SEEK":
        return {
          currentEventIndex: action.index,
          isPlaying: false,
        };

      case "TICK":
        if (state.isPlaying && state.currentEventIndex < totalEvents - 1) {
          return {
            ...state,
            currentEventIndex: state.currentEventIndex + 1,
          };
        }
        if (state.currentEventIndex >= totalEvents - 1) {
          return { ...state, isPlaying: false };
        }
        return state;

      default:
        return state;
    }
  };
}

// ============================================================================
// Timeline Controls Component
// ============================================================================

interface TimelineControlsProps {
  currentEventIndex: number;
  totalEvents: number;
  isPlaying: boolean;
  currentEvent?: {
    description: string;
    timestamp: number;
  };
  onPrev: () => void;
  onNext: () => void;
  onPlayPause: () => void;
  onSliderChange: (value: number[]) => void;
}

function TimelineControls({
  currentEventIndex,
  totalEvents,
  isPlaying,
  currentEvent,
  onPrev,
  onNext,
  onPlayPause,
  onSliderChange,
}: TimelineControlsProps) {
  return (
    <div className="px-3 py-2 border-b flex items-center gap-3">
      <ButtonGroup>
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          onClick={onPrev}
          disabled={currentEventIndex === 0}
        >
          <SkipBack className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          onClick={onPlayPause}
          disabled={currentEventIndex === totalEvents - 1}
        >
          {isPlaying ? (
            <Pause className="h-3 w-3" />
          ) : (
            <Play className="h-3 w-3" />
          )}
        </Button>
        <Button
          size="icon"
          variant="outline"
          className="h-7 w-7"
          onClick={onNext}
          disabled={currentEventIndex === totalEvents - 1}
        >
          <SkipForward className="h-3 w-3" />
        </Button>
      </ButtonGroup>

      <div className="flex-1">
        <Slider
          value={[currentEventIndex]}
          onValueChange={onSliderChange}
          max={totalEvents - 1}
          step={1}
          className="w-full"
        />
      </div>

      <div className="text-[10px] text-muted-foreground text-right tabular-nums font-mono whitespace-nowrap">
        Event {String(currentEventIndex + 1).padStart(2, "0")} of{" "}
        {String(totalEvents).padStart(2, "0")}
      </div>

      {currentEvent && (
        <>
          <span className="text-zinc-300 dark:text-zinc-700">|</span>
          <div className="flex items-center gap-2 text-xs truncate">
            <span className="font-medium truncate">
              {currentEvent.description}
            </span>
            <span className="text-muted-foreground font-mono text-[10px]">
              {format(new Date(currentEvent.timestamp), "HH:mm:ss.SSS")}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Breadcrumb Navigation Component
// ============================================================================

interface BreadcrumbNavigationProps {
  history: NavigationHistoryItem[];
  currentIndex: number;
  onNavigate: (index: number) => void;
}

function BreadcrumbNavigation({
  history,
  currentIndex,
  onNavigate,
}: BreadcrumbNavigationProps) {
  return (
    <div className="flex items-center gap-1.5 bg-background/60 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-2 h-7 rounded-md border text-xs">
      {history.slice(0, currentIndex + 1).map((item, idx) => (
        <div key={idx} className="flex items-center gap-1.5 flex-shrink-0">
          {idx > 0 && (
            <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
          )}
          <button
            onClick={() => idx < currentIndex && onNavigate(idx)}
            disabled={idx === currentIndex}
            className={`${
              idx === currentIndex
                ? "font-medium text-foreground cursor-default"
                : "text-muted-foreground hover:text-foreground cursor-pointer"
            }`}
          >
            {item.workflowName}
            {item.workflowId && (
              <span className="text-[10px] ml-1 font-mono opacity-70">
                ({item.workflowId.slice(0, 8)})
              </span>
            )}
          </button>
          {item.taskName && idx < currentIndex && (
            <Badge variant="outline" className="text-[10px] h-4 px-1">
              via {item.taskName}
            </Badge>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function TimelineWorkflowVisualizer({
  traceId,
  structure,
  trace,
  keyEvents,
  rootSpans,
  onLoadChildren,
  onFetchWorkflowState,
  onFetchChildInstances,
}: TimelineWorkflowVisualizerProps) {
  const [navState, dispatch] = useReducer(navigationReducer, {
    history: [{ workflowName: structure.name, workflowId: traceId, structure }],
    currentIndex: 0,
    selectedTask: null,
    selectedChildWorkflowName: undefined,
    navigationCounter: 0,
  });
  const [isInspectorOpen, setInspectorOpen] = useState(true);

  const timelineReducer = useMemo(
    () => createTimelineReducer(keyEvents?.length || 0),
    [keyEvents?.length]
  );

  const [timelineState, dispatchTimeline] = useReducer(timelineReducer, {
    currentEventIndex: 0,
    isPlaying: false,
  });

  const timeRange = useMemo(() => {
    const firstKeyEvent = keyEvents?.[0];
    const lastKeyEvent = keyEvents?.[keyEvents.length - 1];

    if (!firstKeyEvent || !lastKeyEvent) {
      return { start: 0, end: 0 };
    }

    return {
      start: firstKeyEvent.timestamp,
      end: lastKeyEvent.timestamp,
    };
  }, [keyEvents]);

  const currentTimestamp = useMemo(() => {
    if (!keyEvents || keyEvents.length === 0) return timeRange.start;
    // Use the next event's timestamp (or a buffer after the last event) to ensure
    // we capture all spans that are part of the current operation
    const currentEvent = keyEvents[timelineState.currentEventIndex];
    const nextEvent = keyEvents[timelineState.currentEventIndex + 1];

    if (!currentEvent) return timeRange.start;

    // If there's a next event, use a timestamp just before it
    // Otherwise, use current event timestamp + 1ms to include all related spans
    return nextEvent ? nextEvent.timestamp - 0.001 : currentEvent.timestamp + 1;
  }, [keyEvents, timelineState.currentEventIndex, timeRange.start]);

  // Use specific workflow instance ID if navigated to a child workflow
  const currentNavItem = navState.history[navState.currentIndex];
  const currentEvent = keyEvents?.[timelineState.currentEventIndex];

  // Use the navigation item's workflowId (set explicitly when navigating)
  // This ensures correct workflow state when navigating via breadcrumbs
  const currentWorkflowId = currentNavItem?.workflowId;

  // If we have a taskName but no workflowId, we need to find the appropriate instance
  // Fetch instances when we're viewing a child workflow without a specific instance selected
  const needInstanceLookup = !!currentNavItem?.taskName && !currentWorkflowId;
  const [instancesForLookup, setInstancesForLookup] = useState<
    WorkflowInstance[] | undefined
  >();

  useEffect(() => {
    if (needInstanceLookup && currentNavItem?.taskName) {
      onFetchChildInstances({
        taskName: currentNavItem.taskName,
        timestamp: currentTimestamp,
      }).then(setInstancesForLookup);
    } else {
      setInstancesForLookup(undefined);
    }
  }, [
    needInstanceLookup,
    currentNavItem?.taskName,
    currentTimestamp,
    onFetchChildInstances,
  ]);

  // Pick the first active instance (or the only one if there's just one)
  const resolvedWorkflowId =
    currentWorkflowId || instancesForLookup?.[0]?.workflowId;

  // Fetch workflow state
  const [workflowState, setWorkflowState] = useState<WorkflowState | null>(
    null
  );

  useEffect(() => {
    onFetchWorkflowState({
      workflowId: resolvedWorkflowId,
      timestamp: currentTimestamp,
    }).then(setWorkflowState);
  }, [resolvedWorkflowId, currentTimestamp, onFetchWorkflowState]);

  const stableWorkflowState = useRef(workflowState);
  if (workflowState !== undefined && workflowState !== null) {
    stableWorkflowState.current = workflowState;
  }

  const handleNext = useCallback(() => {
    dispatchTimeline({ type: "NEXT" });
  }, []);

  const handlePrev = useCallback(() => {
    dispatchTimeline({ type: "PREV" });
  }, []);

  const handlePlayPause = useCallback(() => {
    dispatchTimeline({ type: "TOGGLE_PLAY_PAUSE" });
  }, []);

  const handleSliderChange = useCallback((value: number[]) => {
    dispatchTimeline({ type: "SEEK", index: value[0] ?? 0 });
  }, []);

  const handleJumpToSpan = useCallback(
    (spanId: string) => {
      if (!keyEvents) return;
      const eventIndex = keyEvents.findIndex(
        (event) => event.spanId === spanId
      );
      if (eventIndex !== -1) {
        dispatchTimeline({ type: "SEEK", index: eventIndex });
      }
    },
    [keyEvents]
  );

  // Build navigation path for a given workflow name
  const buildNavigationPath = useCallback(
    (workflowName: string): NavigationHistoryItem[] | null => {
      // Build navigation path from root to target workflow
      const buildPath = (
        struct: ExtractedWorkflowStructure,
        targetName: string,
        isRoot: boolean = true
      ): NavigationHistoryItem[] | null => {
        if (struct.name === targetName) {
          // Only set workflowId for root workflow; child workflows will get their ID via instance lookup
          return [
            {
              workflowName: struct.name,
              workflowId: isRoot ? traceId : undefined,
              structure: struct,
            },
          ];
        }

        for (const task of struct.tasks) {
          if (task.type === "compositeTask") {
            const childPath = buildPath(task.childWorkflow, targetName, false);
            if (childPath) {
              return [
                {
                  workflowName: struct.name,
                  workflowId: traceId,
                  structure: struct,
                },
                ...childPath.map((item, idx) =>
                  idx === 0 ? { ...item, taskName: task.name } : item
                ),
              ];
            }
          } else if (task.type === "dynamicCompositeTask") {
            for (const child of task.childWorkflows) {
              const childPath = buildPath(child, targetName, false);
              if (childPath) {
                return [
                  {
                    workflowName: struct.name,
                    workflowId: traceId,
                    structure: struct,
                  },
                  ...childPath.map((item, idx) =>
                    idx === 0
                      ? { ...item, taskName: task.name, taskType: task.type }
                      : item
                  ),
                ];
              }
            }
          }
        }

        return null;
      };

      return buildPath(structure, workflowName);
    },
    [structure, traceId]
  );

  // CODE PATH 1: Auto-navigate when timeline event changes
  // Simple: if event workflow != current workflow && no modal open -> navigate
  // Track the event index to know when timeline actually moved (vs manual navigation)
  const prevEventIndexRef = useRef(timelineState.currentEventIndex);

  useEffect(() => {
    const eventWorkflowName = currentEvent?.workflowName;
    const currentWorkflowName = currentNavItem?.workflowName;
    const timelineMoved =
      timelineState.currentEventIndex !== prevEventIndexRef.current;

    console.log("[AUTO-NAV CHECK]", {
      timelineMoved,
      eventWorkflowName,
      currentWorkflowName,
      willNavigate:
        timelineMoved &&
        eventWorkflowName &&
        eventWorkflowName !== currentWorkflowName,
    });

    // Only auto-navigate if:
    // 1. Timeline actually moved (event index changed)
    // 2. Event workflow differs from current workflow
    if (
      timelineMoved &&
      eventWorkflowName &&
      eventWorkflowName !== currentWorkflowName
    ) {
      console.log("[AUTO-NAV] Navigating to:", eventWorkflowName);
      const path = buildNavigationPath(eventWorkflowName);
      if (path) {
        dispatch({ type: "TIMELINE_NAVIGATE", path });
      }
    }

    prevEventIndexRef.current = timelineState.currentEventIndex;
  }, [
    timelineState.currentEventIndex,
    currentEvent?.workflowName,
    currentNavItem?.workflowName,
    buildNavigationPath,
  ]);

  const getChildWorkflowsForTask = useCallback(
    (task: ExtractedWorkflowStructure["tasks"][number]) => {
      if (task.type === "compositeTask") return [task.childWorkflow];
      if (task.type === "dynamicCompositeTask") return task.childWorkflows;
      return [];
    },
    []
  );

  // Handle task clicks -> populate sidebar
  const handleTaskClick = useCallback(
    (task: ExtractedWorkflowStructure["tasks"][number]) => {
      dispatch({ type: "SET_SELECTED_TASK", task });
      setInspectorOpen(true);
    },
    [setInspectorOpen]
  );

  const selectedTask = navState.selectedTask ?? null;
  const childWorkflowOptions = useMemo(() => {
    return selectedTask ? getChildWorkflowsForTask(selectedTask) : [];
  }, [selectedTask, getChildWorkflowsForTask]);

  const childWorkflowSelectionCacheRef = useRef<Record<string, string>>({});

  // Fetch task inspector instances (all child workflow types for the selected task)
  const [workflowInstancesAll, setWorkflowInstancesAll] = useState<
    WorkflowInstance[] | undefined
  >();

  const shouldFetchTaskInstances =
    selectedTask &&
    (selectedTask.type === "compositeTask" ||
      selectedTask.type === "dynamicCompositeTask");

  useEffect(() => {
    if (shouldFetchTaskInstances && selectedTask) {
      onFetchChildInstances({
        taskName: selectedTask.name,
        timestamp: currentTimestamp,
      }).then(setWorkflowInstancesAll);
    } else {
      setWorkflowInstancesAll(undefined);
    }
  }, [
    shouldFetchTaskInstances,
    selectedTask?.name,
    currentTimestamp,
    onFetchChildInstances,
  ]);

  const uniqueObservedChildWorkflowNames = useMemo(() => {
    if (!workflowInstancesAll) return [];
    return Array.from(new Set(workflowInstancesAll.map((w) => w.workflowName)));
  }, [workflowInstancesAll]);

  // Auto-select the "actual" child workflow for dynamic composite tasks when unambiguous.
  useEffect(() => {
    if (!selectedTask) return;
    if (childWorkflowOptions.length === 0) return;
    if (
      selectedTask.type !== "compositeTask" &&
      selectedTask.type !== "dynamicCompositeTask"
    ) {
      return;
    }

    const isKnownChildWorkflowName = (name: string | undefined | null) => {
      if (!name) return false;
      return childWorkflowOptions.some(
        (wf: { name?: string }) => wf.name === name
      );
    };

    // Cache any explicit user selection.
    if (isKnownChildWorkflowName(navState.selectedChildWorkflowName)) {
      childWorkflowSelectionCacheRef.current[selectedTask.name] =
        navState.selectedChildWorkflowName!;
      return;
    }

    // 1) If the trace shows exactly one child workflow name for this task (up to this timestamp),
    // pick it automatically.
    const observed = uniqueObservedChildWorkflowNames.filter((name) =>
      childWorkflowOptions.some(
        (wf: { name?: string }) => wf.name === name
      )
    );
    if (observed.length === 1) {
      const resolved = observed[0]!;
      childWorkflowSelectionCacheRef.current[selectedTask.name] = resolved;
      dispatch({
        type: "SET_SELECTED_CHILD_WORKFLOW",
        workflowName: resolved,
      });
      return;
    }

    // 2) Reuse cached resolution for this task (stable across timestamps when instances are absent).
    const cached = childWorkflowSelectionCacheRef.current[selectedTask.name];
    if (isKnownChildWorkflowName(cached)) {
      dispatch({
        type: "SET_SELECTED_CHILD_WORKFLOW",
        workflowName: cached,
      });
      return;
    }

    // 3) Non-dynamic composite tasks always have exactly one child.
    if (selectedTask.type === "compositeTask" && childWorkflowOptions.length === 1) {
      const resolved = childWorkflowOptions[0]!.name;
      childWorkflowSelectionCacheRef.current[selectedTask.name] = resolved;
      dispatch({
        type: "SET_SELECTED_CHILD_WORKFLOW",
        workflowName: resolved,
      });
    }
  }, [
    selectedTask,
    childWorkflowOptions,
    navState.selectedChildWorkflowName,
    uniqueObservedChildWorkflowNames,
    dispatch,
  ]);

  const selectedChildWorkflow = useMemo(() => {
    if (!selectedTask) return null;
    if (childWorkflowOptions.length === 0) return null;
    if (!navState.selectedChildWorkflowName) {
      return childWorkflowOptions[0];
    }
    return (
      childWorkflowOptions.find(
        (wf: { name?: string }) => wf.name === navState.selectedChildWorkflowName
      ) ?? childWorkflowOptions[0]
    );
  }, [childWorkflowOptions, navState.selectedChildWorkflowName, selectedTask]);

  const workflowInstances = useMemo(() => {
    if (!workflowInstancesAll || !selectedChildWorkflow) return undefined;
    return workflowInstancesAll.filter(
      (instance) => instance.workflowName === selectedChildWorkflow.name
    );
  }, [workflowInstancesAll, selectedChildWorkflow]);

  const handleInstanceSelect = useCallback(
    (workflowId: string) => {
      if (!selectedTask || !selectedChildWorkflow) return;
      dispatch({
        type: "SELECT_INSTANCE",
        workflowId,
        taskName: selectedTask.name,
        childWorkflow: selectedChildWorkflow,
      });
    },
    [dispatch, selectedChildWorkflow, selectedTask]
  );

  const handleProceedWithoutInstance = useCallback(() => {
    if (!selectedTask || !selectedChildWorkflow) return;
    dispatch({
      type: "PROCEED_WITHOUT_INSTANCE",
      taskName: selectedTask.name,
      childWorkflow: selectedChildWorkflow,
    });
  }, [dispatch, selectedChildWorkflow, selectedTask]);

  const currentStructure = navState.history[navState.currentIndex]!;

  // Autoplay effect - dispatches TICK action when playing
  useEffect(() => {
    if (!timelineState.isPlaying) return;

    const timer = setTimeout(() => {
      dispatchTimeline({ type: "TICK" });
    }, 1000);

    return () => clearTimeout(timer);
  }, [timelineState.isPlaying, timelineState.currentEventIndex]);

  const traceMetadata = (trace?.metadata ?? {}) as Record<string, unknown>;
  const workflowName =
    typeof traceMetadata.workflowName === "string"
      ? traceMetadata.workflowName
      : structure.name;
  const workflowVersion =
    typeof traceMetadata.workflowVersionName === "string"
      ? traceMetadata.workflowVersionName
      : undefined;

  return (
    <div className="flex h-full absolute inset-0">
      {/* Left side - Spans tree */}
      <div className="w-1/3 max-w-108 border-r flex flex-col h-full">
        <div className="px-3 py-2 border-b">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="text-xs font-semibold">Execution Trace</h3>
              <code className="text-[10px] text-muted-foreground font-mono truncate">
                {workflowName}
              </code>
            </div>
            {workflowVersion && (
              <Badge
                variant="outline"
                className="text-[10px] h-4 px-1 flex-shrink-0"
              >
                v{workflowVersion}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto max-h-full pb-4">
          <SpansView
            traceId={traceId}
            trace={trace}
            rootSpans={rootSpans}
            onLoadChildren={onLoadChildren}
            currentTimestamp={currentTimestamp}
            onJumpToSpan={handleJumpToSpan}
            showRelativeTime={false}
          />
        </div>
      </div>

      {/* Right side - Workflow visualizer with controls */}
      <div className="flex-1 flex flex-col">
        <TimelineControls
          currentEventIndex={timelineState.currentEventIndex}
          totalEvents={keyEvents?.length || 0}
          isPlaying={timelineState.isPlaying}
          currentEvent={currentEvent}
          onPrev={handlePrev}
          onNext={handleNext}
          onPlayPause={handlePlayPause}
          onSliderChange={handleSliderChange}
        />

        {/* Workflow Visualization */}
        <div className="flex-1 relative">
          <div className="h-full w-full flex">
            <div className="flex-1 relative">
              <ReactFlowProvider key={`nav-${navState.navigationCounter}`}>
                <WorkflowVisualizerCore
                  structure={currentStructure.structure}
                  state={stableWorkflowState.current}
                  onTaskClick={handleTaskClick}
                  breadcrumbSlot={
                    <BreadcrumbNavigation
                      history={navState.history}
                      currentIndex={navState.currentIndex}
                      onNavigate={(index) =>
                        dispatch({ type: "BREADCRUMB_NAVIGATE", index })
                      }
                    />
                  }
                  showLayoutControls={true}
                />
              </ReactFlowProvider>
            </div>

            {/* Sidebar for task details and drilldown */}
            {isInspectorOpen ? (
              <div className="w-80 border-l bg-background/70 backdrop-blur-sm flex flex-col">
                <div className="px-3 py-2 border-b flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold">Task Inspector</h3>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setInspectorOpen(false)}
                    aria-label="Hide task inspector"
                  >
                    <ChevronRight className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                  {!selectedTask && (
                    <p className="text-[10px] text-muted-foreground">
                      Click a task to view details.
                    </p>
                  )}
                  {selectedTask && (
                    <div className="space-y-2">
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
                          Task
                        </div>
                        <div className="text-xs font-medium">
                          {selectedTask.name}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {selectedTask.type} • {selectedTask.splitType}/
                          {selectedTask.joinType}
                        </div>
                        {selectedTask.description && (
                          <div className="text-[10px] text-muted-foreground">
                            {selectedTask.description}
                          </div>
                        )}
                        {selectedTask.type === "task" &&
                          selectedTask.workItem && (
                            <div className="mt-1.5 pt-1.5 border-t space-y-0.5">
                              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
                                Work item
                              </div>
                              <div className="text-xs font-medium">
                                {selectedTask.workItem.name}
                              </div>
                              {selectedTask.workItem.description && (
                                <div className="text-[10px] text-muted-foreground">
                                  {selectedTask.workItem.description}
                                </div>
                              )}
                            </div>
                          )}
                        {stableWorkflowState.current?.tasks &&
                          stableWorkflowState.current.tasks[
                            selectedTask.name
                          ] && (
                            <Badge
                              variant="outline"
                              className="text-[10px] h-4 px-1 mt-1"
                            >
                              {
                                stableWorkflowState.current.tasks[
                                  selectedTask.name
                                ]!.state
                              }
                            </Badge>
                          )}
                      </div>

                      {(selectedTask.type === "compositeTask" ||
                        selectedTask.type === "dynamicCompositeTask") && (
                        <div className="space-y-1.5 pt-1.5 border-t">
                          <div className="space-y-0.5">
                            <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
                              Child workflow
                            </div>
                            {childWorkflowOptions.length > 1 && (
                              <select
                                className="w-full border rounded px-1.5 py-0.5 text-xs"
                                value={
                                  navState.selectedChildWorkflowName ??
                                  childWorkflowOptions[0]?.name
                                }
                                onChange={(e) =>
                                  dispatch({
                                    type: "SET_SELECTED_CHILD_WORKFLOW",
                                    workflowName: e.target.value,
                                  })
                                }
                              >
                    {childWorkflowOptions.map((wf: { name?: string }) => (
                                  <option key={wf.name} value={wf.name}>
                                    {wf.name}
                                  </option>
                                ))}
                              </select>
                            )}
                            {childWorkflowOptions.length === 1 && (
                              <div className="text-xs font-mono">
                                {childWorkflowOptions[0]?.name}
                              </div>
                            )}
                          </div>

                          <div className="text-[10px] uppercase text-muted-foreground tracking-wider">
                            Instances
                          </div>
                          {workflowInstances === undefined ? (
                            <div className="text-[10px] text-muted-foreground">
                              Loading...
                            </div>
                          ) : workflowInstances.length === 0 ? (
                            <div className="text-[10px] text-muted-foreground">
                              No instances yet at this timestamp.
                            </div>
                          ) : (
                            <div className="space-y-1">
                              {workflowInstances.map((instance) => (
                                <div
                                  key={instance.workflowId}
                                  className="border rounded px-1.5 py-1 text-[10px] flex items-center justify-between gap-2"
                                >
                                  <div className="min-w-0">
                                    <div className="font-medium truncate">
                                      {instance.workflowName}
                                    </div>
                                    <div className="text-muted-foreground font-mono">
                                      {instance.state} • Gen{" "}
                                      {instance.generation}
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-5 px-1.5 text-[10px]"
                                    onClick={() =>
                                      handleInstanceSelect(instance.workflowId)
                                    }
                                  >
                                    Open
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}

                          <Button
                            size="sm"
                            variant="default"
                            className="h-6 text-xs w-full"
                            disabled={!selectedChildWorkflow}
                            onClick={() => handleProceedWithoutInstance()}
                          >
                            View structure
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="w-8 border-l bg-background/70 backdrop-blur-sm flex items-start justify-center pt-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setInspectorOpen(true)}
                  aria-label="Show task inspector"
                >
                  <ChevronLeft className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
