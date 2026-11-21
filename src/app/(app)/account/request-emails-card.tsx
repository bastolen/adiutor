/**
 * @file The "Emails about requests" card on the Profile page: whether the
 * user gets emails about requests at all, and a button to turn them off or
 * back on. Those emails' footers link here (`#request-emails`). Text from
 * `account.profile`.
 */
import { useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';

import { REQUEST_EMAILS_SECTION } from './account-messages';
import { requestEmailsAction } from './actions';

/**
 * Says what the emails about requests are and whether they're on, with the
 * button that switches them (the action's message is the toast). The button
 * stays where it is when its text changes, so the keyboard keeps its place.
 *
 * @param props - Component props.
 * @param props.on - Whether the user gets them now.
 * @returns The card.
 */
export default function RequestEmailsCard({ on }: { on: boolean }) {
  const t = useTranslations('account.profile');
  return (
    <Card
      id={REQUEST_EMAILS_SECTION}
      title={t('requestEmailsTitle')}
      description={t('requestEmailsDescription')}
      actions={
        on ? (
          <Badge tone="success">{t('requestEmailsOn')}</Badge>
        ) : (
          <Badge>{t('requestEmailsOff')}</Badge>
        )
      }
    >
      <div className="flex justify-end">
        <RowAction
          action={requestEmailsAction}
          fields={{ on: on ? 'false' : 'true' }}
          label={on ? t('requestEmailsTurnOff') : t('requestEmailsTurnOn')}
        />
      </div>
    </Card>
  );
}
