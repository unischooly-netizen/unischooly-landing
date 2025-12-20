import crypto from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const ZOOM_WEBHOOK_SECRET = process.env.ZOOM_WEBHOOK_SECRET;

  // 1️⃣ Handle Zoom URL validation (first time only)
  if (req.body?.event === "endpoint.url_validation") {
    const hash = crypto
      .createHmac("sha256", ZOOM_WEBHOOK_SECRET)
      .update(req.body.payload.plainToken)
      .digest("hex");

    return res.json({
      plainToken: req.body.payload.plainToken,
      encryptedToken: hash,
    });
  }

  // 2️⃣ Handle real events
  const event = req.body.event;
  const payload = req.body.payload;

  console.log("Zoom Event Received:", event);

  if (event === "meeting.ended") {
    const meetingId = payload.object.id;

    // TODO: Update Supabase here (Step 13)
    console.log("Meeting ended:", meetingId);
  }

  res.status(200).json({ received: true });
}
