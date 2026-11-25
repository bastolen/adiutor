/**
 * @file Finds the region the toasts are shown in.
 */
import { screen } from '@testing-library/react';

/**
 * Finds the toast region (named "Notifications ...").
 *
 * @returns The region.
 */
export default function toastRegion(): HTMLElement {
  return screen.getByRole('region', { name: /^Notifications/ });
}
