import type { EmailSender } from "./sender";
import type { RenderedEmail } from "./templates";

export class ConsoleEmailSender implements EmailSender {
  send(to: string, email: RenderedEmail): Promise<void> {
    const lines = [
      "",
      "==================== EMAIL (console transport) ====================",
      `  to:      ${to}`,
      `  subject: ${email.subject}`,
      "",
      email.text,
      "===================================================================",
      "",
    ];
    process.stderr.write(`${lines.join("\n")}\n`);
    return Promise.resolve();
  }
}
