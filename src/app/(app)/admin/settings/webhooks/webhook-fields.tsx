/**
 * @file The fields of a webhook's form, for adding one and for changing one:
 * its name, address, format, request types and events. Their text comes from
 * `admin.settings.webhooks.fields`, which the page passes through `ClientMessages`.
 */
'use client';

import { useTranslations } from 'next-intl';

import CheckboxField from '@/components/ui/checkbox-field';
import RadioField from '@/components/ui/radio-field';
import TextField from '@/components/ui/text-field';
import { useTransientState } from '@/components/ui/use-transient-state';
import { WEBHOOK_NAME_MAX_LENGTH, WEBHOOK_URL_MAX_LENGTH } from '@/lib/input-rules';
import {
  WEBHOOK_EVENTS,
  WEBHOOK_FORMATS,
  type WebhookEvent,
  type WebhookFormat,
} from '@/lib/webhooks';

/** A request type a webhook can cover. */
export interface WebhookTypeChoice {
  /** Its key. */
  key: string;
  /** Its name. */
  name: string;
  /** Whether it's archived: offered only when the webhook covers it already. */
  archived: boolean;
}

/** A webhook as its form starts from, when it's changed. */
export interface EditedWebhook {
  /** Its name. */
  name: string;
  /** How it's sent. */
  format: WebhookFormat;
  /** What it's told about. */
  events: readonly WebhookEvent[];
  /** Whether it covers every type. */
  allTypes: boolean;
  /** The types it covers otherwise. */
  types: readonly string[];
}

/** Props for {@link WebhookFields}. */
interface WebhookFieldsProps {
  /** The request types, in order. */
  types: readonly WebhookTypeChoice[];
  /** The webhook to change; without one, the fields are for a new webhook. */
  webhook?: EditedWebhook;
}

/**
 * The fields, posted as `name`, `url`, `format`, `allTypes` (`true` or
 * `false`), `types` and `events` (each as often as chosen). The address is
 * required for a new webhook; for one that's there, an empty address keeps
 * the saved one, which is never shown. The types to choose from appear once
 * "Chosen types" is picked. Under the events, a note says that internal
 * notes and priorities are for the staff alone.
 */
export default function WebhookFields({ types, webhook = undefined }: WebhookFieldsProps) {
  const t = useTranslations('admin.settings.webhooks');
  const [allTypes, setAllTypes] = useTransientState(webhook?.allTypes ?? true);
  const chosenTypes = new Set(webhook?.types ?? []);
  const chosenEvents = new Set<WebhookEvent>(webhook?.events ?? ['raised', 'reply', 'status']);
  const offered = types.filter((type) => !type.archived || chosenTypes.has(type.key));

  return (
    <>
      <TextField
        label={t('fields.nameLabel')}
        name="name"
        maxLength={WEBHOOK_NAME_MAX_LENGTH}
        defaultValue={webhook?.name}
        description={t('fields.nameHint')}
        autoComplete="off"
        required
      />
      <TextField
        label={t('fields.urlLabel')}
        name="url"
        type="url"
        inputMode="url"
        maxLength={WEBHOOK_URL_MAX_LENGTH}
        description={webhook ? t('fields.urlKeepHint') : t('fields.urlHint')}
        autoComplete="off"
        spellCheck={false}
        required={!webhook}
      />
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium text-foreground">
          {t('fields.formatLabel')}
        </legend>
        {WEBHOOK_FORMATS.map((format) => (
          <RadioField
            key={format}
            name="format"
            value={format}
            label={t(`format.${format}`)}
            description={
              format === 'json' ? t('fields.formatJsonHint') : t('fields.formatChatHint')
            }
            defaultChecked={(webhook?.format ?? 'json') === format}
          />
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium text-foreground">
          {t('fields.typesLegend')}
        </legend>
        <input type="hidden" name="allTypes" value={String(allTypes)} />
        <RadioField
          name="typeChoice"
          value="all"
          label={t('allTypes')}
          description={t('fields.allTypesHint')}
          checked={allTypes}
          onChange={() => setAllTypes(true)}
        />
        <RadioField
          name="typeChoice"
          value="chosen"
          label={t('fields.chosenTypes')}
          checked={!allTypes}
          onChange={() => setAllTypes(false)}
        />
        {!allTypes && (
          <div className="flex flex-col gap-3 ps-8">
            {offered.map((type) => (
              <CheckboxField
                key={type.key}
                name="types"
                value={type.key}
                label={type.name}
                defaultChecked={chosenTypes.has(type.key)}
              />
            ))}
          </div>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-sm font-medium text-foreground">
          {t('fields.eventsLegend')}
        </legend>
        {WEBHOOK_EVENTS.map((event) => (
          <CheckboxField
            key={event}
            name="events"
            value={event}
            label={t(`events.${event}`)}
            defaultChecked={chosenEvents.has(event)}
          />
        ))}
        <p className="text-xs text-muted-foreground">{t('fields.staffOnly')}</p>
      </fieldset>
    </>
  );
}
