/**
 * @file Shows backup codes once, with ways to keep them.
 */
'use client';

import { Download } from 'lucide-react';
import { useTranslations } from 'next-intl';

import Button from '@/components/ui/button';
import CopyButton from '@/components/ui/copy-button';

/**
 * The backup codes in a grid, with Copy and Download buttons. They can't be
 * shown again later, which the text says.
 *
 * @param props - Component props.
 * @param props.codes - The codes.
 * @param props.onDone - Called when the user confirms they've saved them.
 * @returns The codes.
 */
export default function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useTranslations('account');
  const text = codes.join('\n');

  /** Saves the codes as a text file, under a heading. */
  const download = () => {
    const url = URL.createObjectURL(new Blob([t('security.backupCodes.file', { codes: text })]));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'adiutor-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">{t('security.backupCodes.intro')}</p>
      <ul
        aria-label={t('security.backupCodes.label')}
        className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-raised-muted p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code} className="text-center tracking-wider">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={text} label={t('security.backupCodes.copy')} />
        <Button variant="secondary" size="sm" onClick={download}>
          <Download aria-hidden="true" />
          {t('security.backupCodes.download')}
        </Button>
      </div>
      <Button onClick={onDone}>{t('security.backupCodes.saved')}</Button>
    </div>
  );
}
