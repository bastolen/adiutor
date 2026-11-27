/**
 * @file The mail server card of Settings (decision 0045): the mail server emails go
 * out through and their sender, saved and tried here, and the email that
 * tells every staff Admin of a change. Sending itself is in
 * `src/lib/email.ts`, which reads the saved mail server.
 *
 * This is the module's public API: nothing outside this folder imports its
 * files directly.
 */
export { type MailServerChange, serverName, smtpChangedEmailFor } from './notice';
export {
  getSmtpSettings,
  saveSmtpSettings,
  type SendThrough,
  type SmtpEnvironment,
  type SmtpSettings,
} from './settings';
