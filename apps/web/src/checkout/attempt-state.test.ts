import { describe, expect, it } from "vitest";
import type { ApiError, OrderSnapshot } from "../lib/api-types";
import {
  attemptReducer,
  initialAttemptState,
  isSubmissionLocked,
  nextKey,
  type AttemptState,
  type RetryOutcome,
} from "./attempt-state";

const order: OrderSnapshot = {
  id: "10636165-8168-434c-9216-18794be25fd4",
  productId: "84bcc09e-aef4-48c8-9dd7-924f62b16988",
  quantity: 2,
  status: "PENDING",
  failureCode: null,
  createdAt: "2026-08-10T12:00:00.000Z",
  updatedAt: "2026-08-10T12:00:00.000Z",
};

const error: ApiError = {
  code: "INSUFFICIENT_STOCK",
  message: "Sem estoque.",
  correlationId: "eae73135-03b9-487c-a658-09eec0eb5484",
};

const currentKey = "794b6307-0dab-4a39-8f30-f6d7687ccb42";


describe("attemptReducer", () => {
  it.each<{
    outcome: RetryOutcome;
    reusesCurrentKey: boolean;
  }>([
    { outcome: "transport-error", reusesCurrentKey: true },
    { outcome: "internal-error", reusesCurrentKey: true },
    { outcome: "validation-error", reusesCurrentKey: false },
    { outcome: "product-not-found", reusesCurrentKey: false },
    { outcome: "insufficient-stock", reusesCurrentKey: false },
    { outcome: "idempotency-conflict", reusesCurrentKey: false },
    { outcome: "terminal-failed", reusesCurrentKey: false },
  ])(
    "applies the exact idempotency-key policy for $outcome",
    ({ outcome, reusesCurrentKey }) => {
      const key = nextKey({ outcome, currentKey });

      if (reusesCurrentKey) {
        expect(key).toBe(currentKey);
      } else {
        expect(key).not.toBe(currentKey);
        expect(key).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      }
    },
  );
  it("moves a logical submission from idle through submitting to tracking", () => {
    const submitting = attemptReducer(initialAttemptState, {
      type: "submit",
      key: "794b6307-0dab-4a39-8f30-f6d7687ccb42",
      productId: order.productId,
      quantity: order.quantity,
    });
    const tracking = attemptReducer(submitting, {
      type: "order_received",
      order,
    });

    expect(submitting).toEqual({
      kind: "submitting",
      key: "794b6307-0dab-4a39-8f30-f6d7687ccb42",
      productId: order.productId,
      quantity: 2,
    });
    expect(tracking).toEqual({
      kind: "tracking",
      key: "794b6307-0dab-4a39-8f30-f6d7687ccb42",
      order,
    });
  });

  it("maps an already terminal order to its terminal attempt state", () => {
    const submitting = attemptReducer(initialAttemptState, {
      type: "submit",
      key: "794b6307-0dab-4a39-8f30-f6d7687ccb42",
      productId: order.productId,
      quantity: order.quantity,
    });

    expect(
      attemptReducer(submitting, {
        type: "order_received",
        order: { ...order, status: "COMPLETED" },
      }),
    ).toMatchObject({ kind: "succeeded" });
    expect(
      attemptReducer(submitting, {
        type: "order_received",
        order: {
          ...order,
          status: "FAILED",
          failureCode: "TEMPORARY_ERP_FAILURE",
        },
      }),
    ).toMatchObject({
      kind: "failed",
      error: { code: "TEMPORARY_ERP_FAILURE" },
    });
  });

  it("stores explicit API failures without discarding their order", () => {
    expect(
      attemptReducer(
        { kind: "tracking", key: "key", order },
        { type: "fail", error, order },
      ),
    ).toEqual({
      kind: "failed",
      error,
      order,
      retry: {
        key: "key",
        productId: order.productId,
        quantity: order.quantity,
      },
    });
  });

  it("pauses and resumes tracking without changing the order or key", () => {
    const tracking: AttemptState = { kind: "tracking", key: currentKey, order };
    const paused = attemptReducer(tracking, { type: "pause_tracking" });
    const resumed = attemptReducer(paused, { type: "resume_tracking" });

    expect(paused).toEqual({
      kind: "tracking_paused",
      key: currentKey,
      order,
    });
    expect(resumed).toEqual(tracking);
  });

  it("locks submission for every non-terminal order state", () => {
    expect(isSubmissionLocked(initialAttemptState)).toBe(false);
    expect(
      isSubmissionLocked({
        kind: "submitting",
        key: "key",
        productId: order.productId,
        quantity: 2,
      }),
    ).toBe(true);
    expect(
      isSubmissionLocked({ kind: "tracking", key: "key", order }),
    ).toBe(true);
    expect(
      isSubmissionLocked({ kind: "tracking_paused", key: "key", order }),
    ).toBe(true);
    expect(isSubmissionLocked({ kind: "failed", error })).toBe(false);
    expect(isSubmissionLocked({ kind: "succeeded", order })).toBe(false);
  });
});
