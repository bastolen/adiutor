'use client';

/**
 * @file The company's section tabs (`SegmentTabNav`), with its Requests tab
 * current on both views of the company's requests: the list (the company's
 * first page) and the board below it.
 */
import { useSelectedLayoutSegment } from 'next/navigation';
import type { ComponentProps } from 'react';

import SegmentTabNav from '@/components/ui/segment-tab-nav';
import { COMPANY_BOARD_SEGMENT } from '@/lib/requests';

/**
 * The company layout's tabs. The Requests tab opens the company's first
 * page (no segment below the layout), and stays the open section on the
 * company's board (`COMPANY_BOARD_SEGMENT`), its other view of the same
 * requests: there, it's handed the board's segment, so `SegmentTabNav`
 * marks it current (`aria-current="page"`) as on the list.
 */
export default function CompanyTabs({ label, items }: ComponentProps<typeof SegmentTabNav>) {
  const current = useSelectedLayoutSegment();
  const onBoard = current === COMPANY_BOARD_SEGMENT;
  return (
    <SegmentTabNav
      label={label}
      items={items.map((item) =>
        onBoard && item.segment === null ? { ...item, segment: COMPANY_BOARD_SEGMENT } : item,
      )}
    />
  );
}
