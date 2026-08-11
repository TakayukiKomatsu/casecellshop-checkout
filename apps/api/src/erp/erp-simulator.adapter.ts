import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/env.schema';
import {
  type ErpProcessingInput,
  type ErpProcessingResult,
  type ErpProcessorPort,
} from './erp-processor.port';

export type SimulationResult = 'success' | 'failure';
export type SimulationMode = SimulationResult | 'scripted';

export class InvalidSimulationScriptError extends Error {
  constructor() {
    super('ERP_SIMULATION_SCRIPT must be a non-empty success/failure sequence');
    this.name = new.target.name;
  }
}

export class SimulationScriptExhaustedError extends Error {
  constructor() {
    super('ERP simulation script is exhausted');
    this.name = new.target.name;
  }
}

@Injectable()
export class ErpSimulatorAdapter implements ErpProcessorPort {
  private readonly delayMs: number;
  private readonly mode: SimulationMode;
  private readonly script: SimulationResult[];
  private cursor = 0;

  constructor(config: ConfigService<AppEnv, true>) {
    this.delayMs = config.getOrThrow('ERP_SIMULATION_DELAY_MS');
    this.mode = config.getOrThrow('ERP_SIMULATION_MODE');
    this.script = this.parseScript(
      config.getOrThrow('ERP_SIMULATION_SCRIPT'),
      this.mode,
    );
  }

  assertReady(): void {
    if (this.mode === 'scripted' && this.cursor >= this.script.length) {
      throw new SimulationScriptExhaustedError();
    }
  }

  async process(input: ErpProcessingInput): Promise<ErpProcessingResult> {
    void input;
    const selected = this.nextResult();
    await new Promise<void>((resolve) => setTimeout(resolve, this.delayMs));

    return selected === 'success'
      ? { ok: true }
      : { ok: false, code: 'TEMPORARY_ERP_FAILURE' };
  }

  private nextResult(): SimulationResult {
    if (this.mode !== 'scripted') {
      return this.mode;
    }

    const selected = this.script[this.cursor];
    if (!selected) {
      throw new SimulationScriptExhaustedError();
    }

    this.cursor += 1;
    return selected;
  }

  private parseScript(
    script: string,
    mode: SimulationMode,
  ): SimulationResult[] {
    if (mode !== 'scripted') {
      return [];
    }

    const results = script.split(',').map((value) => value.trim());
    if (
      results.length === 0 ||
      results.some((value) => value !== 'success' && value !== 'failure')
    ) {
      throw new InvalidSimulationScriptError();
    }

    return results as SimulationResult[];
  }
}
