export type CheckoutErrorCode =
  | 'PRODUCT_NOT_FOUND'
  | 'ORDER_NOT_FOUND'
  | 'INSUFFICIENT_STOCK'
  | 'IDEMPOTENCY_KEY_REUSED';

export abstract class CheckoutError extends Error {
  abstract readonly code: CheckoutErrorCode;
  abstract readonly statusCode: number;
  readonly details?: Record<string, unknown>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class ProductNotFoundError extends CheckoutError {
  readonly code = 'PRODUCT_NOT_FOUND';
  readonly statusCode = 404;

  constructor() {
    super('Produto não encontrado.');
  }
}

export class OrderNotFoundError extends CheckoutError {
  readonly code = 'ORDER_NOT_FOUND';
  readonly statusCode = 404;

  constructor() {
    super('Pedido não encontrado.');
  }
}

export class InsufficientStockError extends CheckoutError {
  readonly code = 'INSUFFICIENT_STOCK';
  readonly statusCode = 409;

  constructor(availableStock: number) {
    super('Estoque insuficiente para a quantidade solicitada.', {
      availableStock,
    });
  }
}

export class IdempotencyKeyReusedError extends CheckoutError {
  readonly code = 'IDEMPOTENCY_KEY_REUSED';
  readonly statusCode = 409;

  constructor() {
    super('Chave de idempotência já utilizada com dados diferentes.');
  }
}
