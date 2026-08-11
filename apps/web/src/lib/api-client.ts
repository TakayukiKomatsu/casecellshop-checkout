import type {
  ApiError,
  CreateOrderRequest,
  CreateOrderResponse,
  OrderSnapshot,
  ProductListResponse,
} from "./api-types";
import { isApiError } from "./api-types";

const apiOrigin = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001").replace(
  /\/$/,
  "",
);

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiOrigin}/api${path}`, init);
  const body: unknown = await response.json();

  if (!response.ok) {
    if (isApiError(body)) {
      throw body;
    }

    const fallback: ApiError = {
      code: "INTERNAL_ERROR",
      message: "Não foi possível concluir a solicitação.",
      correlationId: response.headers.get("x-correlation-id") ?? "",
    };
    throw fallback;
  }

  return body as T;
}

export function listProducts(signal?: AbortSignal): Promise<ProductListResponse> {
  return requestJson<ProductListResponse>("/products", { signal });
}

export function createOrder(
  payload: CreateOrderRequest,
  key: string,
  signal?: AbortSignal,
): Promise<CreateOrderResponse> {
  return requestJson<CreateOrderResponse>("/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": key,
    },
    body: JSON.stringify(payload),
    signal,
  });
}

export function getOrder(
  orderId: string,
  signal?: AbortSignal,
): Promise<OrderSnapshot> {
  return requestJson<OrderSnapshot>(`/orders/${encodeURIComponent(orderId)}`, {
    signal,
  });
}
