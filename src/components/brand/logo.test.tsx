/**
 * @file Tests for the logo: Adiutor's in both versions without an upload,
 * and the uploaded one, once, at the height asked for and its own width.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BrandLogoProvider } from './brand-logo';
import Logo from './logo';

describe('Logo', () => {
  it('shows Adiutor’s logo, with its light-text version for dark mode, without an upload', () => {
    const { container } = render(<Logo height={32} />);

    const images = [...container.querySelectorAll('img')];
    expect(images.map((image) => image.getAttribute('src'))).toEqual([
      expect.stringContaining('logo.svg'),
      expect.stringContaining('logo-on-dark.svg'),
    ]);
    expect(images.every((image) => image.getAttribute('alt') === '')).toBe(true);
  });

  it('shows the uploaded logo once, in both modes, at the height asked for', () => {
    const { container } = render(
      <BrandLogoProvider logo={{ src: '/branding/logo?v=logo-1', width: 560, height: 160 }}>
        <Logo height={32} priority />
      </BrandLogoProvider>,
    );

    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    const [image] = images;
    expect(image).toHaveAttribute('src', '/branding/logo?v=logo-1');
    expect(image).toHaveAttribute('alt', '');
    expect(image).toHaveAttribute('width', '112');
    expect(image).toHaveAttribute('height', '32');
    expect(image).toHaveAttribute('fetchpriority', 'high');
    // Narrower room shrinks it, keeping its shape.
    expect(image).toHaveClass('max-w-full', 'object-contain');
    expect(image).not.toHaveClass('dark:hidden');
  });
});
