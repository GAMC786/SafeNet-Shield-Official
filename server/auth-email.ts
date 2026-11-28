type AuthEmailOptions = {
  to: string;
  subject: string;
  url: string;
  action: "verify your email" | "reset your password";
};

export async function sendAuthEmail({ to, subject, url, action }: AuthEmailOptions) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is required to send authentication emails.");

  const safeUrl = url
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "SafeNet <noreply@auth.safenetinc.ca>",
      to: [to],
      subject,
      text: `Use this secure link to ${action}: ${url}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Use this secure link to ${action}:</p><p><a href="${safeUrl}">Continue to SafeNet</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
  });
  if (!response.ok) {
    console.error("Resend rejected a SafeNet authentication email.", response.status);
    throw new Error("SafeNet could not send the authentication email.");
  }
}
