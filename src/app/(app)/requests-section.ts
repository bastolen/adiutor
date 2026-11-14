/**
 * @file The Requests section of the app, which everyone signed in gets:
 * declared once for the sidebar (`NavLinks`) and the dashboard's tile
 * (`Shortcuts`), like the staff sections (`staff-sections.ts`). Its text is
 * in `navigation.items` and `dashboard.shortcuts`.
 */
import { Inbox } from 'lucide-react';

/**
 * The Requests section: every request the viewer may see. Its sidebar link is
 * current on its path and everything under it (a request, the form for a new
 * one).
 */
const REQUESTS_SECTION = { key: 'requests', href: '/requests', icon: Inbox } as const;

export default REQUESTS_SECTION;
