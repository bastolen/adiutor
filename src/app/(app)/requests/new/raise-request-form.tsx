/**
 * @file The form that raises a request. Its text comes from the `requests`
 * namespace, which the page passes through `ClientMessages`, and the label of
 * a company that shares its name from `common`.
 */
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import Button from '@/components/ui/button';
import MarkdownField from '@/components/ui/markdown/markdown-field';
import ResultAlert from '@/components/ui/result-alert';
import SelectField from '@/components/ui/select-field';
import { ChangesFieldset, useSignedInAs } from '@/components/ui/signed-in-as';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { companyChoiceLabels } from '@/lib/company-choices';
import { REQUEST_TEXT_MAX_LENGTH, REQUEST_TITLE_MAX_LENGTH } from '@/lib/input-rules';
import { REQUEST_PRIORITIES, REQUEST_TYPES } from '@/lib/requests';

import raiseRequestAction from './actions';

/** The priority select's first choice: leave the priority to the request's type. */
const FROM_TYPE = 'from-type';

/** A company a request can be raised in. */
interface RaisableCompany {
  /** Its URL name, which the form sends. */
  slug: string;
  /** Its name. */
  name: string;
}

/**
 * Props for {@link RaiseRequestForm}.
 */
interface RaiseRequestFormProps {
  /** The companies the viewer may raise a request in: at least one. */
  companies: readonly RaisableCompany[];
  /** The company to start with (its URL name), e.g. the one whose page the viewer came from. */
  company?: string;
  /** Whether the viewer chooses a priority: the staff who work on requests. */
  choosesPriority: boolean;
}

/**
 * A form with the request's company (a select only when there's more than
 * one to choose from, naming a company by its URL name too when another has
 * the same name: `companyChoiceLabels`), title, type and description. Each type says what it's
 * for. The staff also get a priority, which the type sets unless they choose
 * one; nobody else sees a priority. A refused request keeps what was typed;
 * a raised one opens its page.
 *
 * @param props - Form props.
 * @param props.companies - The companies to choose from.
 * @param props.company - The company to start with.
 * @param props.choosesPriority - Whether to show the priority.
 * @returns The form.
 */
export default function RaiseRequestForm({
  companies,
  company = undefined,
  choosesPriority,
}: RaiseRequestFormProps) {
  const t = useTranslations('requests');
  const tCommon = useTranslations('common');
  // Changes are turned off while a staff member is signed in as the user.
  const changesOff = useSignedInAs();
  const [result, formAction, pending, onSubmit] = useTransientActionState(raiseRequestAction, null);
  const [priority, setPriority] = useState(FROM_TYPE);
  const [only] = companies;

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ChangesFieldset>
        <ResultAlert result={result} errorsOnly />
        {companies.length === 1 && only ? (
          <input type="hidden" name="company" value={only.slug} />
        ) : (
          <SelectField
            label={t('new.company')}
            name="company"
            options={companyChoiceLabels(companies, ({ name, slug }) =>
              tCommon('companyWithUrlName', { name, urlName: slug }),
            ).map(({ slug, label }) => ({ value: slug, label }))}
            defaultValue={company ?? ''}
            placeholder={t('new.companyPlaceholder')}
            disabled={changesOff}
          />
        )}
        <TextField
          label={t('new.titleLabel')}
          name="title"
          maxLength={REQUEST_TITLE_MAX_LENGTH}
          description={t('new.titleHint')}
          autoComplete="off"
          required
          disabled={changesOff}
        />
        <SelectField
          label={t('new.typeLabel')}
          name="type"
          options={REQUEST_TYPES.map((value) => ({
            value,
            label: t('type', { type: value }),
            description: t('typeDescription', { type: value }),
          }))}
          defaultValue=""
          placeholder={t('new.typePlaceholder')}
          disabled={changesOff}
        />
        <MarkdownField
          label={t('new.descriptionLabel')}
          name="description"
          rows={14}
          maxLength={REQUEST_TEXT_MAX_LENGTH}
          description={t('new.descriptionHint')}
          required
          disabled={changesOff}
        />
        {choosesPriority && (
          <>
            {/* The select can't hold an empty value, so "set by the type" is sent as none. */}
            <input type="hidden" name="priority" value={priority === FROM_TYPE ? '' : priority} />
            <SelectField
              label={t('new.priorityLabel')}
              options={[
                { value: FROM_TYPE, label: t('new.priorityFromType') },
                ...REQUEST_PRIORITIES.map((value) => ({
                  value,
                  label: t('priority', { priority: value }),
                })),
              ]}
              value={priority}
              onValueChange={setPriority}
              description={t('new.priorityHint')}
              disabled={changesOff}
            />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending} disabled={changesOff}>
            {t('new.submit')}
          </Button>
          <Button asChild variant="secondary">
            <Link href="/requests">{t('new.cancel')}</Link>
          </Button>
        </div>
      </ChangesFieldset>
    </form>
  );
}
