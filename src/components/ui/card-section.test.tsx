/**
 * @file Tests for the parts of a card: each is a group named by its own
 * heading, a level below the card's, with its description and controls.
 */
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Card from './card';
import CardSection, { CardSections } from './card-section';

describe('CardSection', () => {
  it('names each part by its heading, a level below the card’s', () => {
    render(
      <Card title="Attachments" flush>
        <CardSections>
          <CardSection title="Largest file" description="The largest file anyone may attach.">
            <button type="button">Save size</button>
          </CardSection>
          <CardSection title="Where files are kept">
            <button type="button">Test and save storage</button>
          </CardSection>
        </CardSections>
      </Card>,
    );

    expect(screen.getByRole('heading', { level: 2, name: 'Attachments' })).toBeInTheDocument();
    const largest = screen.getByRole('group', { name: 'Largest file' });
    expect(within(largest).getByRole('heading', { level: 3 })).toHaveTextContent('Largest file');
    expect(within(largest).getByText('The largest file anyone may attach.')).toBeInTheDocument();
    expect(within(largest).getByRole('button', { name: 'Save size' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Where files are kept' })).getByRole('button', {
        name: 'Test and save storage',
      }),
    ).toBeInTheDocument();
  });

  it('shows no description when there is none', () => {
    render(
      <CardSection title="Where files are kept">
        <span>Fields</span>
      </CardSection>,
    );

    expect(screen.getByRole('group', { name: 'Where files are kept' })).toHaveTextContent(
      /^Where files are keptFields$/,
    );
  });
});
