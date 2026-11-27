/**
 * @file Sample requests for local development, so the request pages have
 * something to show: every status and type, a reopened request, requests
 * raised by the company and by the staff, a conversation with replies from
 * both sides, requests assigned to one or two staff members, one request
 * written in Markdown with every kind of formatting, and two internal requests
 * (the staff's own, without a company: decision 0048). Used by
 * `scripts/seed-dev.ts`.
 */
import {
  FORMATTED_CLIENT_REPLY,
  FORMATTED_DESCRIPTION,
  FORMATTED_STAFF_REPLY,
} from '../tests/database/formatted-request';
import type { SamplePerson, SampleRequest } from '../tests/database/store-requests';

/** An hour in milliseconds. */
const HOUR = 60 * 60 * 1000;

/** A day in milliseconds. */
const DAY = 24 * HOUR;

/** The seeded users and companies the samples are about. */
export interface SampleRequestWorld {
  /** "Adiutor Tests Alpha". */
  alpha: string;
  /** "Adiutor Tests Beta". */
  beta: string;
  /** "Adiutor Tests Gamma", which is deactivated: its requests can only be read. */
  gamma: string;
  /** Avery Alpha, Alpha's Admin. */
  alphaAdmin: string;
  /** Casey Client, a Client in Alpha. */
  alphaClient: string;
  /** Mika Multi, Beta's Admin (and a Watcher in Alpha). */
  multi: string;
  /** Gale Gamma, Gamma's Admin. */
  gammaAdmin: string;
  /** Sam Support, on the staff (and a Client in Alpha, where they still act as staff). */
  support: string;
  /** Morgan Manager, on the staff. */
  manager: string;
}

/**
 * Builds the sample requests, from the last three weeks.
 *
 * @param world - IDs of the seeded companies and users.
 * @returns The requests, in the order of their numbers.
 */
