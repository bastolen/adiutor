/**
 * @file Tests for declaring a kind of queued job: one whose name isn't
 * kebab-case stops the app from loading.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { defineQueuedKind } from './define';

describe('defineQueuedKind', () => {
  it('takes a kebab-case name, and refuses anything else', () => {
    const payload = z.object({ userId: z.uuid() });

    expect(defineQueuedKind({ name: 'adiutor-tests', payload }).name).toBe('adiutor-tests');
    expect(() => defineQueuedKind({ name: 'adiutor tests', payload })).toThrow(
      'The kind of queued job "adiutor tests" needs a kebab-case name',
    );
  });
});
