import { ConsoleEmailSender } from "./console-sender";
import { createSesEmailSender } from "./ses-sender";
import type { RenderedEmail } from "./templates";

export interface EmailSender {
  send(to: string, email: RenderedEmail): Promise<void>;
}

export function getEmailSender(): EmailSender {
  const transport = process.env.EMAIL_TRANSPORT ?? "console";
  switch (transport) {
    case "console":
      return new ConsoleEmailSender();
    case "ses":
      return createSesEmailSender();
    default:
      throw new Error(`Unknown EMAIL_TRANSPORT: ${transport}`);
  }
}
