/**
 * @file Tests for the labels of a request.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LOCALES } from '@/lib/i18n/locales';
import translator from '@/lib/i18n/translator';
import { REQUEST_PRIORITIES, REQUEST_STATUSES, REQUEST_TYPES } from '@/lib/requests';

import renderInLocale from '../../../../tests/i18n/render';
import { PriorityBadge, ReopenedBadge, StatusBadge, TypeBadge } from './request-badges';

describe('StatusBadge', () => {
  it.each([
    ['open', 'Open'],
    ['todo', 'To do'],
    ['in_progress', 'In progress'],
    ['done', 'Done'],
    ['cancelled', 'Cancelled'],
  ] as const)('names %s the same for everyone', (status, label) => {
    render(<StatusBadge status={status} audience="follower" />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it.each([
    ['contributor', 'Waiting for your reply'],
    ['follower', 'Waiting for your company'],
    ['staff', 'Waiting for the company'],
  ] as const)('tells a %s who a waiting request waits for', (audience, label) => {
    render(<StatusBadge status="waiting" audience={audience} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('ReopenedBadge, TypeBadge and PriorityBadge', () => {
  it('say that a request was reopened, and what type it is', () => {
    render(
      <>
        <ReopenedBadge />
        <TypeBadge type="new_feature" />
      </>,
    );

    expect(screen.getByText('Reopened')).toBeInTheDocument();
    expect(screen.getByText('New feature')).toBeInTheDocument();
  });

  it('names the priority on its own, and leaves "priority" out next to a label that says it', () => {
    render(
      <>
        <PriorityBadge priority="high" />
        <PriorityBadge priority="low" short />
      </>,
    );

    expect(screen.getByText('High priority')).toBeInTheDocument();
    expect(screen.getByText('Low')).toBeInTheDocument();
  });

  it.each([
    ['nl-NL', ['Wacht op jouw reactie', 'Heropend', 'Support', 'Lage prioriteit', 'Hoog']],
    ['es-ES', ['A la espera de tu respuesta', 'Reabierta', 'Soporte', 'Prioridad baja', 'Alta']],
  ] as const)('speak %s', (locale, labels) => {
    renderInLocale(
      locale,
      <>
        <StatusBadge status="waiting" audience="contributor" />
        <ReopenedBadge />
        <TypeBadge type="support" />
        <PriorityBadge priority="low" />
        <PriorityBadge priority="high" short />
      </>,
    );

    labels.forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
  });
});

describe('the request labels in every language', () => {
  it.each(LOCALES)('name every status, type and priority in %s', (locale) => {
    const t = translator(locale, 'requests');
    const unknown = t('status', { status: 'nonsense', audience: 'staff' });
    const labels = [
      ...REQUEST_STATUSES.flatMap((status) =>
        (['staff', 'contributor', 'follower'] as const).map((audience) =>
          t('status', { status, audience }),
        ),
      ),
      ...REQUEST_TYPES.map((type) => t('type', { type })),
      ...REQUEST_PRIORITIES.map((priority) => t('priority', { priority })),
      ...REQUEST_PRIORITIES.map((priority) => t('priorityBadge', { priority })),
    ];

    labels.forEach((label) => {
      expect(label).not.toBe('');
      expect(label).not.toBe(unknown);
    });
    // Each status has its own name, and so has each type and each priority.
    /**
     *
     * @param values
     */
    /**
     * How many different names a list of labels has.
     *
     * @param values - The labels.
     * @returns The number of distinct ones.
     */
    const names = (values: string[]) => new Set(values).size;
    expect(
      names(REQUEST_STATUSES.map((status) => t('status', { status, audience: 'staff' }))),
    ).toBe(REQUEST_STATUSES.length);
    expect(names(REQUEST_TYPES.map((type) => t('type', { type })))).toBe(REQUEST_TYPES.length);
    expect(names(REQUEST_PRIORITIES.map((priority) => t('priority', { priority })))).toBe(
      REQUEST_PRIORITIES.length,
    );
  });
});
