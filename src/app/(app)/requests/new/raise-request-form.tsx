/**
 * @file The form that raises a request. Its text comes from the `requests`
 * namespace, which the page passes through `ClientMessages`, and the label of
 * a company that shares its name from `common`.
 */
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';

import Button from '@/components/ui/button';
import MarkdownField from '@/components/ui/markdown/markdown-field';
import ResultAlert from '@/components/ui/result-alert';
import SelectField from '@/components/ui/select-field';
import TextField from '@/components/ui/text-field';
import { useTransientActionState } from '@/components/ui/use-transient-state';
import { companyChoiceLabels } from '@/lib/company-choices';
import { REQUEST_TEXT_MAX_LENGTH, REQUEST_TITLE_MAX_LENGTH } from '@/lib/input-rules';
import { INTERNAL_CHOICE, REQUEST_PRIORITIES } from '@/lib/requests';

import AttachmentPicker, { type Attaching } from '../../_requests/attachment-picker';
import { mentionChoicesAction } from '../../_requests/mention-actions';
import raiseRequestAction, { raiseForChoicesAction } from './actions';

/** The priority select's first choice: leave the priority to the request's type. */
const FROM_TYPE = 'from-type';

/** The first choice of who it's raised for: the staff member raises it themself. */
const FOR_SELF = 'self';

/** A company a request can be raised in. */
interface RaisableCompany {
  /** Its URL name, which the form sends. */
  slug: string;
  /** Its name. */
  name: string;
}

/** A type a request can be raised with. */
interface RaisableType {
  /** Its key, which the form sends. */
  key: string;
  /** Its name. */
  name: string;
  /** What it's for. */
  description: string;
}

/** Someone at the company the staff can raise a request for. */
interface RaiseForChoice {
  /** Their key in the company, which the form sends. */
  key: string;
  /** Their name. */
  name: string;
}

/**
 * Props for {@link RaiseRequestForm}.
 */
interface RaiseRequestFormProps {
  /** The types to choose from, in order: the ones that aren't archived. */
  types: readonly RaisableType[];
  /** The companies the viewer may raise a request in: at least one, unless they raise internal ones. */
  companies: readonly RaisableCompany[];
  /**
   * Whether the viewer may raise an internal request (decision 0048): the staff who work on
   * requests. The company select then always shows, with "Internal" first.
   */
  raisesInternal?: boolean;
  /**
   * The company to start with (its URL name, or `INTERNAL_CHOICE`), e.g. the one whose page the
   * viewer came from.
   */
  company?: string;
  /** Whether the viewer chooses a priority: the staff who work on requests. */
  choosesPriority: boolean;
  /** What attaching needs, while people can attach files to the description. */
  attaching?: Attaching | null;
  /** Whether the viewer can raise it for someone at the company: the staff who work on requests. */
  raisesFor?: boolean;
  /** Who it can be raised for in the company chosen already, if one is; by name. */
  raiseForChoices?: readonly RaiseForChoice[];
}

/**
 * A form with the request's company (a select only when there's more than
 * one to choose from, naming a company by its URL name too when another has
 * the same name: `companyChoiceLabels`), title, type and description. Each type says what it's
 * for. The staff who work on requests always get the select, with "Internal"
 * first: an internal request, which has no company and only the staff read
 * (decision 0048), also when there's one company to choose from. The staff
 * also choose who it's for, themselves or an Admin or Client
 * of the company who asked them (the people come with the company chosen
 * already, and are asked for when another is chosen, which puts the choice
 * back to themselves; an internal request is their own, so the choice isn't
 * there), and get a priority, which the type sets unless they choose one;
 * nobody else sees either. While people can attach files, files go with the
 * description (`AttachmentPicker`), and the request waits for them to
 * upload. A refused request keeps what was typed and attached; a raised one
 * opens its page.
 */
