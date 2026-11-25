/**
 * @file The Storage card's content while the server's environment chooses
 * where files are kept: what it chose, without any secret, and that it
 * can't be changed here. Its text comes from
 * `admin.settings.attachments.storage`.
 */
import { useTranslations } from 'next-intl';

import Alert from '@/components/ui/alert';
import { DescriptionList, DescriptionRow } from '@/components/ui/description-list';
import SetByEnvironment from '@/components/ui/set-by-environment';
import type { StorageView } from '@/lib/storage';

/**
 * The storage's settings as a list, by driver.
 *
 * @param props - List props.
 * @param props.view - The storage, without its secrets.
 */
function StorageDetails({ view }: { view: StorageView }) {
  const t = useTranslations('admin.settings.attachments.storage');
  const driverNames = {
    local: t('drivers.local'),
    s3: t('drivers.s3'),
    sftp: t('drivers.sftp'),
  };
  return (
    <DescriptionList>
      <DescriptionRow term={t('driver')}>{driverNames[view.driver]}</DescriptionRow>
      {view.driver === 'local' && (
        <DescriptionRow term={t('dir')}>
          <code className="wrap-anywhere">{view.dir}</code>
        </DescriptionRow>
      )}
      {view.driver === 's3' && (
        <>
          <DescriptionRow term={t('endpoint')}>
            <span className="wrap-anywhere">{view.endpoint}</span>
          </DescriptionRow>
          <DescriptionRow term={t('region')}>{view.region}</DescriptionRow>
          <DescriptionRow term={t('bucket')}>
            <span className="wrap-anywhere">{view.bucket}</span>
          </DescriptionRow>
          <DescriptionRow term={t('accessKeyId')}>
            <code className="wrap-anywhere">{view.accessKeyId}</code>
          </DescriptionRow>
          <DescriptionRow term={t('bucketAddress')}>
            {view.forcePathStyle ? t('inPath') : t('inHost')}
          </DescriptionRow>
        </>
      )}
      {view.driver === 'sftp' && (
        <>
          <DescriptionRow term={t('host')}>
            <span className="wrap-anywhere">{view.host}</span>
          </DescriptionRow>
          <DescriptionRow term={t('port')}>{view.port}</DescriptionRow>
          <DescriptionRow term={t('username')}>
            <span className="wrap-anywhere">{view.username}</span>
          </DescriptionRow>
          <DescriptionRow term={t('signsInWith')}>
            {view.signsInWith === 'key' ? t('signsInWithKey') : t('signsInWithPassword')}
          </DescriptionRow>
          <DescriptionRow term={t('hostKey')}>
            <code className="wrap-anywhere">{view.hostKey}</code>
          </DescriptionRow>
          <DescriptionRow term={t('dir')}>
            <code className="wrap-anywhere">{view.dir}</code>
          </DescriptionRow>
        </>
      )}
    </DescriptionList>
  );
}

/**
 * What the environment chose, or that it turned attachments off.
 *
 * @param props - Props.
 * @param props.view - The storage, without its secrets; `null` when the environment turned attachments off.
 */
export default function EnvironmentStorage({ view }: { view: StorageView | null }) {
  const t = useTranslations('admin.settings.attachments.storage');
  if (view === null) {
    return <Alert tone="info">{t('offInEnvironment')}</Alert>;
  }
  return (
    <SetByEnvironment variable="ATTACHMENTS_STORAGE">
      <StorageDetails view={view} />
    </SetByEnvironment>
  );
}
