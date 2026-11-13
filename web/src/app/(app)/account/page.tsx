import type { Metadata } from "next";
import ActionForm from "@/components/ActionForm";
import PasswordInput from "@/components/PasswordInput";
import { cap } from "@/lib/format";
import { requireViewer } from "@/lib/session";
import { changePassword } from "./actions";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const viewer = await requireViewer();
  const { reset } = await searchParams;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">
            <b>03</b> Account
            <span>{viewer.email}</span>
          </span>
          <h1 className="display">Your account</h1>
        </div>
      </header>

      <div className="grid-2">
        <section className="panel" aria-labelledby="password-h">
          <div className="panel__head">
            <h2 id="password-h">
              <span>01</span>Change password
            </h2>
          </div>
          <div className="panel__body">
            {reset ? (
              <p className="notice notice--ok" role="status" style={{ marginBottom: 16 }}>
                You&apos;re signed in from the reset link. Choose a new password now.
              </p>
            ) : null}
            <ActionForm action={changePassword} submit="Change password" className="scan-form">
              <label className="field">
                <span className="label">New password</span>
                <PasswordInput name="password" autoComplete="new-password" />
              </label>
              <label className="field">
                <span className="label">Confirm new password</span>
                <PasswordInput name="confirm" autoComplete="new-password" />
              </label>
            </ActionForm>
          </div>
        </section>

        <section className="panel" aria-labelledby="who-h">
          <div className="panel__head">
            <h2 id="who-h">
              <span>02</span>Signed in as
            </h2>
          </div>
          <dl className="spec panel__body">
            <div><dt>Name</dt><dd>{viewer.name}</dd></div>
            <div><dt>Email</dt><dd>{viewer.email}</dd></div>
            <div><dt>Role</dt><dd>{cap(viewer.role)}</dd></div>
            <div><dt>Farms and role</dt><dd className="muted">Ask an admin to change these.</dd></div>
          </dl>
        </section>
      </div>
    </div>
  );
}
