import { useState, useEffect, useRef, useCallback } from "react";

const BACKEND = (process.env.REACT_APP_BACKEND_URL || "https://gekko-backend-production.up.railway.app").replace(/\/$/, "");
const WS_URL = BACKEND.replace("https://", "wss://").replace("http://", "ws://") + "/ws";

const greekColor = (val, type) => {
  if (type === "delta") return val > 0 ? "#00ffc8" : "#ff4466";
  if (type === "gamma") return "#f0c040";
  if (type === "theta") return "#ff6b35";
  if (type === "iv") return val > 18 ? "#ff4466" : "#00ffc8";
  return "#fff";
};

function PnLBar({ pct }) {
  const c = Math.max(-1, Math.min(1, pct / 0.5));
  const g = pct >= 0;
  return (
    <div style={{ position: "relative", height: 10, background: "#111", borderRadius: 6, border: "1px solid #1e2a2a" }}>
      <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "#2a2a2a" }} />
      <div style={{
        position: "absolute",
        left: g ? "50%" : `${50 + c * 50}%`,
        width: `${Math.abs(c) * 50}%`,
        top: 1, bottom: 1,
        background: g ? "linear-gradient(90deg,#00ffc8,#00cc99)" : "linear-gradient(90deg,#ff4466,#cc2244)",
        borderRadius: 4, transition: "all 0.6s ease",
        boxShadow: g ? "0 0 6px #00ffc855" : "0 0 6px #ff446655",
      }} />
      <div style={{ position: "absolute", left: "75%", top: -1, bottom: -1, width: 1.5, background: "#00ffc8", opacity: 0.4 }} />
      <div style={{ position: "absolute", left: "25%", top: -1, bottom: -1, width: 1.5, background: "#ff4466", opacity: 0.4 }} />
    </div>
  );
}

const MOCK = [
  { strike: 25900, type: "CE", ltp: 28, iv: 22.1, delta: 0.15, gamma: 0.001, theta: -9.8, oi: 2100000, iv_mismatch: 5.4, overpriced: true },
  { strike: 25800, type: "CE", ltp: 67, iv: 18.9, delta: 0.28, gamma: 0.002, theta: -14.2, oi: 3120000, iv_mismatch: 3.7, overpriced: true },
  { strike: 25700, type: "CE", ltp: 124, iv: 16.2, delta: 0.42, gamma: 0.003, theta: -18.4, oi: 2840000, iv_mismatch: 0.5, overpriced: false },
  { strike: 25600, type: "PE", ltp: 98, iv: 15.1, delta: -0.38, gamma: 0.003, theta: -16.8, oi: 2650000, iv_mismatch: 0.8, overpriced: false },
  { strike: 25500, type: "PE", ltp: 44, iv: 19.4, delta: -0.22, gamma: 0.002, theta: -12.1, oi: 3480000, iv_mismatch: 4.2, overpriced: true },
  { strike: 25400, type: "PE", ltp: 18, iv: 21.6, delta: -0.12, gamma: 0.001, theta: -7.4, oi: 1900000, iv_mismatch: 6.1, overpriced: true },
];

