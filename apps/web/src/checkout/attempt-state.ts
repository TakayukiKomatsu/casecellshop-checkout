import type { ApiError, OrderSnapshot } from "../lib/api-types";

export interface AttemptContext {
  key: string;
  productId: string;
  quantity: number;
}

export type AttemptState =
  | { kind: "idle" }
  | ({ kind: "submitting" } & AttemptContext)
  | { kind: "tracking"; key: string; order: OrderSnapshot }
  | { kind: "tracking_paused"; key: string; order: OrderSnapshot }
  | { kind: "succeeded"; order: OrderSnapshot }
  | {
      kind: "failed";
      order?: OrderSnapshot;
      error: ApiError;
      retry?: AttemptContext;
    };

export type AttemptAction =
  | {
      type: "submit";
      key: string;
      productId: string;
      quantity: number;
    }
  | { type: "order_received"; order: OrderSnapshot }
  | { type: "pause_tracking" }
  | { type: "resume_tracking" }
  | { type: "fail"; error: ApiError; order?: OrderSnapshot }
  | { type: "reset" };

export const initialAttemptState: AttemptState = { kind: "idle" };

export type RetryOutcome =
  | "transport-error"
  | "internal-error"
  | "validation-error"
  | "product-not-found"
  | "insufficient-stock"
  | "idempotency-conflict"
  | "terminal-failed";

export function nextKey({
  outcome,
  currentKey,
}: {
  outcome: RetryOutcome;
  currentKey: string;
}): string {
  return outcome === "transport-error" || outcome === "internal-error"
    ? currentKey
    : crypto.randomUUID();
}

export function isUnknownSubmissionResult(error: ApiError): boolean {
  return error.code === "NETWORK_ERROR" || error.code === "INTERNAL_ERROR";
}

function retryContext(
  state: AttemptState,
  order?: OrderSnapshot,
): AttemptContext | undefined {
  if (state.kind === "submitting") {
    return {
      key: state.key,
      productId: state.productId,
      quantity: state.quantity,
    };
  }
  if (state.kind === "tracking" || state.kind === "tracking_paused") {
    return {
      key: state.key,
      productId: (order ?? state.order).productId,
      quantity: (order ?? state.order).quantity,
    };
  }
  return undefined;
}

export function isSubmissionLocked(state: AttemptState): boolean {
  return (
    state.kind === "submitting" ||
    state.kind === "tracking" ||
    state.kind === "tracking_paused"
  );
}

export function attemptReducer(
  state: AttemptState,
  action: AttemptAction,
): AttemptState {
  switch (action.type) {
    case "submit":
      if (isSubmissionLocked(state)) {
        return state;
      }
      return {
        kind: "submitting",
        key: action.key,
        productId: action.productId,
        quantity: action.quantity,
      };

    case "order_received": {
      if (action.order.status === "COMPLETED") {
        return { kind: "succeeded", order: action.order };
      }
      if (action.order.status === "FAILED") {
        return {
          kind: "failed",
          order: action.order,
          retry: retryContext(state, action.order),
          error: {
            code: action.order.failureCode ?? "INTERNAL_ERROR",
            message: "O pedido não pôde ser processado.",
            correlationId: "",
          },
        };
      }
      if (
        state.kind !== "submitting" &&
        state.kind !== "tracking" &&
        state.kind !== "tracking_paused"
      ) {
        return state;
      }
      return { kind: "tracking", key: state.key, order: action.order };
    }

    case "pause_tracking":
      return state.kind === "tracking"
        ? { kind: "tracking_paused", key: state.key, order: state.order }
        : state;

    case "resume_tracking":
      return state.kind === "tracking_paused"
        ? { kind: "tracking", key: state.key, order: state.order }
        : state;

    case "fail":
      return {
        kind: "failed",
        error: action.error,
        order: action.order,
        retry: retryContext(state, action.order),
      };

    case "reset":
      return initialAttemptState;
  }
}
