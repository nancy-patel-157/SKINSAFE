// SkinSafe backend: keeps the API key off the browser and hides the upload->task->poll flow.
import 'dotenv/config';
import express from "express";

const BASE = "https://yce-api-01.makeupar.com";
const KEY = process.env.YOUCAM_API_KEY;
const DEMO = process.env.DEMO_MODE === "true" || !KEY;
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.static("public"));

async function yc(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: H, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`YouCam ${r.status} on ${path}: ${JSON.stringify(j)}`);
  return j;
}

app.post("/api/analyze", async (req, res) => {
  if (DEMO) { await sleep(1200); return res.json({ demo: true, results: DEMO_RESULT }); }
  try {
    const buf = Buffer.from(req.body.image.split(",")[1], "base64");
    // 1) File API -> upload URL + file_id.
    const f = await yc("/s2s/v2.0/file/skin-analysis", {
      method: "POST",
      body: JSON.stringify({ files: [{ content_type: "image/jpeg", file_name: "selfie.jpg", file_size: buf.length }] })
    });
    const file = f.data.files[0];
    await fetch(file.requests[0].url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: buf });

    // 2) Create task.
    const t = await yc("/s2s/v2.0/task/skin-analysis", {
      method: "POST",
      body: JSON.stringify({
        src_file_id: file.file_id,
        dst_actions: ["acne","oiliness","moisture","pore","wrinkle","age_spot","redness","texture","dark_circle_v2","eye_bag","firmness","radiance","skin_type"],
        miniserver_args: { enable_mask_overlay: false },
        format: "json"
      })
    });

    // 3) Poll until done.
    for (let i = 0; i < 30; i++) {
      await sleep(2000);
      const s = await yc(`/s2s/v2.0/task/skin-analysis/${t.data.task_id}`);
      if (s.data.task_status === "success") return res.json({ results: s.data.results });
      if (s.data.task_status === "error") throw new Error("Task failed: " + JSON.stringify(s.data));
    }
    throw new Error("Timed out");
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

const sc = (type, ui_score) => ({ type, ui_score });
const DEMO_RESULT = {
  output: [
    sc("acne", 99), sc("oiliness", 65), sc("moisture", 65), sc("pore", 79),
    sc("wrinkle", 71), sc("age_spot", 72), sc("redness", 97), sc("texture", 74),
    sc("dark_circle_v2", 72), sc("eye_bag", 58), sc("firmness", 84),
    { type: "skin_type", region: "whole", skin_type: "Oily" }
  ]
};

app.listen(3000, () => console.log(`SkinSafe on http://localhost:3000 ${DEMO ? "(DEMO MODE)" : ""}`));