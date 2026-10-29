import 'dotenv/config';
import express from "express";
import { GoogleGenAI } from "@google/genai";

const BASE = "https://yce-api-01.makeupar.com";
const KEY = process.env.YOUCAM_API_KEY;
const DEMO = process.env.DEMO_MODE === "true" || !KEY;
const H = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const ai = new GoogleGenAI({});

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static("public"));

async function yc(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: H, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`YouCam ${r.status} on ${path}: ${JSON.stringify(j)}`);
  return j;
}

const sc = (type, ui_score) => ({ type, ui_score });
const DEMO_RESULT = {
  output: [
    sc("acne", 82), sc("oiliness", 77), sc("moisture", 78), sc("pore", 70),
    sc("wrinkle", 85), sc("age_spot", 85), sc("redness", 99), sc("texture", 97),
    sc("dark_circle_v2", 65), sc("eye_bag", 85), sc("firmness", 95), sc("radiance", 88),
    { type: "skin_type", region: "whole", skin_type: "Combination" }
  ]
};

// 1. YouCam Skin Analysis Endpoint (Jo abhi fail ho raha hai)
app.post("/api/analyze", async (req, res) => {
  if (DEMO) {
    await sleep(1000);
    return res.json({ demo: true, results: DEMO_RESULT });
  }
  try {
    const buf = Buffer.from(req.body.image.split(",")[1], "base64");
    const f = await yc("/s2s/v2.0/file/skin-analysis", {
      method: "POST",
      body: JSON.stringify({ files: [{ content_type: "image/jpeg", file_name: "selfie.jpg", file_size: buf.length }] })
    });
    const file = f.data.files[0];
    await fetch(file.requests[0].url, { method: "PUT", headers: { "Content-Type": "image/jpeg" }, body: buf });

    const t = await yc("/s2s/v2.0/task/skin-analysis", {
      method: "POST",
      body: JSON.stringify({
        src_file_id: file.file_id,
        dst_actions: ["acne","oiliness","moisture","pore","wrinkle","age_spot","redness","texture","dark_circle_v2","eye_bag","firmness","radiance","skin_type"],
        miniserver_args: { enable_mask_overlay: false },
        format: "json"
      })
    });

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

// 2. Gemini Vision Bottle Scan Endpoint
app.post("/api/analyze-bottle", async (req, res) => {
  try {
    const { image, skinType, concerns } = req.body;
    if (!image) return res.status(400).json({ error: "Image is required" });

    const base64Data = image.includes(",") ? image.split(",")[1] : image;
    const mimeType = image.includes(";") ? image.split(";")[0].split(":")[1] : "image/jpeg";

    const prompt = `
You are a dermatologist evaluating a skincare product label.
Patient Skin Type: ${skinType || "Combination"}
Patient Concerns: ${(concerns || []).join(", ") || "General"}

1. Check if this is a skincare label. If not, return is_skincare: false.
2. Extract the active ingredients.
3. Compare against skin concerns. If beneficial, recommend "Buy".
4. Return JSON:
{
  "is_skincare": true,
  "product_name": "Product Name",
  "extracted_ingredients": ["ingredient1"],
  "verdict": "Buy" | "Maybe" | "Skip",
  "routine_timing": "AM" | "PM" | "Both",
  "reasoning": "Clinical reasoning",
  "conflicts_or_warnings": []
}`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{
        role: "user",
        parts: [
          { text: prompt },
          { inlineData: { data: base64Data, mimeType: mimeType } }
        ]
      }],
      config: { responseMimeType: "application/json" }
    });

    res.json(JSON.parse(response.text));
  } catch (error) {
    console.error("Gemini Vision Error:", error);
    res.status(500).json({ error: "Failed to analyze product label." });
  }
});

app.listen(3000, () => console.log("SkinSafe on http://localhost:3000"));