export default function sampleRequests(world: SampleRequestWorld): SampleRequest[] {
  const now = Date.now();
  /**
   * A time before now.
   *
   * @param days - How many days before.
   * @param hours - And how many hours.
   * @returns The time.
   */
  const ago = (days: number, hours = 0) => new Date(now - days * DAY - hours * HOUR);
  const avery: SamplePerson = { id: world.alphaAdmin, side: 'company' };
  const casey: SamplePerson = { id: world.alphaClient, side: 'company' };
  const mika: SamplePerson = { id: world.multi, side: 'company' };
  const gale: SamplePerson = { id: world.gammaAdmin, side: 'company' };
  const sam: SamplePerson = { id: world.support, side: 'staff' };
  const morgan: SamplePerson = { id: world.manager, side: 'staff' };

  return [
    {
      companyId: world.alpha,
      title: 'Export invoices as CSV',
      description:
        'Our bookkeeper would like to download all invoices of a month as one CSV file.\n\nNot urgent.',
      type: 'new_feature',
      priority: 'low',
      status: 'cancelled',
      raisedBy: casey,
      at: ago(20),
      entries: [
        { by: morgan, at: ago(19), change: 'status', from: 'open', to: 'todo' },
        {
          by: casey,
          at: ago(12),
          reply: 'Our bookkeeper found another way, so this is no longer needed.',
        },
        { by: casey, at: ago(12), change: 'status', from: 'todo', to: 'cancelled' },
      ],
    },
    {
      companyId: world.alpha,
      title: 'New colleague needs access to the shared mailbox',
      description:
        'Raised after a phone call with Avery: Robin starts on Monday and needs the info@ mailbox.',
      type: 'support',
      priority: 'normal',
      status: 'done',
      raisedBy: sam,
      at: ago(10),
      entries: [
        { by: sam, at: ago(10), change: 'status', from: 'open', to: 'in_progress' },
        { by: sam, at: ago(9), reply: 'Robin has access now. Can you confirm it works?' },
        { by: sam, at: ago(9), change: 'status', from: 'in_progress', to: 'waiting' },
        { by: avery, at: ago(8), reply: 'It works, thank you!' },
        { by: avery, at: ago(8), change: 'status', from: 'waiting', to: 'in_progress' },
        { by: avery, at: ago(8), change: 'status', from: 'in_progress', to: 'done' },
      ],
    },
    {
      companyId: world.alpha,
      title: 'Wrong address on invoices',
      description: 'Invoices still show our old address at Keizersgracht. We moved in March.',
      type: 'bug',
      priority: 'normal',
      status: 'open',
      reopened: true,
      raisedBy: avery,
      at: ago(9),
      entries: [
        { by: morgan, at: ago(8), change: 'status', from: 'open', to: 'in_progress' },
        { by: morgan, at: ago(7), reply: 'Fixed: new invoices show the new address.' },
        { by: morgan, at: ago(7), change: 'status', from: 'in_progress', to: 'done' },
        {
          by: avery,
          at: ago(1, 2),
          reply: 'The PDF is right now, but the email that carries it still has the old address.',
        },
        { by: avery, at: ago(1, 2), change: 'status', from: 'done', to: 'open' },
      ],
    },
    {
      companyId: world.alpha,
      title: 'Update the opening hours on the website',
      description: 'Our opening hours change next month. Can you update them on the website?',
      type: 'support',
      priority: 'normal',
      status: 'waiting',
      raisedBy: casey,
      at: ago(6),
      entries: [
        { by: sam, at: ago(5), change: 'status', from: 'open', to: 'todo' },
        { by: sam, at: ago(2), change: 'status', from: 'todo', to: 'in_progress' },
        {
          by: sam,
          at: ago(0, 5),
          reply:
            'Done on the test site: https://adiutor.test/preview\n\nPlease check it, and we’ll publish it.',
        },
        { by: sam, at: ago(0, 5), change: 'status', from: 'in_progress', to: 'waiting' },
      ],
    },
    {
      companyId: world.alpha,
      title: 'Dark mode for the customer portal',
      description: 'Several customers asked whether the portal can follow their dark mode setting.',
      type: 'new_feature',
      priority: 'normal',
      status: 'todo',
      raisedBy: avery,
      at: ago(4),
      entries: [
        {
          by: morgan,
          at: ago(3),
          change: 'title',
          from: 'Dark mode',
          to: 'Dark mode for the customer portal',
        },
        { by: morgan, at: ago(3), change: 'priority', from: 'low', to: 'normal' },
        { by: morgan, at: ago(3), change: 'status', from: 'open', to: 'todo' },
      ],
    },
    {
      companyId: world.alpha,
      title: 'Checkout shows an error after paying',
      description:
        'Since this morning customers see “Something went wrong” after they pay.\nThe payment itself goes through.',
      type: 'hotfix',
      priority: 'high',
      status: 'in_progress',
      raisedBy: avery,
      at: ago(0, 7),
      entries: [
        { by: sam, at: ago(0, 6), change: 'status', from: 'open', to: 'in_progress' },
        { by: sam, at: ago(0, 6), assign: 'assigned', subject: world.support },
        { by: sam, at: ago(0, 6), reply: 'We’re on it and will let you know within the hour.' },
      ],
      assignees: [world.support],
    },
    {
      companyId: world.alpha,
      title: 'The printer on floor 2 prints blank pages',
      description: 'It started after the last toner change. The one on floor 1 works.',
      type: 'bug',
      priority: 'normal',
      raisedBy: casey,
      at: ago(0, 3),
    },
    {
      companyId: world.beta,
      title: 'The newsletter sign-up form is broken',
      description: 'Submitting the form on the home page does nothing.',
      type: 'bug',
      priority: 'high',
      status: 'waiting',
      raisedBy: mika,
      at: ago(3),
      entries: [
        { by: morgan, at: ago(3), change: 'priority', from: 'normal', to: 'high' },
        { by: morgan, at: ago(2), change: 'status', from: 'open', to: 'in_progress' },
        { by: morgan, at: ago(2), assign: 'assigned', subject: world.manager },
        { by: morgan, at: ago(2), reply: 'Which browser are you using when it does nothing?' },
        { by: morgan, at: ago(2), change: 'status', from: 'in_progress', to: 'waiting' },
      ],
      assignees: [world.manager],
    },
    {
      companyId: world.beta,
      title: 'Set up a test site',
      description: 'We’d like to try changes before they go live.',
      type: 'new_feature',
      priority: 'low',
      raisedBy: mika,
      at: ago(1),
    },
    {
      companyId: world.gamma,
      title: 'Renew the SSL certificate',
      description: 'The certificate of our shop expires at the end of the month.',
      type: 'support',
      priority: 'normal',
      status: 'in_progress',
      raisedBy: gale,
      at: ago(15),
      entries: [{ by: sam, at: ago(14), change: 'status', from: 'open', to: 'in_progress' }],
    },
    {
      // Written in Markdown, with every kind of formatting a request can show.
      companyId: world.alpha,
      title: 'Move the intranet to the new server',
      description: FORMATTED_DESCRIPTION,
      type: 'new_feature',
      priority: 'low',
      status: 'in_progress',
      raisedBy: avery,
      at: ago(6),
      entries: [
        { by: sam, at: ago(5), change: 'status', from: 'open', to: 'in_progress' },
        { by: sam, at: ago(5), assign: 'assigned', subject: world.support },
        { by: sam, at: ago(5), assign: 'assigned', subject: world.manager },
        { by: sam, at: ago(4), reply: FORMATTED_STAFF_REPLY },
        { by: avery, at: ago(3), reply: FORMATTED_CLIENT_REPLY, mentions: [sam] },
      ],
      assignees: [world.support, world.manager],
    },
    {
      // The staff's own: no company sees it.
      companyId: null,
      title: 'Renew the certificate of the mail server',
      description:
        'It runs out next week. Morgan, can you order the new one? Then I’ll install it.',
      type: 'support',
      priority: 'high',
      status: 'in_progress',
      raisedBy: sam,
      at: ago(2),
      entries: [
        { by: sam, at: ago(2), change: 'status', from: 'open', to: 'in_progress' },
        { by: sam, at: ago(2), assign: 'assigned', subject: world.support },
        { by: morgan, at: ago(1, 4), reply: 'Ordered. It should arrive tomorrow.' },
      ],
      assignees: [world.support],
    },
    {
      companyId: null,
      title: 'Write the hand-over for the holidays',
      description: 'Who covers which companies in the last two weeks of the year.',
      type: 'support',
      priority: 'normal',
      status: 'done',
      raisedBy: morgan,
      at: ago(9),
      entries: [{ by: morgan, at: ago(8), change: 'status', from: 'open', to: 'done' }],
    },
  ];
}
