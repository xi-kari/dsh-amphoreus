export const USER_PLAIN = {
  type: 'user/message',
  seq: 3,
  time: 1,
  data: {
    id: 'm1',
    role: 'user',
    content: [{ type: 'text', text: '帮我看看这个' }],
    source: { kind: 'user' },
  },
}

export const USER_NO_SOURCE = {
  type: 'user/message',
  seq: 3,
  time: 1,
  data: {
    id: 'm1',
    role: 'user',
    content: [{ type: 'text', text: '旧格式' }],
  },
}

export const SKILL_INJECT = {
  type: 'user/message',
  seq: 2,
  time: 1,
  data: {
    id: 'm0',
    role: 'user',
    content: [{ type: 'text', text: '<skill_content name="amphoreus-cyrene">…FIXTURE_SKILL_BODY…</skill_content>' }],
    source: { kind: 'skill-invocation', name: 'amphoreus-cyrene', form: 'instructions' },
  },
}

export const SYSTEM_REMINDER = {
  type: 'user/message',
  seq: 2,
  time: 1,
  data: {
    id: 'm0',
    role: 'user',
    content: [{ type: 'text', text: '<system-reminder>\nA skill is a reusable set…' }],
    source: { kind: 'skill-catalog', form: 'catalog', entries: [] },
  },
}

export const SYSTEM_REMINDER_NO_SOURCE = {
  type: 'user/message',
  seq: 2,
  time: 1,
  data: {
    id: 'm0',
    role: 'user',
    content: [{ type: 'text', text: '<system-reminder>\nA skill is a reusable set…' }],
  },
}

export const RUNTIME_CONTEXT = {
  type: 'user/message',
  seq: 1,
  time: 1,
  data: {
    id: 'm',
    role: 'user',
    content: [{
      type: 'text',
      text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots. …',
    }],
    source: { kind: 'plugin', plugin: 'runtime-context' },
  },
}

export const COMPACT_CHECKPOINT = {
  type: 'user/message',
  seq: 9,
  time: 1,
  data: {
    id: 'c',
    role: 'user',
    content: [{ type: 'text', text: '摘要…' }],
    source: { kind: 'plugin', plugin: 'compact' },
  },
}

export const ASSISTANT = {
  type: 'assistant/message',
  seq: 5,
  time: 2,
  data: {
    turn: 1,
    step: 1,
    message: {
      id: 'a1',
      role: 'assistant',
      content: [{ type: 'text', text: 'FIXTURE_ANSWER' }],
      source: { kind: 'model' },
    },
  },
}

export const TURN_START = {
  type: 'turn/start',
  seq: 0,
  time: 0,
  data: { turn: 1 },
}

export const TOOL_CALL = {
  type: 'tool/call',
  seq: 4,
  time: 2,
  data: { turn: 1, step: 1, callId: 'call-1', name: 'Read', arguments: '{"path":"x"}' },
}

export const TOOL_RESULT = {
  type: 'tool/result',
  seq: 6,
  time: 2,
  data: {
    turn: 1,
    step: 1,
    message: {
      content: [{ type: 'tool-result', content: [{ type: 'text', text: 'FIXTURE_TOOL_RESULT' }] }],
      source: { kind: 'tool', callId: 'call-1' },
    },
  },
}

export const TURN_END_ERROR = {
  type: 'turn/end',
  seq: 7,
  time: 3,
  data: { turn: 1, reason: { kind: 'error', error: { message: 'boom', code: 'UNKNOWN' } } },
}

export const TURN_END_ABORTED = {
  type: 'turn/end',
  seq: 7,
  time: 3,
  data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } },
}

export const TURN_END_INTERRUPTED = {
  type: 'turn/end',
  seq: 7,
  time: 3,
  data: { turn: 1, reason: { kind: 'interrupted' } },
}

export const TURN_END_COMPLETED = {
  type: 'turn/end',
  seq: 7,
  time: 3,
  data: { turn: 1, reason: { kind: 'completed' } },
}

export const TURN_END_MAX_TOKENS = {
  type: 'turn/end',
  seq: 7,
  time: 3,
  data: { turn: 1, reason: { kind: 'max-tokens' } },
}
