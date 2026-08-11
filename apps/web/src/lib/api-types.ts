export interface ProductDto {
  id: string;
  sku: string;
  name: string;
  description: string;
  priceCents: number;
  availableStock: number;
}

export interface ProductListResponse {
  items: ProductDto[];
}

export type OrderStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";
export type OrderFailureCode = "TEMPORARY_ERP_FAILURE" | null;

export interface OrderSnapshot {
  id: string;
  productId: string;
  quantity: number;
  status: OrderStatus;
  failureCode: OrderFailureCode;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderRequest {
  productId: string;
  quantity: number;
}

export interface CreateOrderResponse {
  replayed: boolean;
  order: OrderSnapshot;
}

export interface ApiError {
  code: string;
  message: string;
  correlationId: string;
  details?: Record<string, unknown>;
}

export function isApiError(value: unknown): value is ApiError {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ApiError>;
  return (
    typeof candidate.code === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.correlationId === "string"
  );
}
