import type { Metadata } from "next";
import ActionForm from "@/components/ActionForm";
import { getFarms, getMembers } from "@/lib/data";
import { stamp } from "@/lib/format";
import { requireAdmin } from "@/lib/session";
import { setFarms, setRole } from "../actions";

export const metadata: Metadata = { title: "People" };

export default async function UsersAdmin() {
  const viewer = await requireAdmin();
  const [members, farms] = await Promise.all([getMembers(), getFarms(viewer)]);
  const farmName = (id: string) => farms.find((f) => f.id === id)?.name ?? id;

  return (
    <div className="page">
      <header className="page-head">
        <div className="page-head__title">
          <span className="eyebrow">
            <b>A3</b> Manage <span>{members.length} people</span>
          </span>
          <h1 className="display">People</h1>
        </div>
      </header>

      <p className="notice">
        People create their own account at <span className="num">/login</span>. They start as farmers with no farm and
        see nothing until you link them to one here.
      </p>

      <section className="panel">
        <div className="panel__head">
          <h2>
            <span>01</span>Accounts
          </h2>
          <span className="label">Click a row to edit</span>
        </div>
        <div className="rows" style={{ "--cols": "1.2fr 1.4fr 0.6fr 1.4fr 0.8fr" } as React.CSSProperties}>
          <div className="rows__head">
            <span>Name</span>
            <span className="hide-sm">Email</span>
            <span>Role</span>
            <span>Farms</span>
            <span className="r hide-sm">Joined</span>
          </div>
          {members.map((m) => (
            <details key={m.id}>
              <summary>
                <span className="name">{m.full_name || "—"}</span>
                <span className="muted hide-sm">{m.email}</span>
                <span>{m.role === "admin" ? <span className="tag tag--ok">Admin</span> : <span className="tag">Farmer</span>}</span>
                <span className={m.farmIds.length ? "" : "muted"}>
                  {m.farmIds.length ? m.farmIds.map(farmName).join(", ") : m.role === "admin" ? "All (admin)" : "None yet"}
                </span>
                <span className="r num muted hide-sm">{stamp(m.created_at)}</span>
              </summary>
              <div className="rows__edit">
                <ActionForm action={setRole} submit="Change role" variant="plain" className="inline-form">
                  <input type="hidden" name="user_id" value={m.id} />
                  <select className="select" name="role" defaultValue={m.role} aria-label="Role" disabled={m.id === viewer.id}>
                    <option value="farmer">Farmer · sees insights only</option>
                    <option value="admin">Admin · manages everything</option>
                  </select>
                </ActionForm>
                <ActionForm action={setFarms} submit="Save farms" variant="plain" className="inline-form">
                  <input type="hidden" name="user_id" value={m.id} />
                  <div className="checks">
                    {farms.map((f) => (
                      <label key={f.id}>
                        <input type="checkbox" name="farm_id" value={f.id} defaultChecked={m.farmIds.includes(f.id)} /> {f.name}
                      </label>
                    ))}
                  </div>
                </ActionForm>
              </div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
