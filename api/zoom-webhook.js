import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const event = req.body?.event;

  // 🔐 Zoom URL validation
  if (event === "endpoint.url_validation") {
    const plainToken = req.body.payload.plainToken;

    const encryptedToken = crypto
      .createHmac("sha256", process.env.ZOOM_WEBHOOK_SECRET)
      .update(plainToken)
      .digest("hex");

    return res.status(200).json({
      plainToken,
      encryptedToken,
    });
  }

  // ✅ Future events (meeting ended, started etc.)
  return res.status(200).json({ status: "received" });
}
