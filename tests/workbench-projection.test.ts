import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectableEvent } from '../src/host/workbench.ts'
import {
  ASSISTANT,
  COMPACT_CHECKPOINT,
  RUNTIME_CONTEXT,
  SKILL_INJECT,
  SYSTEM_REMINDER,
  SYSTEM_REMINDER_NO_SOURCE,
  TURN_END_ABORTED,
  TURN_END_COMPLETED,
  TURN_END_ERROR,
  TURN_END_INTERRUPTED,
  TURN_END_MAX_TOKENS,
  TURN_START,
  USER_NO_SOURCE,
  USER_PLAIN,
} from './fixtures/session-events.ts'

test('projects only ordinary user, assistant, and terminal error events', () => {
  assert.equal(projectableEvent(USER_PLAIN)?.kind, 'user')
  assert.equal(projectableEvent(USER_NO_SOURCE)?.kind, 'user')

  assert.equal(projectableEvent(SKILL_INJECT), null)
  assert.equal(projectableEvent(SYSTEM_REMINDER), null)
  assert.equal(projectableEvent(SYSTEM_REMINDER_NO_SOURCE), null)
  assert.equal(projectableEvent(RUNTIME_CONTEXT), null)
  assert.equal(projectableEvent(COMPACT_CHECKPOINT), null)

  assert.equal(projectableEvent(ASSISTANT)?.kind, 'assistant')
  assert.equal(projectableEvent(TURN_START), null)

  assert.equal(projectableEvent(TURN_END_ERROR)?.kind, 'error')
  assert.equal(projectableEvent(TURN_END_ABORTED)?.kind, 'error')
  assert.equal(projectableEvent(TURN_END_INTERRUPTED)?.kind, 'error')
  assert.equal(projectableEvent(TURN_END_COMPLETED), null)
  assert.equal(projectableEvent(TURN_END_MAX_TOKENS), null)
})
