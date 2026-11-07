/**
 * @file Decorative example of a request, shown on the brand panel of the
 * public pages to show what Adiutor is for.
 */
import { Check } from 'lucide-react';

import Avatar from '@/components/ui/avatar';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';

/** The example conversation: a company user asks, the staff answers. `initials` feed the avatars. */
const MESSAGES = [
  {
    author: 'You',
    initials: 'Y',
    when: 'Mon',
    staff: false,
    text: 'Our opening hours change next month. Can you update them on the website?',
  },
  {
    author: 'Adiutor Support',
    initials: 'AS',
    when: 'Tue',
    staff: true,
    text: "Done on the test site. Please check it and approve, and we'll publish it.",
  },
] as const;

/**
 * An example request card with its conversation and approval buttons, with a
 * second card behind it for depth. Purely decorative: it's meant for a panel
 * hidden from assistive technology, and it's `inert`, so nothing in it can be
 * focused, clicked, hovered or selected. The buttons are decorative
 * look-alikes without hover, focus or press effects.
 *
 * @returns The example request.
 */
export default function RequestPreview() {
  return (
    <div inert className="pointer-events-none relative w-full max-w-md cursor-default select-none">
      <div className="absolute inset-x-6 -bottom-3 h-full rounded-xl border border-border bg-surface/60" />
      <div className="relative flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 text-foreground shadow-2xl">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-muted-foreground">REQ-142</span>
            <Badge tone="warning">Waiting for your approval</Badge>
          </div>
          <p className="text-base font-semibold">Update the opening hours on the website</p>
        </div>
        <ol className="flex flex-col gap-3 border-t border-border pt-4">
          {MESSAGES.map((message) => (
            <li key={message.author} className="flex gap-3">
              <Avatar name={message.initials} size="sm" brand={message.staff} />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-xs">
                  <span className="font-medium">{message.author}</span>
                  <span className="text-muted-foreground"> · {message.when}</span>
                </p>
                <p className="rounded-lg bg-muted px-3 py-2 text-sm">{message.text}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex justify-end gap-2">
          <Button decorative variant="secondary" size="sm">
            Reply
          </Button>
          <Button decorative size="sm">
            <Check aria-hidden="true" />
            Approve
          </Button>
        </div>
      </div>
    </div>
  );
}
