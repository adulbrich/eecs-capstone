import { buildEmailSenderConfig } from "./config";
import { ConsoleEmailSender } from "./console-sender";
import { createSesEmailSender } from "./ses-sender";
import type { RenderedEmail } from "./templates";

export interface EmailSender {
  send(to: string, email: RenderedEmail): Promise<void>;
}

export function getEmailSender(
  env: NodeJS.ProcessEnv = process.env
): EmailSender {
  const config = buildEmailSenderConfig(env);
  switch (config.transport) {
    case "console":
      return new ConsoleEmailSender();
    case "ses":
      return createSesEmailSender(config);
    default:
      throw new Error(`Unknown EMAIL_TRANSPORT: ${config.transport}`);
  }
}
