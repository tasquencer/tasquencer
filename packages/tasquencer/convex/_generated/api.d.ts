/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as components_audit_src_client_buffer from "../components/audit/src/client/buffer.js";
import type * as components_audit_src_client_helpers from "../components/audit/src/client/helpers.js";
import type * as components_audit_src_client_service from "../components/audit/src/client/service.js";
import type * as components_audit_src_shared_attributeSchemas from "../components/audit/src/shared/attributeSchemas.js";
import type * as components_audit_src_shared_context from "../components/audit/src/shared/context.js";
import type * as components_authorization_src_client_builders from "../components/authorization/src/client/builders.js";
import type * as components_authorization_src_client_helpers from "../components/authorization/src/client/helpers.js";
import type * as components_authorization_src_client_scopes from "../components/authorization/src/client/scopes.js";
import type * as components_authorization_src_client_service from "../components/authorization/src/client/service.js";
import type * as components_authorization_src_client_service_authorizedWorkItemActions from "../components/authorization/src/client/service/authorizedWorkItemActions.js";
import type * as components_authorization_src_client_service_authorizedWorkflowActions from "../components/authorization/src/client/service/authorizedWorkflowActions.js";
import type * as components_authorization_src_client_service_policy from "../components/authorization/src/client/service/policy.js";
import type * as components_authorization_src_client_userProvider from "../components/authorization/src/client/userProvider.js";
import type * as lib_metadataHelpers from "../lib/metadataHelpers.js";
import type * as tasquencer___tests___helpers_versionManager from "../tasquencer/__tests__/helpers/versionManager.js";
import type * as tasquencer_audit_integration from "../tasquencer/audit/integration.js";
import type * as tasquencer_builder from "../tasquencer/builder.js";
import type * as tasquencer_builder_cancellationRegion from "../tasquencer/builder/cancellationRegion.js";
import type * as tasquencer_builder_compositeTask from "../tasquencer/builder/compositeTask.js";
import type * as tasquencer_builder_dummyTask from "../tasquencer/builder/dummyTask.js";
import type * as tasquencer_builder_dynamicCompositeTask from "../tasquencer/builder/dynamicCompositeTask.js";
import type * as tasquencer_builder_flow from "../tasquencer/builder/flow.js";
import type * as tasquencer_builder_task from "../tasquencer/builder/task.js";
import type * as tasquencer_builder_types from "../tasquencer/builder/types.js";
import type * as tasquencer_builder_workItem from "../tasquencer/builder/workItem.js";
import type * as tasquencer_builder_workItem_actions from "../tasquencer/builder/workItem/actions.js";
import type * as tasquencer_builder_workflow from "../tasquencer/builder/workflow.js";
import type * as tasquencer_builder_workflow_actions from "../tasquencer/builder/workflow/actions.js";
import type * as tasquencer_elements_baseTask from "../tasquencer/elements/baseTask.js";
import type * as tasquencer_elements_compositeTask from "../tasquencer/elements/compositeTask.js";
import type * as tasquencer_elements_condition from "../tasquencer/elements/condition.js";
import type * as tasquencer_elements_dummyTask from "../tasquencer/elements/dummyTask.js";
import type * as tasquencer_elements_dynamicCompositeTask from "../tasquencer/elements/dynamicCompositeTask.js";
import type * as tasquencer_elements_executionContext from "../tasquencer/elements/executionContext.js";
import type * as tasquencer_elements_flow from "../tasquencer/elements/flow.js";
import type * as tasquencer_elements_helpers_auditHelpers from "../tasquencer/elements/helpers/auditHelpers.js";
import type * as tasquencer_elements_helpers_nonFinalizedHelpers from "../tasquencer/elements/helpers/nonFinalizedHelpers.js";
import type * as tasquencer_elements_helpers_schedulerHelpers from "../tasquencer/elements/helpers/schedulerHelpers.js";
import type * as tasquencer_elements_marking from "../tasquencer/elements/marking.js";
import type * as tasquencer_elements_task from "../tasquencer/elements/task.js";
import type * as tasquencer_elements_workItem from "../tasquencer/elements/workItem.js";
import type * as tasquencer_elements_workflow from "../tasquencer/elements/workflow.js";
import type * as tasquencer_exceptions_base from "../tasquencer/exceptions/base.js";
import type * as tasquencer_exceptions_condition from "../tasquencer/exceptions/condition.js";
import type * as tasquencer_exceptions_helpers from "../tasquencer/exceptions/helpers.js";
import type * as tasquencer_exceptions_index from "../tasquencer/exceptions/index.js";
import type * as tasquencer_exceptions_path from "../tasquencer/exceptions/path.js";
import type * as tasquencer_exceptions_task from "../tasquencer/exceptions/task.js";
import type * as tasquencer_exceptions_workItem from "../tasquencer/exceptions/workItem.js";
import type * as tasquencer_exceptions_workflow from "../tasquencer/exceptions/workflow.js";
import type * as tasquencer_index from "../tasquencer/index.js";
import type * as tasquencer_lib_e2wfojnet from "../tasquencer/lib/e2wfojnet.js";
import type * as tasquencer_types from "../tasquencer/types.js";
import type * as tasquencer_util_apiFacade from "../tasquencer/util/apiFacade.js";
import type * as tasquencer_util_apiImpl from "../tasquencer/util/apiImpl.js";
import type * as tasquencer_util_attributeHelpers from "../tasquencer/util/attributeHelpers.js";
import type * as tasquencer_util_attributeTypeGuards from "../tasquencer/util/attributeTypeGuards.js";
import type * as tasquencer_util_extractWorkflowStructure from "../tasquencer/util/extractWorkflowStructure.js";
import type * as tasquencer_util_helpers from "../tasquencer/util/helpers.js";
import type * as tasquencer_util_scheduler from "../tasquencer/util/scheduler.js";
import type * as tasquencer_util_statsShards from "../tasquencer/util/statsShards.js";
import type * as tasquencer_util_workflowHelpers from "../tasquencer/util/workflowHelpers.js";
import type * as tasquencer_versionManager from "../tasquencer/versionManager.js";
import type * as tasquencer_versionManager_migration from "../tasquencer/versionManager/migration.js";
import type * as testing_tasquencer from "../testing/tasquencer.js";
import type * as workflows_validator_api from "../workflows/validator/api.js";
import type * as workflows_validator_definition from "../workflows/validator/definition.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "components/audit/src/client/buffer": typeof components_audit_src_client_buffer;
  "components/audit/src/client/helpers": typeof components_audit_src_client_helpers;
  "components/audit/src/client/service": typeof components_audit_src_client_service;
  "components/audit/src/shared/attributeSchemas": typeof components_audit_src_shared_attributeSchemas;
  "components/audit/src/shared/context": typeof components_audit_src_shared_context;
  "components/authorization/src/client/builders": typeof components_authorization_src_client_builders;
  "components/authorization/src/client/helpers": typeof components_authorization_src_client_helpers;
  "components/authorization/src/client/scopes": typeof components_authorization_src_client_scopes;
  "components/authorization/src/client/service": typeof components_authorization_src_client_service;
  "components/authorization/src/client/service/authorizedWorkItemActions": typeof components_authorization_src_client_service_authorizedWorkItemActions;
  "components/authorization/src/client/service/authorizedWorkflowActions": typeof components_authorization_src_client_service_authorizedWorkflowActions;
  "components/authorization/src/client/service/policy": typeof components_authorization_src_client_service_policy;
  "components/authorization/src/client/userProvider": typeof components_authorization_src_client_userProvider;
  "lib/metadataHelpers": typeof lib_metadataHelpers;
  "tasquencer/__tests__/helpers/versionManager": typeof tasquencer___tests___helpers_versionManager;
  "tasquencer/audit/integration": typeof tasquencer_audit_integration;
  "tasquencer/builder": typeof tasquencer_builder;
  "tasquencer/builder/cancellationRegion": typeof tasquencer_builder_cancellationRegion;
  "tasquencer/builder/compositeTask": typeof tasquencer_builder_compositeTask;
  "tasquencer/builder/dummyTask": typeof tasquencer_builder_dummyTask;
  "tasquencer/builder/dynamicCompositeTask": typeof tasquencer_builder_dynamicCompositeTask;
  "tasquencer/builder/flow": typeof tasquencer_builder_flow;
  "tasquencer/builder/task": typeof tasquencer_builder_task;
  "tasquencer/builder/types": typeof tasquencer_builder_types;
  "tasquencer/builder/workItem": typeof tasquencer_builder_workItem;
  "tasquencer/builder/workItem/actions": typeof tasquencer_builder_workItem_actions;
  "tasquencer/builder/workflow": typeof tasquencer_builder_workflow;
  "tasquencer/builder/workflow/actions": typeof tasquencer_builder_workflow_actions;
  "tasquencer/elements/baseTask": typeof tasquencer_elements_baseTask;
  "tasquencer/elements/compositeTask": typeof tasquencer_elements_compositeTask;
  "tasquencer/elements/condition": typeof tasquencer_elements_condition;
  "tasquencer/elements/dummyTask": typeof tasquencer_elements_dummyTask;
  "tasquencer/elements/dynamicCompositeTask": typeof tasquencer_elements_dynamicCompositeTask;
  "tasquencer/elements/executionContext": typeof tasquencer_elements_executionContext;
  "tasquencer/elements/flow": typeof tasquencer_elements_flow;
  "tasquencer/elements/helpers/auditHelpers": typeof tasquencer_elements_helpers_auditHelpers;
  "tasquencer/elements/helpers/nonFinalizedHelpers": typeof tasquencer_elements_helpers_nonFinalizedHelpers;
  "tasquencer/elements/helpers/schedulerHelpers": typeof tasquencer_elements_helpers_schedulerHelpers;
  "tasquencer/elements/marking": typeof tasquencer_elements_marking;
  "tasquencer/elements/task": typeof tasquencer_elements_task;
  "tasquencer/elements/workItem": typeof tasquencer_elements_workItem;
  "tasquencer/elements/workflow": typeof tasquencer_elements_workflow;
  "tasquencer/exceptions/base": typeof tasquencer_exceptions_base;
  "tasquencer/exceptions/condition": typeof tasquencer_exceptions_condition;
  "tasquencer/exceptions/helpers": typeof tasquencer_exceptions_helpers;
  "tasquencer/exceptions/index": typeof tasquencer_exceptions_index;
  "tasquencer/exceptions/path": typeof tasquencer_exceptions_path;
  "tasquencer/exceptions/task": typeof tasquencer_exceptions_task;
  "tasquencer/exceptions/workItem": typeof tasquencer_exceptions_workItem;
  "tasquencer/exceptions/workflow": typeof tasquencer_exceptions_workflow;
  "tasquencer/index": typeof tasquencer_index;
  "tasquencer/lib/e2wfojnet": typeof tasquencer_lib_e2wfojnet;
  "tasquencer/types": typeof tasquencer_types;
  "tasquencer/util/apiFacade": typeof tasquencer_util_apiFacade;
  "tasquencer/util/apiImpl": typeof tasquencer_util_apiImpl;
  "tasquencer/util/attributeHelpers": typeof tasquencer_util_attributeHelpers;
  "tasquencer/util/attributeTypeGuards": typeof tasquencer_util_attributeTypeGuards;
  "tasquencer/util/extractWorkflowStructure": typeof tasquencer_util_extractWorkflowStructure;
  "tasquencer/util/helpers": typeof tasquencer_util_helpers;
  "tasquencer/util/scheduler": typeof tasquencer_util_scheduler;
  "tasquencer/util/statsShards": typeof tasquencer_util_statsShards;
  "tasquencer/util/workflowHelpers": typeof tasquencer_util_workflowHelpers;
  "tasquencer/versionManager": typeof tasquencer_versionManager;
  "tasquencer/versionManager/migration": typeof tasquencer_versionManager_migration;
  "testing/tasquencer": typeof testing_tasquencer;
  "workflows/validator/api": typeof workflows_validator_api;
  "workflows/validator/definition": typeof workflows_validator_definition;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  tasquencerAudit: {
    api: {
      computeWorkflowSnapshot: FunctionReference<
        "mutation",
        "internal",
        { retryCount?: number; timestamp: number; traceId: string },
        null
      >;
      flushTracePayload: FunctionReference<
        "mutation",
        "internal",
        { spans: Array<any>; trace?: any },
        null
      >;
      getAuditContext: FunctionReference<
        "query",
        "internal",
        { workflowId: string },
        {
          _creationTime: number;
          _id: string;
          context: any;
          createdAt: number;
          traceId: string;
          traceMetadata?: any;
          workflowId: string;
        } | null
      >;
      getChildSpans: FunctionReference<
        "query",
        "internal",
        { parentSpanId: string; traceId: string },
        Array<{
          _creationTime: number;
          _id: string;
          attributes?:
            | {
                parent?: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workflow";
                versionName: string;
                workflowId?: string;
                workflowName: string;
              }
            | {
                generation: number;
                inputConditions?: Array<{ marking: number; name: string }>;
                joinSatisfied?: boolean;
                joinType?: string;
                outputConditions?: Array<string>;
                splitType?: string;
                state?: string;
                type: "task";
                versionName: string;
                workflowId: string;
              }
            | {
                delta: number;
                newMarking: number;
                oldMarking: number;
                operation: "incrementMarking" | "decrementMarking";
                type: "condition";
                workflowId: string;
              }
            | {
                parent: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workItem";
                versionName: string;
                workflowId: string;
              }
            | {
                activityName: string;
                data?: any;
                type: "activity";
                workflowId: string;
              }
            | { payload: any; type: "custom" };
          causationId?: string;
          depth: number;
          duration?: number;
          endedAt?: number;
          error?: any;
          events?: any;
          operation: string;
          operationType: string;
          parentSpanId?: string;
          path: Array<string>;
          resourceId?: string;
          resourceName?: string;
          resourceType?: string;
          sequenceNumber?: number;
          spanId: string;
          startedAt: number;
          state: "started" | "completed" | "failed" | "canceled";
          traceId: string;
        }>
      >;
      getChildWorkflowInstances: FunctionReference<
        "query",
        "internal",
        {
          taskName: string;
          timestamp: number;
          traceId: string;
          workflowName?: string;
        },
        Array<{
          endedAt?: number;
          generation: number;
          startedAt: number;
          state: string;
          workflowId: string;
          workflowName: string;
        }>
      >;
      getKeyEvents: FunctionReference<
        "query",
        "internal",
        { traceId: string },
        Array<{
          category: "workflow" | "task" | "condition" | "workItem" | "error";
          depth: number;
          description: string;
          spanId: string;
          timestamp: number;
          type: string;
          workflowName?: string;
        }>
      >;
      getRootSpans: FunctionReference<
        "query",
        "internal",
        { traceId: string },
        Array<{
          _creationTime: number;
          _id: string;
          attributes?:
            | {
                parent?: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workflow";
                versionName: string;
                workflowId?: string;
                workflowName: string;
              }
            | {
                generation: number;
                inputConditions?: Array<{ marking: number; name: string }>;
                joinSatisfied?: boolean;
                joinType?: string;
                outputConditions?: Array<string>;
                splitType?: string;
                state?: string;
                type: "task";
                versionName: string;
                workflowId: string;
              }
            | {
                delta: number;
                newMarking: number;
                oldMarking: number;
                operation: "incrementMarking" | "decrementMarking";
                type: "condition";
                workflowId: string;
              }
            | {
                parent: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workItem";
                versionName: string;
                workflowId: string;
              }
            | {
                activityName: string;
                data?: any;
                type: "activity";
                workflowId: string;
              }
            | { payload: any; type: "custom" };
          causationId?: string;
          depth: number;
          duration?: number;
          endedAt?: number;
          error?: any;
          events?: any;
          operation: string;
          operationType: string;
          parentSpanId?: string;
          path: Array<string>;
          resourceId?: string;
          resourceName?: string;
          resourceType?: string;
          sequenceNumber?: number;
          spanId: string;
          startedAt: number;
          state: "started" | "completed" | "failed" | "canceled";
          traceId: string;
        }>
      >;
      getSpansByResource: FunctionReference<
        "query",
        "internal",
        { resourceId: string; resourceType: string },
        Array<{
          _creationTime: number;
          _id: string;
          attributes?:
            | {
                parent?: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workflow";
                versionName: string;
                workflowId?: string;
                workflowName: string;
              }
            | {
                generation: number;
                inputConditions?: Array<{ marking: number; name: string }>;
                joinSatisfied?: boolean;
                joinType?: string;
                outputConditions?: Array<string>;
                splitType?: string;
                state?: string;
                type: "task";
                versionName: string;
                workflowId: string;
              }
            | {
                delta: number;
                newMarking: number;
                oldMarking: number;
                operation: "incrementMarking" | "decrementMarking";
                type: "condition";
                workflowId: string;
              }
            | {
                parent: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workItem";
                versionName: string;
                workflowId: string;
              }
            | {
                activityName: string;
                data?: any;
                type: "activity";
                workflowId: string;
              }
            | { payload: any; type: "custom" };
          causationId?: string;
          depth: number;
          duration?: number;
          endedAt?: number;
          error?: any;
          events?: any;
          operation: string;
          operationType: string;
          parentSpanId?: string;
          path: Array<string>;
          resourceId?: string;
          resourceName?: string;
          resourceType?: string;
          sequenceNumber?: number;
          spanId: string;
          startedAt: number;
          state: "started" | "completed" | "failed" | "canceled";
          traceId: string;
        }>
      >;
      getSpansByTimeRange: FunctionReference<
        "query",
        "internal",
        { endTime: number; startTime: number; traceId: string },
        Array<{
          _creationTime: number;
          _id: string;
          attributes?:
            | {
                parent?: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workflow";
                versionName: string;
                workflowId?: string;
                workflowName: string;
              }
            | {
                generation: number;
                inputConditions?: Array<{ marking: number; name: string }>;
                joinSatisfied?: boolean;
                joinType?: string;
                outputConditions?: Array<string>;
                splitType?: string;
                state?: string;
                type: "task";
                versionName: string;
                workflowId: string;
              }
            | {
                delta: number;
                newMarking: number;
                oldMarking: number;
                operation: "incrementMarking" | "decrementMarking";
                type: "condition";
                workflowId: string;
              }
            | {
                parent: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workItem";
                versionName: string;
                workflowId: string;
              }
            | {
                activityName: string;
                data?: any;
                type: "activity";
                workflowId: string;
              }
            | { payload: any; type: "custom" };
          causationId?: string;
          depth: number;
          duration?: number;
          endedAt?: number;
          error?: any;
          events?: any;
          operation: string;
          operationType: string;
          parentSpanId?: string;
          path: Array<string>;
          resourceId?: string;
          resourceName?: string;
          resourceType?: string;
          sequenceNumber?: number;
          spanId: string;
          startedAt: number;
          state: "started" | "completed" | "failed" | "canceled";
          traceId: string;
        }>
      >;
      getTrace: FunctionReference<
        "query",
        "internal",
        { traceId: string },
        {
          _creationTime: number;
          _id: string;
          attributes?:
            | {
                payload?: any;
                type: "workflow";
                versionName: string;
                workflowId: string;
                workflowName: string;
              }
            | { payload?: any; type: "custom" };
          correlationId?: string;
          endedAt?: number;
          initiatorType?: "user" | "system" | "scheduled";
          initiatorUserId?: string;
          metadata?: any;
          name: string;
          startedAt: number;
          state: "running" | "completed" | "failed" | "canceled";
          traceId: string;
        } | null
      >;
      getTraceSpans: FunctionReference<
        "query",
        "internal",
        { traceId: string },
        Array<{
          _creationTime: number;
          _id: string;
          attributes?:
            | {
                parent?: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workflow";
                versionName: string;
                workflowId?: string;
                workflowName: string;
              }
            | {
                generation: number;
                inputConditions?: Array<{ marking: number; name: string }>;
                joinSatisfied?: boolean;
                joinType?: string;
                outputConditions?: Array<string>;
                splitType?: string;
                state?: string;
                type: "task";
                versionName: string;
                workflowId: string;
              }
            | {
                delta: number;
                newMarking: number;
                oldMarking: number;
                operation: "incrementMarking" | "decrementMarking";
                type: "condition";
                workflowId: string;
              }
            | {
                parent: {
                  taskGeneration: number;
                  taskName: string;
                  workflowId: string;
                };
                payload?: any;
                state?: string;
                type: "workItem";
                versionName: string;
                workflowId: string;
              }
            | {
                activityName: string;
                data?: any;
                type: "activity";
                workflowId: string;
              }
            | { payload: any; type: "custom" };
          causationId?: string;
          depth: number;
          duration?: number;
          endedAt?: number;
          error?: any;
          events?: any;
          operation: string;
          operationType: string;
          parentSpanId?: string;
          path: Array<string>;
          resourceId?: string;
          resourceName?: string;
          resourceType?: string;
          sequenceNumber?: number;
          spanId: string;
          startedAt: number;
          state: "started" | "completed" | "failed" | "canceled";
          traceId: string;
        }>
      >;
      getWorkflowSnapshots: FunctionReference<
        "query",
        "internal",
        { traceId: string },
        Array<{
          _creationTime: number;
          _id: string;
          sequenceNumber: number;
          state: any;
          timestamp: number;
          traceId: string;
          workflowId: string;
        }>
      >;
      getWorkflowStateAtTime: FunctionReference<
        "query",
        "internal",
        { timestamp: number; traceId: string; workflowId?: string },
        {
          conditions: Record<
            string,
            { lastChangedAt: number; marking: number; name: string }
          >;
          sequenceNumber: number;
          tasks: Record<
            string,
            {
              generation: number;
              lastChangedAt: number;
              name: string;
              state:
                | "disabled"
                | "enabled"
                | "started"
                | "completed"
                | "failed"
                | "canceled";
            }
          >;
          timestamp: number;
          workItems: Record<
            string,
            {
              id: string;
              lastChangedAt: number;
              name: string;
              state:
                | "initialized"
                | "started"
                | "completed"
                | "failed"
                | "canceled";
              taskName: string;
            }
          >;
          workflow: {
            name: string;
            state:
              | "initialized"
              | "started"
              | "completed"
              | "failed"
              | "canceled";
          };
        } | null
      >;
      listRecentTraces: FunctionReference<
        "query",
        "internal",
        { limit?: number },
        Array<{
          _creationTime: number;
          _id: string;
          attributes?:
            | {
                payload?: any;
                type: "workflow";
                versionName: string;
                workflowId: string;
                workflowName: string;
              }
            | { payload?: any; type: "custom" };
          correlationId?: string;
          endedAt?: number;
          initiatorType?: "user" | "system" | "scheduled";
          initiatorUserId?: string;
          metadata?: any;
          name: string;
          startedAt: number;
          state: "running" | "completed" | "failed" | "canceled";
          traceId: string;
        }>
      >;
      removeAuditContext: FunctionReference<
        "mutation",
        "internal",
        { workflowId: string },
        null
      >;
      saveAuditContext: FunctionReference<
        "mutation",
        "internal",
        {
          data: {
            context: {
              causationId?: string;
              correlationId?: string;
              depth: number;
              parentSpanId?: string;
              path: Array<string>;
              traceId: string;
            };
            traceId: string;
            traceMetadata?: any;
          };
          workflowId: string;
        },
        null
      >;
    };
  };
  tasquencerAuthorization: {
    api: {
      addUserToAuthGroup: FunctionReference<
        "mutation",
        "internal",
        { expiresAt?: number; groupId: string; userId: string },
        string
      >;
      assignAuthRoleToGroup: FunctionReference<
        "mutation",
        "internal",
        { assignedBy?: string; groupId: string; roleId: string },
        string
      >;
      assignAuthRoleToUser: FunctionReference<
        "mutation",
        "internal",
        {
          assignedBy?: string;
          expiresAt?: number;
          roleId: string;
          userId: string;
        },
        string
      >;
      createAuthGroup: FunctionReference<
        "mutation",
        "internal",
        { description: string; metadata?: any; name: string },
        string
      >;
      createAuthRole: FunctionReference<
        "mutation",
        "internal",
        {
          description: string;
          metadata?: any;
          name: string;
          scopes: Array<string>;
        },
        string
      >;
      deleteAuthGroup: FunctionReference<
        "mutation",
        "internal",
        { groupId: string },
        null
      >;
      deleteAuthRole: FunctionReference<
        "mutation",
        "internal",
        { roleId: string },
        null
      >;
      getAuthGroup: FunctionReference<
        "query",
        "internal",
        { groupId: string },
        {
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
        } | null
      >;
      getAuthGroupByName: FunctionReference<
        "query",
        "internal",
        { name: string },
        {
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
        } | null
      >;
      getAuthGroupMemberCount: FunctionReference<
        "query",
        "internal",
        { groupId: string },
        number
      >;
      getAuthGroupRoles: FunctionReference<
        "query",
        "internal",
        { groupId: string },
        Array<{
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
          scopes: Array<string>;
        }>
      >;
      getAuthRole: FunctionReference<
        "query",
        "internal",
        { roleId: string },
        {
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
          scopes: Array<string>;
        } | null
      >;
      getAuthRoleByName: FunctionReference<
        "query",
        "internal",
        { name: string },
        {
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
          scopes: Array<string>;
        } | null
      >;
      getGroupByName: FunctionReference<
        "query",
        "internal",
        { name: string },
        {
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
        } | null
      >;
      getGroupMembers: FunctionReference<
        "query",
        "internal",
        { groupId: string },
        Array<string>
      >;
      getRoleByName: FunctionReference<
        "query",
        "internal",
        { name: string },
        {
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
          scopes: Array<string>;
        } | null
      >;
      getRoleScopes: FunctionReference<
        "query",
        "internal",
        { roleId: string },
        Array<string>
      >;
      getUserAuthGroupMemberships: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          expiresAt?: number;
          groupId: string;
          joinedAt: number;
          userId: string;
        }>
      >;
      getUserAuthGroups: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
        }>
      >;
      getUserAuthRoleAssignments: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          assignedAt: number;
          assignedBy?: string;
          expiresAt?: number;
          roleId: string;
          userId: string;
        }>
      >;
      getUserAuthRoles: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<{
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
          scopes: Array<string>;
        }>
      >;
      getUserScopes: FunctionReference<
        "query",
        "internal",
        { userId: string },
        Array<string>
      >;
      getUsersWithScope: FunctionReference<
        "query",
        "internal",
        { scope: string },
        Array<string>
      >;
      insertAuthGroupRoleAssignments: FunctionReference<
        "mutation",
        "internal",
        {
          assignments: Array<{
            assignedAt: number;
            assignedBy?: string;
            groupId: string;
            roleId: string;
          }>;
        },
        Array<string>
      >;
      insertAuthGroups: FunctionReference<
        "mutation",
        "internal",
        {
          groups: Array<{
            description: string;
            isActive: boolean;
            name: string;
          }>;
        },
        Array<string>
      >;
      insertAuthRoles: FunctionReference<
        "mutation",
        "internal",
        {
          roles: Array<{
            description: string;
            isActive: boolean;
            name: string;
            scopes: Array<string>;
          }>;
        },
        Array<string>
      >;
      listAuthGroupRoleAssignments: FunctionReference<
        "query",
        "internal",
        any,
        Array<{
          _creationTime: number;
          _id: string;
          assignedAt: number;
          assignedBy?: string;
          groupId: string;
          roleId: string;
        }>
      >;
      listAuthGroups: FunctionReference<
        "query",
        "internal",
        { isActive?: boolean },
        Array<{
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
        }>
      >;
      listAuthRoles: FunctionReference<
        "query",
        "internal",
        { isActive?: boolean },
        Array<{
          _creationTime: number;
          _id: string;
          description: string;
          isActive: boolean;
          metadata?: any;
          name: string;
          scopes: Array<string>;
        }>
      >;
      removeAuthRoleFromGroup: FunctionReference<
        "mutation",
        "internal",
        { groupId: string; roleId: string },
        null
      >;
      removeAuthRoleFromUser: FunctionReference<
        "mutation",
        "internal",
        { roleId: string; userId: string },
        null
      >;
      removeUserFromAuthGroup: FunctionReference<
        "mutation",
        "internal",
        { groupId: string; userId: string },
        null
      >;
      updateAuthGroup: FunctionReference<
        "mutation",
        "internal",
        {
          description?: string;
          groupId: string;
          isActive?: boolean;
          metadata?: any;
          name?: string;
        },
        null
      >;
      updateAuthRole: FunctionReference<
        "mutation",
        "internal",
        {
          description?: string;
          isActive?: boolean;
          metadata?: any;
          name?: string;
          roleId: string;
          scopes?: Array<string>;
        },
        null
      >;
      updateUserAuthGroupMemberships: FunctionReference<
        "mutation",
        "internal",
        { groupIds: Array<string>; userId: string },
        null
      >;
      updateUserAuthRoleAssignments: FunctionReference<
        "mutation",
        "internal",
        { roleIds: Array<string>; userId: string },
        null
      >;
      userInGroup: FunctionReference<
        "query",
        "internal",
        { groupId: string; userId: string },
        boolean
      >;
    };
  };
};
