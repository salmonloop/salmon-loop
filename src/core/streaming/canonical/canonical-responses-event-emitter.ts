import { formatCanonicalFunctionCallItemId } from './function-call-item-id.js';
import {
  createResponseContentPartAddedOutputTextEvent,
  createResponseContentPartDoneOutputTextEvent,
  createResponseFunctionCallArgumentsDeltaEvent,
  createResponseFunctionCallArgumentsDoneEvent,
  createResponseOutputItemAddedFunctionCallEvent,
  createResponseOutputItemAddedMessageEvent,
  createResponseOutputItemDoneFunctionCallEvent,
  createResponseOutputItemDoneMessageEvent,
  createResponseOutputTextDeltaEvent,
  createResponseOutputTextDoneEvent,
} from './responses-event-emitter.js';
import type { CanonicalResponsesEvent } from './responses-events.js';

export type CanonicalStreamPart =
  | {
      type: 'output_text.delta';
      streamId: string;
      delta: string;
      logprobs?: unknown[];
    }
  | {
      type: 'output_text.done';
      streamId: string;
      text?: string;
      logprobs?: unknown[];
    }
  | {
      type: 'function_call.start';
      streamId: string;
      callId: string;
      name: string;
    }
  | {
      type: 'function_call_arguments.delta';
      streamId: string;
      callId: string;
      delta: string;
    }
  | {
      type: 'function_call_arguments.done';
      streamId: string;
      callId: string;
      name?: string;
      arguments: string;
    }
  | {
      type: 'function_call.done';
      streamId: string;
      callId: string;
      name: string;
      arguments: string;
    };

export type CanonicalResponsesEventEmitterOptions = {
  toolArgs?: 'redact' | 'allow';
  itemId?: () => string;
};

type TextStreamState = {
  outputIndex: number;
  itemId: string;
  contentIndex: number;
  contentPartAdded: boolean;
  outputTextDone: boolean;
  contentPartDone: boolean;
  messageItemDone: boolean;
  text: string;
};

type FunctionCallState = {
  streamId: string;
  callId: string;
  outputIndex: number;
  itemId: string;
  toolName: string;
  args: string;
  addedEmitted: boolean;
  argsDeltaEmitted: boolean;
  argsDoneEmitted: boolean;
  itemDoneEmitted: boolean;
  pendingArgsDeltas: string[];
  pendingArgsDone: { argumentsText: string; name?: string } | null;
};

const REDACTED_TOOL_ARGS = '{}';

/**
 * A provider-agnostic canonical responses event generator.
 *
 * This emitter intentionally only solves event translation + minimal state (ids/indexes),
 * leaving message/block assembly to `StreamAssembler` and protocol encoding to adapters.
 */
export class CanonicalResponsesEventEmitter {
  private readonly toolArgsMode: 'redact' | 'allow';
  private readonly itemIdFn: () => string;

  private nextOutputIndex = 0;
  private nextItemId = 0;

  private readonly textStreams = new Map<string, TextStreamState>();
  private readonly functionCalls = new Map<string, FunctionCallState>();

  constructor(options: CanonicalResponsesEventEmitterOptions = {}) {
    this.toolArgsMode = options.toolArgs ?? 'redact';
    this.itemIdFn = options.itemId ?? (() => `item_${++this.nextItemId}`);
  }

  push(part: CanonicalStreamPart): CanonicalResponsesEvent[] {
    switch (part.type) {
      case 'output_text.delta': {
        return this.onOutputTextDelta(part.streamId, part.delta, part.logprobs);
      }

      case 'output_text.done': {
        return this.onOutputTextDone(part.streamId, part.text, part.logprobs);
      }

      case 'function_call.start': {
        return this.onFunctionCallStart(part.streamId, part.callId, part.name);
      }

      case 'function_call_arguments.delta': {
        return this.onFunctionCallArgsDelta(part.streamId, part.callId, part.delta);
      }

      case 'function_call_arguments.done': {
        return this.onFunctionCallArgsDone(part.streamId, part.callId, part.arguments, part.name);
      }

      case 'function_call.done': {
        return this.onFunctionCallDone(part.streamId, part.callId, part.name, part.arguments);
      }
    }
  }

