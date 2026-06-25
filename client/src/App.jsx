import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api, setToken, getToken } from "./api.js";

/* ============ PROTEÇÃO: evita tela branca se uma seção falhar ============ */
class Boundary extends React.Component {
  constructor(p) { super(p); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidUpdate(prev) { if (prev.tabKey !== this.props.tabKey && this.state.err) this.setState({ err: null }); }
  render() {
    if (this.state.err) return (
      <div className="card"><div className="empty">Não foi possível exibir esta seção.<br /><span className="dim" style={{ fontSize: 12 }}>{String(this.state.err.message || this.state.err)}</span><br />
        <button className="primary" style={{ marginTop: 10 }} onClick={() => this.setState({ err: null })}>Tentar novamente</button></div></div>
    );
    return this.props.children;
  }
}

/* ============ DADOS INICIAIS (importados da sua planilha) ============ */
const SEED = [];

/* ============ PAPÉIS / PERMISSÕES ============ */
const ROLES = { admin: "Administrador", gerente: "Gerente", supervisor: "Supervisor de A&B" };
const roleLabel = (r) => ROLES[r] || r;
const can = {
  manageUsers: (u) => u && u.role === "admin",
  manageHotels: (u) => u && u.role === "admin",
  managePdvs: (u) => u && (u.role === "admin" || u.role === "gerente"),
  validate: (u) => u && (u.role === "admin" || u.role === "gerente"),
  editRetroactive: (u) => u && (u.role === "admin" || u.role === "gerente"),
};
// dias que o usuário pode editar: supervisor só hoje em diante; demais qualquer dia
const canEditDay = (u, date) => {
  if (!u) return false;
  if (can.editRetroactive(u)) return true;
  return date >= todayISO();
};
const hotelsForUser = (u, hotels) => (!u ? [] : u.role === "admin" ? hotels : hotels.filter((h) => (u.hotelIds || []).includes(h.id)));

/* ============ UTILIDADES ============ */
const todayISO = () => new Date().toLocaleDateString("en-CA");
const ymOf = (d) => d.slice(0, 7);
const fmtBR = (d) => (d ? d.split("-").reverse().join("/") : "");
const fmtShort = (d) => d.slice(8, 10) + "/" + d.slice(5, 7);
const fmtBRL = (v) => (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const addDays = (iso, n) => { const t = new Date(iso + "T12:00:00"); t.setDate(t.getDate() + n); return t.toLocaleDateString("en-CA"); };
const num = (v) => (v === "" || v == null ? 0 : Number(v) || 0);
const has = (v) => v !== "" && v != null && !Number.isNaN(Number(v));
const uid = () => "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const byName = (a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR", { sensitivity: "base" });
const monthsBetween = (a, b) => { const out = new Set(); let d = a.slice(0, 7) + "-01"; while (ymOf(d) <= ymOf(b)) { out.add(ymOf(d)); d = ymOf(addDays(d, 32)) + "-01"; } return [...out]; };

const emptyDay = (date) => ({ date, time: "", resp: "", items: {}, status: "draft", savedBy: null, savedAt: null, validatedBy: null, validatedAt: null });
function printLandscape() {
  const st = document.createElement("style");
  st.textContent = "@page{size:A4 landscape}";
  document.head.appendChild(st);
  const clean = () => { st.remove(); window.removeEventListener("afterprint", clean); };
  window.addEventListener("afterprint", clean);
  window.print();
}

/* fechamento de um item em um dia = contagem + reposto */
const closeOf = (rec, pid) => { const it = rec?.items?.[pid]; if (!it || !has(it.c)) return null; return num(it.c) + num(it.r); };

function calcRows(products, rec, prevRec) {
  return products.map((p) => {
    const it = rec?.items?.[p.id] || {};
    const prevClose = prevRec ? closeOf(prevRec, p.id) : null;
    const opening = prevClose != null ? prevClose : p.par;
    const hasPrev = prevClose != null;
    const count = has(it.c) ? num(it.c) : null;
    const repNeed = count == null ? null : Math.max(p.par - count, 0);
    const prevSt = prevRec ? num(prevRec.items?.[p.id]?.st) : 0;
    const spAdj = Math.max(num(it.sp) - prevSt, 0);
    const vt = spAdj + num(it.st);
    const fech = count == null ? null : count + num(it.r);
    const dif = count == null ? null : count + vt - opening;
    return { ...p, it, opening, hasPrev, count, repNeed, vt, fech, dif, prevSt, spAdj };
  });
}
function dayTotals(products, rec, prevRec) {
  const rows = calcRows(products, rec, prevRec);
  let sales = 0, losses = 0, surplus = 0, rep = 0, counted = 0, toRep = 0, lossVal = 0;
  rows.forEach((r) => {
    sales += r.vt; rep += num(r.it.r);
    if (r.count != null) { counted++; toRep += r.repNeed; }
    if (r.dif != null) { if (r.dif < 0) { losses += -r.dif; lossVal += -r.dif * num(r.price); } else surplus += r.dif; }
  });
  return { sales, losses, surplus, rep, counted, toRep, lossVal };
}

/* ============ COMPONENTES BÁSICOS ============ */
const Num = ({ v, dash = "—" }) => <span className="mono">{v == null ? dash : v}</span>;
const Tag = ({ tone = "g", children }) => <span className={"tag tag-" + tone}>{children}</span>;

function NumInput({ value, onChange, w = 64, ph = "", disabled = false }) {
  return (
    <input className="ninp" style={{ width: w }} type="number" min="0" inputMode="numeric" placeholder={ph} disabled={disabled}
      value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Math.max(0, parseInt(e.target.value) || 0))} />
  );
}

function PriceInput({ value, onChange, w = 88 }) {
  return (
    <input className="ninp" style={{ width: w }} type="number" min="0" step="0.01" inputMode="decimal" placeholder="0,00"
      value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? "" : Math.max(0, parseFloat(e.target.value) || 0))} />
  );
}

function DateNav({ date, setDate }) {
  return (
    <div className="datenav">
      <button className="ghost" onClick={() => setDate(addDays(date, -1))}>‹</button>
      <input type="date" className="dinp" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      <button className="ghost" onClick={() => setDate(addDays(date, 1))}>›</button>
      <button className="ghost today" onClick={() => setDate(todayISO())}>hoje</button>
    </div>
  );
}

