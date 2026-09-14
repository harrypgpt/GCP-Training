export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Injection token for the active {@link MailTransport} implementation. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * Low-level "send one email" port. Swappable per environment (console vs
 * SMTP) without the rest of the app knowing which one is active.
 */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}
