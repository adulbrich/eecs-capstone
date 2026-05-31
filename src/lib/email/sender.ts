import { ConsoleEmailSender } from "./console-sender";

export interface EmailMessage {
  to: string;
  url: string;
}

export interface EmailSender {
  sendPasswordReset(msg: EmailMessage): Promise<void>;
  sendVerification(msg: EmailMessage): Promise<void>;
}

export function getEmailSender(): EmailSender {
  const transport = process.env.EMAIL_TRANSPORT ?? "console";
  switch (transport) {
    case "console":
      return new ConsoleEmailSender();
    default:
      throw new Error(`Unknown EMAIL_TRANSPORT: ${transport}`);
  }
}
