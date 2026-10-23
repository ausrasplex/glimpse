import React from "react";
import { useApp } from "../store.jsx";
import { Icon } from "../icons.jsx";
import { Screen, TopBar, Sheet, Thumb, Avatar, AvatarStack, Menu, Confirm, Choice, Swatches, DateSheet, PlayBadge, ClipView } from "../ui.jsx";
import { EntryEditSheet } from "./calendar.jsx";
import { CopyBox } from "./settings.jsx";
import * as S from "../sel.js";
import { rel, shortDate, hexA, monthDay, fullDay, relDay, fmtSec, PALETTE, uid, fmtDur } from "../util.js";

const { useState } = React;

function CatChip({ cat }) {
  return <span className="tag" style={{ background: hexA(cat.color, 0.14), color: cat.color }}><span className="dot" style={{ width: 6, height: 6, background: cat.color }} />{cat.name}</span>;
}

function ProjectRow({ x, onClick }) {
  const { db, me } = useApp();
  const others = x.members.map((m) => S.user(db, m.userId)).filter(Boolean);
  return (
    <button onClick={onClick} className="hrow gap12" style={{ padding: 10, borderRadius: 16, background: "var(--surface)", border: "1px solid var(--line)", color: "inherit", textAlign: "left", width: "100%" }}>
      <Thumb m={x.cover} style={{ width: 64, height: 64, borderRadius: 12 }} />
      <span className="stack gap4" style={{ flex: 1, minWidth: 0 }}>
        <span className="ellipsis" style={{ fontSize: 15, fontWeight: 700 }}>{x.p.name}</span>
        <span className="hrow gap6 wrap"><CatChip cat={x.cat} />{x.cat.daily && x.streak ? <span className="hrow gap2" style={{ fontSize: 11, fontWeight: 700 }}><Icon name="flame" size={11} color="var(--accent)" />{x.streak}</span> : null}</span>
        <span className="small muted">{x.count} {x.count === 1 ? "entry" : "entries"} · {x.count ? rel(x.last) : "empty"}</span>
      </span>
      {x.shared ? <AvatarStack users={others} size={24} max={3} /> : null}
    </button>
  );
}

export function Projects() {
  const { db, act, local, actSoon, nav, me, toast } = useApp();
  const [filter, setFilter] = useState("all");
  const [showArch, setShowArch] = useState(false);
  const cats = S.userCategories(db, me.id);
  const all = S.sortProjects(S.myProjects(db, me.id));
  const list = all.filter((x) => filter === "all" || x.m.categoryId === filter);
  const arch = S.myProjects(db, me.id, { archived: true });
  const pinned = list.filter((x) => x.m.pinned), others = list.filter((x) => !x.m.pinned);
  return (
    <Screen>
      <TopBar title="Projects" sub={all.length + " active · " + arch.length + " archived"} right={<button className="pill" style={{ padding: "9px 14px", fontSize: 13 }} onClick={() => nav.go("projectEdit", {})}><Icon name="plus" size={14} stroke={2.6} />New</button>} />
      <div className="scroll pad">
        <div className="hrow wrap gap6" style={{ paddingTop: 18 }}>
          {[{ id: "all", name: "All" }].concat(cats).map((c) => {
            const on = c.id === filter;
            return <button key={c.id} onClick={() => setFilter(c.id)} aria-pressed={on} className="hrow gap6" style={{ padding: "7px 12px", borderRadius: 16, background: on ? "#2A2825" : "var(--surface)", border: "1px solid " + (on ? "var(--fg)" : "var(--line)"), color: on ? "var(--fg)" : "var(--muted)", fontSize: 12.5, fontWeight: 600 }}>{c.color ? <span className="dot" style={{ width: 8, height: 8, background: c.color }} /> : null}{c.name}</button>;
          })}
        </div>
        <button className="hrow gap6 muted" style={{ background: "none", border: "none", padding: "12px 0 4px", fontSize: 12.5, fontWeight: 600 }} onClick={() => nav.go("categories")}><Icon name="sliders" size={14} />Manage categories</button>
        <div className="stack gap18" style={{ paddingTop: 12 }}>
          {pinned.length ? <div className="stack gap8"><span className="sec">Pinned</span>{pinned.map((x) => <ProjectRow key={x.p.id} x={x} onClick={() => nav.go("project", { projectId: x.p.id })} />)}</div> : null}
          <div className="stack gap8">
            <span className="sec">Recently active</span>
            {others.map((x) => <ProjectRow key={x.p.id} x={x} onClick={() => nav.go("project", { projectId: x.p.id })} />)}
            {!others.length ? <div className="small faint" style={{ padding: 18, borderRadius: 14, border: "1.5px dashed var(--line-strong)", textAlign: "center" }}>No other projects {filter === "all" ? "yet" : "in this category"}</div> : null}
          </div>
          <div className="stack gap8">
            <button onClick={() => setShowArch(!showArch)} aria-expanded={showArch} className="hrow between" style={{ padding: "12px 14px", borderRadius: 12, background: "transparent", border: "1px solid var(--line)", color: "var(--muted)", fontSize: 13, fontWeight: 600 }}>
              <span>Archived ({arch.length})</span><Icon name="chevD" size={16} style={{ transform: showArch ? "rotate(180deg)" : "none" }} />
            </button>
            {showArch ? arch.map((x) => (
              <div key={x.p.id} className="hrow gap12" style={{ padding: 10, borderRadius: 16, background: "var(--surface-2)", border: "1px solid var(--line-soft)" }}>
                <Thumb m={x.cover} style={{ width: 52, height: 52, borderRadius: 10, filter: "grayscale(0.6)", opacity: 0.75 }} />
                <span className="stack gap2" style={{ flex: 1, minWidth: 0, opacity: 0.8 }}><span style={{ fontSize: 14, fontWeight: 700 }}>{x.p.name}</span><span className="small muted">{x.cat.name} · {x.count} entries · archived {x.m.archivedAt ? shortDate(x.m.archivedAt) : ""}</span></span>
                <button className="chipbtn" onClick={() => { act("setMemberPrefs", { projectId: x.p.id, archived: false }).then(() => toast(x.p.name + " restored")).catch(() => {}); }}>Restore</button>
              </div>
            )) : null}
            {showArch && !arch.length ? <span className="small faint" style={{ padding: "4px 2px" }}>Nothing archived. Archiving hides a project for you only.</span> : null}
          </div>
        </div>
        <div style={{ height: 26 }} />
      </div>
    </Screen>
  );
}

