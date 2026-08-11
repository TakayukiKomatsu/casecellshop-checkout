export enum OrderStatus {
  Pending = 'PENDING',
  Processing = 'PROCESSING',
  Completed = 'COMPLETED',
  Failed = 'FAILED',
}

export const ORDER_FAILURE_CODE = 'TEMPORARY_ERP_FAILURE' as const;
export type OrderFailureCode = typeof ORDER_FAILURE_CODE;
