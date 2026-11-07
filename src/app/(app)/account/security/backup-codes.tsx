/**
 * @file Shows backup codes once, with ways to keep them.
 */
'use client';

import { Download } from 'lucide-react';

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
  const text = codes.join('\n');

  /** Saves the codes as a text file. */
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Adiutor backup codes\n\n${text}\n`]));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'adiutor-backup-codes.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Use one of these if you can&apos;t use your authenticator app. Each works once. Keep them
        somewhere safe, like a password manager: they won&apos;t be shown again.
      </p>
      <ul
        aria-label="Backup codes"
        className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-raised-muted p-4 font-mono text-sm"
      >
        {codes.map((code) => (
          <li key={code} className="text-center tracking-wider">
            {code}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <CopyButton value={text} label="Copy codes" />
        <Button variant="secondary" size="sm" onClick={download}>
          <Download aria-hidden="true" />
          Download
        </Button>
      </div>
      <Button onClick={onDone}>I&apos;ve saved these codes</Button>
    </div>
  );
}
