/**
 * Encoding registry using Strategy pattern.
 *
 * Allows registration of new encodings without modifying existing code.
 * Follows Open/Closed Principle.
 */

import { get_encoding, type Tiktoken } from 'tiktoken';

import type { EncodingType, IEncoding, ModelFamily } from './types.js';

/**
 * Base encoding implementation using tiktoken.
 */
abstract class TiktokenEncoding implements IEncoding {
  protected encoder: Tiktoken | null = null;
  protected initialized = false;

  constructor(
    readonly name: EncodingType,
    readonly models: ModelFamily[],
  ) {}

  /**
   * Get the tiktoken encoding name for this encoding.
   */
  protected abstract getTiktokenName(): string;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.encoder = get_encoding(this.getTiktokenName() as any);
    this.initialized = true;
  }

  encode(text: string): number[] {
    this.ensureInitialized();
    return Array.from(this.encoder!.encode(text));
  }

  decode(tokens: number[]): string {
    this.ensureInitialized();
    const uint32Tokens = new Uint32Array(tokens);
    const decoded = this.encoder!.decode(uint32Tokens);
    return new TextDecoder().decode(decoded);
  }

  count(text: string): number {
    return this.encode(text).length;
  }

  dispose(): void {
    if (this.encoder) {
      this.encoder.free();
      this.encoder = null;
    }
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.encoder) {
      throw new Error(`Encoding ${this.name} not initialized. Call initialize() first.`);
    }
  }
}

/**
 * cl100k_base encoding (GPT-4, GPT-3.5-turbo, Claude).
 */
class Cl100kEncoding extends TiktokenEncoding {
  constructor() {
    super('cl100k_base', ['openai-gpt4', 'openai-gpt35', 'anthropic-claude']);
  }

  protected getTiktokenName(): string {
    return 'cl100k_base';
  }
}

/**
 * o200k_base encoding (GPT-4o, GPT-4o-mini).
 */
class O200kEncoding extends TiktokenEncoding {
  constructor() {
    super('o200k_base', ['openai-gpt4o']);
  }

  protected getTiktokenName(): string {
    return 'o200k_base';
  }
}

/**
 * Registry for encoding strategies.
 *
 * Features:
 * - Register new encodings at runtime
 * - Auto-select encoding by model family
 * - Default encoding fallback
 */
export class EncodingRegistry {
  private encodings = new Map<EncodingType, IEncoding>();
  private modelToEncoding = new Map<ModelFamily, EncodingType>();
  private initialized = false;

  constructor() {
    // Register default encodings
    this.register(new Cl100kEncoding());
    this.register(new O200kEncoding());
  }

  /**
   * Register a new encoding.
   */
  register(encoding: IEncoding): void {
    this.encodings.set(encoding.name, encoding);
    for (const model of encoding.models) {
      this.modelToEncoding.set(model, encoding.name);
    }
  }

  /**
   * Get encoding by type.
   */
  get(encoding: EncodingType): IEncoding {
    const enc = this.encodings.get(encoding);
    if (!enc) {
      throw new Error(`Unknown encoding: ${encoding}`);
    }
    return enc;
  }

  /**
   * Get encoding for a model family.
   * Returns default encoding if model not found.
   */
  getByModel(model: ModelFamily): IEncoding {
    const encodingName = this.modelToEncoding.get(model);
    if (!encodingName) {
      // Default fallback
      return this.get('cl100k_base');
    }
    return this.get(encodingName);
  }

  /**
   * Get encoding type for a model family.
   */
  getEncodingTypeForModel(model: ModelFamily): EncodingType {
    return this.modelToEncoding.get(model) ?? 'cl100k_base';
  }

  /**
   * Check if encoding is registered.
   */
  has(encoding: EncodingType): boolean {
    return this.encodings.has(encoding);
  }

  /**
   * List all registered encodings.
   */
  listEncodings(): EncodingType[] {
    return Array.from(this.encodings.keys());
  }

  /**
   * List all registered models.
   */
  listModels(): ModelFamily[] {
    return Array.from(this.modelToEncoding.keys());
  }

  /**
   * Initialize all encodings.
   * Call once at application startup.
   */
  async initializeAll(): Promise<void> {
    if (this.initialized) return;

    await Promise.all(Array.from(this.encodings.values()).map((e) => e.initialize()));

    this.initialized = true;
  }

  /**
   * Dispose all encodings.
   * Call at application shutdown.
   */
  disposeAll(): void {
    for (const encoding of this.encodings.values()) {
      encoding.dispose();
    }
    this.initialized = false;
  }

  /**
   * Check if initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}