export default function Gekko() {
  const [tab, setTab] = useState("chat");
  const [wsStatus, setWsStatus] = useState("connecting");
  const [snap, setSnap] = useState(null);
  const [localLog, setLocalLog] = useState([{ sender: "SYSTEM", time: "--:--", text: "Connecting to GEKKO backend...", type: "info" }]);
  const [input, setInput] = useState("");
  const chatRef = useRef(null);
  const wsRef = useRef(null);
  const rTimer = useRef(null);

  const spot = snap?.spot || 25662;
  const vix = snap?.vix || 14.8;
  const ivRank = snap?.iv_rank || 62;
  const pnl = snap?.session_pnl || 0;
  const pnlPct = snap?.pnl_pct || 0;
  const positions = snap?.positions || [];
  const chain = snap?.option_chain?.length ? snap.option_chain : MOCK;
  const logItems = snap?.log?.length ? snap.log : localLog;
  const running = !!snap?.active_strategy;
  const activeStrat = snap?.active_strategy;
  const authStatus = snap?.auth || "disconnected";
  const capital = snap?.config?.capital || 500000;
  const target = snap?.target || 2500;
  const sl = snap?.sl || 2500;

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [logItems, localLog]);

  const ts = () => {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      ws.onopen = () => {
        setWsStatus("live");
        setLocalLog(p => [...p, { sender: "SYSTEM", time: ts(), text: "Connected to GEKKO backend ✓", type: "info" }]);
      };
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "snapshot") setSnap(m.data);
      };
      ws.onclose = () => { setWsStatus("offline"); rTimer.current = setTimeout(connect, 3000); };
      ws.onerror = () => { setWsStatus("offline"); ws.close(); };
    } catch (e) {
      setWsStatus("offline");
      rTimer.current = setTimeout(connect, 3000);
    }
  }, []);

  useEffect(() => {
    connect();
    return () => { clearTimeout(rTimer.current); wsRef.current?.close(); };
  }, [connect]);

  const sendWs = (cmd) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(cmd));
    else setLocalLog(p => [...p, { sender: "SYSTEM", time: ts(), text: "Not connected to backend.", type: "alert" }]);
  };

  const [aiThinking, setAiThinking] = useState(false);
  const handleLogin = () => window.open(`${BACKEND}/login`, "_blank");

  const sendMsg = async () => {
    const m = input.toLowerCase().trim();
    const raw = input.trim();
    if (!raw) return;
    setLocalLog(p => [...p, { sender: "YOU", time: ts(), text: raw, type: "info" }]);
    setInput("");

    // Trading commands — handle directly
    if (m.includes("strategy a") || m.includes("credit spread")) { sendWs({ cmd: "start_strategy", strategy: "A" }); return; }
    if (m.includes("strategy b") || m.includes("iron condor")) { sendWs({ cmd: "start_strategy", strategy: "B" }); return; }
    if (m.includes("stop all") || m.includes("close all")) { sendWs({ cmd: "stop" }); return; }
    if (m === "stop" || m === "close") { sendWs({ cmd: "stop" }); return; }
    if (m.includes("login")) { handleLogin(); return; }

    // Everything else — send to Claude AI
    setAiThinking(true);
    try {
      const context = snap ? `
Current market state:
- Nifty Spot: ${snap.spot}
- VIX: ${snap.vix}
- IV Rank: ${snap.iv_rank}
- Active Strategy: ${snap.active_strategy || "None"}
- Open Positions: ${snap.positions?.length || 0}
- Session P&L: ₹${snap.session_pnl?.toFixed(0) || 0} (${snap.pnl_pct?.toFixed(3) || 0}%)
- Zerodha Auth: ${snap.auth}
- Top overpriced options: ${snap.option_chain?.filter(o => o.overpriced).slice(0, 3).map(o => `${o.strike}${o.type} IV:${o.iv}% mismatch:+${o.iv_mismatch}σ`).join(", ") || "scanning..."}
` : "Market data loading...";

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are GEKKO, an expert AI trading assistant for Nifty options trading on NSE India. You help the trader make smart decisions about options strategies, IV analysis, Greeks interpretation, and risk management.

You have access to live market data and can advise on:
- Whether to start Strategy A (IV Credit Spread) or Strategy B (Iron Condor)
- Reading IV mismatches and Greeks (delta, gamma, theta, vega)
- When to take profits or cut losses
- General options trading education
- Market conditions and what they mean

Trading controls available:
- "start strategy a" or "start strategy b" to activate
- "stop" to close all positions

Keep responses concise and actionable. You're speaking to a trader on their iPhone. Current market context: ${context}`,
          messages: [{ role: "user", content: raw }]
        })
      });

      const data = await response.json();
      const reply = data.content?.[0]?.text || "Sorry, I couldn't process that.";
      setLocalLog(p => [...p, { sender: "GEKKO", time: ts(), text: reply, type: "info" }]);
    } catch (e) {
      // Fallback if API fails
      if (m.includes("scan") || m.includes("status")) {
        sendWs({ cmd: "scan" });
      } else {
        setLocalLog(p => [...p, { sender: "GEKKO", time: ts(), text: `Spot: ${snap?.spot || "--"} | VIX: ${snap?.vix || "--"} | IV Rank: ${snap?.iv_rank || "--"} | P&L: ₹${snap?.session_pnl?.toFixed(0) || 0}`, type: "info" }]);
      }
    } finally {
      setAiThinking(false);
    }
  };

  const C = { bg: "#06090a", panel: "#080c0d", border: "#0f1a1a", green: "#00ffc8", orange: "#ff6b35", red: "#ff4466", yellow: "#f0c040" };

  return (
    <div style={{ fontFamily: "'JetBrains Mono','Fira Code',monospace", background: C.bg, minHeight: "100vh", color: "#ccc", display: "flex", flexDirection: "column", fontSize: 12 }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes glow{0%,100%{box-shadow:0 0 4px #00ffc855}50%{box-shadow:0 0 14px #00ffc8bb}}
        @keyframes fadein{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1e2a2a;border-radius:2px}
        .ll{display:flex;gap:10px;margin-bottom:3px;animation:fadein 0.2s ease}
        .tab{background:none;border:none;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:2px;padding:9px 16px;text-transform:uppercase;border-bottom:2px solid transparent;color:#444;transition:color 0.2s}
        .tab.on{color:#00ffc8;border-bottom-color:#00ffc8}
        .btn{background:none;border:1px solid #1e2a2a;cursor:pointer;font-family:inherit;font-size:10px;letter-spacing:1px;padding:7px 14px;border-radius:3px;text-transform:uppercase;color:#555;transition:all 0.2s}
        .btn:disabled{opacity:0.25;cursor:default}
        .G{border-color:#00ffc8;color:#00ffc8}.O{border-color:#ff6b35;color:#ff6b35}.R{border-color:#ff4466;color:#ff4466}.Y{border-color:#f0c040;color:#f0c040}
        input{background:none;border:none;outline:none;color:#ccc;font-family:inherit;font-size:11px;flex:1}
        .badge{padding:1px 6px;border-radius:2px;font-size:8px;letter-spacing:1px}
        th{padding:7px 10px;text-align:left;color:#2a4040;font-size:9px;letter-spacing:1px;font-weight:400}
        td{padding:9px 10px}
      `}</style>

      {/* HEADER */}
      <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 30, height: 30, background: "linear-gradient(135deg,#00ffc8,#007755)", borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, color: "#000", fontSize: 15, animation: running ? "glow 2s infinite" : "none" }}>G</div>
          <div>
            <div style={{ color: "#fff", fontWeight: 700, letterSpacing: 3, fontSize: 13 }}>GEKKO</div>
            <div style={{ color: "#333", fontSize: 8, letterSpacing: 2 }}>NIFTY OPTIONS AI · {wsStatus === "live" ? "LIVE" : "OFFLINE"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
          {[["NIFTY", spot.toLocaleString("en-IN"), "#fff"], ["VIX", vix.toFixed ? vix.toFixed(1) : vix, C.yellow], ["IV RANK", ivRank, C.orange]].map(([l, v, c]) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: c, fontFamily: "monospace" }}>{v}</div>
              <div style={{ fontSize: 8, color: "#555", letterSpacing: 2 }}>{l}</div>
            </div>
          ))}
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: pnl >= 0 ? C.green : C.red }}>{pnl >= 0 ? "+" : ""}₹{Math.abs(pnl).toFixed(0)}</div>
            <div style={{ fontSize: 8, color: "#444", letterSpacing: 2 }}>P&L</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: wsStatus === "live" ? C.green : wsStatus === "connecting" ? C.yellow : C.red, animation: wsStatus === "live" ? "pulse 1.8s infinite" : "none" }} />
              <span style={{ fontSize: 8, color: "#555" }}>{wsStatus.toUpperCase()}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: authStatus === "connected" ? C.green : "#333" }} />
              <span style={{ fontSize: 8, color: "#555" }}>{authStatus === "connected" ? "ZERODHA ✓" : "NOT AUTHED"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* AUTH BANNER */}
      {authStatus !== "connected" && (
        <div style={{ background: "rgba(240,192,64,0.07)", borderBottom: "1px solid rgba(240,192,64,0.15)", padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 10, color: C.yellow }}>⚠ Auto-login in progress — or tap to login manually.</span>
          <button className="btn Y" onClick={handleLogin}>LOGIN →</button>
        </div>
      )}

      {/* PNL BAR */}
      <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, padding: "8px 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
          <span style={{ fontSize: 9, color: C.red }}>SL −0.5% (−₹{sl.toLocaleString("en-IN")})</span>
          <span style={{ fontSize: 9, color: pnl >= 0 ? C.green : C.red }}>{pnl >= 0 ? "+" : ""}{typeof pnlPct === "number" ? pnlPct.toFixed(3) : pnlPct}% · ₹{pnl.toFixed ? pnl.toFixed(0) : pnl}</span>
          <span style={{ fontSize: 9, color: C.green }}>TGT +0.5% (+₹{target.toLocaleString("en-IN")})</span>
        </div>
        <PnLBar pct={pnlPct} />
      </div>

      {/* STRATEGY BUTTONS */}
      <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, padding: "8px 16px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className={`btn ${activeStrat === "A" && running ? "G" : ""}`} disabled={running || authStatus !== "connected"} onClick={() => sendWs({ cmd: "start_strategy", strategy: "A" })}>▶ Strategy A — IV Spread</button>
        <button className={`btn ${activeStrat === "B" && running ? "O" : ""}`} disabled={running || authStatus !== "connected"} style={{ borderColor: (!running && authStatus === "connected") ? "#ff6b35" : "#1e2a2a", color: (!running && authStatus === "connected") ? "#ff6b35" : "#444" }} onClick={() => sendWs({ cmd: "start_strategy", strategy: "B" })}>▶ Strategy B — Iron Condor</button>
        {running && <button className="btn R" onClick={() => sendWs({ cmd: "stop" })}>■ STOP ALL</button>}
        <div style={{ marginLeft: "auto", fontSize: 9, color: "#2a3a3a" }}>₹{capital.toLocaleString("en-IN")} · 50 lot · Rolls {snap?.roll_count || 0}/5</div>
      </div>

      {/* TABS */}
      <div style={{ background: C.panel, borderBottom: `1px solid ${C.border}`, display: "flex" }}>
        {[["chat", "📡 CHAT"], ["chain", "📊 CHAIN"], ["positions", `📋 LEGS (${positions.length})`], ["config", "⚙ CONFIG"]].map(([k, l]) => (
          <button key={k} className={`tab ${tab === k ? "on" : ""}`} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* CHAT */}
        {tab === "chat" && <>
          <div ref={chatRef} style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
            {logItems.map((m, i) => (
              <div key={i} className="ll" style={{ flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ color: "#333", fontSize: 10, minWidth: 38 }}>{m.time}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: m.sender === "GEKKO" ? C.green : m.sender === "SYSTEM" ? C.yellow : "#aaa" }}>{m.sender}</span>
                </div>
                <div style={{ fontSize: 12, color: m.type === "trade" ? C.orange : m.type === "alert" ? "#ffcc44" : m.sender === "YOU" ? "#fff" : "#999", paddingLeft: 48, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{m.text}</div>
              </div>
            ))}
            {(running || aiThinking) && (
              <div className="ll" style={{ flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", gap: 10 }}>
                  <span style={{ color: "#333", fontSize: 10, minWidth: 38 }}></span>
                  <span style={{ color: C.green, fontSize: 10, fontWeight: 600 }}>GEKKO</span>
                </div>
                <div style={{ paddingLeft: 48, color: "#1a4a2a", animation: "pulse 1.2s infinite", fontSize: 11 }}>
                  {aiThinking ? "● thinking..." : "● monitoring positions..."}
                </div>
              </div>
            )}
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 16px", paddingBottom: "calc(12px + env(safe-area-inset-bottom))", display: "flex", alignItems: "center", gap: 10, background: C.panel, position: "sticky", bottom: 0 }}>
            <span style={{ color: C.green, fontSize: 16 }}>›</span>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !aiThinking && sendMsg()}
              placeholder="Ask GEKKO anything about the market..."
              style={{ fontSize: 13, padding: "4px 0" }}
              disabled={aiThinking}
            />
            <button className="btn G" onClick={sendMsg} disabled={aiThinking} style={{ minWidth: 60 }}>
              {aiThinking ? "..." : "SEND"}
            </button>
          </div>
        </>}

        {/* CHAIN */}
        {tab === "chain" && (
          <div style={{ overflowY: "auto", padding: 16 }}>
            <div style={{ fontSize: 9, color: "#333", letterSpacing: 2, marginBottom: 10 }}>{wsStatus === "live" ? "LIVE" : "DEMO"} CHAIN · NIFTY · SPOT {spot.toLocaleString("en-IN")} · VIX {vix.toFixed ? vix.toFixed(1) : vix}</div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{["STRIKE", "TYPE", "LTP", "IV %", "DELTA", "GAMMA", "THETA", "OI", "SIGNAL"].map(h => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {chain.map((o, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #0a0d0e", background: o.overpriced ? "rgba(255,107,53,0.04)" : "transparent" }}>
                    <td style={{ color: "#fff", fontWeight: 600 }}>{o.strike}</td>
                    <td style={{ color: o.type === "CE" ? C.green : C.orange }}>{o.type}</td>
                    <td>{o.ltp}</td>
                    <td style={{ color: greekColor(o.iv, "iv"), fontWeight: o.overpriced ? 600 : 400 }}>{o.iv}%</td>
                    <td style={{ color: greekColor(o.delta, "delta") }}>{o.delta}</td>
                    <td style={{ color: C.yellow }}>{o.gamma}</td>
                    <td style={{ color: C.orange }}>{o.theta}</td>
                    <td style={{ color: "#555" }}>{(o.oi / 100000).toFixed(1)}L</td>
                    <td>{o.overpriced ? <span className="badge" style={{ background: "rgba(255,107,53,0.12)", color: C.orange, border: "1px solid rgba(255,107,53,0.3)" }}>SELL +{o.iv_mismatch}σ</span> : <span style={{ color: "#2a3a3a", fontSize: 9 }}>FAIR</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* POSITIONS */}
        {tab === "positions" && (
          <div style={{ padding: 16, overflowY: "auto" }}>
            {positions.length === 0
              ? <div style={{ color: "#1e2a2a", textAlign: "center", marginTop: 60 }}>No active positions.<br /><span style={{ fontSize: 10, color: "#1a2020" }}>Start a strategy to begin.</span></div>
              : <>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead><tr style={{ borderBottom: `1px solid ${C.border}` }}>{["SYMBOL", "QTY", "ENTRY", "LTP", "P&L", "Δ", "Θ", "SIDE"].map(h => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>
                    {positions.map((p, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #0a0d0e" }}>
                        <td style={{ color: "#ddd", fontWeight: 600, fontSize: 10 }}>{p.symbol}</td>
                        <td style={{ color: "#555" }}>{p.qty}</td>
                        <td>{p.entry?.toFixed(2)}</td>
                        <td>{p.ltp?.toFixed(2)}</td>
                        <td style={{ color: p.pnl >= 0 ? C.green : C.red, fontWeight: 600 }}>{p.pnl >= 0 ? "+" : ""}₹{p.pnl?.toFixed(0)}</td>
                        <td style={{ color: greekColor(p.delta, "delta") }}>{p.delta?.toFixed(3)}</td>
                        <td style={{ color: C.orange }}>{p.theta?.toFixed(2)}</td>
                        <td><span className="badge" style={{ background: p.side === "sell" ? "rgba(0,255,200,0.08)" : "rgba(255,107,53,0.08)", color: p.side === "sell" ? C.green : C.orange, border: `1px solid ${p.side === "sell" ? "rgba(0,255,200,0.2)" : "rgba(255,107,53,0.2)"}` }}>{p.side?.toUpperCase()}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ marginTop: 12, padding: 14, background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 8, color: "#333", letterSpacing: 2 }}>NET P&L</div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: pnl >= 0 ? C.green : C.red, marginTop: 3 }}>{pnl >= 0 ? "+" : ""}₹{pnl.toFixed ? pnl.toFixed(0) : pnl} <span style={{ fontSize: 11, opacity: 0.5 }}>({typeof pnlPct === "number" ? pnlPct.toFixed(3) : pnlPct}%)</span></div>
                  </div>
                  <div style={{ width: 180 }}><PnLBar pct={pnlPct} /></div>
                </div>
              </>
            }
          </div>
        )}

        {/* CONFIG */}
        {tab === "config" && (
          <div style={{ padding: 16, overflowY: "auto" }}>
            <div style={{ marginBottom: 16, padding: 12, background: "rgba(240,192,64,0.06)", border: "1px solid rgba(240,192,64,0.15)", borderRadius: 4 }}>
              <div style={{ fontSize: 9, color: C.yellow, letterSpacing: 2, marginBottom: 6 }}>ZERODHA AUTH</div>
              <div style={{ fontSize: 11, color: "#888" }}>Status: <span style={{ color: authStatus === "connected" ? C.green : C.red }}>{authStatus}</span></div>
              {snap?.token_expires && <div style={{ fontSize: 10, color: "#555", marginTop: 4 }}>Expires: {snap.token_expires}</div>}
              {authStatus !== "connected" && <button className="btn Y" style={{ marginTop: 8 }} onClick={handleLogin}>MANUAL LOGIN →</button>}
            </div>
            {[
              { title: "RISK", color: C.green, rows: [["Capital", `₹${capital.toLocaleString("en-IN")}`], ["Target", `+₹${target.toLocaleString("en-IN")} (0.5%)`], ["Stop Loss", `-₹${sl.toLocaleString("en-IN")} (0.5%)`], ["Max Rolls", snap?.config?.max_rolls || 5]] },
              { title: "STRATEGY A", color: C.green, rows: [["IV Mismatch", `≥${snap?.config?.iv_mismatch_threshold || 2.0}σ`], ["Hedge Pre-noon", `${snap?.config?.pre_noon_hedge_pts || 400}pts`], ["Hedge Post-noon", `${snap?.config?.post_noon_hedge_pts || 300}pts`], ["Exit", "50% decay"]] },
              { title: "STRATEGY B", color: C.orange, rows: [["IV Rank Entry", `>${snap?.config?.iv_rank_entry || 60}`], ["Short Delta", `Δ ${snap?.config?.delta_short_min || 0.20}–${snap?.config?.delta_short_max || 0.30}`], ["Wing Width", `${snap?.config?.condor_wing_width || 100}pts`], ["Adjust", `Δ>${snap?.config?.adjustment_delta || 0.45}`]] },
              { title: "BACKEND", color: "#555", rows: [["WebSocket", WS_URL], ["Status", wsStatus], ["Backend", BACKEND]] },
            ].map(sec => (
              <div key={sec.title} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 9, color: sec.color, letterSpacing: 2, marginBottom: 6 }}>{sec.title}</div>
                <div style={{ background: C.panel, border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
                  {sec.rows.map(([k, v], i) => (
                    <div key={i} style={{ padding: "9px 14px", display: "flex", justifyContent: "space-between", borderBottom: i < sec.rows.length - 1 ? `1px solid #0a0d0e` : "none" }}>
                      <span style={{ color: "#555", fontSize: 11 }}>{k}</span>
                      <span style={{ color: "#888", fontSize: 11, fontFamily: "monospace", wordBreak: "break-all" }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