export default function RaiseRequestForm({
  types,
  companies,
  raisesInternal = false,
  company = undefined,
  choosesPriority,
  attaching = null,
  raisesFor = false,
  raiseForChoices = [],
}: RaiseRequestFormProps) {
  const t = useTranslations('requests');
  const tCommon = useTranslations('common');
  const [result, formAction, pending, onSubmit] = useTransientActionState(raiseRequestAction, null);
  const [priority, setPriority] = useState(FROM_TYPE);
  // Whether a file is uploading, which the request waits for.
  const [uploading, setUploading] = useState(false);
  const [only] = companies;
  // With one company and no internal requests to raise, there's nothing to choose.
  const fixed = !raisesInternal && companies.length === 1 && only ? only : null;
  // The company the request is for, as far as it's chosen: who the description can mention
  // depends on it.
  const [chosen, setChosen] = useState(fixed ? fixed.slug : (company ?? ''));
  const internal = chosen === INTERNAL_CHOICE;
  const loadMentions = useCallback(
    () => (chosen ? mentionChoicesAction({ company: chosen }) : Promise.resolve([])),
    [chosen],
  );
  // Who it's raised for, among the people of the chosen company: asked for when it changes.
  const [forChoices, setForChoices] = useState(raiseForChoices);
  const [raisedFor, setRaisedFor] = useState(FOR_SELF);
  const [loadingFor, setLoadingFor] = useState(false);
  // Only the answer for the company chosen last counts.
  const latestCompany = useRef('');
  /**
   * Chooses the company and, for the staff, asks for its people, putting
   * who it's raised for back to themselves meanwhile. An internal request
   * has nobody to ask for.
   *
   * @param slug - The company's URL name, or `INTERNAL_CHOICE`.
   */
  const chooseCompany = (slug: string) => {
    setChosen(slug);
    if (!raisesFor) {
      return;
    }
    latestCompany.current = slug;
    setRaisedFor(FOR_SELF);
    setForChoices([]);
    if (slug === INTERNAL_CHOICE) {
      setLoadingFor(false);
      return;
    }
    setLoadingFor(true);
    /**
     * Shows the people of the company, unless another was chosen meanwhile.
     *
     * @param people - Who it can be raised for there.
     */
    const show = (people: readonly RaiseForChoice[]) => {
      if (latestCompany.current === slug) {
        setForChoices(people);
        setLoadingFor(false);
      }
    };
    raiseForChoicesAction(slug).then(show, () => show([]));
  };

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-5">
      <ResultAlert result={result} errorsOnly />
      {fixed ? (
        <input type="hidden" name="company" value={fixed.slug} />
      ) : (
        <SelectField
          label={t('new.company')}
          name="company"
          options={[
            ...(raisesInternal ? [{ value: INTERNAL_CHOICE, label: t('internal.label') }] : []),
            ...companyChoiceLabels(companies, ({ name, slug }) =>
              tCommon('companyWithUrlName', { name, urlName: slug }),
            ).map(({ slug, label }) => ({ value: slug, label })),
          ]}
          defaultValue={company ?? ''}
          onValueChange={chooseCompany}
          placeholder={t('new.companyPlaceholder', { internal: raisesInternal ? 'yes' : 'no' })}
          description={internal ? t('new.internalHint') : undefined}
        />
      )}
      {raisesFor && !internal && (
        <>
          {/* The select can't hold an empty value, so the staff member themself is sent as none. */}
          <input type="hidden" name="raised_for" value={raisedFor === FOR_SELF ? '' : raisedFor} />
          <SelectField
            label={t('new.raiseForLabel')}
            options={[
              { value: FOR_SELF, label: t('new.raiseForSelf') },
              ...forChoices.map(({ key, name }) => ({ value: key, label: name })),
            ]}
            value={raisedFor}
            onValueChange={setRaisedFor}
            busy={loadingFor}
            description={t('new.raiseForHint')}
          />
        </>
      )}
      <TextField
        label={t('new.titleLabel')}
        name="title"
        maxLength={REQUEST_TITLE_MAX_LENGTH}
        description={t('new.titleHint')}
        autoComplete="off"
        required
      />
      <SelectField
        label={t('new.typeLabel')}
        name="type"
        options={types.map(({ key, name, description }) => ({
          value: key,
          label: name,
          description,
        }))}
        defaultValue=""
        placeholder={t('new.typePlaceholder')}
      />
      <MarkdownField
        label={t('new.descriptionLabel')}
        name="description"
        rows={14}
        maxLength={REQUEST_TEXT_MAX_LENGTH}
        description={t('new.descriptionHint')}
        required
        mentions={loadMentions}
        // Only the staff read an internal request: its links to their pages stay links.
        staffOnly={internal}
      />
      {attaching && (
        <AttachmentPicker maxFileMb={attaching.maxFileMb} onUploadingChange={setUploading} />
      )}
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
          />
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          loading={pending}
          disabled={uploading}
          focusableWhenDisabled={uploading}
        >
          {t('new.submit')}
        </Button>
        <Button asChild variant="secondary">
          <Link href="/requests">{tCommon('actions.cancel')}</Link>
        </Button>
      </div>
    </form>
  );
}
