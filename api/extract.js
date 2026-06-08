// Función serverless de Vercel: lee una captura y devuelve las compras detectadas.
// La API key vive SOLO en el servidor (variable de entorno), nunca en el navegador.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método no permitido" });
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "Falta ANTHROPIC_API_KEY en las variables de entorno de Vercel." });
  }

  try {
    const { image, media_type } = req.body || {};
    if (!image) return res.status(400).json({ error: "No llegó ninguna imagen." });

    const prompt = [
      "Eres un extractor de compras de Bitcoin desde una captura de pantalla de un exchange o wallet.",
      "Devuelve SOLO JSON válido, sin markdown ni texto extra, con este esquema exacto:",
      '{"purchases":[{"date":"YYYY-MM-DD","priceUsd":<numero>,"amountBtc":<numero>,"side":"buy"}]}',
      "Reglas:",
      "- priceUsd = precio de 1 BTC en USD en el momento de la compra. Si solo ves el costo total y la cantidad, calcula priceUsd = costoTotal / amountBtc.",
      "- amountBtc = cantidad comprada en BTC. Si está en satoshis (sats), conviértela: 1 BTC = 100000000 sats.",
      "- Incluye SOLO operaciones de compra (buy). Ignora ventas (sell) y depósitos.",
      "- Si no hay fecha visible, usa \"\".",
      "- Si no encuentras ninguna compra, devuelve {\"purchases\":[]}.",
    ].join("\n");

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: media_type || "image/jpeg", data: image } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(502).json({ error: (data && data.error && data.error.message) || "Error de la API de Claude" });
    }

    const text = (data.content || []).map((b) => b.text || "").join("").trim();
    const clean = text.replace(/```json/g, "").replace(/```/g, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      const match = clean.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { purchases: [] };
    }

    const purchases = (parsed.purchases || [])
      .filter((p) => !p.side || String(p.side).toLowerCase() !== "sell")
      .map((p) => ({
        date: p.date || "",
        priceUsd: Number(p.priceUsd) || null,
        amountBtc: Number(p.amountBtc) || null,
      }))
      .filter((p) => p.amountBtc || p.priceUsd);

    return res.status(200).json({ purchases });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Error inesperado en el servidor." });
  }
}
