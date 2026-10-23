import nodemailer from "nodemailer";
import { getSettings, type ServerSettings } from "./settings";
import { decrypt } from "./crypto";

type Smtp = { host: string; port: string; user: string; pass: string | null; from: string };

function transport(s: Smtp) {
  const port = Number(s.port) || 587;
  return nodemailer.createTransport({ host: s.host, port, secure: port === 465, auth: s.user ? { user: s.user, pass: s.pass || "" } : undefined, connectionTimeout: 10000, greetingTimeout: 10000 });
}

export async function sendWith(s: Smtp, to: string, subject: string, text: string) {
  await transport(s).sendMail({ from: s.from, to, subject, text });
}

export async function sendMail(to: string, subject: string, text: string, settings?: ServerSettings): Promise<boolean> {
  const st = settings || (await getSettings());
  if (!st.email.ok || !st.email.host) return false;
  try { await sendWith({ ...st.email, pass: decrypt(st.email.passEnc) }, to, subject, text); return true; }
  catch (e) { console.error("[mail]", (e as Error).message); return false; }
}
