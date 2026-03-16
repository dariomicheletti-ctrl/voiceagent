const express = require("express");
const app = express();
app.use(express.json());

// ── DATI IN MEMORIA ─────────────────────────────────────
const sessions = [];
const consents = [];
const adminTokens = new Set();
const ADMIN_CODE = "202011";

// ── HELPER ───────────────────────────────────────────────
function getToken(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/admin_token=([^;]+)/);
  return match ? match[1] : null;
}

function authAdmin(req, res, next) {
  const token = getToken(req);
  if (token && adminTokens.has(token)) return next();
  res.status(401).json({ error: "Non autorizzato" });
}

function sendPage(res, filename) {
  res.sendFile(filename, { root: __dirname + "/public" }, function(err) {
    if (err) {
      console.error("Errore file:", filename, err.message);
      res.status(500).send("Errore caricamento pagina: " + filename);
    }
  });
}

// ── API: REGISTRAZIONE ───────────────────────────────────
app.post("/api/register", function(req, res) {
  var body = req.body;
  if (!body.phone || !body.consent1 || !body.consent2) {
    return res.status(400).json({ ok: false, error: "Consensi obbligatori mancanti" });
  }
  consents.push({
    phone: body.phone,
    consent1: true,
    consent2: true,
    consent3: !!body.consent3,
    timestamp: body.timestamp || new Date().toISOString()
  });
  res.json({ ok: true });
});

// ── API: ADMIN LOGIN/LOGOUT ──────────────────────────────
app.post("/api/admin/login", function(req, res) {
  if (req.body.code === ADMIN_CODE) {
    var token = Date.now().toString(36) + Math.random().toString(36).slice(2);
    adminTokens.add(token);
    res.setHeader("Set-Cookie", "admin_token=" + token + "; Path=/; HttpOnly; SameSite=Strict");
    res.json({ ok: true });
  } else {
    res.json({ ok: false });
  }
});

app.post("/api/admin/logout", function(req, res) {
  var token = getToken(req);
  if (token) adminTokens.delete(token);
  res.setHeader("Set-Cookie", "admin_token=; Path=/; Max-Age=0");
  res.json({ ok: true });
});

// ── API: SESSIONI ────────────────────────────────────────
app.post("/api/session/start", function(req, res) {
  var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  sessions.push({
    id: id,
    scenario: req.body.scenario || "reception",
    phone: req.body.phone || "",
    startedAt: new Date().toISOString(),
    duration: 0,
    messages: []
  });
  res.json({ id: id });
});

app.post("/api/session/message", function(req, res) {
  var s = sessions.find(function(x) { return x.id === req.body.sessionId; });
  if (s) s.messages.push({ role: req.body.role, content: req.body.content });
  res.json({ ok: true });
});

app.post("/api/session/end", function(req, res) {
  var s = sessions.find(function(x) { return x.id === req.body.sessionId; });
  if (s) s.duration = req.body.duration || 0;
  res.json({ ok: true });
});

app.get("/api/sessions", authAdmin, function(req, res) {
  res.json(sessions);
});

app.get("/api/consents", authAdmin, function(req, res) {
  res.json(consents);
});

// ── API: EXPORT CSV ──────────────────────────────────────
app.get("/api/export/csv/calls", authAdmin, function(req, res) {
  var csv = "ID,Telefono,Data,Scenario,Durata(s),Ruolo,Messaggio\n";
  sessions.forEach(function(s) {
    (s.messages || []).forEach(function(m) {
      csv += '"' + s.id + '","' + s.phone + '","' + s.startedAt + '","' + s.scenario + '","' + s.duration + '","' + m.role + '","' + m.content.replace(/"/g, '""') + '"\n';
    });
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=chiamate.csv");
  res.send(csv);
});

app.get("/api/export/csv/consents", authAdmin, function(req, res) {
  var csv = "Telefono,Data,ConsensoServizio,ConsensoArchiviazione,ConsensoMarketing\n";
  consents.forEach(function(c) {
    csv += '"' + c.phone + '","' + c.timestamp + '","' + c.consent1 + '","' + c.consent2 + '","' + c.consent3 + '"\n';
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=consensi.csv");
  res.send(csv);
});

// ── API: CHAT GROQ ───────────────────────────────────────
app.post("/api/chat", async function(req, res) {
  var body = req.body;
  var system = body.system;
  var messages = body.messages;
  var sessionId = body.sessionId;

  if (sessionId && messages && messages.length) {
    var last = messages[messages.length - 1];
    var s = sessions.find(function(x) { return x.id === sessionId; });
    if (s) s.messages.push({ role: last.role, content: last.content });
  }

  try {
    var response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        max_tokens: 300,
        messages: [{ role: "system", content: system }].concat(messages)
      })
    });
    var data = await response.json();
    var reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "Mi dispiace, puo ripetere?";
    if (sessionId) {
      var s2 = sessions.find(function(x) { return x.id === sessionId; });
      if (s2) s2.messages.push({ role: "assistant", content: reply });
    }
    res.json({ reply: reply });
  } catch (err) {
    console.error("Groq error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── PAGINE ───────────────────────────────────────────────
app.get("/", function(req, res) {
  sendPage(res, "register.html");
});

app.get("/agent", function(req, res) {
  sendPage(res, "agent.html");
});

app.get("/admin", function(req, res) {
  sendPage(res, "login.html");
});

app.get("/admin/dashboard", function(req, res) {
  var token = getToken(req);
  if (!token || !adminTokens.has(token)) return res.redirect("/admin");
  sendPage(res, "dashboard.html");
});

// ── AVVIO ────────────────────────────────────────────────
var PORT = process.env.PORT || 3000;
app.listen(PORT, function() {
  console.log("VoiceAgent attivo su porta " + PORT);
});
