export const ERP_PROCESSOR_PORT = Symbol('ERP_PROCESSOR_PORT');

export type ErpProcessingInput = {
  operationId: string;
  productId: string;
  quantity: number;
};

export type ErpProcessingResult =
  { ok: true } | { ok: false; code: 'TEMPORARY_ERP_FAILURE' };

export interface ErpProcessorPort {
  assertReady?(): void;
  process(input: ErpProcessingInput): Promise<ErpProcessingResult>;
}
