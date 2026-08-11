"use client";

import type { FormEvent } from "react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { createOrder, getOrder, listProducts } from "../lib/api-client";
import type { ApiError, OrderSnapshot, ProductDto } from "../lib/api-types";
import { isApiError } from "../lib/api-types";
import {
  attemptReducer,
  initialAttemptState,
  isSubmissionLocked,
  isUnknownSubmissionResult,
  nextKey,
} from "./attempt-state";
import OrderFeedback from "./order-feedback";
import ProductList from "./product-list";
import QuantityInput from "./quantity-input";
import styles from "./checkout-page.module.css";

const POLL_INTERVAL_MS = 1_000;
const POLLING_WINDOW_MS = 30_000;
const MAX_CONSECUTIVE_POLL_FAILURES = 3;

function normalizeError(error: unknown): ApiError {
  if (isApiError(error)) {
    return error;
  }

  return {
    code: "NETWORK_ERROR",
    message: "Não foi possível acessar o serviço. Tente novamente.",
    correlationId: "",
  };
}

export default function CheckoutPage() {
  const [products, setProducts] = useState<ProductDto[]>([]);
  const [selectedProductId, setSelectedProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [replayed, setReplayed] = useState(false);
  const [attempt, dispatch] = useReducer(attemptReducer, initialAttemptState);
  const inFlightRef = useRef(false);

  const loadProducts = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await listProducts(signal);
      setProducts(response.items);
      setSelectedProductId((current) =>
        response.items.some((product) => product.id === current)
          ? current
          : (response.items[0]?.id ?? ""),
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      setCatalogError("Não foi possível carregar os produtos.");
    } finally {
      if (!signal?.aborted) {
        setCatalogLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    void listProducts(controller.signal)
      .then((response) => {
        setProducts(response.items);
        setSelectedProductId((current) =>
          response.items.some((product) => product.id === current)
            ? current
            : (response.items[0]?.id ?? ""),
        );
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setCatalogError("Não foi possível carregar os produtos.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setCatalogLoading(false);
        }
      });

    return () => controller.abort();
  }, []);


  const locked = isSubmissionLocked(attempt);
  const unknownResultPendingRetry =
    attempt.kind === "failed" &&
    !attempt.order &&
    isUnknownSubmissionResult(attempt.error);

  function clearAttemptFeedback() {
    setValidationMessage("");
    setReplayed(false);
    if (attempt.kind === "failed" || attempt.kind === "succeeded") {
      dispatch({ type: "reset" });
    }
  }
  const receiveOrder = useCallback(
    (order: OrderSnapshot) => {
      if (order.status === "COMPLETED") {
        inFlightRef.current = false;
        setQuantity("1");
        setCatalogLoading(true);
        setCatalogError("");
        void loadProducts();
      } else if (order.status === "FAILED") {
        inFlightRef.current = false;
      }

      dispatch({ type: "order_received", order });
    },
    [loadProducts],
  );

  const trackingOrderId =
    attempt.kind === "tracking" ? attempt.order.id : null;

  useEffect(() => {
    if (!trackingOrderId) {
      return;
    }

    const orderId = trackingOrderId;

    const controller = new AbortController();
    let pollTimer = 0;
    let deadlineTimer = 0;
    let consecutiveFailures = 0;
    let stopped = false;

    const stopPolling = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      window.clearTimeout(pollTimer);
      window.clearTimeout(deadlineTimer);
      controller.abort();
    };

    const pauseTracking = () => {
      stopPolling();
      dispatch({ type: "pause_tracking" });
    };

    const scheduleNext = () => {
      if (stopped) {
        return;
      }
      pollTimer = window.setTimeout(() => {
        void poll();
      }, POLL_INTERVAL_MS);
    };

    async function poll() {
      try {
        const order = await getOrder(orderId, controller.signal);
        if (stopped) {
          return;
        }

        consecutiveFailures = 0;
        if (order.status === "COMPLETED" || order.status === "FAILED") {
          stopPolling();
          receiveOrder(order);
          return;
        }
        receiveOrder(order);
      } catch {
        if (stopped) {
          return;
        }
        consecutiveFailures += 1;
      }

      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        pauseTracking();
        return;
      }

      scheduleNext();
    }

    deadlineTimer = window.setTimeout(pauseTracking, POLLING_WINDOW_MS);
    scheduleNext();

    return stopPolling;
  }, [receiveOrder, trackingOrderId]);

  async function submitAttempt(
    payload: { productId: string; quantity: number },
    key: string,
  ) {
    if (inFlightRef.current) {
      return;
    }

    setValidationMessage("");
    setReplayed(false);
    inFlightRef.current = true;
    dispatch({ type: "submit", key, ...payload });

    try {
      const response = await createOrder(payload, key);
      setReplayed(response.replayed);
      receiveOrder(response.order);
    } catch (error) {
      inFlightRef.current = false;
      dispatch({ type: "fail", error: normalizeError(error) });
    }
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || unknownResultPendingRetry || inFlightRef.current) {
      return;
    }

    setValidationMessage("");
    setReplayed(false);
    if (!selectedProductId) {
      setValidationMessage("Selecione um produto.");
      return;
    }

    const numericQuantity = Number(quantity);
    if (
      quantity.trim() === "" ||
      !Number.isSafeInteger(numericQuantity) ||
      numericQuantity <= 0
    ) {
      setValidationMessage("Informe uma quantidade inteira positiva válida.");
      return;
    }

    await submitAttempt(
      { productId: selectedProductId, quantity: numericQuantity },
      crypto.randomUUID(),
    );
  }

  async function retryUnknown() {
    if (
      attempt.kind !== "failed" ||
      !attempt.retry ||
      !isUnknownSubmissionResult(attempt.error)
    ) {
      return;
    }

    const outcome =
      attempt.error.code === "INTERNAL_ERROR"
        ? "internal-error"
        : "transport-error";
    await submitAttempt(
      {
        productId: attempt.retry.productId,
        quantity: attempt.retry.quantity,
      },
      nextKey({ outcome, currentKey: attempt.retry.key }),
    );
  }

  async function retryTerminal() {
    if (
      attempt.kind !== "failed" ||
      attempt.order?.status !== "FAILED" ||
      !attempt.retry
    ) {
      return;
    }

    await submitAttempt(
      {
        productId: attempt.retry.productId,
        quantity: attempt.retry.quantity,
      },
      nextKey({
        outcome: "terminal-failed",
        currentKey: attempt.retry.key,
      }),
    );
  }

  function resumeTracking() {
    if (attempt.kind === "tracking_paused") {
      dispatch({ type: "resume_tracking" });
    }
  }

  return (
    <main className={styles.page}>
      <header>
        <p className={styles.eyebrow}>CaseCellShop</p>
        <h1>Escolha sua capinha</h1>
        <p>Selecione um modelo e informe quantas unidades deseja comprar.</p>
      </header>

      {catalogLoading ? (
        <p aria-live="polite">Carregando produtos...</p>
      ) : null}
      {catalogError ? <p role="alert">{catalogError}</p> : null}

      <form onSubmit={submitOrder} className={styles.checkout} noValidate>
        <ProductList
          products={products}
          selectedProductId={selectedProductId}
          disabled={locked}
          onSelect={(productId) => {
            clearAttemptFeedback();
            setSelectedProductId(productId);
          }}
        />
        <QuantityInput
          value={quantity}
          disabled={locked}
          onChange={(value) => {
            clearAttemptFeedback();
            setQuantity(value);
          }}
        />

        {validationMessage ? <p role="alert">{validationMessage}</p> : null}
        <OrderFeedback
          attempt={attempt}
          replayed={replayed}
          onResumeTracking={resumeTracking}
          onRetryUnknown={() => {
            void retryUnknown();
          }}
          onRetryTerminal={() => {
            void retryTerminal();
          }}
        />

        <button
          type="submit"
          disabled={
            locked ||
            unknownResultPendingRetry ||
            catalogLoading ||
            products.length === 0
          }
        >
          Comprar
        </button>
      </form>
    </main>
  );
}
