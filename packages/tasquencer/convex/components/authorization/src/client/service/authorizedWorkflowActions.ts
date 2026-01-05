import { z } from "zod";
import type { GenericMutationCtx } from "convex/server";
import type {
  GenericWorkflowActions,
  WorkflowActionContext,
  WorkflowCancelAction,
  WorkflowCancelActionContext,
  WorkflowInitializeAction,
  WorkflowInitializeActionContext,
} from "../../../../../tasquencer/builder/workflow/actions";
import { WorkflowActions } from "../../../../../tasquencer/builder/workflow/actions";
import type { AuthorizationContext, WorkflowPolicy } from "./policy";
import { assertAuthorized } from "./policy";
import type { AnyAuthorizationService } from "../service";
import type {
  AnyAuthorizationUserProvider,
  GetAuthorizationUserProviderUser,
} from "../userProvider";

export class AuthorizedWorkflowActions<
  TAuthUserProvider extends AnyAuthorizationUserProvider,
  TMutationCtx extends GenericMutationCtx<any> = GenericMutationCtx<any>,
  TScope extends string = never,
  TWorkflowActionsDefinition = Record<never, never>,
> {
  static make<
    TAuthUserProvider extends AnyAuthorizationUserProvider,
    TMutationCtx extends GenericMutationCtx<any>,
    TScope extends string,
  >(authorizationService: AnyAuthorizationService) {
    return new AuthorizedWorkflowActions<
      TAuthUserProvider,
      TMutationCtx,
      TScope,
      Record<never, never>
    >(
      authorizationService,
      authorizationService.userProvider,
      WorkflowActions.make<TMutationCtx>().actions
    );
  }
  private constructor(
    readonly authorizationService: AnyAuthorizationService,
    readonly userProvider: TAuthUserProvider,
    readonly actions: GenericWorkflowActions<TMutationCtx, any>
  ) {}

  private extendPolicyContextWithAuthorization<TWorkflowContext extends object>(
    ctx: TWorkflowContext,
    user: NonNullable<GetAuthorizationUserProviderUser<TAuthUserProvider>>
  ) {
    return {
      ...ctx,
      authorization: {
        user: user,
        scope: <TPolicyScope extends TScope>(scope: TPolicyScope) => scope,
      },
    };
  }
  private extendActionContextWithAuthorization<TWorkflowContext extends object>(
    ctx: TWorkflowContext,
    user: NonNullable<
      GetAuthorizationUserProviderUser<TAuthUserProvider>
    > | null
  ) {
    return {
      ...ctx,
      authorization: {
        user: user,
        scope: <TPolicyScope extends TScope>(scope: TPolicyScope) => scope,
      },
    };
  }
  private wrapCallbackWithAuthorizationPolicy<
    TSchema extends z.ZodTypeAny,
    TWorkflowContext extends WorkflowActionContext<TMutationCtx, any>,
  >(
    policy: WorkflowPolicy<TAuthUserProvider, TScope, z.output<TSchema>>,
    callback: (
      ctx: TWorkflowContext &
        AuthorizationContext<TAuthUserProvider, TScope, true>,
      payload: z.output<TSchema>
    ) => Promise<void>
  ) {
    return async (ctx: TWorkflowContext, payload: z.output<TSchema>) => {
      if (ctx.isInternalMutation) {
        return await callback(
          this.extendActionContextWithAuthorization(ctx, null),
          payload
        );
      }

      const user = await this.userProvider.getUser(ctx.mutationCtx);

      const result = await policy(
        this.extendPolicyContextWithAuthorization(ctx, user),
        payload
      );

      assertAuthorized(result);

      await callback(
        this.extendActionContextWithAuthorization(ctx, user),
        payload
      );
    };
  }

  initialize<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    policy: WorkflowPolicy<TAuthUserProvider, TScope, z.output<TSchema>>,
    callback: (
      ctx: WorkflowInitializeActionContext<TMutationCtx> &
        AuthorizationContext<TAuthUserProvider, TScope, true>,
      payload: z.output<TSchema>
    ) => Promise<void>
  ) {
    const definition: WorkflowInitializeAction<TMutationCtx, TSchema> = {
      schema,
      callback: this.wrapCallbackWithAuthorizationPolicy(policy, callback),
    };

    return new AuthorizedWorkflowActions<
      TAuthUserProvider,
      TMutationCtx,
      TScope,
      TWorkflowActionsDefinition & {
        initialize: WorkflowInitializeAction<TMutationCtx, TSchema>;
      }
    >(this.authorizationService, this.userProvider, {
      ...this.actions,
      initialize: definition,
    });
  }

  cancel<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    policy: WorkflowPolicy<TAuthUserProvider, TScope, z.output<TSchema>>,
    callback: (
      ctx: WorkflowCancelActionContext<TMutationCtx> &
        AuthorizationContext<TAuthUserProvider, TScope, true>,
      payload: z.output<TSchema>
    ) => Promise<void>
  ) {
    const definition: WorkflowCancelAction<TMutationCtx, TSchema> = {
      schema,
      callback: this.wrapCallbackWithAuthorizationPolicy(policy, callback),
    };

    return new AuthorizedWorkflowActions<
      TAuthUserProvider,
      TMutationCtx,
      TScope,
      TWorkflowActionsDefinition & {
        cancel: WorkflowCancelAction<TMutationCtx, TSchema>;
      }
    >(this.authorizationService, this.userProvider, {
      ...this.actions,
      cancel: definition,
    });
  }

  build() {
    return new WorkflowActions<TMutationCtx, TWorkflowActionsDefinition>(
      this.actions
    );
  }
}
