import type { EmailMessage, EmailSender } from "./sender";

export class ConsoleEmailSender implements EmailSender {
  sendVerification(msg: EmailMessage): Promise<void> {
    this.write("VERIFY EMAIL", msg);
    return Promise.resolve();
  }

  sendPasswordReset(msg: EmailMessage): Promise<void> {
    this.write("RESET PASSWORD", msg);
    return Promise.resolve();
  }

  private write(label: string, msg: EmailMessage) {
    const lines = [
      "",
      "==================== EMAIL (console transport) ====================",
      `[${label}]`,
      `  to:  ${msg.to}`,
      `  url: ${msg.url}`,
      "===================================================================",
      "",
    ];
    process.stderr.write(`${lines.join("\n")}\n`);
  }
}
