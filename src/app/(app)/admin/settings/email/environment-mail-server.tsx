/**
 * @file The Mail server card's content while the server's environment
 * chooses the mail server (`SMTP_URL`): what it chose, without its password,
 * the sender emails go out from, and that it can't be changed here. Its text
 * comes from `admin.settings.email.server`.
 */
import { useTranslations } from 'next-intl';

import Alert from '@/components/ui/alert';
import { DescriptionList, DescriptionRow } from '@/components/ui/description-list';
import SetByEnvironment from '@/components/ui/set-by-environment';
import type { SmtpView } from '@/lib/smtp';

/**
 * What the environment chose.
 *
 * @param props - Props.
 * @param props.view - The mail server, without its password; `null` when its URL can't be read.
 * @param props.sender - The sender emails go out from, as one line.
 */
export default function EnvironmentMailServer({
  view,
  sender,
}: {
  view: Omit<SmtpView, 'from'> | null;
  sender: string;
}) {
  const t = useTranslations('admin.settings.email.server');
  if (view === null) {
    return <Alert tone="info">{t('unreadable')}</Alert>;
  }
  return (
    <SetByEnvironment variable="SMTP_URL">
      <DescriptionList>
        <DescriptionRow term={t('host')}>
          <span className="wrap-anywhere">{view.host}</span>
        </DescriptionRow>
        <DescriptionRow term={t('port')}>{view.port}</DescriptionRow>
        <DescriptionRow term={t('security')}>{t(`securities.${view.security}`)}</DescriptionRow>
        <DescriptionRow term={t('signsIn')}>
          {view.username ? (
            <span className="wrap-anywhere">{view.username}</span>
          ) : (
            t('signsInNone')
          )}
        </DescriptionRow>
        <DescriptionRow term={t('sender')}>
          <span className="wrap-anywhere">{sender}</span>
        </DescriptionRow>
      </DescriptionList>
    </SetByEnvironment>
  );
}
