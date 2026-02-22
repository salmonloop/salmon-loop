import { formatCanonicalFunctionCallItemId } from './function-call-item-id.js';
import {
  createResponseFunctionCallArgumentsDeltaEvent,
  createResponseFunctionCallArgumentsDoneEvent,
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
};

type TextStreamState = {
  contentPartAdded: boolean;
  outputTextDone: boolean;
  contentPartDone: boolean;
  messageItemDone: boolean;
  text: string;
};

type FunctionCallState = {
  streamId: string;
  callId: string;
  argsItemId: string;
  toolName: string;
  args: string;
  addedEmitted: boolean;
  argsDeltaEmitted: boolean;
  argsDoneEmitted: boolean;
  itemDoneEmitted: boolean;
  pendingArgsDeltas: string[];
  pendingArgsDone: { argumentsText: string; name?: string } | null;
};

// CRITICAL SAFETY: tool arguments may include file contents, secrets, or user data.
// Canonical events are safe-by-default, so arguments must be redacted unless explicitly opted in.
const REDACTED_TOOL_ARGS = '{}';

/**
 * A provider-agnostic canonical responses event generator.
 *
 * This emitter intentionally only solves event translation + minimal state (ids/indexes),
 * leaving message/block assembly to `StreamAssembler` and protocol encoding to adapters.
 */
export class CanonicalResponsesEventEmitter {
  private readonly toolArgsMode: 'redact' | 'allow';

  private readonly textStreams = new Map<string, TextStreamState>();
  private readonly functionCalls = new Map<string, FunctionCallState>();

  constructor(options: CanonicalResponsesEventEmitterOptions = {}) {
    this.toolArgsMode = options.toolArgs ?? 'redact';
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
        text: st.text,
        logprobs,
      }),
    );

    return out;
  }

  private ensureTextStream(streamId: string): TextStreamState {
    const existing = this.textStreams.get(streamId);
    if (existing) return existing;

    const st: TextStreamState = {
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
      {
        type: 'response.output_item.added',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'in_progress',
          content: [],
        },
      },
      {
        type: 'response.content_part.added',
        part: { type: 'output_text', text: '', annotations: [] },
      },
    ];
  }

  private flushTextStream(st: TextStreamState): CanonicalResponsesEvent[] {
    const out: CanonicalResponsesEvent[] = [];

    out.push(...this.ensureTextContentPartAdded(st));

    if (!st.outputTextDone && !st.messageItemDone) {
      st.outputTextDone = true;
      out.push(
        createResponseOutputTextDoneEvent({
          text: st.text,
          logprobs: [],
        }),
      );
    }

    if (!st.contentPartDone && !st.messageItemDone) {
      st.contentPartDone = true;
      out.push({
        type: 'response.content_part.done',
        part: { type: 'output_text', text: st.text, annotations: [] },
      });
    }

    if (!st.messageItemDone) {
      st.messageItemDone = true;
      out.push({
        type: 'response.output_item.done',
        item: {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [{ type: 'output_text', text: st.text, annotations: [] }],
        },
      });
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

    const argsItemId = formatCanonicalFunctionCallItemId(callId);

    const st: FunctionCallState = {
      streamId,
      callId,
      argsItemId,
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
      {
        type: 'response.output_item.added',
        item: {
          type: 'function_call',
          call_id: st.callId,
          name: st.toolName,
          arguments: '',
          status: 'in_progress',
        },
      },
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
          itemId: st.argsItemId,
          delta: REDACTED_TOOL_ARGS,
        }),
      );
      return out;
    }

    st.args += delta;
    out.push(
      createResponseFunctionCallArgumentsDeltaEvent({
        itemId: st.argsItemId,
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
            itemId: st.argsItemId,
            delta: REDACTED_TOOL_ARGS,
          }),
        );
      }

      st.argsDoneEmitted = true;
      st.args = REDACTED_TOOL_ARGS;
      out.push(
        createResponseFunctionCallArgumentsDoneEvent({
          itemId: st.argsItemId,
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
        itemId: st.argsItemId,
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
    out.push({
      type: 'response.output_item.done',
      item: {
        type: 'function_call',
        call_id: st.callId,
        name: st.toolName,
        arguments: st.args,
        status: 'completed',
      },
    });
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