function ClipSheet({ e, onClose }) {
  const { db, act, local, actSoon, nav, me, toast } = useApp();
  const [sub, setSub] = useState(null);
  const [playing, setPlaying] = useState(true);
  const c = S.clipOf(db, e);
  const author = S.user(db, e.authorId);
  const mine = e.authorId === me.id;
  const owner = S.isOwner(db, e.projectId, me.id);
  const p = S.project(db, e.projectId);
  const remove = async () => {
    let r;
    try { r = await act("deleteEntry", { entryId: e.id }); } catch (x) { return; }
    onClose();
    toast(mine ? "Entry deleted" : "Removed from " + p.name, { label: "Undo", run: () => act("restoreEntry", { restore: r.restore }).catch(() => {}) });
  };
  const item = (label, icon, fn, danger) => ({ label, icon, onClick: fn, danger });
  return (
    <>
      <Sheet open={!sub} onClose={onClose} label="Clip details">
        <div className="stack gap14">
          <div className="hrow gap14" style={{ alignItems: "flex-start" }}>
            <ClipView muted m={c.m} start={c.start} end={c.end} playing={playing} loop style={{ width: 96, height: 128, borderRadius: 12 }}>
              <button aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)} style={{ position: "absolute", inset: 0, background: "transparent", border: "none" }} />
            </ClipView>
            <div className="stack gap6" style={{ flex: 1, minWidth: 0 }}>
              <span className="hrow gap8"><Avatar user={author} size={22} ring={false} /><span style={{ fontSize: 13, fontWeight: 700 }}>Filmed by {mine ? "you" : S.firstName(author)}</span></span>
              <span className="muted" style={{ fontSize: 12.5 }}>{fullDay(e.date)} · {c.len.toFixed(1)}s</span>
              <span style={{ fontSize: 14, lineHeight: 1.4 }}>{e.note ? "“" + e.note + "”" : <span className="faint">No note</span>}</span>
              {e.mood ? <span className="hrow gap6 small muted"><span className="dot" style={{ background: S.moodColor(db, e.authorId, e.mood) }} />{e.mood}</span> : null}
            </div>
          </div>
          {mine ? (
            <Menu items={[item("Edit note & mood", "edit", () => setSub("edit")), item("Adjust trim", "scissors", () => { onClose(); nav.go("capture", { entryId: e.id }); }), item("Move to another day", "calendar", () => setSub("date")), item("Open full view", "chevR", () => { onClose(); nav.go("entry", { entryId: e.id }); }), "-", item("Delete entry", "trash", remove, true)]} />
          ) : owner ? (
            <div className="stack gap8">
              <span className="sec">Owner tools · this project only</span>
              <Menu items={[item("Adjust trim for this project", "scissors", () => { onClose(); nav.go("capture", { entryId: e.id }); }), item("Move to another day", "calendar", () => setSub("date")), item("Open full view", "chevR", () => { onClose(); nav.go("entry", { entryId: e.id }); }), "-", item("Remove from project", "trash", remove, true)]} />
              <span className="small faint" style={{ lineHeight: 1.4 }}>Changes only apply here. {S.firstName(author)}'s original clip and other projects aren't touched. The note and mood can only be edited by {S.firstName(author)}.</span>
            </div>
          ) : (
            <div className="stack gap10">
              <button className="btn ghost sm" onClick={() => { onClose(); nav.go("entry", { entryId: e.id }); }}>Open full view</button>
              <span className="small faint" style={{ lineHeight: 1.4 }}>Only {S.firstName(author)} or the project owner can change this clip.</span>
            </div>
          )}
        </div>
      </Sheet>
      {sub === "edit" ? <EntryEditSheet entry={e} open onClose={() => setSub(null)} /> : null}
      <DateSheet open={sub === "date"} onClose={() => setSub(null)} value={e.date} title="Move to another day" onPick={(k) => { act("moveEntry", { entryId: e.id, date: k }).then(() => { toast("Moved to " + relDay(k)); onClose(); }).catch(() => {}); }} />
    </>
  );
}

