/**
 * @file The card for request types on the Requests tab of Settings: each type in its order,
 * with what it's for and its starting priority, and the buttons to add one,
 * edit, reorder, archive and restore. Its text comes from
 * `admin.settings.requests.requestTypes` (the dialog's through `ClientMessages`).
 */
import { useTranslations } from 'next-intl';

import Badge from '@/components/ui/badge';
import Card from '@/components/ui/card';
import RowAction from '@/components/ui/row-action';
import { REQUEST_PRIORITIES } from '@/lib/requests';
import type { RequestTypeView } from '@/server/requests';

import { PriorityBadge } from '../../../_requests/request-badges';
import {
  archiveRequestTypeAction,
  moveRequestTypeAction,
  restoreRequestTypeAction,
} from './actions';
import RequestTypeDialog from './request-type-dialog';

/**
 * The card. Types are a short list in an order the staff choose, so they're
 * a list with Up and Down buttons rather than a table that sorts and pages.
 * Up on the first type and Down on the last are off but stay focusable
 * (moving a type there would otherwise drop keyboard focus). Archiving asks
 * first; its button then becomes Restore, and focus goes to the card's
 * heading (`RowAction`). The last type that isn't archived can't be
 * archived: the service refuses it, and says why.
 *
 * @param props - Component props.
 * @param props.types - Every type, in order, with its starting priority (staff Admins get it).
 */
export default function RequestTypesCard({ types }: { types: readonly RequestTypeView[] }) {
  const t = useTranslations('admin.settings.requests.requestTypes');
  const tRequests = useTranslations('requests');
  const priorities = REQUEST_PRIORITIES.map((value) => ({
    value,
    label: tRequests('priority', { priority: value }),
  }));

  return (
    <Card
      id="request-types"
      title={t('title')}
      description={t('description')}
      actions={<RequestTypeDialog priorities={priorities} />}
    >
      <ul aria-label={t('listLabel')} className="-my-3 divide-y divide-border">
        {types.map((type, index) => {
          const fields = { type: type.key, name: type.name };
          return (
            <li
              key={type.key}
              className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium wrap-anywhere text-foreground">
                  {type.name}
                  {type.startingPriority && <PriorityBadge priority={type.startingPriority} />}
                  {type.archived && <Badge>{t('archived')}</Badge>}
                </p>
                <p className="text-sm wrap-anywhere text-muted-foreground">{type.description}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {type.startingPriority && (
                  <RequestTypeDialog
                    type={{ ...type, startingPriority: type.startingPriority }}
                    priorities={priorities}
                  />
                )}
                <RowAction
                  action={moveRequestTypeAction}
                  fields={{ ...fields, direction: 'up' }}
                  label={t('moveUp')}
                  ariaLabel={t('moveUpLabel', { name: type.name })}
                  variant="ghost"
                  disabled={index === 0}
                  focusableWhenDisabled
                />
                <RowAction
                  action={moveRequestTypeAction}
                  fields={{ ...fields, direction: 'down' }}
                  label={t('moveDown')}
                  ariaLabel={t('moveDownLabel', { name: type.name })}
                  variant="ghost"
                  disabled={index === types.length - 1}
                  focusableWhenDisabled
                />
                {type.archived ? (
                  <RowAction
                    action={restoreRequestTypeAction}
                    fields={fields}
                    label={t('restore')}
                    ariaLabel={t('restoreLabel', { name: type.name })}
                  />
                ) : (
                  <RowAction
                    action={archiveRequestTypeAction}
                    fields={fields}
                    label={t('archive')}
                    ariaLabel={t('archiveLabel', { name: type.name })}
                    variant="danger-subtle"
                    confirm={{
                      title: t('archiveTitle', { name: type.name }),
                      description: t('archiveDescription'),
                      confirmLabel: t('archiveConfirm'),
                    }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
