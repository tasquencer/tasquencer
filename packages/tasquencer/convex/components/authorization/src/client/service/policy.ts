import type { GenericMutationCtx } from "convex/server";
import type { WorkflowActionContext } from "../../../../../tasquencer/builder/workflow/actions";
import type { WorkItemActionContext } from "../../../../../tasquencer/builder/workItem/actions";
import { userHasScope } from "../helpers";
import type {
  AnyAuthorizationUserProvider,
  GetAuthorizationUserProviderUser,
} from "../userProvider";
import type { AnyAuthorizationService } from "../service";

export const PolicyResult = {
  ALLOW: "allow",
  DENY: "deny",
} as const;

export type PolicyResult = (typeof PolicyResult)[keyof typeof PolicyResult];

export type AuthorizationContext<
  TAuthUserProvider extends AnyAuthorizationUserProvider,
  TScope extends string,
  TIsUserOptional extends boolean = false,
> = {
  authorization: {
    scope: <TPolicyScope extends TScope>(scope: TPolicyScope) => TPolicyScope;
    user: TIsUserOptional extends true
      ? GetAuthorizationUserProviderUser<TAuthUserProvider> | null
      : NonNullable<GetAuthorizationUserProviderUser<TAuthUserProvider>>;
  };
};

export type WorkItemPolicyContext<
  TAuthUserProvider extends AnyAuthorizationUserProvider,
  TScope extends string,
  TWorkItemPayload,
> = WorkItemActionContext<GenericMutationCtx<any>, TWorkItemPayload> &
  AuthorizationContext<TAuthUserProvider, TScope>;

export type WorkItemPolicy<
  TAuthUserProvider extends AnyAuthorizationUserProvider,
  TScope extends string = never,
  TWorkItemPayload = any,
> = (
  ctx: WorkItemPolicyContext<TAuthUserProvider, TScope, TWorkItemPayload>,
  payload: TWorkItemPayload
) => Promise<PolicyResult>;

export type WorkflowPolicyContext<
  TAuthUserProvider extends AnyAuthorizationUserProvider,
  TScope extends string,
  TWorkflowPayload,
> = WorkflowActionContext<GenericMutationCtx<any>, TWorkflowPayload> &
  AuthorizationContext<TAuthUserProvider, TScope>;

export type WorkflowPolicy<
  TAuthUserProvider extends AnyAuthorizationUserProvider,
  TScope extends string = never,
  TWorkflowPayload = any,
> = (
  ctx: WorkflowPolicyContext<TAuthUserProvider, TScope, TWorkflowPayload>,
  payload: TWorkflowPayload
) => Promise<PolicyResult>;

export class PolicyException extends Error {
  constructor(
    readonly message: string,
    readonly result: PolicyResult
  ) {
    super(`Authorization policy violation: ${message}`);
  }
}

export function assertAuthorized(policyResult: PolicyResult) {
  if (policyResult === PolicyResult.DENY) {
    throw new PolicyException("Unauthorized", policyResult);
  }
}

export function makePolicyHelpers<
  TAuthUserProvider extends AnyAuthorizationUserProvider,
  TScope extends string = never,
>(authorizationService: AnyAuthorizationService) {
  /**
   * Policy helper: Check if user has a specific scope
   */
  const requireScope =
    (scope: TScope) =>
    async ({
      mutationCtx,
      authorization,
    }:
      | WorkItemPolicyContext<TAuthUserProvider, TScope, any>
      | WorkflowPolicyContext<TAuthUserProvider, TScope, any>) => {
      const user = authorization.user;
      if (!user || !user.userId) {
        return PolicyResult.DENY;
      }

      const hasScope = await userHasScope(
        mutationCtx,
        authorizationService.componentApi,
        user.userId,
        scope
      );
      return hasScope ? PolicyResult.ALLOW : PolicyResult.DENY;
    };

  /**
   * Policy helper: Check if user has at least one of the specified scopes
   */
  const requireAnyScope =
    (scopes: TScope[]) =>
    async ({
      mutationCtx,
      authorization,
    }:
      | WorkItemPolicyContext<TAuthUserProvider, TScope, any>
      | WorkflowPolicyContext<TAuthUserProvider, TScope, any>) => {
      const user = authorization.user;

      if (!user || !user.userId) {
        return PolicyResult.DENY;
      }
      const scopeChecks = await Promise.all(
        scopes.map((scope) =>
          userHasScope(
            mutationCtx,
            authorizationService.componentApi,
            user.userId,
            scope
          )
        )
      );

      return scopeChecks.some((hasScope) => hasScope)
        ? PolicyResult.ALLOW
        : PolicyResult.DENY;
    };

  /**
   * Policy helper: Check if user has all of the specified scopes
   */
  const requireAllScopes =
    (scopes: TScope[]) =>
    async ({
      mutationCtx,
      authorization,
    }:
      | WorkItemPolicyContext<TAuthUserProvider, TScope, any>
      | WorkflowPolicyContext<TAuthUserProvider, TScope, any>) => {
      const user = authorization.user;

      if (!user || !user.userId) {
        return PolicyResult.DENY;
      }

      const scopeChecks = await Promise.all(
        scopes.map((scope) =>
          userHasScope(
            mutationCtx,
            authorizationService.componentApi,
            user.userId,
            scope
          )
        )
      );

      return scopeChecks.every((hasScope) => hasScope)
        ? PolicyResult.ALLOW
        : PolicyResult.DENY;
    };

  /**
   * Policy helper: Combine multiple policies with OR logic
   */
  const anyPolicy =
    (
      ...policies: ((
        ctx:
          | WorkItemPolicyContext<TAuthUserProvider, TScope, any>
          | WorkflowPolicyContext<TAuthUserProvider, TScope, any>
      ) => Promise<PolicyResult>)[]
    ) =>
    async (
      ctx:
        | WorkItemPolicyContext<TAuthUserProvider, TScope, any>
        | WorkflowPolicyContext<TAuthUserProvider, TScope, any>
    ) => {
      for (const policy of policies) {
        const result = await policy(ctx);
        if (result === PolicyResult.ALLOW) {
          return PolicyResult.ALLOW;
        }
      }
      return PolicyResult.DENY;
    };

  /**
   * Policy helper: Combine multiple policies with AND logic
   */
  const allPolicies =
    (
      ...policies: ((
        ctx:
          | WorkItemPolicyContext<TAuthUserProvider, TScope, any>
          | WorkflowPolicyContext<TAuthUserProvider, TScope, any>
      ) => Promise<PolicyResult>)[]
    ) =>
    async (
      ctx:
        | WorkItemPolicyContext<TAuthUserProvider, TScope, any>
        | WorkflowPolicyContext<TAuthUserProvider, TScope, any>
    ) => {
      for (const policy of policies) {
        const result = await policy(ctx);
        if (result === PolicyResult.DENY) {
          return PolicyResult.DENY;
        }
      }
      return PolicyResult.ALLOW;
    };

  return {
    requireScope,
    requireAnyScope,
    requireAllScopes,
    anyPolicy,
    allPolicies,
  };
}
