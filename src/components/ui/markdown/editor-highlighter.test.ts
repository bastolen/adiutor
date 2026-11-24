/**
 * @file Tests for loading the languages of highlighted code: a failed
 * download is tried again by the next call instead of being kept.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('loadCodeLanguages', () => {
  afterEach(() => {
    vi.doUnmock('./languages');
    vi.resetModules();
  });

  it('tries again after a failed download, and then knows the languages', async () => {
    vi.resetModules();
    vi.doMock('./languages', () => {
      throw new Error('The chunk could not be loaded');
    });
    const { loadCodeLanguages, knownCodeLanguages } = await import('./editor-highlighter');

    await expect(loadCodeLanguages()).rejects.toThrow();
    expect(knownCodeLanguages()).toBeNull();

    vi.doMock('./languages', () => ({
      CODE_LANGUAGES: {},
      CODE_LANGUAGE_CHOICES: [],
      /**
       * Stands in for naming a language.
       *
       * @returns No name.
       */
      codeLanguageName: () => null,
    }));
    await expect(loadCodeLanguages()).resolves.toBeUndefined();
    expect(knownCodeLanguages()).not.toBeNull();
  });
});
