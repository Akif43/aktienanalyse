export interface NotifyInput {
  title: string;
  message: string;
  /** Link, der beim Antippen der Benachrichtigung geöffnet wird. */
  url?: string;
}

export interface Notifier {
  send(input: NotifyInput): Promise<void>;
}
