/**
 * @file Tests for the icon row.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import IconRow from './icon-row';

/**
 * Renders a row inside a list, as it is used.
 *
 * @param props - Props to pass on to the row.
 * @param props.truncateTitle - Cut the title off with an ellipsis.
 * @param props.iconClassName - Extra classes for the icon's box.
 * @param props.subtitle - A line below the title.
 * @returns The list item.
 */
function renderRow({
  truncateTitle = false,
  iconClassName = undefined,
  subtitle = undefined,
}: { truncateTitle?: boolean; iconClassName?: string; subtitle?: string | null } = {}) {
  render(
    <ul>
      <IconRow
        icon={<svg data-testid="icon" />}
        iconClassName={iconClassName}
        title="Passkey"
        truncateTitle={truncateTitle}
        subtitle={subtitle}
        control={<button type="button">Rename</button>}
      >
        On this device only
      </IconRow>
    </ul>,
  );
  return screen.getByRole('listitem');
}

describe('IconRow', () => {
  it('shows the title, the explanation and the control in a list item', () => {
    const row = renderRow();

    expect(row).toHaveTextContent('PasskeyOn this device only');
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });

  it('shows a subtitle below the title, whole, wrapping where it must', () => {
    const name = 'jane.tester.with.a.long.address@mail.adiutor-tests.test';
    const row = renderRow({ subtitle: name });

    expect(row).toHaveTextContent(`Passkey${name}On this device only`);
    expect(screen.getByText(name)).toHaveClass('break-all');
    expect(screen.getByText(name)).not.toHaveClass('truncate');
  });

  it('leaves the subtitle out when there is none', () => {
    const row = renderRow({ subtitle: null });

    expect(row.textContent).toBe('PasskeyOn this device onlyRename');
  });

  it('hides the icon from screen readers', () => {
    renderRow();

    expect(screen.getByTestId('icon').parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('leaves the icon colour to the caller', () => {
    renderRow();
    expect(screen.getByTestId('icon').parentElement).not.toHaveClass('text-muted-foreground');
  });

  it('adds the caller’s classes to the icon box', () => {
    renderRow({ iconClassName: 'text-muted-foreground' });

    expect(screen.getByTestId('icon').parentElement).toHaveClass(
      'size-9',
      'bg-surface',
      'text-muted-foreground',
    );
  });

  it('cuts the title off only when asked to', () => {
    renderRow({ truncateTitle: true });
    expect(screen.getByText('Passkey')).toHaveClass('truncate', 'text-sm', 'font-medium');
  });

  it('wraps the title by default', () => {
    renderRow();
    expect(screen.getByText('Passkey')).not.toHaveClass('truncate');
  });
});
