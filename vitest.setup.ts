/**
 * @file Runs before every Vitest test file.
 *
 * Registers Testing Library's DOM matchers (e.g. `toBeInTheDocument()`) and
 * unmounts rendered components after each test.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