  /**
   * Flushes any open items in the given stream to a "done" state, producing
   * the missing canonical *done* events in a stable order.
   */
  finish(streamId: string): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];

    const text = this.textStreams.get(streamId);
    if (text) out.push(...this.flushTextStream(text));

    for (const call of this.functionCalls.values()) {
      if (call.streamId !== streamId) continue;
      out.push(...this.flushFunctionCall(call));
    }

    return out;
  }

  private onOutputTextDelta(
    streamId: string,
    delta: string,
    logprobs?: unknown[],
  ): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];
    const st = this.ensureTextStream(streamId);
    out.push(...this.ensureTextContentPartAdded(st));

    if (st.messageItemDone) return out;

    st.text += delta;
    out.push(
      createResponseOutputTextDeltaEvent({
        delta,
        outputIndex: st.outputIndex,
        itemId: st.itemId,
        contentIndex: st.contentIndex,
        logprobs,
      }),
    );

    return out;
  }

  private onOutputTextDone(
    streamId: string,
    text?: string,
    logprobs?: unknown[],
  ): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];
    const st = this.ensureTextStream(streamId);
    out.push(...this.ensureTextContentPartAdded(st));

    if (st.messageItemDone) return out;
    if (typeof text === 'string') st.text = text;
    if (st.outputTextDone) return out;

    st.outputTextDone = true;
    out.push(
      createResponseOutputTextDoneEvent({
        outputIndex: st.outputIndex,
        itemId: st.itemId,
        contentIndex: st.contentIndex,
        text: st.text,
        logprobs,
      }),
    );

    return out;
  }

  private ensureTextStream(streamId: string): TextStreamState {
    const existing = this.textStreams.get(streamId);
    if (existing) return existing;

    const outputIndex = this.nextOutputIndex++;
    const itemId = this.itemIdFn();
    const st: TextStreamState = {
      outputIndex,
      itemId,
      contentIndex: 0,
      contentPartAdded: false,
      outputTextDone: false,
      contentPartDone: false,
      messageItemDone: false,
      text: '',
    };
    this.textStreams.set(streamId, st);
    return st;
  }

  private ensureTextContentPartAdded(st: TextStreamState): CanonicalResponsesEvent[] {
    if (st.contentPartAdded) return [];
    if (st.messageItemDone) return [];
    st.contentPartAdded = true;

    return [
      createResponseOutputItemAddedMessageEvent({
        itemId: st.itemId,
        role: 'assistant',
        outputIndex: st.outputIndex,
      }),
      createResponseContentPartAddedOutputTextEvent({
        itemId: st.itemId,
        outputIndex: st.outputIndex,
        contentIndex: st.contentIndex,
      }),
    ];
  }

  private flushTextStream(st: TextStreamState): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];

    out.push(...this.ensureTextContentPartAdded(st));

    if (!st.outputTextDone && !st.messageItemDone) {
      st.outputTextDone = true;
      out.push(
        createResponseOutputTextDoneEvent({
          outputIndex: st.outputIndex,
          itemId: st.itemId,
          contentIndex: st.contentIndex,
          text: st.text,
          logprobs: [],
        }),
      );
    }

    if (!st.contentPartDone && !st.messageItemDone) {
      st.contentPartDone = true;
      out.push(
        createResponseContentPartDoneOutputTextEvent({
          outputIndex: st.outputIndex,
          itemId: st.itemId,
          contentIndex: st.contentIndex,
          text: st.text,
        }),
      );
    }

    if (!st.messageItemDone) {
      st.messageItemDone = true;
      out.push(
        createResponseOutputItemDoneMessageEvent({
          outputIndex: st.outputIndex,
          itemId: st.itemId,
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: st.text,
              annotations: [],
            },
          ],
        }),
      );
    }

    return out;
  }

  private ensureFunctionCallStarted(
    streamId: string,
    callId: string,
    name: string,
  ): CanonicalResponsesEvent[] {
    const existing = this.functionCalls.get(callId);
    if (existing) return [];

    const outputIndex = this.nextOutputIndex++;
    const itemId = formatCanonicalFunctionCallItemId(callId);

    const st: FunctionCallState = {
      streamId,
      callId,
      outputIndex,
      itemId,
      toolName: name,
      args: '',
      addedEmitted: false,
      argsDeltaEmitted: false,
      argsDoneEmitted: false,
      itemDoneEmitted: false,
      pendingArgsDeltas: [],
      pendingArgsDone: null,
    };
    this.functionCalls.set(callId, st);

    return [];
  }

  private onFunctionCallStart(
    streamId: string,
    callId: string,
    name: string,
  ): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];
    out.push(...this.ensureFunctionCallStarted(streamId, callId, name));

    const st = this.functionCalls.get(callId);
    if (!st || st.itemDoneEmitted) return out;

    st.streamId = streamId;
    if (st.toolName === 'unknown' && name !== 'unknown') st.toolName = name;
    out.push(...this.ensureFunctionCallAdded(st));
    out.push(...this.flushPendingFunctionCallArgs(st));
    return out;
  }

  private ensureFunctionCallAdded(st: FunctionCallState): CanonicalResponsesEvent[] {
    if (st.addedEmitted) return [];
    if (st.toolName === 'unknown') return [];
    st.addedEmitted = true;
    return [
      createResponseOutputItemAddedFunctionCallEvent({
        outputIndex: st.outputIndex,
        itemId: st.itemId,
        callId: st.callId,
        name: st.toolName,
        argumentsText: '',
      }),
    ];
  }

  private onFunctionCallArgsDelta(
    streamId: string,
    callId: string,
    delta: string,
  ): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];
    out.push(...this.ensureFunctionCallStarted(streamId, callId, 'unknown'));

    const st = this.functionCalls.get(callId);
    if (!st || st.itemDoneEmitted) return out;
    st.streamId = streamId;

    if (!st.addedEmitted) {
      st.pendingArgsDeltas.push(delta);
      return out;
    }

    if (this.toolArgsMode === 'redact') {
      if (st.argsDeltaEmitted) return out;
      st.argsDeltaEmitted = true;
      out.push(
        createResponseFunctionCallArgumentsDeltaEvent({
          outputIndex: st.outputIndex,
          itemId: st.itemId,
          delta: REDACTED_TOOL_ARGS,
        }),
      );
      return out;
    }

    st.args += delta;
    out.push(
      createResponseFunctionCallArgumentsDeltaEvent({
        outputIndex: st.outputIndex,
        itemId: st.itemId,
        delta,
      }),
    );
    return out;
  }

  private onFunctionCallArgsDone(
    streamId: string,
    callId: string,
    argumentsText: string,
    name?: string,
  ): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];
    out.push(...this.ensureFunctionCallStarted(streamId, callId, name ?? 'unknown'));

    const st = this.functionCalls.get(callId);
    if (!st || st.itemDoneEmitted) return out;
    if (st.argsDoneEmitted) return out;
    st.streamId = streamId;
    if (typeof name === 'string' && name && st.toolName === 'unknown') st.toolName = name;

    if (!st.addedEmitted) {
      st.pendingArgsDone = { argumentsText, name };
      out.push(...this.ensureFunctionCallAdded(st));
      out.push(...this.flushPendingFunctionCallArgs(st));
      return out;
    }

    if (this.toolArgsMode === 'redact') {
      if (!st.argsDeltaEmitted) {
        st.argsDeltaEmitted = true;
        out.push(
          createResponseFunctionCallArgumentsDeltaEvent({
            outputIndex: st.outputIndex,
            itemId: st.itemId,
            delta: REDACTED_TOOL_ARGS,
          }),
        );
      }

      st.argsDoneEmitted = true;
      st.args = REDACTED_TOOL_ARGS;
      out.push(
        createResponseFunctionCallArgumentsDoneEvent({
          outputIndex: st.outputIndex,
          itemId: st.itemId,
          name: name ?? st.toolName,
          argumentsText: REDACTED_TOOL_ARGS,
        }),
      );
      return out;
    }

    st.argsDoneEmitted = true;
    st.args = argumentsText;
    out.push(
      createResponseFunctionCallArgumentsDoneEvent({
        outputIndex: st.outputIndex,
        itemId: st.itemId,
        name: name ?? st.toolName,
        argumentsText,
      }),
    );
    return out;
  }

  private onFunctionCallDone(
    streamId: string,
    callId: string,
    name: string,
    argumentsText: string,
  ): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];
    out.push(...this.ensureFunctionCallStarted(streamId, callId, name));

    const st = this.functionCalls.get(callId);
    if (!st || st.itemDoneEmitted) return out;

    out.push(...this.onFunctionCallArgsDone(streamId, callId, argumentsText, name));
    out.push(...this.flushFunctionCall(st));
    return out;
  }

  private flushFunctionCall(st: FunctionCallState): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];
    if (st.itemDoneEmitted) return out;

    out.push(...this.ensureFunctionCallAdded(st));
    out.push(...this.flushPendingFunctionCallArgs(st));

    if (!st.argsDoneEmitted) {
      out.push(...this.onFunctionCallArgsDone(st.streamId, st.callId, st.args, st.toolName));
    }

    st.itemDoneEmitted = true;
    out.push(
      createResponseOutputItemDoneFunctionCallEvent({
        outputIndex: st.outputIndex,
        itemId: st.itemId,
        callId: st.callId,
        name: st.toolName,
        argumentsText: st.args,
      }),
    );
    return out;
  }

  private flushPendingFunctionCallArgs(st: FunctionCallState): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];
    if (!st.addedEmitted) return out;

    for (const delta of st.pendingArgsDeltas) {
      out.push(...this.onFunctionCallArgsDelta(st.streamId, st.callId, delta));
    }
    st.pendingArgsDeltas = [];

    if (st.pendingArgsDone) {
      const done = st.pendingArgsDone;
      st.pendingArgsDone = null;
      out.push(
        ...this.onFunctionCallArgsDone(st.streamId, st.callId, done.argumentsText, done.name),
      );
    }

    return out;
  }
}