/* ============ APP ============ */
function Workspace({ user, pdv, hotelName, onExit, openHelp, onLogout }) {
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [tab, setTab] = useState("dash");
  const [products, setProducts] = useState([]);
  const [index, setIndex] = useState([]);          // datas com lançamento, ordenadas
  const [months, setMonths] = useState({});        // ym -> { date: rec }
  const [pending, setPending] = useState([]);      // datas aguardando validação
  const [workDate, setWorkDate] = useState(todayISO());
  const [draft, setDraft] = useState(emptyDay(todayISO()));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2800); };
  const fullName = hotelName + " · " + pdv.name;
  const ro = !canEditDay(user, workDate);

  /* ---- carregamento (reutilizado após importar backup) ---- */
  const loadAll = useCallback(async () => {
    try {
      const prods = ((await api.getProducts(pdv.id)) || []).slice().sort(byName);
      const { dates, pending: pend } = await api.getIndex(pdv.id);
      const need = new Set([ymOf(todayISO())]);
      if (dates.length) { need.add(ymOf(dates[dates.length - 1])); if (dates.length > 1) need.add(ymOf(dates[dates.length - 2])); }
      const m = {};
      for (const ym of need) m[ym] = await api.getDays(pdv.id, ym + "-01", ym + "-31");
      setProducts(prods); setIndex(dates); setMonths(m); setPending(pend); setReady(true);
    } catch (e) { setStorageOk(false); setReady(true); flash(e.message); }
  }, [pdv.id]);
  useEffect(() => { loadAll(); }, [loadAll]);

  const ensureMonths = useCallback(async (yms) => {
    const missing = yms.filter((ym) => !(ym in months));
    if (!missing.length) return;
    const add = {};
    for (const ym of missing) add[ym] = await api.getDays(pdv.id, ym + "-01", ym + "-31");
    setMonths((prev) => ({ ...add, ...prev }));
  }, [months, pdv.id]);

  const getDay = useCallback((date) => months[ymOf(date)]?.[date] || null, [months]);
  const prevDateOf = useCallback((date) => { for (let i = index.length - 1; i >= 0; i--) if (index[i] < date) return index[i]; return null; }, [index]);

  /* ---- rascunho do dia de trabalho ---- */
  useEffect(() => {
    (async () => {
      const need = [ymOf(workDate)];
      const pd = prevDateOf(workDate);
      if (pd) need.push(ymOf(pd));
      await ensureMonths(need);
    })();
  }, [workDate, index]); // eslint-disable-line

  useEffect(() => {
    const saved = getDay(workDate);
    setDraft(saved ? JSON.parse(JSON.stringify(saved)) : emptyDay(workDate));
    setDirty(false);
  }, [workDate, months]); // eslint-disable-line

  const upHeader = (f, v) => { if (ro) return; setDraft((d) => ({ ...d, [f]: v })); setDirty(true); };
  const upItem = (pid, f, v) => { if (ro) return; setDraft((d) => ({ ...d, items: { ...d.items, [pid]: { ...(d.items[pid] || {}), [f]: v } } })); setDirty(true); };

  const applyRec = (rec, date) => {
    const ym = ymOf(date);
    setMonths((pp) => ({ ...pp, [ym]: { ...(pp[ym] || {}), [date]: rec } }));
    setIndex((idx) => idx.includes(date) ? idx : [...idx, date].sort());
    setPending((pd) => { const base = pd.filter((x) => x !== date); return rec.status === "pending" ? [...base, date].sort() : base; });
  };

  const saveDraft = async () => {
    if (ro) return;
    setSaving(true);
    try {
      const rec = await api.saveDay(pdv.id, workDate, { time: draft.time, resp: draft.resp, items: draft.items });
      applyRec(rec, workDate); setDraft(rec); setDirty(false);
      if (rec.status === "pending") flash("Dia " + fmtBR(workDate) + " salvo — enviado para validação do gerente");
      else flash("Dia " + fmtBR(workDate) + " salvo e validado");
    } catch (e) { flash(e.message); }
    setSaving(false);
  };

  const validateDay = async (date) => {
    try {
      const rec = await api.validateDay(pdv.id, date);
      applyRec(rec, date);
      if (date === workDate) setDraft(rec);
      flash("Conciliação de " + fmtBR(date) + " validada");
    } catch (e) { flash(e.message); }
  };

  const saveProducts = async (list) => { const sorted = list.slice().sort(byName); setProducts(sorted); try { await api.saveProducts(pdv.id, sorted); } catch (e) { flash(e.message); } };

  const prevRec = useMemo(() => { const pd = prevDateOf(workDate); return pd ? getDay(pd) : null; }, [workDate, months, index]); // eslint-disable-line
  const prevDate = prevDateOf(workDate);

  if (!ready) return <div className="boot"><style>{CSS}</style><div className="bootcard">Carregando controle de estoque…</div></div>;

  const TABS = [["dash", "Dashboard"], ["count", "Contagem"], ["conc", "Conciliação"], ["rep", "Reposição"], ["hist", "Histórico"], ["prod", "Produtos"], ["backup", "Backup"]];
  const showValidations = can.validate(user) && pending.length > 0;

  return (
    <div className="app">
      <style>{CSS}</style>
      <header className="hdr no-print">
        <div className="hdr-in">
          <div className="hdr-top">
            <div className="brand">
              <div className="stamp">PAR<br />STOCK</div>
              <div>
                <div className="brand-t">{hotelName}</div>
                <div className="pdv-title">{pdv.name}</div>
              </div>
            </div>
            <div className="hdr-actions">
              {showValidations && (
                <button className="bell" onClick={() => { setTab("hist"); }} title={pending.length + " conciliação(ões) aguardando validação"}>
                  <span className="bell-i">🔔</span><span className="bell-n">{pending.length}</span>
                </button>
              )}
              <div className="who"><span className="who-n">{user.name}</span><span className="who-r">{roleLabel(user.role)}</span></div>
              <button className="switchbtn" onClick={onExit}>Trocar PDV</button>
              <button className="switchbtn" onClick={onLogout} title="Sair da conta">Sair</button>
              <button className="helpbtn" onClick={openHelp} title="Dúvidas e suporte">?</button>
            </div>
          </div>
          <nav className="tabs">
            {TABS.map(([k, l]) => (
              <button key={k} className={"tab" + (tab === k ? " on" : "")} onClick={() => setTab(k)}>
                {l}{k === "hist" && showValidations ? <span className="tabdot" /> : null}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {!storageOk && <div className="warn no-print">Não foi possível conectar ao servidor. Verifique sua conexão e recarregue a página.</div>}
      {ro && ["count", "conc", "rep"].includes(tab) && (
        <div className="robar no-print">Você está vendo <b>{fmtBR(workDate)}</b> (dia retroativo). Seu perfil ({roleLabel(user.role)}) não pode alterar dias anteriores — selecione o dia de hoje para lançar.</div>
      )}

      <main className="main">
        <Boundary tabKey={tab}>
        {products.length === 0 && !["prod", "backup"].includes(tab) && (
          <div className="card" style={{ marginBottom: 14 }}><div className="empty">Este PDV ainda não tem produtos cadastrados.<br /><button className="primary" style={{ marginTop: 10 }} onClick={() => setTab("prod")}>Cadastrar produtos</button></div></div>
        )}
        {tab === "dash" && <Dashboard products={products} index={index} months={months} ensureMonths={ensureMonths} getDay={getDay} go={(d) => { setWorkDate(d); setTab("conc"); }} />}
        {tab === "count" && <Contagem products={products} draft={draft} upHeader={upHeader} upItem={upItem} date={workDate} setDate={setWorkDate} pdvName={fullName} ro={ro} />}
        {tab === "conc" && <Conciliacao products={products} draft={draft} prevRec={prevRec} prevDate={prevDate} upItem={upItem} date={workDate} setDate={setWorkDate} pdvName={fullName} ro={ro} user={user} onValidate={validateDay} />}
        {tab === "rep" && <Reposicao products={products} draft={draft} prevRec={prevRec} upItem={upItem} date={workDate} setDate={setWorkDate} pdvName={fullName} ro={ro} />}
        {tab === "hist" && <Historico products={products} index={index} months={months} ensureMonths={ensureMonths} getDay={getDay} prevOf={prevDateOf} go={(d) => { setWorkDate(d); setTab("conc"); }} user={user} onValidate={validateDay} pending={pending} />}
        {tab === "prod" && <Produtos products={products} saveProducts={saveProducts} />}
        {tab === "backup" && <BackupTab pdv={pdv} hotelName={hotelName} user={user} flash={flash} reload={loadAll} />}
        </Boundary>
      </main>
      <Footer />

      {dirty && !ro && ["count", "conc", "rep"].includes(tab) && (
        <div className="savebar no-print">
          <span>Alterações de <b>{fmtBR(workDate)}</b> não salvas</span>
          <button className="primary" disabled={saving} onClick={saveDraft}>{saving ? "Salvando…" : "Salvar dia"}</button>
        </div>
      )}
      {toast && <div className="toast no-print">{toast}</div>}
    </div>
  );
}

/* ============ GRÁFICO DE BARRAS (SVG, sem dependências) ============ */
function BarsChart({ data, go }) {
  const W = 760, H = 230, padL = 34, padR = 10, padT = 12, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB;
  const max = Math.max(1, ...data.map((d) => d.sales));
  const niceMax = Math.max(1, Math.ceil(max / 4) * 4);
  const n = data.length;
  const step = iw / n;
  const bw = Math.min(46, step * 0.62);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(niceMax * f));
  const x = (i) => padL + step * i + (step - bw) / 2;
  const y = (v) => padT + ih - (v / niceMax) * ih;
  const everyLabel = n > 16 ? Math.ceil(n / 16) : 1;
  return (
    <div className="chartwrap">
      <svg viewBox={"0 0 " + W + " " + H} className="barsvg" preserveAspectRatio="xMidYMid meet">
        {ticks.map((tv, k) => (
          <g key={k}>
            <line x1={padL} x2={W - padR} y1={y(tv)} y2={y(tv)} stroke="#e6ebe5" strokeDasharray="2 4" />
            <text x={padL - 6} y={y(tv) + 3} textAnchor="end" fontSize="10" fill="#8a978f">{tv}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = Math.max(d.sales > 0 ? 2 : 0, (d.sales / niceMax) * ih);
          const yy = padT + ih - h;
          return (
            <g key={i} className="barg" onClick={() => go(d.d)} style={{ cursor: "pointer" }}>
              <title>{fmtBR(d.d) + " — " + d.sales + " vendas" + (d.losses > 0 ? " · perdas " + d.losses : "")}</title>
              <rect x={x(i)} y={padT} width={bw} height={ih} fill="transparent" />
              <rect x={x(i)} y={yy} width={bw} height={h} rx="4" fill={d.losses > 0 ? "#dc9a2e" : "#0e7c66"} className="bar" />
              {i % everyLabel === 0 && <text x={x(i) + bw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="#5c6b66">{d.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ============ DASHBOARD ============ */
function Dashboard({ products, index, months, ensureMonths, getDay, go }) {
  const [span, setSpan] = useState(7);
  const [from, setFrom] = useState(addDays(todayISO(), -6));
  const [to, setTo] = useState(todayISO());
  const f = span === 0 ? from : addDays(todayISO(), -(span - 1));
  const t = span === 0 ? to : todayISO();

  useEffect(() => { ensureMonths(monthsBetween(f, t)); }, [f, t]); // eslint-disable-line

  const dates = useMemo(() => index.filter((d) => d >= f && d <= t), [index, f, t]);
  const data = useMemo(() => dates.map((d) => {
    const i = index.indexOf(d);
    const prev = i > 0 ? getDay(index[i - 1]) : null;
    const tt = dayTotals(products, getDay(d), prev);
    return { d, label: fmtShort(d), ...tt };
  }), [dates, months, products]); // eslint-disable-line

  const tot = data.reduce((a, x) => ({ sales: a.sales + x.sales, losses: a.losses + x.losses, rep: a.rep + x.rep, lossVal: a.lossVal + (x.lossVal || 0) }), { sales: 0, losses: 0, rep: 0, lossVal: 0 });
  const lastDate = index.length ? index[index.length - 1] : null;
  const lastRec = lastDate ? getDay(lastDate) : null;
  const lastPrev = lastDate ? (index.length > 1 ? getDay(index[index.length - 2]) : null) : null;
  const lastRows = lastRec ? calcRows(products, lastRec, lastPrev) : [];
  const pending = lastRows.filter((r) => r.repNeed != null && r.repNeed - num(r.it.r) > 0);

  const byProd = useMemo(() => {
    const m = {};
    dates.forEach((d) => {
      const rec = getDay(d); if (!rec) return;
      const i = index.indexOf(d); const prev = i > 0 ? getDay(index[i - 1]) : null;
      calcRows(products, rec, prev).forEach((r) => {
        if (!m[r.id]) m[r.id] = { name: r.name, unit: r.unit, sales: 0, losses: 0, lossVal: 0 };
        m[r.id].sales += r.vt; if (r.dif != null && r.dif < 0) { m[r.id].losses += -r.dif; m[r.id].lossVal += -r.dif * num(r.price); }
      });
    });
    return Object.values(m);
  }, [dates, months, products]); // eslint-disable-line
  const topSales = [...byProd].sort((a, b) => b.sales - a.sales).slice(0, 6).filter((x) => x.sales > 0);
  const topLoss = [...byProd].sort((a, b) => b.losses - a.losses).slice(0, 6).filter((x) => x.losses > 0);

  return (
    <section>
      <div className="row between wrap">
        <h2>Dashboard</h2>
        <div className="filters">
          {[7, 15, 30].map((n) => <button key={n} className={"chip" + (span === n ? " on" : "")} onClick={() => setSpan(n)}>{n} dias</button>)}
          <button className={"chip" + (span === 0 ? " on" : "")} onClick={() => setSpan(0)}>período</button>
          {span === 0 && (<span className="rangepick">
            <input type="date" className="dinp" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="dim">até</span>
            <input type="date" className="dinp" value={to} onChange={(e) => setTo(e.target.value)} />
          </span>)}
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="kpi-n mono">{tot.sales}</div><div className="kpi-l">unidades vendidas</div><div className="kpi-s">{fmtBR(f)} – {fmtBR(t)}</div></div>
        <div className="kpi"><div className={"kpi-n mono" + (tot.losses ? " bad" : "")}>{tot.losses}</div><div className="kpi-l">perdas no período</div><div className="kpi-s">{tot.lossVal > 0 ? <b className="bad">≈ {fmtBRL(tot.lossVal)}</b> : "diferenças negativas"}</div></div>
        <div className="kpi"><div className="kpi-n mono">{tot.rep}</div><div className="kpi-l">unidades repostas</div><div className="kpi-s">{data.length} dia(s) lançado(s)</div></div>
        <div className="kpi"><div className={"kpi-n mono" + (pending.length ? " amber" : "")}>{pending.length}</div><div className="kpi-l">itens abaixo do mínimo</div><div className="kpi-s">{lastDate ? "última contagem: " + fmtBR(lastDate) : "sem lançamentos"}</div></div>
      </div>

      <div className="card">
        <div className="card-t">Vendas por dia</div>
        {data.length === 0 ? <div className="empty">Nenhum dia lançado no período. Comece pela aba <b>Contagem</b>.</div> : (
          <BarsChart data={data} go={go} />
        )}
        {data.some((x) => x.losses > 0) && <div className="legend"><i className="dot" style={{ background: "#dc9a2e" }} /> dia com perda registrada <i className="dot" style={{ background: "#0e7c66", marginLeft: 14 }} /> dia sem perdas</div>}
      </div>

      <div className="grid2">
        <div className="card">
          <div className="card-t">Mais vendidos no período</div>
          {topSales.length === 0 ? <div className="empty">Sem vendas lançadas.</div> : topSales.map((x, i) => (
            <div className="rank" key={i}>
              <span className="rank-n">{x.name} <span className="dim">({x.unit})</span></span>
              <span className="rank-bar"><i style={{ width: Math.max(6, (x.sales / topSales[0].sales) * 100) + "%" }} /></span>
              <span className="mono rank-v">{x.sales}</span>
            </div>
          ))}
        </div>
        <div className="card">
          <div className="card-t">Perdas por produto</div>
          {topLoss.length === 0 ? <div className="empty ok">Nenhuma perda no período. ✓</div> : topLoss.map((x, i) => (
            <div className="rank" key={i}>
              <span className="rank-n">{x.name}</span>
              <span className="rank-bar loss"><i style={{ width: Math.max(6, (x.losses / topLoss[0].losses) * 100) + "%" }} /></span>
              <span className="rank-v2"><span className="mono bad">−{x.losses}</span>{x.lossVal > 0 && <div className="adj bad">{fmtBRL(x.lossVal)}</div>}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============ CONTAGEM ============ */
function Contagem({ products, draft, upHeader, upItem, date, setDate, pdvName, ro }) {
  const list = products;
  const done = products.filter((p) => has(draft.items[p.id]?.c)).length;
  return (
    <section>
      <div className="row between wrap no-print">
        <h2>Contagem diária</h2>
        <div className="row gap"><DateNav date={date} setDate={setDate} /><button className="primary" onClick={() => window.print()}>Imprimir lista</button></div>
      </div>
      <div className="card no-print">
        <div className="row wrap gap">
          <label className="fld">Horário<input type="time" className="dinp" value={draft.time} disabled={ro} onChange={(e) => upHeader("time", e.target.value)} /></label>
          <label className="fld">Responsável<input className="tinp" value={draft.resp} disabled={ro} placeholder="quem contou" onChange={(e) => upHeader("resp", e.target.value)} /></label>
          <div className="grow" />
          <div className="progress"><b className="mono">{done}</b>/<span className="mono">{products.length}</span> contados</div>
        </div>
      </div>
      <div className="card pad0 print-zone">
        <div className="printhead">
          <div className="stamp sm">PAR<br />STOCK</div>
          <div>
            <div className="ph-t">CONTAGEM — {pdvName}</div>
            <div className="ph-s">Data: {fmtBR(date)} · Horário: {draft.time || "_____:_____"} · Responsável: {draft.resp || "____________________"}</div>
          </div>
        </div>
        <table className="tbl no-print">
          <thead><tr><th className="tl">Produto</th><th>Uni.</th><th>Mínimo</th><th>Contagem</th></tr></thead>
          <tbody>
            {list.map((p) => {
              const c = draft.items[p.id]?.c;
              return (
                <tr key={p.id} className={has(c) ? "rowdone" : ""}>
                  <td className="tl">{p.name}</td>
                  <td className="dim">{p.unit}</td>
                  <td><Num v={p.par} /></td>
                  <td><NumInput value={c} disabled={ro} onChange={(v) => upItem(p.id, "c", v)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <table className="tbl ct2">
          <thead><tr><th className="tl">Produto</th><th>Uni.</th><th>Contagem</th><th className="ct-gap" /><th className="tl">Produto</th><th>Uni.</th><th>Contagem</th></tr></thead>
          <tbody>
            {(() => {
              const half = Math.ceil(list.length / 2);
              const val = (p) => { const c = draft.items[p.id]?.c; return has(c) ? <span className="mono">{c}</span> : <span className="cline" />; };
              return Array.from({ length: half }).map((_, i) => {
                const L = list[i]; const R = list[i + half];
                return (
                  <tr key={i}>
                    <td className="tl">{L ? L.name : ""}</td><td className="dim">{L ? L.unit : ""}</td><td>{L ? val(L) : ""}</td>
                    <td className="ct-gap" />
                    <td className="tl">{R ? R.name : ""}</td><td className="dim">{R ? R.unit : ""}</td><td>{R ? val(R) : ""}</td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>
      </div>
      <p className="hint no-print">Depois de contar, vá para <b>Conciliação</b> para lançar as vendas — e lembre de <b>salvar o dia</b>.</p>
    </section>
  );
}

/* ============ CONCILIAÇÃO ============ */
function Conciliacao({ products, draft, prevRec, prevDate, upItem, date, setDate, pdvName, ro, user, onValidate }) {
  const rows = calcRows(products, draft, prevRec);
  const t = dayTotals(products, draft, prevRec);
  const st = draft.status || "draft";
  const canVal = can.validate(user) && st === "pending";
  return (
    <section>
      <div className="row between wrap no-print">
        <h2>Conciliação</h2>
        <div className="row gap"><DateNav date={date} setDate={setDate} /><button className="primary" onClick={printLandscape}>Imprimir</button></div>
      </div>

      {st !== "draft" && (
        <div className={"statusbar no-print " + (st === "validated" ? "ok" : "pend")}>
          {st === "validated"
            ? <span>✓ Conciliação validada{draft.validatedBy ? " por " + draft.validatedBy.name : ""}{draft.validatedAt ? " em " + new Date(draft.validatedAt).toLocaleString("pt-BR") : ""}.</span>
            : <span>⏳ Aguardando validação do gerente{draft.savedBy ? " · enviada por " + draft.savedBy.name : ""}.</span>}
          {canVal && <button className="primary sm" onClick={() => onValidate(date)}>Validar conciliação</button>}
        </div>
      )}

      <div className="chain card no-print">
        <div className="chain-step"><div className="chain-l">Fechamento anterior</div><div className="chain-v mono">{prevDate ? fmtBR(prevDate) : "—"}</div><div className="chain-s">{prevDate ? "estoque inicial de hoje" : "1º dia: usa o estoque mínimo"}</div></div>
        <div className="chain-a">→</div>
        <div className="chain-step"><div className="chain-l">Vendas no período</div><div className="chain-v mono">{t.sales}</div><div className="chain-s">ontem ajustadas + hoje até a contagem</div></div>
        <div className="chain-a">→</div>
        <div className="chain-step"><div className="chain-l">Contagem de hoje</div><div className="chain-v mono">{t.counted}<span className="dim">/{products.length}</span></div><div className="chain-s">itens contados</div></div>
        <div className="chain-a">→</div>
        <div className="chain-step"><div className="chain-l">A repor</div><div className="chain-v mono amber">{t.toRep}</div><div className="chain-s">p/ voltar ao mínimo</div></div>
        <div className="chain-a">→</div>
        <div className="chain-step"><div className="chain-l">Diferenças</div><div className={"chain-v mono" + (t.losses ? " bad" : "")}>{t.losses ? "−" + t.losses : "0"}{t.surplus ? <span className="ok"> / +{t.surplus}</span> : null}</div><div className="chain-s">falta / sobra</div></div>
      </div>

      <div className="card pad0 print-zone">
        <div className="printhead">
          <div className="stamp sm">PAR<br />STOCK</div>
          <div>
            <div className="ph-t">CONCILIAÇÃO — {pdvName}</div>
            <div className="ph-s">Data: {fmtBR(date)}{draft.time ? " · Contagem às " + draft.time : ""}{draft.resp ? " · Resp.: " + draft.resp : ""}</div>
          </div>
        </div>
        <div className="scrollx conc-scroll">
        <table className="tbl wide">
          <thead>
            <tr>
              <th className="tl sticky">Produto</th><th>Mín.</th><th title="Fechamento do dia anterior (contagem + reposto). Sem dia anterior, usa o mínimo.">Inicial</th>
              <th>Contagem</th><th className="inph" title='Vendas totais de ontem. O que já foi lançado como "vendas hoje" no dia anterior é descontado automaticamente.'>Vendas ontem</th><th className="inph">Vendas hoje</th><th>Venda total</th>
              <th>A repor</th><th className="inph">Reposto</th><th>Fechamento</th><th>Diferença</th><th className="tl">Justificativa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="tl sticky">{r.name} <span className="dim">({r.unit})</span></td>
                <td><Num v={r.par} /></td>
                <td><Num v={r.opening} />{!r.hasPrev && <span className="mark" title="sem dia anterior — usando o estoque mínimo">*</span>}</td>
                <td><NumInput value={r.it.c} disabled={ro} onChange={(v) => upItem(r.id, "c", v)} /></td>
                <td><NumInput value={r.it.sp} disabled={ro} onChange={(v) => upItem(r.id, "sp", v)} /></td>
                <td><NumInput value={r.it.st} disabled={ro} onChange={(v) => upItem(r.id, "st", v)} /></td>
                <td><Num v={r.vt || (r.count != null ? 0 : null)} /></td>
                <td>{r.repNeed == null ? <Num v={null} /> : r.repNeed > 0 ? <Tag tone="a">{r.repNeed}</Tag> : <span className="dim mono">0</span>}</td>
                <td><NumInput value={r.it.r} disabled={ro} onChange={(v) => upItem(r.id, "r", v)} /></td>
                <td><Num v={r.fech} /></td>
                <td>{r.dif == null ? <Num v={null} /> : r.dif < 0 ? <Tag tone="r">−{-r.dif}</Tag> : r.dif > 0 ? <Tag tone="g">+{r.dif}</Tag> : <span className="dim mono">0</span>}</td>
                <td className="tl"><input className="tinp jinp no-print" value={r.it.j || ""} disabled={ro} placeholder="" onChange={(e) => upItem(r.id, "j", e.target.value)} /><span className="jprint">{r.it.j || ""}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <div className="signrow">
          <div className="signbox"><div className="signline" /><div className="signlabel">Supervisor de A&amp;B</div></div>
          <div className="signbox"><div className="signline" /><div className="signlabel">Subgerente</div></div>
        </div>
      </div>
      <p className="hint no-print"><b>Vendas ontem</b>: lance o total do dia anterior — o sistema desconta sozinho o que já entrou como "vendas hoje" naquele dia (o valor considerado aparece abaixo do campo). <b>Diferença</b> = contagem + vendas − estoque inicial. Negativa indica falta (possível perda); justifique no campo ao lado. O <b>fechamento</b> (contagem + reposto) vira automaticamente o estoque inicial do próximo dia lançado.</p>
    </section>
  );
}

/* ============ REPOSIÇÃO ============ */
function Reposicao({ products, draft, prevRec, upItem, date, setDate, pdvName, ro }) {
  const rows = calcRows(products, draft, prevRec).filter((r) => r.repNeed != null && r.repNeed > 0);
  const counted = calcRows(products, draft, prevRec).some((r) => r.count != null);
  return (
    <section>
      <div className="row between wrap no-print">
        <h2>Reposição do dia</h2>
        <div className="row gap"><DateNav date={date} setDate={setDate} /><button className="primary" onClick={() => window.print()}>Imprimir lista</button></div>
      </div>
      <div className="card pad0 print-zone">
        <div className="printhead">
          <div className="stamp sm">PAR<br />STOCK</div>
          <div><div className="ph-t">REPOSIÇÃO — {pdvName}</div><div className="ph-s">Data: {fmtBR(date)} {draft.time && " · Contagem às " + draft.time}{draft.resp && " · Resp.: " + draft.resp}</div></div>
        </div>
        {!counted ? <div className="empty">Lance a contagem do dia para gerar a lista de reposição.</div> :
          rows.length === 0 ? <div className="empty ok">Todos os itens estão no estoque mínimo. Nada a repor. ✓</div> : (
            <table className="tbl">
              <thead><tr><th className="tl">Produto</th><th>Uni.</th><th>Em loja</th><th>Mínimo</th><th>Repor</th><th>Reposto</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="tl">{r.name}</td><td className="dim">{r.unit}</td>
                    <td><Num v={r.count} /></td><td><Num v={r.par} /></td>
                    <td><Tag tone="a">{r.repNeed}</Tag></td>
                    <td><NumInput value={r.it.r} disabled={ro} onChange={(v) => upItem(r.id, "r", v)} /></td>
                  </tr>
                ))}
                <tr className="totrow"><td className="tl">Total</td><td /><td /><td /><td><b className="mono">{rows.reduce((a, r) => a + r.repNeed, 0)}</b></td><td /></tr>
              </tbody>
            </table>
          )}
      </div>
      <p className="hint no-print">Imprima, faça a reposição anotando no papel e depois digite aqui (ou na Conciliação) a quantidade <b>Reposto</b> — e salve o dia. É esse valor que define o estoque inicial de amanhã.</p>
    </section>
  );
}

/* ============ HISTÓRICO ============ */
function Historico({ products, index, months, ensureMonths, getDay, prevOf, go, user, onValidate, pending }) {
  const [from, setFrom] = useState(addDays(todayISO(), -29));
  const [to, setTo] = useState(todayISO());
  const [open, setOpen] = useState(null);
  const [filter, setFilter] = useState("all"); // all | pending | validated
  useEffect(() => { ensureMonths(monthsBetween(from, to)); }, [from, to]); // eslint-disable-line
  let dates = index.filter((d) => d >= from && d <= to).slice().reverse();
  const statusOf = (d) => (getDay(d)?.status) || "draft";
  if (filter === "pending") dates = dates.filter((d) => statusOf(d) === "pending");
  if (filter === "validated") dates = dates.filter((d) => statusOf(d) === "validated");
  const pendCount = pending ? pending.length : 0;

  const Badge = ({ st }) => st === "validated"
    ? <span className="sbadge ok">✓ Validado</span>
    : st === "pending"
      ? <span className="sbadge pend">⏳ Aguardando validação</span>
      : <span className="sbadge dim">rascunho</span>;

  return (
    <section>
      <div className="row between wrap">
        <h2>Histórico</h2>
        <div className="filters"><input type="date" className="dinp" value={from} onChange={(e) => setFrom(e.target.value)} /><span className="dim">até</span><input type="date" className="dinp" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      </div>

      <div className="filters">
        <button className={"chip" + (filter === "all" ? " on" : "")} onClick={() => setFilter("all")}>Todos</button>
        <button className={"chip" + (filter === "pending" ? " on" : "")} onClick={() => setFilter("pending")}>Pendentes{pendCount ? " (" + pendCount + ")" : ""}</button>
        <button className={"chip" + (filter === "validated" ? " on" : "")} onClick={() => setFilter("validated")}>Validados</button>
      </div>

      {dates.length === 0 && <div className="card"><div className="empty">{filter === "pending" ? "Nenhuma conciliação pendente neste período." : "Nenhum dia lançado neste período."}</div></div>}
      {dates.map((d) => {
        const rec = getDay(d); if (!rec) return null;
        const pd = prevOf(d); const prev = pd ? getDay(pd) : null;
        const t = dayTotals(products, rec, prev);
        const st = rec.status || "draft";
        const rows = open === d ? calcRows(products, rec, prev).filter((r) => r.count != null || r.vt > 0) : [];
        return (
          <div className={"card pad0 histcard" + (st === "pending" ? " hl-pend" : "")} key={d}>
            <button className="histhead" onClick={() => setOpen(open === d ? null : d)}>
              <span className="histdate mono">{fmtBR(d)}</span>
              <span className="histkpis">
                <Badge st={st} />
                <span>vendas <b className="mono">{t.sales}</b></span>
                <span>repostos <b className="mono">{t.rep}</b></span>
                <span>perdas <b className={"mono" + (t.losses ? " bad" : "")}>{t.losses ? "−" + t.losses : "0"}</b>{t.lossVal > 0 && <span className="bad"> ({fmtBRL(t.lossVal)})</span>}</span>
                {t.surplus > 0 && <span>sobras <b className="mono ok">+{t.surplus}</b></span>}
                <span className="dim">{t.counted} itens{rec.savedBy ? " · " + rec.savedBy.name : ""}</span>
              </span>
              <span className="histact">{open === d ? "fechar" : "detalhes"}</span>
            </button>
            {open === d && (
              <div className="scrollx">
                <table className="tbl">
                  <thead><tr><th className="tl">Produto</th><th>Inicial</th><th>Vendas</th><th>Contagem</th><th>Reposto</th><th>Fechamento</th><th>Diferença</th><th className="tl">Justificativa</th></tr></thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="tl">{r.name}</td><td><Num v={r.opening} /></td><td><Num v={r.vt} /></td><td><Num v={r.count} /></td>
                        <td><Num v={has(r.it.r) ? num(r.it.r) : null} /></td><td><Num v={r.fech} /></td>
                        <td>{r.dif == null ? "—" : r.dif < 0 ? <Tag tone="r">−{-r.dif}</Tag> : r.dif > 0 ? <Tag tone="g">+{r.dif}</Tag> : <span className="dim mono">0</span>}</td>
                        <td className="tl dim">{r.it.j || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="histfoot">
                  <div className="dim" style={{ fontSize: 12 }}>
                    {rec.savedBy ? "Salvo por " + rec.savedBy.name + " (" + roleLabel(rec.savedBy.role) + ")" : ""}
                    {rec.validatedBy ? " · Validado por " + rec.validatedBy.name : ""}
                  </div>
                  <div className="row gap">
                    {can.validate(user) && st === "pending" && <button className="primary sm" onClick={() => onValidate(d)}>Validar conciliação</button>}
                    <button className="ghost" onClick={() => go(d)}>Abrir na Conciliação →</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}

/* ============ PRODUTOS ============ */
function Produtos({ products, saveProducts }) {
  const [q, setQ] = useState("");
  const [nv, setNv] = useState({ name: "", unit: "UN", par: "", price: "" });
  const list = products.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  const up = (id, f, v) => saveProducts(products.map((p) => (p.id === id ? { ...p, [f]: f === "par" || f === "price" ? num(v) : v } : p)));
  const del = (id) => { const p = products.find((x) => x.id === id); if (window.confirm('Excluir "' + p.name + '"? O histórico de dias já salvos não é alterado.')) saveProducts(products.filter((x) => x.id !== id)); };
  const add = () => { if (!nv.name.trim()) return; saveProducts([...products, { id: uid(), name: nv.name.trim(), unit: nv.unit.trim() || "UN", par: num(nv.par), price: num(nv.price) }]); setNv({ name: "", unit: "UN", par: "", price: "" }); };
  return (
    <section>
      <div className="row between wrap"><h2>Produtos</h2><label className="fld">Buscar<input className="tinp" value={q} onChange={(e) => setQ(e.target.value)} placeholder="filtrar…" /></label></div>
      <div className="card">
        <div className="card-t">Novo produto</div>
        <div className="row wrap gap">
          <label className="fld grow">Nome<input className="tinp" value={nv.name} onChange={(e) => setNv({ ...nv, name: e.target.value })} placeholder="ex.: água com gás 500ml" /></label>
          <label className="fld">Unidade<input className="tinp" style={{ width: 80 }} value={nv.unit} onChange={(e) => setNv({ ...nv, unit: e.target.value.toUpperCase() })} /></label>
          <label className="fld">Estoque mínimo<NumInput value={nv.par} onChange={(v) => setNv({ ...nv, par: v })} w={90} /></label>
          <label className="fld">Valor (R$)<PriceInput value={nv.price} onChange={(v) => setNv({ ...nv, price: v })} /></label>
          <button className="primary self-end" onClick={add}>Adicionar</button>
        </div>
      </div>
      {products.length === 0 && (
        <div className="card"><div className="empty">Nenhum produto cadastrado neste PDV. Use o formulário acima para começar.</div></div>
      )}
      <div className="card pad0">
        <table className="tbl">
          <thead><tr><th className="tl">Produto</th><th>Unidade</th><th>Estoque mínimo</th><th>Valor (R$)</th><th /></tr></thead>
          <tbody>
            {list.map((p) => (
              <tr key={p.id}>
                <td className="tl"><input className="tinp full" value={p.name} onChange={(e) => up(p.id, "name", e.target.value)} /></td>
                <td><input className="tinp" style={{ width: 64, textAlign: "center" }} value={p.unit} onChange={(e) => up(p.id, "unit", e.target.value.toUpperCase())} /></td>
                <td><NumInput value={p.par} onChange={(v) => up(p.id, "par", v)} /></td>
                <td><PriceInput value={p.price} onChange={(v) => up(p.id, "price", v)} /></td>
                <td><button className="ghost danger" onClick={() => del(p.id)}>excluir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{products.length} produtos cadastrados. Alterações aqui valem para os próximos lançamentos. O <b>Valor (R$)</b> é usado para calcular o custo das perdas no dashboard.</p>
    </section>
  );
}

/* ============ BACKUP ============ */
function BackupTab({ pdv, hotelName, user, flash, reload }) {
  const allowImport = user.role === "admin" || user.role === "gerente";
  const doExport = async () => {
    try {
      const dump = await api.exportPdv(pdv.id);
      dump.pdv = { hotel: hotelName, name: pdv.name };
      const blob = new Blob([JSON.stringify(dump)], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
      a.download = "backup-" + (pdv.name || "pdv").toLowerCase().replace(/[^a-z0-9]+/gi, "-") + "-" + todayISO() + ".json";
      a.click(); URL.revokeObjectURL(a.href); flash("Backup exportado");
    } catch (e) { flash(e.message); }
  };
  const doImport = (file) => {
    const r = new FileReader();
    r.onload = async () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || d._type !== "parstock-pdv-backup") { alert("Arquivo de backup inválido."); return; }
        if (!window.confirm('Importar backup para "' + pdv.name + '"? Os dados atuais deste PDV serão substituídos pelos do arquivo.')) return;
        await api.importPdv(pdv.id, d); flash("Backup importado"); reload();
      } catch (e) { alert(e.message || "Não foi possível ler o arquivo de backup."); }
    };
    r.readAsText(file);
  };
  return (
    <section>
      <h2>Backup e importação</h2>
      <div className="grid2">
        <div className="card">
          <div className="card-t">Exportar backup</div>
          <p className="hint" style={{ margin: "0 0 12px" }}>Baixa um arquivo .json com todos os produtos e lançamentos do PDV <b>{pdv.name}</b> direto do banco de dados.</p>
          <button className="primary" onClick={doExport}>Exportar backup (.json)</button>
        </div>
        <div className="card">
          <div className="card-t">Importar backup</div>
          {allowImport ? (<>
            <p className="hint" style={{ margin: "0 0 12px" }}>Restaura um arquivo de backup neste PDV. Os dados atuais serão substituídos pelos do arquivo.</p>
            <label className="ghost filebtn">Escolher arquivo de backup…
              <input type="file" accept="application/json" style={{ display: "none" }}
                onChange={(e) => { if (e.target.files && e.target.files[0]) doImport(e.target.files[0]); e.target.value = ""; }} />
            </label>
          </>) : <p className="hint">Apenas gerente ou administrador podem importar backups.</p>}
        </div>
      </div>
      <p className="hint">Os dados ficam no banco de dados do servidor. O backup serve para guardar uma cópia ou migrar entre ambientes.</p>
    </section>
  );
}

/* ============ SUPORTE E RODAPÉ ============ */
function HelpModal({ close }) {
  return (
    <div className="modal-ov" onClick={close}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close} aria-label="fechar">×</button>
        <h3>Dúvidas e suporte</h3>
        <div className="dim" style={{ fontSize: 12.5 }}>Fale com o desenvolvedor do sistema:</div>
        <div style={{ margin: "10px 0 2px", fontWeight: 700, fontSize: 15 }}>Rafael Almeida</div>
        <div className="contact">
          <a href="mailto:rafael.almeida@accor.com">
            <span className="cicon" style={{ background: "var(--green)" }}>@</span>
            <span>E-mail<br /><small className="dim" style={{ fontWeight: 400 }}>rafael.almeida@accor.com</small></span>
          </a>
          <a href="https://teams.microsoft.com/l/chat/0/0?users=rafael.almeida@accor.com" target="_blank" rel="noreferrer">
            <span className="cicon" style={{ background: "#5059c9" }}>T</span>
            <span>Microsoft Teams<br /><small className="dim" style={{ fontWeight: 400 }}>iniciar conversa</small></span>
          </a>
        </div>
      </div>
    </div>
  );
}
function Footer() {
  return (
    <footer className="foot no-print">Desenvolvido por <b>Rafael Almeida</b> · <a href="mailto:rafael.almeida@accor.com">rafael.almeida@accor.com</a></footer>
  );
}

/* ============ TELA INICIAL: ESCOLHER / CRIAR PDV ============ */
/* ============ AUTENTICAÇÃO / CONTAS ============ */
function Shell({ children, user, onLogout, openHelp, crumbs }) {
  return (
    <div className="sel">
      <style>{CSS}</style>
      <div className="sel-bar">
        <div className="sel-bar-in">
          <div className="brand">
            <div className="stamp">PAR<br />STOCK</div>
            <div><div className="brand-t dark">Controle de Estoque</div>{crumbs && <div className="crumbs">{crumbs}</div>}</div>
          </div>
          <div className="hdr-actions">
            {user && <div className="who dark"><span className="who-n">{user.name}</span><span className="who-r">{roleLabel(user.role)}</span></div>}
            {user && <button className="switchbtn dark" onClick={onLogout}>Sair</button>}
            <button className="helpbtn green" onClick={openHelp} title="Dúvidas e suporte">?</button>
          </div>
        </div>
      </div>
      <div className="sel-main"><div className="sel-card">{children}</div></div>
      <Footer />
    </div>
  );
}

function Login({ onLogin }) {
  const [login, setLogin] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); setErr(""); const e = await onLogin(login.trim(), pass); if (e) setErr(e); setBusy(false); };
  return (
    <>
      <div className="sel-brand"><div className="stamp big">PAR<br />STOCK</div><div><div className="sel-t">Entrar</div><div className="sel-s">Acesse com seu usuário e senha</div></div></div>
      <div className="card">
        <label className="fld block">Login<input className="tinp full" value={login} autoFocus onChange={(e) => setLogin(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
        <label className="fld block">Senha<input className="tinp full" type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} /></label>
        {err && <p className="hint" style={{ color: "var(--red)" }}>{err}</p>}
        <button className="primary block" disabled={busy} onClick={submit}>{busy ? "Entrando…" : "Entrar"}</button>
        <p className="hint">Não tem acesso? Solicite ao administrador a criação do seu usuário.</p>
      </div>
    </>
  );
}

function ChangePassword({ user, forced, onDone, onLogout }) {
  const [cur, setCur] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = pw.length >= 4 && pw === pw2 && (forced || cur.length > 0);
  const submit = async () => {
    setBusy(true); setErr("");
    try { await api.changePassword(forced ? undefined : cur, pw); onDone(); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <>
      <div className="sel-brand"><div className="stamp big">PAR<br />STOCK</div><div><div className="sel-t">Trocar senha</div><div className="sel-s">{forced ? "Defina uma nova senha para o primeiro acesso" : "Atualize sua senha"}</div></div></div>
      <div className="card">
        <p className="hint" style={{ marginTop: 0 }}>Olá, <b>{user.name}</b>. {forced ? "Por segurança, defina uma senha pessoal antes de continuar." : ""}</p>
        {!forced && <label className="fld block">Senha atual<input className="tinp full" type="password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>}
        <label className="fld block">Nova senha<input className="tinp full" type="password" value={pw} autoFocus onChange={(e) => setPw(e.target.value)} /></label>
        <label className="fld block">Repita a nova senha<input className="tinp full" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ok && submit()} /></label>
        {pw && pw.length < 4 && <p className="hint" style={{ color: "var(--red)" }}>A senha precisa de pelo menos 4 caracteres.</p>}
        {pw2 && pw !== pw2 && <p className="hint" style={{ color: "var(--red)" }}>As senhas não conferem.</p>}
        {err && <p className="hint" style={{ color: "var(--red)" }}>{err}</p>}
        <button className="primary block" disabled={!ok || busy} onClick={submit}>{busy ? "Salvando…" : "Salvar nova senha"}</button>
        <button className="ghost block" style={{ marginTop: 8 }} onClick={onLogout}>Sair</button>
      </div>
    </>
  );
}

function UserForm({ hotels, initial, onSave, onCancel }) {
  const [f, setF] = useState(initial || { name: "", login: "", pass: "", role: "supervisor", hotelIds: [] });
  const [busy, setBusy] = useState(false);
  const toggleHotel = (id) => setF((p) => ({ ...p, hotelIds: p.hotelIds.includes(id) ? p.hotelIds.filter((x) => x !== id) : [...p.hotelIds, id] }));
  const editing = !!initial;
  const ok = f.name.trim() && f.login.trim() && (editing || f.pass.length >= 4) && (f.role === "admin" || f.hotelIds.length > 0);
  const save = async () => { setBusy(true); await onSave(f); setBusy(false); };
  return (
    <div className="card">
      <div className="card-t">{editing ? "Editar usuário" : "Novo usuário"}</div>
      <div className="row wrap gap">
        <label className="fld grow">Nome<input className="tinp full" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="fld grow">Login<input className="tinp full" value={f.login} onChange={(e) => setF({ ...f, login: e.target.value.trim() })} /></label>
        <label className="fld">Perfil<select className="tinp" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="supervisor">Supervisor de A&amp;B</option><option value="gerente">Gerente</option><option value="admin">Administrador</option>
        </select></label>
      </div>
      <label className="fld block" style={{ marginTop: 8 }}>{editing ? "Nova senha (em branco mantém; preenchida força nova troca)" : "Senha provisória (o usuário troca no 1º acesso)"}<input className="tinp full" type="password" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} /></label>
      {f.role !== "admin" && (
        <div style={{ marginTop: 10 }}>
          <div className="card-t" style={{ marginBottom: 6 }}>Hotéis com acesso</div>
          {hotels.length === 0 ? <p className="hint">Crie um hotel primeiro para vincular o usuário.</p> : (
            <div className="chips">{hotels.map((h) => <button key={h.id} className={"chip" + (f.hotelIds.includes(h.id) ? " on" : "")} onClick={() => toggleHotel(h.id)}>{h.name}</button>)}</div>
          )}
        </div>
      )}
      {f.role === "admin" && <p className="hint">Administradores têm acesso a todos os hotéis.</p>}
      <div className="row gap" style={{ marginTop: 12 }}>
        <button className="primary" disabled={!ok || busy} onClick={save}>{busy ? "Salvando…" : editing ? "Salvar" : "Criar usuário"}</button>
        {onCancel && <button className="ghost" onClick={onCancel}>Cancelar</button>}
      </div>
    </div>
  );
}

function UsersScreen({ hotels, me, onBack, flash }) {
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = async () => { try { setUsers(await api.listUsers()); } catch (e) { flash(e.message); } };
  useEffect(() => { load(); }, []); // eslint-disable-line
  const editUser = editing && editing !== "new" ? (users || []).find((u) => u.id === editing) : null;
  const create = async (f) => { try { await api.createUser({ name: f.name, login: f.login, password: f.pass, role: f.role, hotelIds: f.hotelIds }); setEditing(null); load(); } catch (e) { alert(e.message); } };
  const update = async (id, f) => { try { await api.updateUser(id, { name: f.name, login: f.login, password: f.pass, role: f.role, hotelIds: f.hotelIds }); setEditing(null); load(); } catch (e) { alert(e.message); } };
  const remove = async (id, name) => { if (window.confirm('Excluir o usuário "' + name + '"?')) { try { await api.deleteUser(id); load(); } catch (e) { alert(e.message); } } };
  return (
    <>
      <div className="sel-brand"><div className="stamp big">PAR<br />STOCK</div><div><div className="sel-t">Usuários</div><div className="sel-s">Crie contas e defina perfis e hotéis</div></div></div>
      <div className="row gap" style={{ marginBottom: 10 }}>
        <button className="ghost" onClick={onBack}>← Voltar</button>
        {!editing && <button className="primary" onClick={() => setEditing("new")}>+ Novo usuário</button>}
      </div>
      {editing === "new" && <UserForm hotels={hotels} onSave={create} onCancel={() => setEditing(null)} />}
      {editUser && <UserForm hotels={hotels} initial={{ ...editUser, pass: "" }} onSave={(f) => update(editUser.id, f)} onCancel={() => setEditing(null)} />}
      {users === null ? <div className="card"><div className="empty">Carregando…</div></div> : (!editing && users.map((u) => (
        <div className="pdvitem" key={u.id}>
          <div className="grow">
            <div className="pdv-n">{u.name} {u.id === me.id && <span className="dim" style={{ fontSize: 11 }}>(você)</span>}</div>
            <div className="pdv-h">{roleLabel(u.role)} · login: {u.login}{u.role !== "admin" ? " · " + (u.hotelIds || []).map((id) => (hotels.find((h) => h.id === id) || {}).name).filter(Boolean).join(", ") : " · todos os hotéis"}{u.mustChange ? " · (troca de senha pendente)" : ""}</div>
          </div>
          <button className="ghost" onClick={() => setEditing(u.id)}>editar</button>
          {u.id !== me.id && <button className="ghost danger" onClick={() => remove(u.id, u.name)}>excluir</button>}
        </div>
      )))}
    </>
  );
}

/* ============ APP ============ */
export default function App() {
  const [boot, setBoot] = useState(true);
  const [user, setUser] = useState(null);
  const [needChange, setNeedChange] = useState(false);
  const [hotels, setHotels] = useState([]);
  const [pdvs, setPdvs] = useState([]);
  const [hotelId, setHotelId] = useState(null);
  const [pdv, setPdv] = useState(null);
  const [adminView, setAdminView] = useState(null);
  const [help, setHelp] = useState(false);
  const [newHotel, setNewHotel] = useState("");
  const [newPdv, setNewPdv] = useState("");
  const [toast, setToast] = useState("");
  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 2800); };

  // restaurar sessão pelo token
  useEffect(() => {
    (async () => {
      if (getToken()) { try { const { user: u } = await api.me(); setUser(u); setNeedChange(!!u.mustChange); } catch { setToken(null); } }
      setBoot(false);
    })();
  }, []);

  // carregar hotéis quando logado e sem precisar trocar senha
  useEffect(() => {
    (async () => { if (user && !needChange) { try { setHotels(await api.listHotels()); } catch (e) { flash(e.message); } } })();
  }, [user, needChange]);

  // carregar PDVs ao abrir um hotel
  useEffect(() => {
    (async () => { if (user && hotelId) { try { setPdvs(await api.listPdvs(hotelId)); } catch (e) { flash(e.message); } } })();
  }, [user, hotelId]);

  const doLogin = async (login, password) => {
    try { const { token, user: u } = await api.login(login, password); setToken(token); setUser(u); setNeedChange(!!u.mustChange); return ""; }
    catch (e) { return e.message; }
  };
  const logout = () => { setToken(null); setUser(null); setNeedChange(false); setHotelId(null); setPdv(null); setAdminView(null); };

  const addHotel = async () => { if (!newHotel.trim()) return; try { await api.createHotel(newHotel.trim()); setNewHotel(""); setHotels(await api.listHotels()); } catch (e) { flash(e.message); } };
  const addPdv = async () => { if (!newPdv.trim() || !hotelId) return; try { await api.createPdv(hotelId, newPdv.trim()); setNewPdv(""); setPdvs(await api.listPdvs(hotelId)); } catch (e) { flash(e.message); } };
  const removePdv = async (id) => { if (window.confirm("Remover este PDV? Os lançamentos dele serão apagados.")) { try { await api.deletePdv(id); setPdvs(await api.listPdvs(hotelId)); } catch (e) { flash(e.message); } } };

  if (boot) return <div className="boot"><style>{CSS}</style><div className="bootcard">Carregando…</div></div>;

  const helpModal = help ? <HelpModal close={() => setHelp(false)} /> : null;
  const toastEl = toast ? <div className="toast">{toast}</div> : null;

  // sem sessão → login
  if (!user) return <Shell user={null} openHelp={() => setHelp(true)}><Login onLogin={doLogin} />{helpModal}{toastEl}</Shell>;

  // troca de senha obrigatória (primeiro acesso)
  if (needChange) return <Shell user={null} openHelp={() => setHelp(true)}><ChangePassword user={user} forced onDone={() => { setNeedChange(false); setUser({ ...user, mustChange: false }); }} onLogout={logout} />{helpModal}{toastEl}</Shell>;

  // dentro de um PDV → workspace
  if (pdv) return (<>
    <Workspace key={pdv.id} user={user} pdv={pdv} hotelName={(hotels.find((h) => h.id === pdv.hotelId) || {}).name || ""}
      onExit={() => { setPdv(null); if (hotelId) api.listPdvs(hotelId).then(setPdvs).catch(() => {}); }} onLogout={logout} openHelp={() => setHelp(true)} />
    {helpModal}{toastEl}
  </>);

  // admin gerenciando usuários
  if (adminView === "users" && can.manageUsers(user)) return (
    <Shell user={user} onLogout={logout} openHelp={() => setHelp(true)} crumbs="Administração › Usuários">
      <UsersScreen hotels={hotels} me={user} onBack={() => setAdminView(null)} flash={flash} />{helpModal}{toastEl}
    </Shell>
  );

  // escolher PDV dentro do hotel
  if (hotelId) {
    const hotel = hotels.find((h) => h.id === hotelId);
    return (
      <Shell user={user} onLogout={logout} openHelp={() => setHelp(true)} crumbs={<span><button className="crumb-link" onClick={() => setHotelId(null)}>Hotéis</button> › {hotel ? hotel.name : ""}</span>}>
        <div className="sel-brand"><div className="stamp big">PAR<br />STOCK</div><div><div className="sel-t">{hotel ? hotel.name : "Hotel"}</div><div className="sel-s">Escolha um ponto de venda</div></div></div>
        <div className="row gap" style={{ marginBottom: 10 }}><button className="ghost" onClick={() => setHotelId(null)}>← Hotéis</button></div>
        {pdvs.length === 0 && <div className="card"><div className="empty">Nenhum PDV neste hotel ainda.{can.managePdvs(user) ? " Crie o primeiro abaixo." : " Peça ao gerente ou administrador."}</div></div>}
        {pdvs.map((p) => (
          <div className="pdvitem" key={p.id}>
            <div className="grow"><div className="pdv-n">{p.name}</div>{p.pending ? <div className="pdv-h"><span className="sbadge pend">⏳ {p.pending} aguardando validação</span></div> : null}</div>
            {can.manageHotels(user) && <button className="ghost danger" onClick={() => removePdv(p.id)}>remover</button>}
            <button className="primary" onClick={() => setPdv(p)}>Entrar</button>
          </div>
        ))}
        {can.managePdvs(user) && (<>
          <div className="divider">criar PDV</div>
          <div className="card"><div className="row wrap gap">
            <label className="fld grow">Nome do PDV<input className="tinp full" value={newPdv} placeholder="ex.: Minibar / Bar / Loja" onChange={(e) => setNewPdv(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPdv()} /></label>
            <button className="primary self-end" disabled={!newPdv.trim()} onClick={addPdv}>Criar PDV</button>
          </div></div>
        </>)}
        {helpModal}{toastEl}
      </Shell>
    );
  }

  // escolher hotel
  return (
    <Shell user={user} onLogout={logout} openHelp={() => setHelp(true)} crumbs="Hotéis">
      <div className="sel-brand"><div className="stamp big">PAR<br />STOCK</div><div><div className="sel-t">Hotéis</div><div className="sel-s">Selecione um hotel para continuar</div></div></div>
      {can.manageUsers(user) && <div className="row gap" style={{ marginBottom: 10 }}><button className="ghost" onClick={() => setAdminView("users")}>Gerenciar usuários</button></div>}
      {hotels.length === 0 && <div className="card"><div className="empty">{can.manageHotels(user) ? "Nenhum hotel cadastrado. Crie o primeiro abaixo." : "Você ainda não está vinculado a nenhum hotel. Peça ao administrador."}</div></div>}
      {hotels.map((h) => (
        <div className="pdvitem" key={h.id}>
          <div className="grow"><div className="pdv-n">{h.name}</div></div>
          <button className="primary" onClick={() => setHotelId(h.id)}>Abrir</button>
        </div>
      ))}
      {can.manageHotels(user) && (<>
        <div className="divider">criar hotel</div>
        <div className="card"><div className="row wrap gap">
          <label className="fld grow">Nome do hotel<input className="tinp full" value={newHotel} placeholder="ex.: Ibis Styles Botafogo" onChange={(e) => setNewHotel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addHotel()} /></label>
          <button className="primary self-end" disabled={!newHotel.trim()} onClick={addHotel}>Criar hotel</button>
        </div></div>
      </>)}
      {helpModal}{toastEl}
    </Shell>
  );
}

/* ============ ESTILO ============ */
const CSS = `
:root{--paper:#f3f5f1;--card:#ffffff;--ink:#1c2b2d;--dim:#5c6b66;--line:#dfe4dd;--green:#0e7c66;--green-d:#0a5d4d;--amber:#dc9a2e;--amber-bg:#fbf1dd;--red:#be4b3f;--red-bg:#f9e7e4;--green-bg:#e4f1ec;}
*{box-sizing:border-box}
.app{min-height:100vh;background:var(--paper);color:var(--ink);font:14px/1.45 "Segoe UI",system-ui,-apple-system,Roboto,sans-serif;padding-bottom:120px}
.mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
h2{font-family:Futura,"Century Gothic","Avenir Next","Segoe UI",sans-serif;font-size:19px;letter-spacing:.04em;text-transform:uppercase;margin:0}
.boot{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3f5f1}
.bootcard{padding:18px 26px;border:1px solid #dfe4dd;border-radius:12px;background:#fff;color:#5c6b66}
.hdr{background:var(--ink);color:#f3f5f1}
.hdr-in{max-width:1150px;margin:0 auto;padding:14px 16px 0;display:flex;flex-direction:column;gap:10px}
.brand{display:flex;gap:12px;align-items:center}
.stamp{font-family:Futura,"Century Gothic",sans-serif;font-weight:700;font-size:11px;line-height:1.05;letter-spacing:.14em;border:2px solid var(--amber);color:var(--amber);padding:5px 7px;border-radius:4px;transform:rotate(-3deg)}
.stamp.sm{transform:none;border-color:var(--ink);color:var(--ink)}
.brand-t{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#9fb0aa}
.tabs{display:flex;gap:2px;overflow-x:auto}
.tab{appearance:none;border:none;background:transparent;color:#9fb0aa;padding:9px 14px;font:600 13px "Segoe UI",sans-serif;cursor:pointer;border-radius:8px 8px 0 0;white-space:nowrap}
.tab.on{background:var(--paper);color:var(--ink)}
.main{max-width:1150px;margin:0 auto;padding:18px 16px}
section>*+*{margin-top:14px}
.row{display:flex;align-items:center}.between{justify-content:space-between}.wrap{flex-wrap:wrap;gap:10px}.gap{gap:10px}.grow{flex:1}.self-end{align-self:flex-end}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.card.pad0{padding:0;overflow:hidden}
.card-t{font:700 11px Futura,"Century Gothic",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-bottom:10px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
.kpi-n{font-size:26px;font-weight:700}
.kpi-n.bad{color:var(--red)}.kpi-n.amber{color:var(--amber)}
.kpi-l{font-size:12px;font-weight:600;margin-top:2px}
.kpi-s{font-size:11px;color:var(--dim)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media(max-width:760px){.grid2{grid-template-columns:1fr}}
.tbl{width:100%;border-collapse:collapse;font-size:13px}
.tbl th{font:700 10.5px Futura,"Century Gothic",sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--dim);padding:9px 8px;border-bottom:1px solid var(--line);text-align:center;background:#fafbf9}
.tbl td{padding:6px 8px;border-bottom:1px solid #edf0ec;text-align:center}
.tbl .tl{text-align:left}
.tbl tr:last-child td{border-bottom:none}
.tbl.wide{min-width:1080px}
.scrollx{overflow-x:auto}
.conc-scroll{max-height:max(340px,calc(100vh - 250px));overflow:auto}
.conc-scroll thead th{position:sticky;top:0;z-index:3;box-shadow:0 1px 0 var(--line)}
.conc-scroll thead th.sticky{z-index:4}
.sticky{position:sticky;left:0;background:#fff;z-index:1;min-width:190px;box-shadow:1px 0 0 var(--line)}
.tbl th.sticky{background:#fafbf9}
.inph{background:#fbf6ea!important}
.rowdone td{background:#f6faf8}
.ninp{border:1px solid var(--line);border-radius:8px;padding:6px;text-align:center;font:600 13px ui-monospace,Menlo,monospace;background:#fffdf6;outline:none;-moz-appearance:textfield;appearance:textfield}
.ninp::-webkit-outer-spin-button,.ninp::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
.ninp:focus{border-color:var(--green);background:#fff}
.tinp{border:1px solid var(--line);border-radius:8px;padding:7px 9px;font:13px "Segoe UI",sans-serif;outline:none;background:#fff}
.tinp:focus{border-color:var(--green)}
.tinp.full{width:100%}
.jinp{width:150px;background:#fffdf6}
.jprint{display:none}
.ct2{display:none}
.dinp{border:1px solid var(--line);border-radius:8px;padding:6px 8px;font:600 13px ui-monospace,Menlo,monospace;background:#fff;outline:none}
.fld{display:flex;flex-direction:column;gap:4px;font:600 11px "Segoe UI",sans-serif;color:var(--dim)}
.datenav{display:flex;align-items:center;gap:5px}
button{cursor:pointer}
.primary{background:var(--green);color:#fff;border:none;border-radius:9px;padding:9px 16px;font:700 13px "Segoe UI",sans-serif}
.primary:hover{background:var(--green-d)}
.primary:disabled{opacity:.6;cursor:default}
.ghost{background:#fff;border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:600 12px "Segoe UI",sans-serif;color:var(--ink)}
.ghost:hover{border-color:var(--green);color:var(--green)}
.ghost.today{text-transform:uppercase;letter-spacing:.06em;font-size:10.5px}
.ghost.danger{color:var(--red)}.ghost.danger:hover{border-color:var(--red)}
.chip{background:#fff;border:1px solid var(--line);border-radius:999px;padding:6px 12px;font:600 12px "Segoe UI",sans-serif;color:var(--dim)}
.chip.on{background:var(--ink);border-color:var(--ink);color:#fff}
.filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.rangepick{display:flex;align-items:center;gap:6px}
.tag{display:inline-block;min-width:30px;padding:3px 8px;border-radius:7px;font:700 12px ui-monospace,Menlo,monospace}
.tag-a{background:var(--amber-bg);color:#8a5d10}
.tag-r{background:var(--red-bg);color:var(--red)}
.tag-g{background:var(--green-bg);color:var(--green-d)}
.dim{color:var(--dim)}.bad{color:var(--red)}.ok{color:var(--green-d)}.amber{color:var(--amber)}
.mark{color:var(--amber);font-weight:700;margin-left:2px;cursor:help}
.empty{padding:26px 16px;text-align:center;color:var(--dim)}
.empty.ok{color:var(--green-d)}
.hint{font-size:12px;color:var(--dim);margin:4px 2px 0}
.progress{font:600 12px "Segoe UI",sans-serif;color:var(--dim);align-self:flex-end;padding-bottom:8px}
.chain{display:flex;align-items:stretch;gap:6px;overflow-x:auto;padding:12px}
.chain-step{flex:1;min-width:118px;background:#fafbf9;border:1px solid var(--line);border-radius:10px;padding:9px 10px}
.chain-l{font:700 9.5px Futura,"Century Gothic",sans-serif;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.chain-v{font-size:19px;font-weight:700;margin-top:2px}
.chain-s{font-size:10.5px;color:var(--dim)}
.chain-a{align-self:center;color:var(--amber);font-size:17px;font-weight:700}
.legend{font-size:11px;color:var(--dim);margin-top:8px;display:flex;align-items:center}
.chartwrap{width:100%;overflow-x:auto}
.barsvg{width:100%;min-width:340px;height:230px;display:block}
.barsvg .bar{transition:opacity .15s ease}
.barsvg .barg:hover .bar{opacity:.82}
.dot{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:5px}
.rank{display:flex;align-items:center;gap:8px;padding:5px 0}
.rank-n{flex:0 0 46%;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rank-bar{flex:1;height:9px;background:#eef1ed;border-radius:5px;overflow:hidden}
.rank-bar i{display:block;height:100%;background:var(--green);border-radius:5px}
.rank-bar.loss i{background:var(--red)}
.rank-v{flex:0 0 34px;text-align:right;font-weight:700}
.rank-v2{flex:0 0 92px;text-align:right;font-weight:700}
.adj{font-size:10px;color:var(--dim);margin-top:2px;white-space:nowrap}
.histcard{margin-top:10px}
.histhead{display:flex;align-items:center;gap:14px;width:100%;background:#fff;border:none;padding:12px 14px;text-align:left;flex-wrap:wrap}
.histhead:hover{background:#fafbf9}
.histdate{font-weight:700;font-size:15px}
.histkpis{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--ink);flex:1}
.histact{font:700 11px "Segoe UI",sans-serif;color:var(--green);text-transform:uppercase;letter-spacing:.06em}
.histfoot{padding:10px 14px;border-top:1px solid var(--line)}
.totrow td{background:#fafbf9;font-weight:700}
.savebar{position:fixed;left:50%;transform:translateX(-50%);bottom:52px;background:var(--ink);color:#fff;border-radius:12px;padding:10px 12px 10px 16px;display:flex;align-items:center;gap:14px;box-shadow:0 8px 24px rgba(20,35,35,.35);z-index:40;max-width:94vw}
.savebar .primary{background:var(--amber);color:#231a05}
.toast{position:fixed;left:50%;transform:translateX(-50%);bottom:112px;background:var(--green);color:#fff;border-radius:10px;padding:9px 16px;font-weight:600;z-index:41;box-shadow:0 6px 18px rgba(0,0,0,.25)}
.warn{max-width:1150px;margin:10px auto 0;padding:9px 14px;background:var(--amber-bg);border:1px solid #ecd29a;border-radius:10px;color:#7a5410;font-size:12.5px}
.printhead{display:flex;gap:12px;align-items:center;padding:14px;border-bottom:1px solid var(--line)}
.signrow{display:flex;gap:40px;justify-content:space-around;padding:38px 24px 20px;flex-wrap:wrap;border-top:1px solid var(--line)}
.signbox{flex:1;max-width:290px;min-width:190px;text-align:center}
.signline{border-bottom:1.5px solid var(--ink);height:30px}
.signlabel{font:700 10px Futura,"Century Gothic",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);margin-top:7px}
.ph-t{font:700 15px Futura,"Century Gothic",sans-serif;letter-spacing:.06em}
.ph-s{font-size:12px;color:var(--dim)}
@media print{
 html,body{height:auto!important;overflow:visible!important}
 .app{padding-bottom:0!important}
 body *{visibility:hidden}
 .print-zone,.print-zone *{visibility:visible}
 .print-zone{position:absolute;left:0;top:0;width:100%;height:auto!important;overflow:visible!important;border:none!important;border-radius:0!important}
 .conc-scroll{max-height:none!important;overflow:visible!important}
 .conc-scroll thead th{position:static!important;box-shadow:none!important}
 .no-print{display:none!important}
 .tbl{page-break-inside:auto}
 .tbl tr{page-break-inside:avoid}
 .tbl thead{display:table-header-group}
 .ninp{border:none!important;border-bottom:1px solid #555!important;border-radius:0!important;background:none!important;width:56px!important}
 .tinp{border:none!important;border-bottom:1px solid #bbb!important;border-radius:0!important;background:none!important}
 .print-zone .tbl.wide{min-width:0!important;font-size:9px}
 .print-zone .tbl.wide td,.print-zone .tbl.wide th{padding:3px 2px}
 .print-zone .tbl.wide th{font-size:7.5px}
 .print-zone .sticky{position:static!important;box-shadow:none!important;min-width:0!important}
 .print-zone .tbl.wide .ninp{width:30px!important;font-size:9px!important}
 .jprint{display:block;font-size:8.5px;line-height:1.3;max-width:130px;min-width:80px;white-space:normal;word-break:break-word;text-align:left}
 .ct2{display:table;width:100%}
 .ct2 td,.ct2 th{font-size:9.5px;padding:4px 5px}
 .ct2 th{font-size:8px}
 .ct-gap{width:16px;border-left:1px solid #ddd}
 .cline{display:inline-block;width:46px;height:12px}
 .signrow{page-break-inside:avoid;border-top:none!important;padding-top:46px!important}
 .tag{background:none!important;color:#000!important;font-weight:700}
}
@media(max-width:640px){.tbl{font-size:12px}.tbl td,.tbl th{padding:5px 5px}.sticky{min-width:140px}.ninp{width:54px!important}.jinp{width:110px}}
.hdr-top{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}
.hdr-actions{display:flex;gap:8px;align-items:center}
.pdv-title{font:700 17px Futura,"Century Gothic","Avenir Next",sans-serif;letter-spacing:.05em;color:#fff}
.helpbtn{width:32px;height:32px;border-radius:50%;border:2px solid var(--amber);background:transparent;color:var(--amber);font:700 16px Futura,"Century Gothic",sans-serif;line-height:1}
.helpbtn:hover{background:var(--amber);color:#1c2b2d}
.helpbtn.green{border-color:var(--green);color:var(--green);background:#fff}
.helpbtn.green:hover{background:var(--green);color:#fff}
.switchbtn{background:transparent;border:1px solid #46605c;color:#c9d6d1;border-radius:8px;padding:7px 11px;font:600 11px "Segoe UI",sans-serif;text-transform:uppercase;letter-spacing:.06em}
.switchbtn:hover{border-color:var(--amber);color:var(--amber)}
.foot{position:fixed;left:0;right:0;bottom:0;z-index:30;background:var(--ink);color:#9fb0aa;padding:9px 16px;font-size:12px;text-align:center}
.foot a{color:var(--amber);text-decoration:none;font-weight:600}
.foot b{color:#e8ecea}
.filebtn{display:inline-flex;align-items:center;cursor:pointer}
.modal-ov{position:fixed;inset:0;background:rgba(20,35,35,.55);display:flex;align-items:center;justify-content:center;z-index:90;padding:16px}
.modal{background:#fff;border-radius:14px;max-width:380px;width:100%;padding:20px;position:relative;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:var(--ink)}
.modal-x{position:absolute;top:8px;right:12px;background:none;border:none;font-size:22px;color:var(--dim);cursor:pointer}
.modal h3{margin:0 0 4px;font:700 14px Futura,"Century Gothic",sans-serif;letter-spacing:.08em;text-transform:uppercase}
.contact{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.contact a{display:flex;align-items:center;gap:10px;border:1px solid var(--line);border-radius:10px;padding:10px 12px;text-decoration:none;color:var(--ink);font-weight:600}
.contact a:hover{border-color:var(--green);color:var(--green)}
.cicon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font:700 14px Futura,sans-serif;color:#fff;flex:none}
.sel{min-height:100vh;background:var(--paper);display:flex;flex-direction:column;font:14px/1.45 "Segoe UI",system-ui,sans-serif;color:var(--ink)}
.sel-help{position:fixed;top:14px;right:14px;z-index:10}
.sel-main{flex:1;display:flex;align-items:flex-start;justify-content:center;padding:48px 16px 70px}
.sel-card{width:100%;max-width:440px}
.sel-brand{display:flex;gap:14px;align-items:center;margin-bottom:18px}
.stamp.big{font-size:14px;padding:8px 10px;border-color:var(--green);color:var(--green)}
.sel-t{font:700 20px Futura,"Century Gothic",sans-serif;letter-spacing:.05em;text-transform:uppercase}
.sel-s{color:var(--dim);font-size:12.5px}
.pdvitem{display:flex;align-items:center;gap:8px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-bottom:8px;flex-wrap:wrap}
.pdvitem .grow{flex:1;min-width:140px}
.pdv-h{font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--dim)}
.pdv-n{font:700 15px Futura,"Century Gothic",sans-serif}
.divider{display:flex;align-items:center;gap:10px;color:var(--dim);font:700 10px Futura,sans-serif;letter-spacing:.18em;text-transform:uppercase;margin:16px 0 10px}
.divider:before,.divider:after{content:"";flex:1;height:1px;background:var(--line)}
.sel .primary{background:var(--ink)}
.sel .primary:hover{background:#0f1a1c}
.sel .ghost{color:var(--ink)}
.sel .ghost:hover{border-color:var(--ink);color:var(--ink)}
.sel .ghost.danger{color:var(--ink)}
.sel .ghost.danger:hover{border-color:var(--ink)}
.sel .helpbtn{border-color:var(--ink);color:var(--ink);background:#fff}
.sel .helpbtn:hover{background:var(--ink);color:#fff}
.sel .stamp.big{border-color:var(--ink);color:var(--ink)}

/* ---- animações sutis ---- */
@keyframes fadeUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes popIn{from{opacity:0;transform:translateY(10px) scale(.97)}to{opacity:1;transform:none}}
@keyframes growBar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
.main section{animation:fadeUp .28s ease both}
.sel-card{animation:fadeUp .32s ease both}
button{transition:background .16s ease,color .16s ease,border-color .16s ease,transform .12s ease,box-shadow .16s ease}
.primary:active,.ghost:active,.chip:active,.helpbtn:active,.switchbtn:active{transform:scale(.96)}
.tab{transition:background .18s ease,color .18s ease}
.kpi{transition:transform .18s ease,box-shadow .18s ease}
.kpi:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(28,43,45,.08)}
.pdvitem{transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
.pdvitem:hover{transform:translateY(-2px);box-shadow:0 6px 16px rgba(28,43,45,.08);border-color:#c8d2cb}
.ninp,.tinp,.dinp{transition:border-color .15s ease,box-shadow .15s ease,background .15s ease}
.ninp:focus,.tinp:focus,.dinp:focus{box-shadow:0 0 0 3px rgba(14,124,102,.13)}
.rowdone td{transition:background .35s ease}
.histhead{transition:background .15s ease}
.histcard .scrollx{animation:fadeUp .22s ease both}
.rank-bar i{transform-origin:left;animation:growBar .55s ease both}
.tag{animation:fadeIn .25s ease both}
.savebar{animation:popIn .25s ease both}
.toast{animation:popIn .22s ease both}
.modal-ov{animation:fadeIn .18s ease both}
.modal{animation:popIn .22s ease both}
.chain-step{transition:transform .18s ease,border-color .18s ease}
.chain-step:hover{transform:translateY(-2px);border-color:#c8d2cb}
@media (prefers-reduced-motion: reduce){*,*:before,*:after{animation:none!important;transition:none!important}}

/* ---- contas, papéis, validação ---- */
.who{display:flex;flex-direction:column;line-height:1.1;text-align:right;margin-right:2px}
.who-n{font-weight:700;font-size:12.5px;color:#fff}
.who-r{font-size:10px;color:#9fb0aa;letter-spacing:.04em}
.who.dark .who-n{color:var(--ink)}
.who.dark .who-r{color:var(--dim)}
.bell{position:relative;background:transparent;border:1px solid #46605c;color:#fff;border-radius:9px;padding:6px 8px;font-size:15px;line-height:1}
.bell:hover{border-color:var(--amber)}
.bell-n{position:absolute;top:-7px;right:-7px;background:var(--amber);color:#231a05;border-radius:999px;font:700 10px "Segoe UI",sans-serif;min-width:17px;height:17px;display:flex;align-items:center;justify-content:center;padding:0 4px}
.tabdot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--amber);margin-left:6px;vertical-align:middle}
.robar{max-width:1150px;margin:10px auto 0;padding:9px 14px;background:#eef3f6;border:1px solid #cfdde3;border-radius:10px;color:#37535d;font-size:12.5px}
.statusbar{max-width:1150px;margin:0 0 4px;padding:10px 14px;border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:13px}
.statusbar.ok{background:var(--green-bg);border:1px solid #bfe0d4;color:var(--green-d)}
.statusbar.pend{background:var(--amber-bg);border:1px solid #ecd29a;color:#7a5410}
.primary.sm{padding:6px 12px;font-size:12px}
.sbadge{display:inline-block;padding:2px 9px;border-radius:999px;font:700 11px "Segoe UI",sans-serif}
.sbadge.ok{background:var(--green-bg);color:var(--green-d)}
.sbadge.pend{background:var(--amber-bg);color:#8a5d10}
.sbadge.dim{background:#eef1ed;color:var(--dim)}
.histcard.hl-pend{border-color:#ecd29a;box-shadow:0 0 0 2px rgba(220,154,46,.12)}
.histfoot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.ninp:disabled,.tinp:disabled,.dinp:disabled{background:#f1f3f0;color:#9aa6a0;cursor:not-allowed;-webkit-text-fill-color:#9aa6a0}
select.tinp{appearance:auto;background:#fff;height:34px}
.fld.block{display:block;margin-bottom:8px}
.fld.block .tinp{margin-top:3px}
.primary.block,.tinp.full{width:100%}
.primary.block{margin-top:6px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.crumbs{font-size:11.5px;color:var(--dim);margin-top:2px}
.crumb-link{background:none;border:none;color:var(--green);font:inherit;cursor:pointer;padding:0;text-decoration:underline}

/* ---- barra superior das telas de seleção (Shell) ---- */
.sel-bar{background:#fff;border-bottom:1px solid var(--line)}
.sel-bar-in{max-width:1150px;margin:0 auto;padding:12px 16px;display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.brand-t.dark{color:var(--dim)}
.sel-bar .stamp{border-color:var(--ink);color:var(--ink);transform:none}
.switchbtn.dark{border-color:var(--line);color:var(--ink)}
.switchbtn.dark:hover{border-color:var(--green);color:var(--green)}
`;
