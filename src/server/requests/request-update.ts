/**
 * @file What an email about a request is made of: the news queued for one
 * person ({@link QueuedRequestNews}, IDs only), and what their email may show
 * ({@link RequestUpdate}), read when it's sent (`readRequestUpdate` in
 * `read-request-update.ts`).
 */
import type {
  RequestAudience,
  RequestParticipantRole,
  RequestSide,
  RequestStatus,
  RequestTextFormat,
} from '@/lib/requests';

import type { RequestUpdateEvent } from '../queue';

/** A queued piece of news for one person, as the batch that sends it hands it over. */
export interface QueuedRequestNews {
  /** The queued job's ID. Job IDs are in the order the news was queued. */
  jobId: string;
  /** What happened. */
  event: RequestUpdateEvent;
  /** The entry it's about, if it has one. */
  entryId: string | null;
  /** Who did it, where no entry says so. */
  byUserId: string | null;
}

/** A text in an email about a request, with the people it mentions by name and its files. */
export interface RequestUpdateText {
  /** The text, as it's stored. */
  text: string;
  /** The format it's stored in. */
  format: RequestTextFormat;
  /** The names of the people it mentions, by the ID its markers name. */
  mentions: Record<string, string>;
  /**
   * The files attached to it, oldest first: their names and sizes only, as
   * they are when the email is sent (a removed one is left out). The email
   * names them; the request's page downloads them (decision 0044).
   */
  attachments: { name: string; size: number }[];
}

/** One thing an email about a request tells its reader. Each names who did it, as the request's page names them. */
export type RequestUpdateItem =
  | {
      /** Someone replied. */
      event: 'reply';
      /** Who. */
      by: string;
      /** The reply. */
      text: RequestUpdateText;
    }
  | {
      /** Someone wrote an internal note: only ever for a reader who reads notes. */
      event: 'note';
      /** Who. */
      by: string;
      /** The note. */
      text: RequestUpdateText;
    }
  | {
      /** Someone changed the status. */
      event: 'status';
      /** Who. */
      by: string;
      /** The side they changed it as: the company's answer to a solution reads differently. */
      bySide: RequestSide;
      /** The status it had. */
      from: RequestStatus;
      /** The status it got. */
      to: RequestStatus;
    }
  | {
      /** Someone assigned the request to the reader. */
      event: 'assigned';
      /** Who. */
      by: string;
    }
  | {
      /** Someone mentioned the reader. */
      event: 'mentioned';
      /** Who. */
      by: string;
      /** Where: in the request's description, a reply, or an internal note (for the staff). */
      where: 'description' | 'reply' | 'note';
      /** The text that mentions them. */
      text: RequestUpdateText;
    }
  | {
      /** Someone subscribed the reader to the request. */
      event: 'subscribed';
      /** Who. */
      by: string;
    }
  | {
      /** A staff member raised the request for the reader (decision 0047). */
      event: 'raised';
      /** Who. */
      by: string;
      /** Its description, as it is by now. */
      text: RequestUpdateText;
    };

/** What one person's email about a request may show. */
export interface RequestUpdate {
  /** Where it goes, and the language its reader saved. */
  recipient: {
    /** Their email address: for sending only, never shown. */
    email: string;
    /** The language they saved, or `null` for Adiutor's default. */
    locale: string | null;
  };
  /** Why they get it: the request is assigned to them, or they're subscribed to it. */
  role: RequestParticipantRole;
  /** How to word the request's statuses for them. */
  audience: RequestAudience;
  /** The request. */
  request: {
    /** Its number, for its address. */
    number: number;
    /** Its number as people see it, e.g. "AD-142". */
    reference: string;
    /** Its title. */
    title: string;
    /** Its company's name; `null` for an internal request, which has none. */
    companyName: string | null;
  };
  /** What happened, in the order it was queued. */
  items: RequestUpdateItem[];
  /**
   * Where on the request's page the email's link opens: the anchor of the
   * first news it tells of that has a place there (an entry of the activity,
   * `#entry-<ID>`, or the description for a mention in it or a request
   * raised for the reader), or `null` when
   * none has one (being subscribed leaves no entry).
   */
  anchor: string | null;
  /**
   * The proposal the reader may answer from the email (Approve and Deny,
   * decision 0033): only when the news includes the change that made the
   * request wait for approval, the request still waits for that proposal,
   * and the reader may answer it (`mayAnswerSolution`).
   */
  answerable?: { proposalEntryId: string };
  /** The jobs whose news isn't in the email, because what they were about is gone. */
  skipped: string[];
}