export function ProjectPage({ params }) {
  const { db, act, nav, me, toast, setDraft, setMashDraft } = useApp();
  const pid = params.projectId;
  const [menu, setMenu] = useState(false);
  const [filter, setFilter] = useState(null);
  const [clip, setClip] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [leaveChoice, setLeaveChoice] = useState("keep");
  const [delMashes, setDelMashes] = useState(false);
  const [limit, setLimit] = useState(30);
  const p = S.project(db, pid);
  const m = p && S.membership(db, pid, me.id);
  if (!p || !m) {
    return <Screen><TopBar title="Project" /><div className="small faint" style={{ padding: 40, textAlign: "center" }}>You're not in this project any more.</div></Screen>;
  }
  const x = S.myProjects(db, me.id, { archived: m.archived }).find((y) => y.p.id === pid);
  const owner = m.role === "OWNER";
  const all = S.projectEntries(db, pid).slice().sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : b.createdAt - a.createdAt));
  const counts = {}; all.forEach((e) => { counts[e.authorId] = (counts[e.authorId] || 0) + 1; });
  const members = S.activeMembers(db, pid).map((mm) => ({ u: S.user(db, mm.userId), role: mm.role, n: counts[mm.userId] || 0 })).filter((y) => y.u).sort((a, b) => b.n - a.n);
  const days = new Set(all.map((e) => e.date)).size;
  const shown = filter ? all.filter((e) => e.authorId === filter) : all;
  const fu = filter ? S.user(db, filter) : null;
  const poss = fu ? (fu.id === me.id ? "Your" : S.firstName(fu) + "'s") : "";
  const ownerUser = S.user(db, p.ownerId);
  const mashes = db.mashes.filter((ms) => ms.projectId === pid && ms.status === "ready" && (ms.shared || ms.ownerId === me.id)).sort((a, b) => b.createdAt - a.createdAt);
  const myClips = counts[me.id] || 0;
  const startMash = () => { setMashDraft(null); nav.go("mash1", { projectId: pid, memberId: filter || null }); };

  const doDelete = async () => {
    try { await act("deleteProject", { projectId: pid, deleteSharedMashes: !!delMashes }); } catch (x) { return; }
    toast(p.name + " deleted");
    nav.reset("projects");
  };
  const doLeave = async () => {
    try { await act("leaveProject", { projectId: pid, choice: leaveChoice }); } catch (x) { return; }
    toast("You left " + p.name);
    nav.reset("projects");
  };
  const cover = x.cover;
  return (
    <Screen>
      <div className="scroll">
        <div style={{ position: "relative", height: 200, background: cover ? (cover.thumb ? "url(" + cover.thumb + ") center/cover" : cover.grad) : "linear-gradient(135deg,#3A3733,#1C1B19)" }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, #121212, rgba(18,18,18,0) 70%)" }} />
          <div className="hrow between" style={{ position: "absolute", top: 20, left: 20, right: 20 }}>
            <button className="iconbtn" aria-label="Back" onClick={nav.back} style={{ background: "rgba(0,0,0,0.45)" }}><Icon name="back" size={17} stroke={2.2} /></button>
            <button className="iconbtn" aria-label="Project options" aria-expanded={menu} onClick={() => setMenu(!menu)} style={{ background: menu ? "rgba(0,0,0,0.75)" : "rgba(0,0,0,0.45)" }}><Icon name="more" size={18} /></button>
          </div>
          <div className="stack gap8" style={{ position: "absolute", left: 20, right: 20, bottom: 14 }}>
            <span style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.01em" }}>{p.name}</span>
            <span style={{ fontSize: 13, color: "var(--fg-2)" }}>{members.length > 1 ? members.length + " members · " : ""}{all.length} entries · {days} {days === 1 ? "day" : "days"}{x.cat.daily ? " · " + x.streak + "-day streak" : ""}</span>
            <span className="hrow gap8 wrap"><CatChip cat={x.cat} /><span className="small" style={{ color: "var(--fg-2)" }}>{owner ? "You own this project" : "Owned by " + S.firstName(ownerUser) + " · you're a contributor"}</span></span>
          </div>
        </div>
        {menu ? (
          <div style={{ position: "absolute", top: 62, right: 20, zIndex: 5, width: 230 }}>
            <Menu items={[
              owner ? { label: "Edit project", icon: "edit", onClick: () => { setMenu(false); nav.go("projectEdit", { projectId: pid }); } } : null,
              { label: owner ? "Manage members" : "Members", icon: "users", onClick: () => { setMenu(false); nav.go("members", { projectId: pid }); } },
              { label: m.pinned ? "Unpin from Home" : "Pin to Home", icon: "pin", onClick: () => { setMenu(false); act("setMemberPrefs", { projectId: pid, pinned: !m.pinned }).then(() => toast(m.pinned ? "Unpinned from Home" : "Pinned to Home")).catch(() => {}); } },
              { label: m.archived ? "Restore" : "Archive for me", icon: "archive", onClick: () => { setMenu(false); act("setMemberPrefs", { projectId: pid, archived: !m.archived }).then(() => { if (!m.archived) { toast("Archived for you. Others still see it.", { label: "Undo", run: () => act("setMemberPrefs", { projectId: pid, archived: false }).catch(() => {}) }); nav.back(); } else toast("Restored"); }).catch(() => {}); } },
              "-",
              owner ? { label: "Delete project", icon: "trash", danger: true, onClick: () => { setMenu(false); setSheet("delete"); } } : { label: "Leave project", icon: "logout", danger: true, onClick: () => { setMenu(false); setSheet("leave"); } }
            ]} />
          </div>
        ) : null}
        <div className="pad stack gap18" style={{ paddingTop: 6 }}>
          {p.desc ? <span className="muted" style={{ fontSize: 13, lineHeight: 1.45 }}>{p.desc}</span> : null}
          <div className="hrow between">
            <button className="hrow gap10" onClick={() => nav.go("members", { projectId: pid })} style={{ background: "none", border: "none", color: "var(--fg)", padding: 0 }}>
              <AvatarStack users={members.map((y) => y.u)} size={30} max={4} />
              {members.length === 1 ? <span className="small muted">Just you</span> : null}
            </button>
            {owner ? <button className="hrow gap6" onClick={() => nav.go("members", { projectId: pid })} style={{ padding: "7px 11px", borderRadius: 10, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--fg)", fontSize: 12, fontWeight: 700 }}><Icon name="userPlus" size={14} />Invite</button> : null}
          </div>
          {members.length > 1 ? (
            <div className="stack gap8">
              <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Perspectives</span><span className="small faint">Tap someone to see their clips</span></div>
              <div className="hscroll" style={{ gap: 8 }}>
                <button onClick={() => setFilter(null)} aria-pressed={!filter} className="stack gap4" style={{ flexShrink: 0, width: 100, padding: 10, borderRadius: 12, background: !filter ? "var(--accent-soft)" : "var(--surface)", border: "1.5px solid " + (!filter ? "var(--accent)" : "var(--line)"), color: "var(--fg)", textAlign: "left" }}>
                  <span className="hrow" style={{ paddingLeft: 5 }}>{members.slice(0, 4).map((y) => <span key={y.u.id} style={{ width: 14, height: 14, marginLeft: -5, borderRadius: "50%", background: y.u.color, border: "1.5px solid var(--surface)" }} />)}</span>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Everyone</span>
                  <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>{all.length}</span>
                  <span className="faint" style={{ fontSize: 10.5 }}>{members.length} members</span>
                </button>
                {members.map((y) => {
                  const on = filter === y.u.id;
                  return (
                    <button key={y.u.id} onClick={() => setFilter(on ? null : y.u.id)} aria-pressed={on} aria-label={(on ? "Showing " : "Show ") + S.firstName(y.u) + "'s " + y.n + " clips"} className="stack gap4" style={{ flexShrink: 0, width: 100, padding: 10, borderRadius: 12, background: on ? "var(--accent-soft)" : "var(--surface)", border: "1.5px solid " + (on ? "var(--accent)" : "var(--line)"), color: "var(--fg)", textAlign: "left" }}>
                      <span className="hrow gap6" style={{ minWidth: 0 }}><Avatar user={y.u} size={18} ring={false} /><span className="ellipsis" style={{ fontSize: 12, fontWeight: 600 }}>{y.u.id === me.id ? "You" : S.firstName(y.u)}</span></span>
                      <span className="num" style={{ fontSize: 18, fontWeight: 700 }}>{y.n}</span>
                      <span className="faint" style={{ fontSize: 10.5 }}>{y.role === "OWNER" ? "Owner" : "Contributor"}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div className="grid2" style={{ gridTemplateColumns: "1fr auto" }}>
            <button className="btn" style={{ padding: 13, fontSize: 14.5 }} onClick={startMash} disabled={!shown.length}><Icon name="mash" size={16} />{filter ? "Mash " + (poss === "Your" ? "your" : poss) + " clips" : "Mash this project"}</button>
            <button className="btn ghost" style={{ width: 50, padding: 0 }} aria-label={"Add a clip to " + p.name} onClick={() => { setDraft({ presetProjectId: pid, returnTo: "project" }); nav.go("capture"); }}><Icon name="plus" size={18} stroke={2.4} /></button>
          </div>
          <div>
            <div className="hrow between" style={{ height: 22, marginBottom: 10 }}>
              <span className="sec">{filter ? poss + " clips · " + shown.length : "Clips"}</span>
              {filter ? <button className="link" style={{ padding: 0, lineHeight: "22px" }} onClick={() => setFilter(null)}>Show everyone</button> : <span className="small faint" style={{ lineHeight: "22px" }}>Tap a clip for details</span>}
            </div>
            {!shown.length ? <div className="small faint" style={{ padding: 22, borderRadius: 14, border: "1.5px dashed var(--line-strong)", textAlign: "center" }}>No clips yet. Tap + to add the first one.</div> : null}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 3, borderRadius: 12, overflow: "hidden" }}>
              {shown.slice(0, limit).map((e) => {
                const md = S.media(db, e.mediaId); const au = S.user(db, e.authorId);
                return (
                  <button key={e.id} onClick={() => setClip(e.id)} aria-label={"Clip by " + S.firstName(au) + " on " + fullDay(e.date)} style={{ position: "relative", aspectRatio: "1", border: "none", padding: 0, background: md ? (md.thumb ? "url(" + md.thumb + ") center/cover" : md.grad) : "#222" }}>
                    <span style={{ position: "absolute", top: 6, left: 7, fontSize: 10.5, fontWeight: 700, textShadow: "0 1px 3px rgba(0,0,0,0.6)" }}>{monthDay(e.date)}</span>
                    {members.length > 1 ? <span style={{ position: "absolute", right: 6, bottom: 6, width: 20, height: 20, borderRadius: "50%", background: au ? au.color : "#555", border: "2px solid rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9.5, fontWeight: 800, color: "#141413" }}>{S.initial(au)}</span> : null}
                  </button>
                );
              })}
            </div>
            {shown.length > limit ? <button className="btn outline sm" style={{ marginTop: 10 }} onClick={() => setLimit(limit + 60)}>Show more ({shown.length - limit} left)</button> : null}
          </div>
          <div className="stack gap8">
            <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Mashes · {mashes.length}</span><span className="small faint">{members.length > 1 ? "Yours stay private until shared" : "Only you can see these"}</span></div>
            {mashes.map((ms) => {
              const by = S.user(db, ms.ownerId);
              const first = S.entry(db, ms.entryIds[0]);
              return (
                <button key={ms.id} onClick={() => nav.go("player", { mashId: ms.id })} className="hrow gap12" style={{ padding: 10, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)", color: "inherit", textAlign: "left" }}>
                  <Thumb m={first ? S.media(db, first.mediaId) : null} style={{ width: 40, height: 56, borderRadius: 7 }}><PlayBadge size={22} /></Thumb>
                  <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
                    <span className="ellipsis" style={{ fontSize: 13.5, fontWeight: 700 }}>{ms.title}</span>
                    <span className="small muted">by {by.id === me.id ? "You" : S.firstName(by)} · {fmtDur(S.mashLength(db, ms))} · {ms.shape[0].toUpperCase() + ms.shape.slice(1)}</span>
                  </span>
                  {ms.ownerId === me.id && members.length > 1 ? <span className={"tag" + (ms.shared ? " ok" : "")}>{ms.shared ? "Shared" : "Private"}</span> : null}
                </button>
              );
            })}
            {!mashes.length ? <span className="small faint">No mashes yet.</span> : null}
          </div>
          <div style={{ height: 24 }} />
        </div>
      </div>
      {clip && S.entry(db, clip) ? <ClipSheet e={S.entry(db, clip)} onClose={() => setClip(null)} /> : null}
      <Confirm open={sheet === "delete"} onClose={() => setSheet(null)} title={"Delete “" + p.name + "”?"} body={"This removes the project for " + (members.length > 1 ? "all " + members.length + " people" : "you") + ", including " + all.length + " entries. Clips that are also in someone's other projects stay there. This can't be undone."} confirm="Delete project" danger onConfirm={doDelete}>
        {mashes.some((ms) => ms.shared) ? (
          <button onClick={() => setDelMashes(!delMashes)} aria-pressed={delMashes} className="hrow gap12" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--fg)", textAlign: "left" }}>
            <span style={{ width: 20, height: 20, flexShrink: 0, borderRadius: 6, background: delMashes ? "var(--danger-strong)" : "transparent", border: "2px solid " + (delMashes ? "var(--danger-strong)" : "#4A4742"), display: "flex", alignItems: "center", justifyContent: "center" }}>{delMashes ? <Icon name="check" size={12} stroke={3} color="#fff" /> : null}</span>
            <span className="stack gap2"><span style={{ fontSize: 13.5, fontWeight: 600 }}>Also delete the shared mashes</span><span className="small muted">{delMashes ? "They'll be removed from everyone's library" : "Unticked: mashes stay in their creators' libraries"}</span></span>
          </button>
        ) : null}
      </Confirm>
      <Confirm open={sheet === "leave"} onClose={() => setSheet(null)} title={"Leave “" + p.name + "”?"} body={myClips ? "You added " + myClips + " clips. What should happen to them?" : "You haven't added any clips."} confirm="Leave project" danger onConfirm={doLeave}>
        {myClips ? (
          <div className="stack gap8">
            <Choice active={leaveChoice === "keep"} onClick={() => setLeaveChoice("keep")} title="Leave my clips for the group" desc="They stay in the project with your name on them, and still count toward your storage." />
            <Choice active={leaveChoice === "take"} onClick={() => setLeaveChoice("take")} title="Take my clips with me" desc={"Your " + myClips + " entries are removed from this project. Clips in your other projects stay."} />
          </div>
        ) : null}
      </Confirm>
    </Screen>
  );
}

function NewCategory({ onAdd }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#9B87D6");
  const [daily, setDaily] = useState(true);
  return (
    <div className="stack gap14" style={{ padding: 14, borderRadius: 14, background: "var(--surface)", border: "1px solid var(--accent)" }}>
      <div className="field"><label className="sec" htmlFor="nc-name">Category name</label><input id="nc-name" className="input" maxLength={24} placeholder="e.g. Fitness" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: "10px 12px", background: "#161513" }} /></div>
      <div className="stack gap8"><span className="sec">Colour</span><Swatches value={color} onPick={setColor} /></div>
      <div className="stack gap8">
        <span className="sec">Type</span>
        <div className="grid2" style={{ gap: 8 }}>
          {[{ id: true, t: "Daily habit", d: "Streaks, missed days, reminder checks" }, { id: false, t: "Freestyle", d: "No streaks, film whenever" }].map((o) => (
            <button key={String(o.id)} onClick={() => setDaily(o.id)} aria-pressed={daily === o.id} className="stack gap2" style={{ padding: 10, borderRadius: 11, background: daily === o.id ? "#211F1C" : "#161513", border: "1.5px solid " + (daily === o.id ? "var(--accent)" : "var(--line)"), color: "var(--fg)", textAlign: "left" }}><span style={{ fontSize: 13, fontWeight: 700 }}>{o.t}</span><span className="tiny muted" style={{ lineHeight: 1.3 }}>{o.d}</span></button>
          ))}
        </div>
      </div>
      <button className="btn sm" disabled={!name.trim()} onClick={() => onAdd({ name: name.trim(), color, daily })}>Add category</button>
    </div>
  );
}

export function ProjectEdit({ params }) {
  const { db, act, local, actSoon, nav, me, toast } = useApp();
  const editing = params.projectId ? S.project(db, params.projectId) : null;
  const mm = editing ? S.membership(db, editing.id, me.id) : null;
  const [name, setName] = useState(editing ? editing.name : "");
  const [desc, setDesc] = useState(editing ? editing.desc : "");
  const cats = S.userCategories(db, me.id);
  const [cat, setCat] = useState(mm ? mm.categoryId : (cats.find((c) => !c.daily) || cats[0]).id);
  const [ncOpen, setNcOpen] = useState(false);
  const [coverMode, setCoverMode] = useState(editing && editing.cover ? "pick" : "auto");
  const [cover, setCover] = useState(editing ? editing.cover : null);
  const clips = editing ? S.projectEntries(db, editing.id).slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 16) : [];
  const members = editing ? S.activeMembers(db, editing.id).map((m) => S.user(db, m.userId)) : [me];
  const save = async () => {
    if (!name.trim()) return;
    try {
      if (editing) {
        await act("saveProject", { projectId: editing.id, name: name.trim(), desc: desc.trim(), cover: coverMode === "pick" ? cover : null, categoryId: cat });
        toast("Project saved"); nav.back();
      } else {
        const r = await act("createProject", { name: name.trim(), desc: desc.trim(), categoryId: cat });
        toast(name.trim() + " created"); nav.replace("project", { projectId: r.projectId });
      }
    } catch (x) { /* toast shown */ }
  };
  return (
    <Screen>
      <TopBar title={editing ? "Edit project" : "New project"} icon="close" backLabel="Cancel" />
      <div className="scroll pad stack gap24" style={{ paddingTop: 22 }}>
        <div className="stack gap10">
          <div className="field"><label className="sec" htmlFor="pe-name">Name</label><input id="pe-name" className="input" maxLength={40} placeholder="e.g. Japan Trip 2026" value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="field"><label className="sec" htmlFor="pe-desc">Description (optional)</label><textarea id="pe-desc" className="input" rows="2" placeholder="What's this project about?" value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
        </div>
        <div className="stack gap10">
          <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Category</span><span className="small faint">Only you see your category</span></div>
          <div className="hrow wrap gap8">
            {cats.map((c) => (
              <button key={c.id} onClick={() => setCat(c.id)} aria-pressed={c.id === cat} className="hrow gap6" style={{ padding: "9px 13px", borderRadius: 12, background: c.id === cat ? hexA(c.color, 0.14) : "var(--surface)", border: "1.5px solid " + (c.id === cat ? c.color : "var(--line)"), color: "var(--fg)", fontSize: 13, fontWeight: 600 }}>
                <span className="dot" style={{ width: 9, height: 9, background: c.color }} />{c.name}<span className="tiny muted" style={{ fontWeight: 500 }}>{c.daily ? "daily" : "free"}</span>
              </button>
            ))}
            <button onClick={() => setNcOpen(!ncOpen)} aria-expanded={ncOpen} className="hrow gap6" style={{ padding: "9px 13px", borderRadius: 12, background: "transparent", border: "1.5px dashed var(--line-strong)", color: "var(--muted)", fontSize: 13, fontWeight: 600 }}><Icon name="plus" size={13} stroke={2.4} />New category</button>
          </div>
          {ncOpen ? <NewCategory onAdd={(c) => { act("addCategory", { name: c.name, color: c.color, daily: c.daily }).then((r) => { setCat(r.categoryId); setNcOpen(false); toast("Category added"); }).catch(() => {}); }} /> : null}
        </div>
        <div className="stack gap10">
          <span className="sec">Cover</span>
          <div className="grid2" style={{ gap: 8 }}>
            {[{ id: "auto", t: "Latest clip", d: "Changes automatically" }, { id: "pick", t: "Choose a clip", d: clips.length ? "Stays fixed" : "Once it has clips", off: !clips.length }].map((o) => (
              <button key={o.id} disabled={o.off} onClick={() => setCoverMode(o.id)} aria-pressed={coverMode === o.id} className="stack gap2" style={{ padding: "11px 12px", borderRadius: 12, background: coverMode === o.id ? "#211F1C" : "#1A1917", border: "1.5px solid " + (coverMode === o.id ? "var(--accent)" : "var(--line)"), color: "var(--fg)", textAlign: "left", opacity: o.off ? 0.45 : 1 }}><span style={{ fontSize: 13, fontWeight: 700 }}>{o.t}</span><span className="tiny muted">{o.d}</span></button>
            ))}
          </div>
          {coverMode === "pick" ? (
            <div className="grid4">
              {clips.map((e) => { const md = S.media(db, e.mediaId); const on = cover === md.id; return <button key={e.id} onClick={() => setCover(md.id)} aria-pressed={on} aria-label={"Use clip from " + fullDay(e.date) + " as cover"} style={{ aspectRatio: "1", borderRadius: 10, background: md.thumb ? "url(" + md.thumb + ") center/cover" : md.grad, border: "2.5px solid " + (on ? "var(--accent)" : "transparent"), padding: 0 }} />; })}
            </div>
          ) : null}
        </div>
        <div className="stack gap10">
          <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">People</span><span className="small faint">{editing ? "You're the owner" : "Optional"}</span></div>
          <button disabled={!editing} onClick={() => nav.go("members", { projectId: editing.id })} className="hrow gap12" style={{ padding: "12px 14px", borderRadius: 14, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--fg)", textAlign: "left" }}>
            <AvatarStack users={members} size={28} max={4} />
            <span className="stack gap2" style={{ flex: 1 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{members.length > 1 ? members.length + " people" : "Just you"}</span><span className="small muted">{editing ? "Manage members & invites" : "Invite people after you create it"}</span></span>
            {editing ? <Icon name="chevR" size={16} color="var(--faint)" /> : null}
          </button>
        </div>
        <div style={{ height: 8 }} />
      </div>
      <div style={{ padding: "12px 20px calc(22px + env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
        <button className="btn" disabled={!name.trim()} onClick={save}>{!name.trim() ? "Give the project a name" : editing ? "Save changes" : "Create project"}</button>
      </div>
    </Screen>
  );
}

export function Categories() {
  const { db, act, local, actSoon, nav, me, toast } = useApp();
  const [open, setOpen] = useState(null);
  const [del, setDel] = useState(null);
  const [moveTo, setMoveTo] = useState(null);
  const cats = S.userCategories(db, me.id);
  const uses = (id) => db.members.filter((m) => m.userId === me.id && m.categoryId === id).length;
  const patch = (id, o) => { local((n) => Object.assign(n.categories.find((c) => c.id === id), o)); actSoon("cat-" + id + Object.keys(o).join(), "patchCategory", Object.assign({ categoryId: id }, o), o.name !== undefined ? 700 : 50); };
  const delCat = cats.find((c) => c.id === del);
  return (
    <Screen>
      <TopBar title="Categories" sub="Personal to you" right={<button className="pill" style={{ padding: "9px 14px", fontSize: 13 }} onClick={() => { act("addCategory", { name: "New category", color: "#9B87D6", daily: false }).then((r) => setOpen(r.categoryId)).catch(() => {}); }}><Icon name="plus" size={14} stroke={2.6} />New</button>} />
      <div className="scroll pad stack gap10" style={{ paddingTop: 22 }}>
        {cats.map((c) => {
          const isOpen = open === c.id;
          const n = uses(c.id);
          return (
            <div key={c.id} style={{ borderRadius: 16, background: "var(--surface)", border: "1px solid " + (isOpen ? "var(--accent)" : "var(--line)") }}>
              <button onClick={() => setOpen(isOpen ? null : c.id)} aria-expanded={isOpen} className="hrow gap12" style={{ width: "100%", padding: 14, background: "none", border: "none", color: "var(--fg)", textAlign: "left" }}>
                <span className="dot" style={{ width: 14, height: 14, background: c.color }} />
                <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: 15, fontWeight: 700 }}>{c.name}</span><span className="small muted">{c.daily ? "Daily habit" : "Freestyle"} · {n} {n === 1 ? "project" : "projects"}</span></span>
                {c.isDefault ? <span className="tag">Default</span> : null}
                <Icon name="chevD" size={16} color="var(--faint)" style={{ transform: isOpen ? "rotate(180deg)" : "none" }} />
              </button>
              {isOpen ? (
                <div className="stack gap14" style={{ padding: "0 14px 14px" }}>
                  <div className="field"><label className="sec" htmlFor={"cat-" + c.id}>Name</label><input id={"cat-" + c.id} className="input" maxLength={24} value={c.name} onChange={(e) => patch(c.id, { name: e.target.value })} style={{ padding: "10px 12px", background: "#161513" }} /></div>
                  <div className="stack gap8"><span className="sec">Colour</span><Swatches value={c.color} onPick={(col) => patch(c.id, { color: col })} /></div>
                  <div className="stack gap8">
                    <span className="sec">Type</span>
                    <div className="grid2" style={{ gap: 8 }}>
                      {[{ id: true, t: "Daily habit", d: "Streaks & missed days" }, { id: false, t: "Freestyle", d: "No streaks" }].map((o) => (
                        <button key={String(o.id)} disabled={c.isDefault} onClick={() => patch(c.id, { daily: o.id })} aria-pressed={c.daily === o.id} className="stack gap2" style={{ padding: 10, borderRadius: 11, background: c.daily === o.id ? "#211F1C" : "#161513", border: "1.5px solid " + (c.daily === o.id ? "var(--accent)" : "var(--line)"), color: "var(--fg)", textAlign: "left", opacity: c.isDefault && c.daily !== o.id ? 0.4 : 1 }}><span style={{ fontSize: 13, fontWeight: 700 }}>{o.t}</span><span className="tiny muted">{o.d}</span></button>
                      ))}
                    </div>
                  </div>
                  {c.isDefault ? <span className="small faint" style={{ lineHeight: 1.4 }}>Default categories can be renamed and recoloured, but not deleted or switched type, so there's always one of each.</span>
                    : <button className="btn sm" style={{ background: "transparent", border: "1px solid rgba(224,120,110,0.35)", color: "var(--danger)", fontWeight: 600 }} onClick={() => { setDel(c.id); setMoveTo(cats.find((x) => x.id !== c.id && !x.daily === !c.daily) ? cats.find((x) => x.id !== c.id && !x.daily === !c.daily).id : cats.find((x) => x.id !== c.id).id); }}>Delete category</button>}
                </div>
              ) : null}
            </div>
          );
        })}
        <div style={{ height: 20 }} />
      </div>
      <Confirm open={!!delCat} onClose={() => setDel(null)} title={delCat ? "Delete “" + delCat.name + "”?" : ""} body={delCat ? (uses(delCat.id) ? uses(delCat.id) + (uses(delCat.id) === 1 ? " project uses it" : " projects use it") + ". Choose where they go. Nothing else is deleted." : "No projects use it.") : ""} confirm={delCat && uses(delCat.id) ? "Move & delete" : "Delete"} danger onConfirm={() => {
        const target = cats.find((c) => c.id === moveTo);
        act("deleteCategory", { categoryId: del, moveTo }).catch(() => {});
        toast("Deleted" + (target && delCat && uses(delCat.id) ? ". Projects moved to " + target.name : "")); setDel(null); setOpen(null);
      }}>
        {delCat && uses(delCat.id) ? (
          <div className="hrow wrap gap8">
            {cats.filter((c) => c.id !== del).map((c) => <button key={c.id} onClick={() => setMoveTo(c.id)} aria-pressed={moveTo === c.id} className="hrow gap6" style={{ padding: "9px 13px", borderRadius: 12, background: moveTo === c.id ? "#211F1C" : "var(--surface)", border: "1.5px solid " + (moveTo === c.id ? c.color : "var(--line)"), color: "var(--fg)", fontSize: 13, fontWeight: 600 }}><span className="dot" style={{ width: 9, height: 9, background: c.color }} />{c.name}</button>)}
          </div>
        ) : null}
      </Confirm>
    </Screen>
  );
}

export function Members({ params }) {
  const { db, act, local, actSoon, nav, me, toast } = useApp();
  const pid = params.projectId;
  const p = S.project(db, pid);
  const [menu, setMenu] = useState(null);
  const [email, setEmail] = useState("");
  const [sheet, setSheet] = useState(null);
  const [removeChoice, setRemoveChoice] = useState("keep");
  const [linkShown, setLinkShown] = useState(null);
  if (!p) return <Screen><TopBar title="Members" /></Screen>;
  const owner = S.isOwner(db, pid, me.id);
  const admin = S.isAdmin(db, me.id);
  const active = S.activeMembers(db, pid);
  const pending = S.pendingMembers(db, pid);
  const counts = {}; S.projectEntries(db, pid).forEach((e) => { counts[e.authorId] = (counts[e.authorId] || 0) + 1; });
  const sent = (db.invitesSentToday || {})[me.id] || 0;
  const limit = db.server.perDay;
  const limited = !admin && db.server.userInvites;
  const left = limited ? Math.max(0, limit - sent) : null;
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && (left === null || left > 0);
  const inProject = new Set(active.map((m) => m.userId).concat(pending.map((m) => m.userId)).filter(Boolean));
  const pendingEmails = new Set(pending.map((m) => m.email).filter(Boolean));
  const known = {};
  db.members.filter((m) => m.status === "ACTIVE" && m.userId === me.id).forEach((mine) => S.activeMembers(db, mine.projectId).forEach((o) => { if (o.userId !== me.id && !inProject.has(o.userId)) known[o.userId] = S.project(db, mine.projectId).name; }));

  const inviteUser = (u) => {
    act("inviteKnown", { projectId: pid, userId: u.id }).then(() => toast("Invite sent")).catch(() => {});
  };
  const sendEmail = () => {
    const em = email.trim().toLowerCase();
    if (!valid) return;
    act("inviteByEmail", { projectId: pid, email: em }).then(() => { setEmail(""); toast("Invite sent"); }).catch(() => {});
  };
  const target = sheet ? db.members.find((m) => m.projectId === pid && m.userId === sheet.userId) : null;
  const tu = target ? S.user(db, target.userId) : null;
  const confirm = async () => {
    const s0 = sheet;
    setSheet(null);
    try {
      if (s0.type === "transfer") { await act("transferOwner", { projectId: pid, userId: s0.userId }); toast(S.firstName(tu) + " is now the owner"); }
      else { await act("removeMember", { projectId: pid, userId: s0.userId, choice: removeChoice }); toast(S.firstName(tu) + " removed" + (removeChoice === "keep" ? ", clips kept" : " with their clips")); }
    } catch (x) { /* toast shown */ }
  };
  const rows = active.map((m) => ({ m, u: S.user(db, m.userId) })).concat(pending.map((m) => ({ m, u: m.userId ? S.user(db, m.userId) : null })));
  return (
    <Screen>
      <TopBar title="Members" sub={p.name} />
      <div className="scroll pad stack gap24" style={{ paddingTop: 22 }}>
        <div className="stack gap8">
          <span className="sec">In this project</span>
          <div className="card flush list">
            {rows.map(({ m, u }) => {
              const isPending = m.status === "INVITED";
              const key = m.userId || m.email;
              const isOwnerRow = m.role === "OWNER" && !isPending;
              const open = menu === key;
              const nm = u ? (u.id === me.id ? "You" : u.name) : m.email;
              return (
                <div key={key}>
                  <div className="hrow gap12" style={{ padding: "12px 14px" }}>
                    {u ? <span style={{ opacity: isPending ? 0.45 : 1 }}><Avatar user={u} size={36} ring={false} /></span> : <span className="av" style={{ width: 36, height: 36, background: "#8C96A3", opacity: 0.45, border: "none" }}>{m.email.charAt(0).toUpperCase()}</span>}
                    <span className="stack gap2" style={{ flex: 1, minWidth: 0 }}>
                      <span className="ellipsis" style={{ fontSize: 14, fontWeight: 700 }}>{nm}</span>
                      <span className="small muted ellipsis">{isPending ? "Invite sent " + rel(m.invitedAt) : (counts[m.userId] || 0) + " clips · " + ((m.joinedAt || 0) <= p.createdAt + 60000 ? "created the project" : "joined " + shortDate(m.joinedAt || Date.now()))}</span>
                    </span>
                    {isPending || isOwnerRow ? <span className={"tag" + (isOwnerRow ? " accent" : "")} style={{ fontSize: 11 }}>{isPending ? "Pending" : "Owner"}</span> : null}
                    {owner && m.userId !== me.id ? <button className="iconbtn plain sq" style={{ width: 30, height: 30, background: open ? "#2A2825" : "transparent" }} aria-label={"Options for " + nm} aria-expanded={open} onClick={() => setMenu(open ? null : key)}><Icon name="more" size={16} color="var(--muted)" /></button> : null}
                  </div>
                  {open ? (
                    <div style={{ margin: "0 12px 12px" }}>
                      <Menu items={isPending ? [admin && m.inviteId ? { label: "Copy invite link", icon: "copy", onClick: () => { setMenu(null); act("inviteLink", { inviteId: m.inviteId }, { noRefresh: true }).then((r) => { try { navigator.clipboard.writeText(r.link).then(() => toast("Invite link copied"), () => setLinkShown(r.link)); } catch (e) { setLinkShown(r.link); } }).catch(() => {}); } } : null, { label: "Cancel invite", icon: "close", danger: true, onClick: () => { setMenu(null); act("cancelProjectInvite", { projectId: pid, memberId: m.id }).then(() => toast("Invite cancelled")).catch(() => {}); } }]
                        : [{ label: "Make owner", icon: "key", onClick: () => { setMenu(null); setSheet({ type: "transfer", userId: m.userId }); } }, { label: "Remove from project", icon: "trash", danger: true, onClick: () => { setMenu(null); setRemoveChoice("keep"); setSheet({ type: "remove", userId: m.userId }); } }]} />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {linkShown ? <CopyBox url={linkShown} note="Works once · expires 7 days after the invite was sent" /> : null}
          {owner ? <span className="small faint" style={{ lineHeight: 1.4 }}>You can't leave while you're the owner. Make someone else owner first, or delete the project.</span> : <span className="small faint" style={{ lineHeight: 1.4 }}>Only the owner can invite or remove people.</span>}
        </div>
        {owner ? (
          <div className="stack gap10">
            <div className="hrow between" style={{ alignItems: "baseline" }}><span className="sec">Invite by email</span>{left !== null ? <span className="small faint">{left} of {limit} invites left today</span> : null}</div>
            <form className="hrow gap8" onSubmit={(e) => { e.preventDefault(); sendEmail(); }}>
              <div className="hrow gap10" style={{ flex: 1, padding: "11px 14px", borderRadius: 12, background: "var(--surface)", border: "1px solid var(--line)" }}>
                <Icon name="mail" size={16} color="var(--faint)" />
                <input type="email" aria-label="Email address" placeholder="friend@example.com" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--fg)", fontSize: 14 }} />
              </div>
              <button className="btn" type="submit" disabled={!valid} style={{ width: "auto", padding: "0 16px", fontSize: 14 }}>Invite</button>
            </form>
            <span className="small faint" style={{ lineHeight: 1.4 }}>If they're already on this server they'll get a notification; if not, an email to join. For privacy, you won't be told which.{!admin && !db.server.userInvites ? " New people need the admin's OK first." : ""}</span>
            {Object.keys(known).length ? (
              <div className="stack gap8" style={{ marginTop: 6 }}>
                <span className="sec">People you share projects with</span>
                <div className="hrow wrap gap8">
                  {Object.keys(known).map((id) => { const u = S.user(db, id); return (
                    <button key={id} onClick={() => inviteUser(u)} aria-label={"Invite " + u.name + " (from " + known[id] + ")"} className="hrow gap8" style={{ padding: "6px 12px 6px 6px", borderRadius: 20, background: "var(--surface)", border: "1px solid var(--line)", color: "var(--fg)" }}>
                      <Avatar user={u} size={26} ring={false} /><span style={{ fontSize: 13, fontWeight: 600 }}>{S.firstName(u)}</span><span style={{ fontSize: 13, fontWeight: 800, color: "var(--accent)" }}>+</span>
                    </button>); })}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div style={{ height: 20 }} />
      </div>
      <Confirm open={!!sheet && !!tu} onClose={() => setSheet(null)} title={sheet && tu ? (sheet.type === "transfer" ? "Make " + S.firstName(tu) + " the owner?" : "Remove " + S.firstName(tu) + "?") : ""} body={sheet && tu ? (sheet.type === "transfer" ? S.firstName(tu) + " will be able to manage members, edit any clip in this project and delete it. You'll become a contributor." : S.firstName(tu) + " will lose access to this project. What should happen to their " + (counts[tu.id] || 0) + " clips?") : ""} confirm={sheet && sheet.type === "transfer" ? "Make owner" : "Remove"} danger={sheet && sheet.type === "remove"} onConfirm={confirm}>
        {sheet && sheet.type === "remove" ? (
          <div className="stack gap8">
            <Choice active={removeChoice === "keep"} onClick={() => setRemoveChoice("keep")} title="Keep their clips in the project" />
            <Choice active={removeChoice === "drop"} onClick={() => setRemoveChoice("drop")} title="Remove their clips from the project" />
          </div>
        ) : null}
      </Confirm>
    </Screen>
  );
}
